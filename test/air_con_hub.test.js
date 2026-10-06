'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;

Module._load = function mockHomeyOAuth(request, parent, isMain)
{
	if (request === 'homey-oauth2app')
	{
		return { OAuth2Device: class OAuth2Device {} };
	}

	return originalLoad.call(this, request, parent, isMain);
};

const AirConHubDevice = require('../drivers/air_con_hub/device');

Module._load = originalLoad;

function createDevice(values = {}, overrides = {})
{
	return Object.assign(Object.create(AirConHubDevice.prototype), {
		getCapabilityValue: (capability) => values[capability] ?? null,
	}, overrides);
}

test('setAll preserves unchanged settings while updating temperature', async () => {
	const calls = [];
	const device = createDevice({ aircon_mode: '1', aircon_fan_speed: '3' }, {
		_operateDevice: async (parameters) => calls.push(parameters),
	});

	await device.onCapabilityAll({ target_temperature: 24 }, {});
	assert.deepEqual(calls, ['24,1,3,on']);
});

test('explicit power controls serialize the requested state', async () => {
	const calls = [];
	const device = createDevice({
		target_temperature: 22,
		aircon_mode: '2',
		aircon_fan_speed: '2',
	}, {
		_operateDevice: async (parameters) => calls.push(parameters),
	});

	await device.onCapabilityAll({ power_off: true }, {});
	await device.onCapabilityAll({ power_on: true }, {});
	assert.deepEqual(calls, ['22,2,2,off', '22,2,2,on']);
});
