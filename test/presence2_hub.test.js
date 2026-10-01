'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function mockHomeyOAuth(request, parent, isMain)
{
	if (request === 'homey-oauth2app') return { OAuth2Device: class OAuth2Device {} };
	return originalLoad.call(this, request, parent, isMain);
};
const PresenceDevice = require('../drivers/presence2_hub/device');

Module._load = originalLoad;

function createDevice(response = { detected: true })
{
	const values = { alarm_presence: true, measure_luminance: 50, measure_battery: 100 };
	const warnings = [];
	const device = Object.assign(Object.create(PresenceDevice.prototype), {
		getData: () => ({ id: 'AABBCCDDEEFF' }),
		getName: () => 'Test presence sensor',
		_getHubDeviceValues: async () => response,
		hasCapability: () => true,
		getCapabilityValue: (id) => values[id],
		setCapabilityValue: async (id, value) => { values[id] = value; },
		setAvailable: async () => {},
		unsetWarning: async () => {},
		setWarning: async (warning) => warnings.push(warning),
		error: () => {},
		homey: { app: { updateLog: () => {}, varToString: JSON.stringify } },
	});
	return { device, values, warnings };
}

function webhook(data)
{
	return { context: { deviceMac: 'AABBCCDDEEFF', ...data } };
}

test('light-only webhook preserves occupied state', async () => {
	const { device, values } = createDevice();
	await device.processWebhookMessage(webhook({ lightLevel: 2 }));
	assert.equal(values.alarm_presence, true);
	assert.equal(values.measure_luminance, 10);
	assert.equal(values.presence_last_report, undefined);
});

test('missing presence in a status poll does not clear occupancy or claim fresh presence', async () => {
	const { device, values, warnings } = createDevice({ battery: 60 });
	await device.getHubDeviceValues();
	assert.equal(values.alarm_presence, true);
	assert.equal(values.presence_last_report, undefined);
	assert.ok(warnings.length);
});

test('both documented Detected and observed detected status fields are accepted', async () => {
	for (const field of ['Detected', 'detected'])
	{
		const { device, values } = createDevice({ [field]: true });
		values.alarm_presence = false;
		await device.getHubDeviceValues();
		assert.equal(values.alarm_presence, true);
		assert.match(values.presence_last_report, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
	}
});

test('zero luminance and zero battery are recorded from polling and webhooks', async () => {
	const polled = createDevice({ detected: false, lightLevel: 0, battery: 0 });
	await polled.device.getHubDeviceValues();
	assert.equal(polled.values.measure_luminance, 0);
	assert.equal(polled.values.measure_battery, 0);
	const pushed = createDevice();
	await pushed.device.processWebhookMessage(webhook({ detectionState: 'NOT_DETECTED', lightLevel: 0, battery: 0 }));
	assert.equal(pushed.values.measure_luminance, 0);
	assert.equal(pushed.values.measure_battery, 0);
});

test('battery display uses documented SwitchBot bands instead of pretending to show an exact percent', async () => {
	const { device, values } = createDevice({ detected: false, battery: 60 });
	await device.getHubDeviceValues();
	assert.equal(values.measure_battery, 60);
	assert.equal(values.presence_battery_band, '20–60%');
	for (const [battery, expected] of [[10, 'Below 10%'], [20, '10–20%'], [100, 'At least 60%'], [37, '37% reported']])
	{
		await device.processWebhookMessage(webhook({ battery }));
		assert.equal(values.presence_battery_band, expected);
	}
	assert.equal(device.formatBatteryBand(null), 'Unknown');
});

test('existing devices gain display capabilities without resetting a previous event', async () => {
	const { device, values } = createDevice();
	const capabilities = new Set(['alarm_presence', 'measure_luminance', 'measure_battery', 'presence_last_report']);
	const added = [];
	values.measure_battery = 60;
	values.presence_last_event = 'Sep 28, 2:30 PM';
	device.hasCapability = (id) => capabilities.has(id);
	device.addCapability = async (id) => { capabilities.add(id); added.push(id); };
	await device.ensurePresentationCapabilities();
	assert.deepEqual(added, ['presence_battery_band', 'presence_last_event']);
	assert.equal(values.presence_battery_band, '20–60%');
	assert.equal(values.presence_last_event, 'Sep 28, 2:30 PM');
	await device.ensurePresentationCapabilities();
	assert.equal(added.length, 2);
});

test('unknown battery remains unknown until a battery field arrives', async () => {
	const { device, values } = createDevice({ detected: false });
	delete values.measure_battery;
	await device.ensurePresentationCapabilities();
	assert.equal(values.presence_battery_band, 'Unknown');
	assert.equal(values.presence_last_event, 'No event observed');
	await device.getHubDeviceValues();
	assert.equal(values.presence_battery_band, 'Unknown');
});

test('a display-capability failure does not block presence or valid receipt updates', async () => {
	const { device, values } = createDevice({ detected: false, battery: 60 });
	const write = device.setCapabilityValue;
	device.setCapabilityValue = async (id, value) => {
		if (id === 'presence_battery_band') throw new Error('Display unavailable');
		await write(id, value);
	};
	await device.getHubDeviceValues();
	assert.equal(values.alarm_presence, false);
	assert.equal(values.measure_battery, 60);
	assert.match(values.presence_last_report, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
});

test('only accepted webhooks advance the displayed sensor-event receipt', async () => {
	const { device, values } = createDevice({ detected: false, battery: 100 });
	values.presence_last_event = 'No event observed';
	await device.getHubDeviceValues();
	assert.equal(values.presence_last_event, 'No event observed');
	await device.processWebhookMessage(webhook({ lightLevel: 2, timeOfSample: Date.now() }));
	assert.match(values.presence_last_event, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
	const accepted = values.presence_last_event;
	await device.processWebhookMessage(webhook({ detected: true, timeOfSample: Date.now() - 60000 }));
	assert.equal(values.presence_last_event, accepted);
});

test('unchanged valid presence advances receipt heartbeat; failed poll does not', async () => {
	const { device, values, warnings } = createDevice();
	values.presence_last_report = '2020-01-01T00:00:00.000Z';
	await device.getHubDeviceValues();
	assert.notEqual(values.presence_last_report, '2020-01-01T00:00:00.000Z');
	const receipt = values.presence_last_report;
	device._getHubDeviceValues = async () => { throw new Error('Cloud unavailable'); };
	await device.getHubDeviceValues();
	assert.equal(values.presence_last_report, receipt);
	assert.equal(values.alarm_presence, true);
	assert.match(warnings.at(-1), /Cloud unavailable/);
});

test('newer webhook wins over a poll that was already in flight', async () => {
	const { device, values } = createDevice();
	let finishPoll;
	device._getHubDeviceValues = () => new Promise((resolve) => { finishPoll = resolve; });
	const poll = device.getHubDeviceValues();
	await device.processWebhookMessage(webhook({ detectionState: 'DETECTED', timeOfSample: Date.now() }));
	finishPoll({ detected: false, lightLevel: 1 });
	await poll;
	assert.equal(values.alarm_presence, true);
});

test('out-of-order and duplicate webhook samples cannot regress presence', async () => {
	const { device, values } = createDevice();
	const now = Date.now();
	await device.processWebhookMessage(webhook({ detectionState: 'DETECTED', timeOfSample: now }));
	const receipt = values.presence_last_report;
	await device.processWebhookMessage(webhook({ detectionState: 'NOT_DETECTED', timeOfSample: now - 1000 }));
	await device.processWebhookMessage(webhook({ detectionState: 'NOT_DETECTED', timeOfSample: now }));
	assert.equal(values.alarm_presence, true);
	assert.equal(values.presence_last_report, receipt);
});

test('invalid fields and unrelated devices do not alter occupancy or freshness', async () => {
	const { device, values } = createDevice();
	await device.processWebhookMessage(webhook({ detected: NaN, battery: -1, lightLevel: null }));
	await device.processWebhookMessage(webhook({ deviceMac: 'OTHER', detectionState: 'NOT_DETECTED' }));
	assert.equal(values.alarm_presence, true);
	assert.equal(values.measure_luminance, 50);
	assert.equal(values.measure_battery, 100);
	assert.equal(values.presence_last_report, undefined);
});

test('a failed capability write does not poison subsequent reports', async () => {
	const { device, values } = createDevice();
	const write = device.setCapabilityValue;
	device.setCapabilityValue = async () => { throw new Error('Temporary Homey error'); };
	await device.processWebhookMessage(webhook({ detectionState: 'NOT_DETECTED' }));
	device.setCapabilityValue = write;
	await device.processWebhookMessage(webhook({ detectionState: 'NOT_DETECTED', lightLevel: 3 }));
	assert.equal(values.alarm_presence, false);
	assert.equal(values.measure_luminance, 15);
	assert.match(values.presence_last_report, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
});

test('diagnostics distinguish source data from rejected samples and retain bounded history', async () => {
	const { device } = createDevice({ detected: false });
	const now = Date.now();
	await device.processWebhookMessage(webhook({ detectionState: 'DETECTED', timeOfSample: now }));
	await device.processWebhookMessage(webhook({ detectionState: 'NOT_DETECTED', timeOfSample: now - 1000 }));
	const before = device.getPresenceDiagnostics();
	assert.equal(before.receivedWebhooks, 2);
	assert.equal(before.webhookReports, 1);
	assert.equal(before.recentReports.at(-1).outcome, 'duplicate or older sample');
	assert.equal(before.queuedReports, 0);
	for (let i = 0; i < 15; i++) await device.getHubDeviceValues();
	const after = device.getPresenceDiagnostics();
	assert.equal(after.lastPolledPresence, false);
	assert.ok(after.lastPollResponseAt);
	assert.equal(after.recentReports.length, 12);
	assert.equal(after.recentReports.at(-1).outcome, 'applied');
});
