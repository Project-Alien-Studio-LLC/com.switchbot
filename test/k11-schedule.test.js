'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const K11Monitor = require('../lib/k11-monitor');
const schedule = require('../lib/k11-schedule');
const { sample, MINUTE } = require('../lib/k11-safety');
const realNow = Date.now;
let now = Date.parse('2026-09-04T09:00:00Z');
Date.now = () => now;
after(() => { Date.now = realNow; });
const args = { schedule: 'morning', scene: { id: 'morning-native', name: 'Morning Clean' }, time: '05:00', days: '0,1,2,3,4,5,6', decision: 'run' };
const data = (workingStatus = 'ChargeDone', extra = {}) => ({ workingStatus, onlineStatus: 'online', battery: 100, ...extra });

function fixture(response = { statusCode: 100 }, initial = {})
{
	now = Date.parse('2026-09-04T09:00:00Z');
	let saved = structuredClone({ presence: 'away', awaySince: now - 31 * MINUTE, presenceUpdatedAt: now - 31 * MINUTE, ...initial });
	const commands = [];
	const events = [];
	const capabilities = {};
	const device = {
		getStoreValue: () => structuredClone(saved),
		setStoreValue: async (key, value) => { saved = structuredClone(value); },
		setCapabilityValue: async (id, value) => { capabilities[id] = value; },
		getSettings: () => ({ k11_room_scene: 'morning-native', k11_room_verified: true, k11_morning_scene: 'quiet-morning-native' }),
		error: () => {},
		homey: {
			app: {}, clock: { getTimezone: () => 'America/New_York' },
			flow: { getDeviceTriggerCard: (id) => ({ trigger: async (dev, tokens) => events.push({ id, ...tokens }) }) },
			drivers: { getDriver: () => ({ getDevices: () => [{
				getData: () => ({ id: 'morning-native' }), getAvailable: () => true,
				getOAuth2ClientForDevice: () => ({ startScene: async (id) => { commands.push(id); return response; } }),
			}] }) },
		},
	};
	const monitor = new K11Monitor(device);
	device.getHubDeviceValues = async () => { await monitor.record(data()); return data(); };
	return { monitor, device, commands, events, capabilities, saved: () => saved };
}

test('slot validates exact local day/time, rejects accidental tests and DST replay keys', () => {
	const time = Date.parse('2026-09-04T09:00:00Z');
	assert.equal(schedule.slot(args, time, 'America/New_York').id, '2026-09-04:morning');
	assert.throws(() => schedule.slot(args, time - MINUTE, 'America/New_York'), /Outside/);
	assert.throws(() => schedule.slot(args, time + 3 * MINUTE, 'America/New_York'), /Outside/);
	assert.throws(() => schedule.slot({ ...args, days: '0,6' }, time, 'America/New_York'), /Outside/);
	for (const value of [{ schedule: '' }, { scene: null }, { days: '9' }, { time: '25:00' }, { decision: 'other' }])
	{
		assert.throws(() => schedule.slot({ ...args, ...value }, time, 'America/New_York'));
	}
	const dst = { ...args, time: '01:30' };
	assert.equal(schedule.slot(dst, Date.parse('2026-11-01T05:30Z'), 'America/New_York').id, schedule.slot(dst, Date.parse('2026-11-01T06:30Z'), 'America/New_York').id);
});

test('5am is allowed without the unrelated legacy quiet-hours or once-daily limits', async () => {
	const f = fixture();
	await f.monitor.runSchedule(args);
	assert.deepEqual(f.commands, ['morning-native']);
	assert.equal(f.saved().lastScheduleEvent.stage, 'requested');
	assert.ok(f.saved().pendingStartAt);
	assert.equal(f.events.filter((e) => e.id === 'k11_attention').length, 0);
});

test('pending scene requests do not show a start fault before the observation timeout', async () => {
	const f = fixture();
	await f.monitor.runSchedule(args);
	await f.monitor.tick();
	assert.equal(f.capabilities.k11_monitor_status, 'Monitoring — no problem reported');
	assert.equal(Object.hasOwn(f.saved().notified, 'start'), false);
	now += 2 * MINUTE;
	await f.monitor.tick();
	assert.equal(f.capabilities.k11_monitor_status, 'Needs attention: start');
	assert.equal(f.saved().lastScheduleEvent.stage, 'unconfirmed');
	assert.equal(f.events.filter((e) => e.id === 'k11_attention').length, 1);
	await f.monitor.tick();
	assert.equal(f.events.filter((e) => e.id === 'k11_attention').length, 1);
});

test('legacy empty notification markers are hidden but real unresolved faults remain visible', async () => {
	const f = fixture(undefined, { notified: { start: undefined } });
	await f.monitor.record(data());
	assert.equal(f.capabilities.k11_monitor_status, 'Monitoring — no problem reported');
	f.monitor.state.notified.start = now;
	await f.monitor.tick();
	assert.equal(f.capabilities.k11_monitor_status, 'Needs attention: start');
});

test('away-only decisions require at least 30 minutes of continuously recorded away time', async () => {
	for (const initial of [
		{ presence: undefined, awaySince: undefined },
		{ presence: 'home', awaySince: null },
		{ presence: 'away', awaySince: now - 29 * MINUTE },
		{ presence: 'away', awaySince: now + MINUTE },
	])
	{
		const f = fixture(undefined, initial);
		await f.monitor.runSchedule(args);
		assert.equal(f.commands.length, 0);
		assert.equal(f.saved().lastScheduleEvent.stage, 'skipped');
		assert.equal(f.events.filter((event) => event.id === 'k11_attention').length, 0);
	}
	const eligible = fixture(undefined, { presence: 'away', awaySince: now - 30 * MINUTE });
	await eligible.monitor.runSchedule(args);
	assert.equal(eligible.commands.length, 1);
});

const quietMorning = { ...args, scene: { id: 'quiet-morning-native', name: 'Quiet Morning' }, decision: 'quiet_morning' };

test('approved Quiet morning runs at home, away or unknown with all robot safety gates intact', async () => {
	for (const presence of ['home', 'away', undefined])
	{
		const f = fixture(undefined, { presence, awaySince: null });
		const scenes = f.device.homey.drivers.getDriver().getDevices();
		scenes[0].getData = () => ({ id: quietMorning.scene.id });
		f.device.homey.drivers.getDriver = () => ({ getDevices: () => scenes });
		await f.monitor.runSchedule(quietMorning);
		await f.monitor.runSchedule(quietMorning);
		assert.deepEqual(f.commands, [quietMorning.scene.id]);
	}
	for (const initial of [{ schedulesPaused: true }, { skipNext: true }])
	{
		const f = fixture(undefined, { presence: 'home', ...initial });
		await f.monitor.runSchedule(quietMorning);
		assert.equal(f.commands.length, 0);
	}
	for (const report of [data('Clearing'), data('ChargeDone', { battery: 20 }), data('ChargeDone', { onlineStatus: 'offline' })])
	{
		const f = fixture(undefined, { presence: 'home' });
		f.device.getHubDeviceValues = async () => { await f.monitor.record(report); return report; };
		await f.monitor.runSchedule(quietMorning);
		assert.equal(f.commands.length, 0);
		assert.equal(f.saved().lastScheduleEvent.stage, 'skipped');
	}
});

test('Quiet morning exception cannot apply to another scene, schedule or time', () => {
	for (const change of [{ schedule: 'evening' }, { time: '13:00' }, { scene: args.scene }])
	{
		assert.throws(() => schedule.slot({ ...quietMorning, ...change }, now, 'America/New_York', quietMorning.scene.id), /exception/);
	}
	assert.throws(() => schedule.slot(quietMorning, now, 'America/New_York'), /exception/);
	assert.throws(() => schedule.slot(quietMorning, Date.parse('2026-09-05T12:00Z'), 'America/New_York', quietMorning.scene.id), /Outside/);
});

test('presence tracking preserves a continuous away start and resets immediately on home', async () => {
	const initial = schedule.recordPresence({}, 'away', now - 40 * MINUTE);
	const repeated = schedule.recordPresence(initial, 'away', now - 10 * MINUTE);
	assert.equal(repeated.awaySince, now - 40 * MINUTE);
	assert.equal(schedule.awayBlockReason(repeated, now), null);
	const home = schedule.recordPresence(repeated, 'home', now);
	assert.equal(home.awaySince, null);
	assert.match(schedule.awayBlockReason(home, now), /home/);
	assert.throws(() => schedule.recordPresence(home, 'unknown', now));
});

test('a return home during status refresh blocks submission without an attention alert', async () => {
	const f = fixture();
	f.device.getHubDeviceValues = async () => {
		await f.monitor.record(data());
		await f.monitor.recordPresence('home');
		return data();
	};
	await f.monitor.runSchedule(args);
	assert.equal(f.commands.length, 0);
	assert.equal(f.saved().lastScheduleEvent.stage, 'skipped');
	assert.match(f.saved().lastScheduleEvent.message, /home/);
	assert.equal(f.events.filter((event) => event.id === 'k11_attention').length, 0);
});

test('duplicate and concurrent invocations execute once; restart retains reservation', async () => {
	const f = fixture();
	await Promise.all([f.monitor.runSchedule(args), f.monitor.runSchedule(args)]);
	const restarted = new K11Monitor(f.device);
	await restarted.runSchedule(args);
	assert.equal(f.commands.length, 1);
	assert.equal(f.saved().scheduleReservations.length, 1);
});

test('skip next is consumed at the next slot even when paused or home, without notification', async () => {
	for (const extra of [{}, { schedulesPaused: true }])
	{
		const f = fixture(undefined, { skipNext: true, ...extra });
		await f.monitor.runSchedule({ ...args, decision: 'home' });
		assert.equal(f.saved().skipNext, false);
		assert.match(f.saved().lastScheduleEvent.message, /Skip next/);
		assert.equal(f.commands.length, 0);
		assert.equal(f.events.filter((e) => e.id === 'k11_attention').length, 0);
	}
});

test('master pause persists; resume does not execute anything or clear skip', async () => {
	const f = fixture();
	await f.monitor.setScheduleControl('skipNext', true);
	await f.monitor.setScheduleControl('schedulesPaused', true);
	const restarted = new K11Monitor(f.device);
	await restarted.setScheduleControl('schedulesPaused', false);
	assert.equal(f.saved().skipNext, true);
	assert.equal(f.capabilities.k11_schedules_paused, false);
	assert.equal(f.commands.length, 0);
});

test('presence Else branch and paused schedules record honest skips and send no command', async () => {
	for (const reason of ['home', 'paused'])
	{
		const f = fixture(undefined, { schedulesPaused: reason === 'paused' });
		await f.monitor.runSchedule({ ...args, decision: reason === 'home' ? 'home' : 'run' });
		assert.equal(f.saved().lastScheduleEvent.stage, 'skipped');
		assert.equal(f.commands.length, 0);
	}
});

test('offline, low battery, unknown battery, busy, unfinished and stale states all fail closed', async () => {
	for (const report of [data('ChargeDone', { onlineStatus: 'offline' }), data('ChargeDone', { battery: 29 }), data('ChargeDone', { battery: null }), data('Clearing'), data('Paused')])
	{
		const f = fixture();
		f.device.getHubDeviceValues = async () => { await f.monitor.record(report); return report; };
		await f.monitor.runSchedule(args);
		assert.equal(f.commands.length, 0);
		assert.equal(f.saved().lastScheduleEvent.stage, 'skipped');
		assert.equal(f.events.filter((e) => e.id === 'k11_attention' && e.reason === 'schedule').length, 1);
		await f.monitor.runSchedule(args);
		assert.equal(f.events.filter((e) => e.id === 'k11_attention' && e.reason === 'schedule').length, 1);
	}
	for (const state of [{ runStartedAt: now }, { lastSeenAt: now - 3 * MINUTE }, { lastSeenAt: now + MINUTE }])
	{
		const f = fixture();
		f.monitor.state = { ...sample({}, data(), now), ...state };
		f.device.getHubDeviceValues = async () => data();
		await f.monitor.runSchedule(args);
		assert.equal(f.commands.length, 0);
	}
});

test('failed refresh or missing pairing cannot command; no fallback or replay', async () => {
	for (const failure of ['refresh', 'pairing'])
	{
		const f = fixture();
		if (failure === 'refresh') f.device.getHubDeviceValues = async () => null;
		else f.device.homey.drivers.getDriver = () => ({ getDevices: () => [] });
		await f.monitor.runSchedule(args);
		await f.monitor.runSchedule(args);
		assert.equal(f.commands.length, 0);
	}
});

test('uncertain or rejected acceptance is not called cleaning or retried', async () => {
	for (const response of [null, {}, { statusCode: 161 }])
	{
		const f = fixture(response);
		await f.monitor.runSchedule(args);
		await f.monitor.runSchedule(args);
		assert.equal(f.commands.length, 1);
		assert.equal(f.saved().lastScheduleEvent.stage, 'uncertain');
		assert.equal(f.saved().pendingStartAt, null);
		assert.equal(f.events.filter((e) => e.id === 'k11_attention').length, 1);
	}
});

test('telemetry tracks cleaning and docking but never says complete on pause or standby', async () => {
	const f = fixture();
	await f.monitor.runSchedule(args);
	now += MINUTE;
	await f.monitor.record(data('Clearing'));
	assert.equal(f.saved().lastScheduleEvent.stage, 'cleaning');
	await f.monitor.record(data('Paused'));
	await f.monitor.record(data('StandBy'));
	assert.equal(f.saved().lastScheduleEvent.stage, 'cleaning');
	await f.monitor.record(data('Charging'));
	assert.equal(f.saved().lastScheduleEvent.stage, 'docked');
	assert.match(f.saved().lastScheduleEvent.message, /not proof/);
	const count = f.events.length;
	await f.monitor.record(data('ChargeDone'));
	assert.equal(f.events.length, count);
});

test('a dock report without observed cleaning is not recorded as finished', async () => {
	const f = fixture();
	await f.monitor.runSchedule(args);
	now += 2 * MINUTE;
	await f.monitor.record(data());
	assert.equal(f.saved().lastScheduleEvent.stage, 'unconfirmed');
	assert.equal(f.saved().pendingStartAt, null);
	await f.monitor.tick();
	assert.equal(f.events.filter((e) => e.id === 'k11_attention').length, 1);
});

test('later approved slot can run the same day after fresh dock telemetry', async () => {
	const f = fixture();
	await f.monitor.runSchedule(args);
	await f.monitor.record(data('Clearing'));
	await f.monitor.record(data('ChargeDone'));
	now += 8 * 60 * MINUTE;
	await f.monitor.runSchedule({ ...args, schedule: 'afternoon', time: '13:00' });
	assert.equal(f.commands.length, 2);
	assert.equal(f.saved().scheduleReservations.length, 2);
});

test('persist failure cannot submit and rejected control persistence keeps old control', async () => {
	const f = fixture(undefined, { schedulesPaused: true });
	f.device.setStoreValue = async () => { throw new Error('storage unavailable'); };
	await assert.rejects(f.monitor.setScheduleControl('schedulesPaused', false), /storage/);
	assert.equal(f.monitor.state.schedulesPaused, true);
	await assert.rejects(f.monitor.runSchedule(args), /storage/);
	assert.equal(f.commands.length, 0);
});

test('pause while refreshing prevents scene submission', async () => {
	const f = fixture();
	f.device.getHubDeviceValues = async () => {
		await f.monitor.record(data());
		await f.monitor.setScheduleControl('schedulesPaused', true);
		return data();
	};
	await f.monitor.runSchedule(args);
	assert.equal(f.commands.length, 0);
	assert.match(f.saved().lastScheduleEvent.message, /paused/);
});

test('history and reservation retention are bounded', () => {
	let state = {};
	for (let i = 0; i < 200; i++)
	{
		const run = { id: String(i), schedule: String(i), at: now };
		state = schedule.reserve(state, run, now);
		state = schedule.event(state, run, 'skipped', 'test', now);
	}
	assert.equal(state.scheduleRuns.length, 30);
	assert.equal(state.scheduleReservations.length, 128);
});

test('slow refresh and uncertain command timeouts release the lock but never replay the slot', async () => {
	for (const stage of ['refresh', 'command'])
	{
		const f = fixture();
		f.monitor.scheduleTimeoutMs = 5;
		if (stage === 'refresh') f.device.getHubDeviceValues = () => new Promise(() => {});
		else f.device.homey.drivers.getDriver = () => ({ getDevices: () => [{ getData: () => ({ id: 'morning-native' }), getOAuth2ClientForDevice: () => ({ startScene: () => { f.commands.push('morning-native'); return new Promise(() => {}); } }) }] });
		await f.monitor.runSchedule(args);
		assert.equal(f.monitor.startInFlight, false);
		assert.equal(f.saved().lastScheduleEvent.stage, stage === 'refresh' ? 'skipped' : 'uncertain');
		await f.monitor.runSchedule(args);
		assert.equal(f.commands.length, stage === 'refresh' ? 0 : 1);
	}
});

test('token path requires explicit acceptance and never duplicates scene requests', async () => {
	for (const response of [true, null])
	{
		const f = fixture();
		f.device.homey.app.openToken = true;
		f.device.homey.app.hub = { startScene: async () => { f.commands.push('token'); return response; } };
		await f.monitor.runSchedule(args);
		await f.monitor.runSchedule(args);
		assert.equal(f.commands.length, 1);
		assert.equal(f.saved().lastScheduleEvent.stage, response ? 'requested' : 'uncertain');
	}
});

test('raw provider errors never enter the run log or notification', async () => {
	const f = fixture();
	f.device.getHubDeviceValues = async () => { throw new Error('secret-token-123'); };
	await f.monitor.runSchedule(args);
	assert.doesNotMatch(JSON.stringify(f.saved()) + JSON.stringify(f.events), /secret-token/);
});
