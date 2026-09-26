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
