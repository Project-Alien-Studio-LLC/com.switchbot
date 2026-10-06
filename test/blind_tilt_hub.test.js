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

const BlindTiltHubDevice = require('../drivers/blind_tilt_hub/device');

Module._load = originalLoad;

function createDevice(overrides = {})
{
	return Object.assign(Object.create(BlindTiltHubDevice.prototype), {
		error: () => {},
	}, overrides);
}

test('precision tilt positions map to the expected SwitchBot commands', async () => {
	const calls = [];
	const device = createDevice({
		_operateCurtain: async (...args) => calls.push(args),
	});

	await device.onCapabilityPosition(0, {});
	await device.onCapabilityPosition(0.25, {});
	await device.onCapabilityPosition(0.5, {});
	await device.onCapabilityPosition(0.75, {});
	await device.onCapabilityPosition(1, {});

	assert.deepEqual(calls, [
		['closeDown', ''],
		['setPosition', 'down;50'],
		['fullyOpen', ''],
		['setPosition', 'up;50'],
		['closeUp', ''],
	]);
});

test('quick actions support open, configured close, tilt up, and tilt down', async () => {
	const calls = [];
	const device = createDevice({
		getSetting: () => 'up',
		_operateCurtain: async (...args) => calls.push(args),
	});

	await device.onCapabilityClosed(false, {});
	await device.onCapabilityClosed(true, {});
	await device.onCapabilityTiltUp(true, {});
	await device.onCapabilityTiltDown(true, {});

	assert.deepEqual(calls, [
		['fullyOpen', ''],
		['closeUp', ''],
		['closeUp', ''],
		['closeDown', ''],
	]);
});

test('quick close defaults to tilt down when no preference exists', async () => {
	const calls = [];
	const device = createDevice({
		getSetting: () => null,
		_operateCurtain: async (...args) => calls.push(args),
	});

	await device.onCapabilityClosed(true, {});
	assert.deepEqual(calls, [['closeDown', '']]);
});

test('status updates the slider, percentage reading, and closed state', () => {
	const values = [];
	const triggers = [];
	const device = createDevice({
		lastPosition: 0,
		setCapabilityValue: async (...args) => values.push(args),
		homey: {
			app: {
				triggerPositionLessThan: async (...args) => triggers.push(['less', ...args]),
				triggerPositionGreaterThan: async (...args) => triggers.push(['greater', ...args]),
			},
		},
	});

	device.updatePosition(0.5);

	assert.deepEqual(values, [
		['windowcoverings_tilt_set', 0.5],
		['position', 50],
		['windowcoverings_closed', false],
	]);
	assert.equal(triggers.length, 2);
	assert.equal(device.lastPosition, 0.5);
});

test('status clamps invalid range endpoints and marks them closed', () => {
	const values = [];
	const device = createDevice({
		setCapabilityValue: async (...args) => values.push(args),
		homey: {
			app: {
				triggerPositionLessThan: async () => {},
				triggerPositionGreaterThan: async () => {},
			},
		},
	});

	device.updatePosition(2);
	assert.deepEqual(values, [
		['windowcoverings_tilt_set', 1],
		['position', 100],
		['windowcoverings_closed', true],
	]);
});

test('status ignores missing or nonnumeric readings', () => {
	const values = [];
	const device = createDevice({
		setCapabilityValue: async (...args) => values.push(args),
	});

	device.updatePosition(undefined);
	device.updatePosition('not-a-number');
	assert.deepEqual(values, []);
});

test('existing devices receive every new capability without duplicate additions', async () => {
	const present = new Set(['measure_battery']);
	const added = [];
	const device = createDevice({
		hasCapability: (capability) => present.has(capability),
		addCapability: async (capability) => {
			added.push(capability);
			present.add(capability);
		},
	});

	await device.addMissingCapabilities();
	assert.deepEqual(added, [
		'windowcoverings_closed',
		'windowcoverings_tilt_up',
		'windowcoverings_tilt_down',
		'position',
	]);
});

test('new status initializes from the existing tilt reading', () => {
	const positions = [];
	const device = createDevice({
		getCapabilityValue: () => 0,
		updatePosition: (position) => positions.push(position),
	});

	device.initializePositionStatus();
	assert.deepEqual(positions, [0]);
});

test('new status stays unset when there is no cached tilt reading', () => {
	const positions = [];
	const device = createDevice({
		getCapabilityValue: () => null,
		updatePosition: (position) => positions.push(position),
	});

	device.initializePositionStatus();
	assert.deepEqual(positions, []);
});
