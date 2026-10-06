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

const LightHubDevice = require('../drivers/light_hub_device');

Module._load = originalLoad;

function createDevice(dim, overrides = {})
{
	return Object.assign(Object.create(LightHubDevice.prototype), {
		getCapabilityValue: (capability) => (capability === 'dim' ? dim : null),
	}, overrides);
}

test('color changes encode hue and saturation independently from brightness', async () => {
	const calls = [];
	const device = createDevice(0.3, {
		sendCommand: async (...args) => calls.push(args),
	});

	await device.onCapabilityLightHueSat({ light_hue: 0.1, light_saturation: 1 }, {});
	assert.deepEqual(calls, [['setColor', '255:153:0']]);
});

test('color changes use the same neutral lightness when brightness is unavailable', async () => {
	const calls = [];
	const device = createDevice(null, {
		sendCommand: async (...args) => calls.push(args),
	});

	await device.onCapabilityLightHueSat({ light_hue: 1 / 3, light_saturation: 1 }, {});
	assert.deepEqual(calls, [['setColor', '0:255:0']]);
});

test('brightness and color temperature commands are clamped and rounded', async () => {
	const calls = [];
	const device = createDevice(0.3, {
		sendCommand: async (...args) => calls.push(args),
	});

	await device.onCapabilityDim(0.333, {});
	await device.onCapabilityDim(2, {});
	await device.onCapabilityLightTemperature(0.333, {});
	await device.onCapabilityLightTemperature(-1, {});

	assert.deepEqual(calls, [
		['setBrightness', 33],
		['setBrightness', 100],
		['setColorTemperature', 5235],
		['setColorTemperature', 6500],
	]);
});
