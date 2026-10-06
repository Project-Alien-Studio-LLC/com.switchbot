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

const CurtainsHubDevice = require('../drivers/curtains_hub/device');

Module._load = originalLoad;

function createDevice(overrides = {})
{
	return Object.assign(Object.create(CurtainsHubDevice.prototype), {
		invertPosition: false,
		motionMode: 0xff,
	}, overrides);
}

test('translates Homey open percentage to SwitchBot closed percentage', () => {
	const device = createDevice();

	assert.equal(device.homeyPositionToSwitchBot(0), 100);
	assert.equal(device.homeyPositionToSwitchBot(0.25), 75);
	assert.equal(device.homeyPositionToSwitchBot(1), 0);
	assert.equal(device.switchBotPositionToHomey(100), 0);
	assert.equal(device.switchBotPositionToHomey(75), 0.25);
	assert.equal(device.switchBotPositionToHomey(0), 1);
});

test('honours inversion and clamps out-of-range positions', () => {
	const device = createDevice({ invertPosition: true });

	assert.equal(device.homeyPositionToSwitchBot(-1), 0);
	assert.equal(device.homeyPositionToSwitchBot(2), 100);
	assert.equal(device.switchBotPositionToHomey(-1), 0);
	assert.equal(device.switchBotPositionToHomey(200), 1);
});

test('serializes SwitchBot motion modes with the required ff token', async () => {
	const calls = [];
	const device = createDevice({
		_operateCurtain: async (...args) => {
			calls.push(args);
			return true;
		},
	});

	await device.runToPos(30, 0xff);
	await device.runToPos(40, '0xff');
	await device.runToPos(50, 0);
	await device.runToPos(60, 1);

	assert.deepEqual(calls, [
		['setPosition', '0,ff,30'],
		['setPosition', '0,ff,40'],
		['setPosition', '0,0,50'],
		['setPosition', '0,1,60'],
	]);
});

test('maps the closed toggle and position slider to SwitchBot correctly', async () => {
	const calls = [];
	const device = createDevice({
		_operateCurtain: async (...args) => {
			calls.push(args);
			return true;
		},
	});

	await device.onCapabilityopenClose(true);
	await device.onCapabilityopenClose(false);
	await device.onCapabilityPosition(0.75, {});

	assert.deepEqual(calls, [
		['setPosition', '0,ff,100'],
		['setPosition', '0,ff,0'],
		['setPosition', '0,ff,25'],
	]);
});

test('Stop holds the reported position when Curtain3 ignores pause', async () => {
	const calls = [];
	const device = createDevice({
		delay: async () => {},
		_getHubDeviceValues: async () => ({ moving: true, slidePosition: 43 }),
		_operateCurtain: async (...args) => {
			calls.push(args);
			return true;
		},
	});

	await device.stop();

	assert.deepEqual(calls, [
		['pause', 'default'],
		['setPosition', '0,ff,43'],
	]);
});

test('Stop does not send a fallback when pause succeeded', async () => {
	const calls = [];
	const device = createDevice({
		delay: async () => {},
		_getHubDeviceValues: async () => ({ moving: false, slidePosition: 43 }),
		_operateCurtain: async (...args) => {
			calls.push(args);
			return true;
		},
	});

	await device.stop();

	assert.deepEqual(calls, [['pause', 'default']]);
});

test('Stop preserves a successful pause when its verification read fails', async () => {
	const calls = [];
	const logs = [];
	const device = createDevice({
		delay: async () => {},
		homey: { app: { updateLog: (...args) => logs.push(args) } },
		_getHubDeviceValues: async () => {
			throw new Error('temporary status error');
		},
		_operateCurtain: async (...args) => {
			calls.push(args);
			return true;
		},
	});

	assert.equal(await device.stop(), true);
	assert.deepEqual(calls, [['pause', 'default']]);
	assert.match(logs[0][0], /temporary status error/);
});
