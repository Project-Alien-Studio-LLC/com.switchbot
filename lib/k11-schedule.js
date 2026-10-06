'use strict';

const { localClock, timeMinutes, MINUTE } = require('./k11-safety');

const MINIMUM_AWAY_MINUTES = 30;

// This is a per-slot guard, not the legacy once-per-day/quiet-hours scheduler.
// The Flow gates current presence; persisted transitions prove continuous-away time.
function slot(args, now, timeZone, morningSceneId)
{
	if (!/^[a-z0-9_-]{1,80}$/i.test(args.schedule || '')) throw new Error('A stable schedule key is required');
	if (!args.scene || typeof args.scene.id !== 'string' || !args.scene.id) throw new Error('A paired room scene is required');
	if (!['run', 'home', 'quiet_morning'].includes(args.decision)) throw new Error('Unknown schedule decision');
	if (args.decision === 'quiet_morning' && (args.schedule !== 'morning' || args.time !== '05:00'
		|| !morningSceneId || args.scene.id !== morningSceneId))
	{
		throw new Error('Home exception is limited to the approved 05:00 Quiet morning scene');
	}
	const days = String(args.days || '').split(',');
	if (!days.length || days.some((day) => !/^[0-6]$/.test(day))) throw new Error('Use comma-separated weekday numbers 0 through 6');
	const clock = localClock(now, timeZone);
	const weekday = String(new Date(`${clock.day}T12:00:00Z`).getUTCDay());
	const minute = timeMinutes(args.time);
	// A Flow Test or accidental manual invocation outside its slot cannot start it.
	if (!days.includes(weekday) || clock.minute < minute || clock.minute > minute + 2) throw new Error('Outside the approved schedule slot; no command sent');
	return { id: `${clock.day}:${args.schedule}`, schedule: args.schedule, scene: args.scene.name || args.scene.id, at: now };
}

function reserve(state, run, now)
{
	const reservations = (state.scheduleReservations || []).filter((item) => now - item.at < 14 * 24 * 60 * MINUTE);
	if (reservations.some((item) => item.id === run.id)) return null;
	return { ...state, scheduleReservations: [...reservations, { id: run.id, at: now }].slice(-128), skipNext: false };
}

function recordPresence(state, presence, now)
{
	if (!['home', 'away'].includes(presence)) throw new Error('Unknown presence state');
	if (!Number.isFinite(now)) throw new Error('A valid presence timestamp is required');
	if (presence === 'home')
	{
		return { ...state, presence: 'home', awaySince: null, presenceUpdatedAt: now };
	}
	const existingAwaySince = state.presence === 'away' && Number.isFinite(state.awaySince) && state.awaySince <= now
		? state.awaySince : now;
	return { ...state, presence: 'away', awaySince: existingAwaySince, presenceUpdatedAt: now };
}

function awayBlockReason(state, now, minimumMinutes = MINIMUM_AWAY_MINUTES)
{
	if (state.presence === 'home') return 'Homey reports you are home';
	if (state.presence !== 'away' || !Number.isFinite(state.awaySince) || state.awaySince > now) return 'Continuous away time is not verified';
	if (now - state.awaySince < minimumMinutes * MINUTE) return `Away for less than ${minimumMinutes} minutes`;
	return null;
}

function presenceBlockReason(state, args, now)
{
	// slot() validates the exact approved scene and time before this exception is used.
	return args.decision === 'quiet_morning' ? null : awayBlockReason(state, now);
}

function event(state, run, stage, message, now)
{
	const runs = [...(state.scheduleRuns || [])];
	const index = runs.findIndex((item) => item.id === run.id);
	const previous = index < 0 ? run : runs[index];
	const updated = { ...previous, stage, message, updatedAt: now };
	if (stage === 'requested') updated.requestedAt = now;
	if (stage === 'cleaning') updated.cleaningObservedAt = now;
	if (stage === 'docked') updated.dockedObservedAt = now;
	if (index >= 0) runs.splice(index, 1);
	runs.push(updated);
	return { ...state, scheduleRuns: runs.slice(-30), lastScheduleEvent: updated };
}

module.exports = { MINIMUM_AWAY_MINUTES, slot, reserve, recordPresence, awayBlockReason, presenceBlockReason, event };
