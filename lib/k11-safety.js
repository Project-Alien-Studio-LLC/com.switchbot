'use strict';

const MINUTE = 60000;
const normalize = (value) => String(value || '').toLowerCase();
const CLEANING = ['clearing', 'cleaning'];
const DOCKED = ['charging', 'chargedone'];
const STATUSES = [...CLEANING, ...DOCKED, 'standby', 'paused', 'gotochargebase', 'dormant', 'introuble', 'inremotecontrol', 'industcollecting'];

// Pure state transition: a pause/standby never means a completed cleaning job.
function sample(previous, data, now, webhook = false)
{
	const state = { ...previous, notified: { ...previous.notified } };
	const status = normalize(data && data.workingStatus);
	if (!STATUSES.includes(status)) return null;
	const timestamp = webhook && data.timeOfSample != null ? Number(data.timeOfSample) : now;
	if (!Number.isFinite(timestamp) || timestamp > now + MINUTE || timestamp < now - 5 * MINUTE || timestamp < (state.sampleAt || 0)) return null;
	state.sampleAt = timestamp;
	state.lastSeenAt = now;
	state.status = status;
	state.online = normalize(data.onlineStatus);
	state.battery = Number.isInteger(data.battery) && data.battery >= 0 && data.battery <= 100 ? data.battery : null;
	if (CLEANING.includes(status))
	{
		if (!state.runStartedAt) state.runStartedAt = now;
		state.pendingStartAt = null;
		delete state.notified.start;
	}
	if (status === 'gotochargebase' && !state.returnStartedAt) state.returnStartedAt = now;
	if (DOCKED.includes(status) && state.online !== 'offline')
	{
		state.runStartedAt = null;
		state.returnStartedAt = null;
		delete state.notified.return;
		delete state.notified.longrun;
	}
	if (status !== 'introuble') delete state.notified.trouble;
	if (state.online === 'online')
	{
		state.offlineSince = null;
		delete state.notified.offline;
		delete state.notified.stale;
	}
	else if (state.online === 'offline' && !state.offlineSince) state.offlineSince = now;
	return state;
}

function evaluate(previous, now)
{
	const state = { ...previous, notified: { ...previous.notified } };
	const alerts = [];
	const add = (reason, message) => {
		if (!state.notified[reason])
		{
			state.notified[reason] = now;
			alerts.push({ reason, message });
		}
	};
	const active = !!(state.runStartedAt || state.returnStartedAt);
	const fresh = state.lastSeenAt && now - state.lastSeenAt <= 5 * MINUTE;
	if (state.pendingStartAt && now - state.pendingStartAt >= 2 * MINUTE) add('start', 'K11+ room-start request has not been followed by a cleaning report. Check the robot; the request will not be automatically retried.');
	if (state.status === 'introuble') add('trouble', 'K11+ reports a problem. Check the robot and SwitchBot app.');
	if (state.offlineSince && now - state.offlineSince >= 5 * MINUTE) add('offline', 'K11+ has reported offline for at least 5 minutes. Check its connection.');
	if (active && !fresh) add('stale', 'K11+ status has not updated for 5 minutes during an unfinished run. Its location and completion are unknown.');
	if (fresh && state.online !== 'offline' && state.returnStartedAt && now - state.returnStartedAt >= 10 * MINUTE) add('return', 'K11+ has not reported docking 10 minutes after starting its return. Please check it.');
	if (fresh && state.online !== 'offline' && state.runStartedAt && now - state.runStartedAt >= 120 * MINUTE) add('longrun', 'K11+ has an unfinished cleaning session over 2 hours old (possibly paused). Please check it.');
	return { state, alerts };
}

function localClock(now, timeZone)
{
	const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
		timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
	}).formatToParts(new Date(now)).map(({ type, value }) => [type, value]));
	return { day: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function timeMinutes(value)
{
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) throw new Error('Use HH:MM for quiet hours');
	const [hour, minute] = value.split(':').map(Number);
	return hour * 60 + minute;
}

function assertStartAllowed(state, settings, now, timeZone, scheduled)
{
	if (!settings.k11_room_scene || settings.k11_room_verified !== true) throw new Error('Verify a vacuum-only room scene first');
	if (!state.lastSeenAt || state.lastSeenAt > now || now - state.lastSeenAt > 2 * MINUTE || state.online !== 'online') throw new Error('Fresh online robot status is required');
	if (!DOCKED.includes(state.status) && state.status !== 'standby') throw new Error('Robot is busy, paused, or not ready');
	if (state.runStartedAt || state.returnStartedAt) throw new Error('An unfinished session needs attention before a new start');
	if (state.battery == null || state.battery < 30) throw new Error('At least 30% reported battery is required');
	const clock = localClock(now, timeZone);
	if (scheduled)
	{
		if (settings.k11_schedule_armed !== true || settings.k11_test_verified !== true) throw new Error('Automatic cleaning is disabled pending the supervised test and schedule approval');
		const start = timeMinutes(settings.k11_quiet_start);
		const end = timeMinutes(settings.k11_quiet_end);
		if (start === end || (start < end ? clock.minute >= start && clock.minute < end : clock.minute >= start || clock.minute < end)) throw new Error('Automatic cleaning is blocked by quiet hours');
		if (state.lastAutomationDay === clock.day) throw new Error('Automatic cleaning has already been reserved today; no automatic retry');
	}
	return clock.day;
}

module.exports = { sample, evaluate, assertStartAllowed, localClock, timeMinutes, MINUTE };
