'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sample, evaluate, assertStartAllowed, localClock, MINUTE } = require('../lib/k11-safety');
const K11Monitor = require('../lib/k11-monitor');
const now = Date.parse('2026-09-04T16:00:00Z');
const data = (workingStatus = 'ChargeDone', extra = {}) => ({ workingStatus, onlineStatus: 'online', battery: 100, ...extra });
const settings = { k11_room_scene: 'room-scene', k11_room_verified: true, k11_test_verified: true, k11_schedule_armed: true, k11_quiet_start: '22:00', k11_quiet_end: '09:00' };

test('unchanged valid status refreshes receipt time, invalid and stale webhooks do not', () => {
	const first = sample({}, data(), now);
	assert.equal(sample(first, data(), now + MINUTE).lastSeenAt, now + MINUTE);
	assert.equal(sample(first, {}, now), null);
	assert.equal(sample(first, data('ChargeDone', { timeOfSample: now - 6 * MINUTE }), now, true), null);
	assert.equal(sample(first, data('ChargeDone', { timeOfSample: now + 2 * MINUTE }), now, true), null);
	assert.equal(sample(first, data('ChargeDone', { timeOfSample: now - 1 }), now, true), null);
	assert.equal(sample(first, data('ChargeDone', { timeOfSample: 'invalid' }), now, true), null);
});

test('pause and standby retain unfinished run; docking closes it without completion claim', () => {
	let state = sample({}, data('Clearing'), now);
	state = sample(state, data('Paused'), now + MINUTE);
	assert.equal(state.runStartedAt, now);
	assert.deepEqual(evaluate(state, now + MINUTE).alerts, []);
	state = sample(state, data('StandBy'), now + 2 * MINUTE);
	assert.equal(state.runStartedAt, now);
	state = sample(state, data('Charging'), now + 3 * MINUTE);
	assert.equal(state.runStartedAt, null);
	assert.deepEqual(evaluate(state, now + 3 * MINUTE).alerts, []);
});

test('trouble is deduplicated across persistence and rearms after recovery', () => {
	let result = evaluate(sample({}, data('InTrouble'), now), now);
	assert.equal(result.alerts[0].reason, 'trouble');
	result = evaluate(JSON.parse(JSON.stringify(result.state)), now + MINUTE);
	assert.equal(result.alerts.length, 0);
	let state = sample(result.state, data(), now + MINUTE);
	state = sample(state, data('InTrouble'), now + 2 * MINUTE);
	assert.equal(evaluate(state, now + 2 * MINUTE).alerts.length, 1);
});

test('missing updates during a run are not asserted to be offline or finished', () => {
	const state = sample({}, data('Clearing'), now);
	const { alerts } = evaluate(state, now + 6 * MINUTE);
	assert.deepEqual(alerts.map((item) => item.reason), ['stale']);
	assert.match(alerts[0].message, /unknown/);
});

test('explicit offline is debounced and only rearms after an online report', () => {
	let state = sample({}, data('ChargeDone', { onlineStatus: 'offline' }), now);
	assert.equal(evaluate(state, now + 4 * MINUTE).alerts.length, 0);
	state = evaluate(state, now + 5 * MINUTE).state;
	assert.equal(evaluate(state, now + 7 * MINUTE).alerts.length, 0);
	state = sample(state, data(), now + 8 * MINUTE);
	assert.equal(state.offlineSince, null);
});

test('failed return and long session alerts require fresh telemetry, not a stale guess', () => {
	let state = sample({}, data('GotoChargeBase'), now);
	assert.deepEqual(evaluate(state, now + 11 * MINUTE).alerts.map((item) => item.reason), ['stale']);
	state = sample(state, data('GotoChargeBase'), now + 11 * MINUTE);
	assert.deepEqual(evaluate(state, now + 11 * MINUTE).alerts.map((item) => item.reason), ['return']);
	state = sample({}, data('Clearing'), now);
	state = sample(state, data('Paused'), now + 121 * MINUTE);
	assert.equal(evaluate(state, now + 121 * MINUTE).alerts[0].reason, 'longrun');
});

test('scheduled starts require every gate; manual room start still requires safety', () => {
	const state = sample({}, data(), now);
	assert.equal(assertStartAllowed(state, settings, now, 'America/New_York', true), '2026-09-04');
	for (const key of ['k11_room_verified', 'k11_test_verified', 'k11_schedule_armed'])
	{
		assert.throws(() => assertStartAllowed(state, { ...settings, [key]: false }, now, 'America/New_York', true));
	}
	for (const altered of [{ ...state, online: 'offline' }, { ...state, lastSeenAt: now - 3 * MINUTE }, { ...state, battery: 29 }, { ...state, battery: null }, { ...state, status: 'paused' }, { ...state, status: 'clearing' }, { ...state, runStartedAt: now }, { ...state, returnStartedAt: now }])
	{
		assert.throws(() => assertStartAllowed(altered, settings, now, 'America/New_York', false));
	}
	assert.throws(() => assertStartAllowed({ ...state, lastAutomationDay: '2026-09-04' }, settings, now, 'America/New_York', true), /already/);
});

test('quiet hours cover midnight with Homey timezone and reject invalid or all-day windows', () => {
	for (const hour of ['02:00', '12:59'])
	{
		const time = Date.parse(`2026-09-04T${hour}:00Z`);
		assert.throws(() => assertStartAllowed(sample({}, data(), time), settings, time, 'America/New_York', true), /quiet/);
	}
	assert.throws(() => assertStartAllowed(sample({}, data(), now), { ...settings, k11_quiet_start: 'bad' }, now, 'America/New_York', true), /HH:MM/);
	assert.throws(() => assertStartAllowed(sample({}, data(), now), { ...settings, k11_quiet_end: '22:00' }, now, 'America/New_York', true), /quiet/);
	assert.equal(localClock(Date.parse('2026-09-05T01:00:00Z'), 'America/New_York').day, '2026-09-04');
});

function fixture(response = { statusCode: 100 })
{
	let saved;
	let calls = 0;
	const device = {
		getStoreValue: () => saved,
		setStoreValue: async (key, value) => { saved = JSON.parse(JSON.stringify(value)); },
		getSettings: () => settings,
		homey: {
			app: {}, clock: { getTimezone: () => 'America/New_York' },
			drivers: { getDriver: () => ({ getDevices: () => [{ getData: () => ({ id: 'room-scene' }), getOAuth2ClientForDevice: () => ({ startScene: async () => { calls++; return response; } }) }] }) },
		},
	};
	const monitor = new K11Monitor(device);
	device.getHubDeviceValues = async () => { monitor.state = sample(monitor.state, data(), Date.now()); return data(); };
	return { monitor, device, saved: () => saved, calls: () => calls };
}

test('room command requires explicit acceptance and never falls back or retries', async () => {
	for (const response of [undefined, {}, { statusCode: 161 }])
	{
		const f = fixture(response === undefined ? null : response);
		await assert.rejects(f.monitor.startRoom(), /rejected|unknown/);
		assert.equal(f.calls(), 1);
		assert.ok(f.saved().lastStartRequestAt);
		await assert.rejects(f.monitor.startRoom(), /recently/);
		assert.equal(f.calls(), 1);
	}
});

test('concurrent clicks submit only one room request and persist reservation', async () => {
	const f = fixture();
	const result = await Promise.allSettled([f.monitor.startRoom(), f.monitor.startRoom()]);
	assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
	assert.equal(f.calls(), 1);
	assert.ok(f.saved().pendingStartAt);
});

test('failed refresh or missing scene cannot issue a scene command', async () => {
	const f = fixture();
	f.device.getHubDeviceValues = async () => null;
	await assert.rejects(f.monitor.startRoom(), /refresh/);
	assert.equal(f.calls(), 0);
	const second = fixture();
	second.device.homey.drivers.getDriver = () => ({ getDevices: () => [] });
	await assert.rejects(second.monitor.startRoom(), /not paired/);
	assert.equal(second.calls(), 0);
});

test('accepted request without reported cleaning alerts once and never retries', () => {
	const state = { ...sample({}, data(), now), pendingStartAt: now };
	let result = evaluate(state, now + 2 * MINUTE);
	assert.equal(result.alerts[0].reason, 'start');
	result = evaluate(result.state, now + 3 * MINUTE);
	assert.equal(result.alerts.length, 0);
	assert.equal(sample(result.state, data('Clearing'), now + 3 * MINUTE).pendingStartAt, null);
});

test('daily reservation survives a rejected command and device restart', async () => {
	const originalNow = Date.now;
	try
	{
		Date.now = () => now;
		const f = fixture({ statusCode: 161 });
		await assert.rejects(f.monitor.startRoom(true), /rejected/);
		assert.equal(f.saved().lastAutomationDay, '2026-09-04');
		const restarted = new K11Monitor(f.device);
		await assert.rejects(restarted.startRoom(true), /already/);
		assert.equal(f.calls(), 1);
	}
	finally { Date.now = originalNow; }
});

test('token-based room start also demands explicit acceptance', async () => {
	for (const response of [true, null, {}])
	{
		const f = fixture();
		f.device.homey.app.openToken = true;
		let calls = 0;
		f.device.homey.app.hub = { startScene: async () => { calls++; return response; } };
		if (response === true) assert.equal(await f.monitor.startRoom(), true);
		else await assert.rejects(f.monitor.startRoom(), /unknown/);
		assert.equal(calls, 1);
		assert.equal(f.calls(), 0);
	}
});

test('monitor publishes receipt age and disposes its timer without device commands', async () => {
	const f = fixture();
	const values = {};
	let interval;
	let cleared;
	Object.assign(f.device, {
		hasCapability: (id) => id in values,
		addCapability: async (id) => { values[id] = null; },
		setCapabilityValue: async (id, value) => { values[id] = value; },
	});
	f.device.homey.setInterval = (callback, delay) => { interval = delay; return 123; };
	f.device.homey.clearInterval = (timer) => { cleared = timer; };
	await f.monitor.init();
	assert.equal(values.k11_last_seen, 'Awaiting report');
	await f.monitor.record(data());
	assert.equal(values.measure_k11_status_age, 0);
	assert.match(values.k11_last_seen, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
	assert.equal(interval, MINUTE);
	f.monitor.stop();
	assert.equal(cleared, 123);
	assert.equal(f.calls(), 0);
});
