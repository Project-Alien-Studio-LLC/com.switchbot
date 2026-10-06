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
const PlugHubDevice = require('../drivers/plug_hub/device');
Module._load = originalLoad;

function deviceWithResponse(response)
{
	const updates = [];
	const device = Object.assign(Object.create(PlugHubDevice.prototype), {
		_getHubDeviceValues: async () => response,
		setAvailable: () => {},
		unsetWarning: async () => {},
		setWarning: async () => {},
		hasCapability: () => true,
		setCapabilityValue: async (id, value) => { updates.push({ id, value }); },
		homey: { app: { updateLog: () => {}, varToString: String } },
	});
	return { device, updates };
}

test('unchanged successful plug status still records a fresh poll', async () => {
	const { device, updates } = deviceWithResponse({ power: 'on', electricCurrent: 0, voltage: 121, weight: 0 });
	await device.getHubDeviceValues();
	const heartbeat = updates.find(({ id }) => id === 'plug_last_polled');
	assert.match(heartbeat.value, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
});

test('empty or failed plug status cannot create a heartbeat', async () => {
	const empty = deviceWithResponse({});
	await empty.device.getHubDeviceValues();
	assert.equal(empty.updates.some(({ id }) => id === 'plug_last_polled'), false);

	const failed = deviceWithResponse(null);
	failed.device._getHubDeviceValues = async () => { throw new Error('cloud unavailable'); };
	await failed.device.getHubDeviceValues();
	assert.equal(failed.updates.some(({ id }) => id === 'plug_last_polled'), false);
});
