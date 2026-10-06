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

const VacuumK11HubDevice = require('../drivers/robot_vacuum_K11_hub/device');

Module._load = originalLoad;

function createDevice(values = {}, overrides = {})
{
	return Object.assign(Object.create(VacuumK11HubDevice.prototype), {
		getCapabilityValue: (capability) => values[capability] ?? null,
	}, overrides);
}

test('Play starts the selected clean mode with the selected fan level and repeat count', async () => {
	const calls = [];
	const device = createDevice({
		vaccum_clean_mode: 'vacuumAndMop',
		vaccum_fan_level: '3',
		vaccum_times: '2',
	}, {
		startVacuum: async (...args) => {
			calls.push(args);
			return 'started';
		},
	});

	assert.equal(await device.onCapabilityPlay(true, {}), 'started');
	assert.deepEqual(calls, [['vacuumAndMop', '3', '2']]);
});

test('Play uses safe defaults when vacuum options have not been set', async () => {
	const calls = [];
	const device = createDevice({}, {
		startVacuum: async (...args) => calls.push(args),
	});

	await device.onCapabilityPlay(true, {});
	assert.deepEqual(calls, [['sweep', '1', '1']]);
});

test('Play returns a failed start command to Homey', async () => {
	const expected = new Error('start rejected');
	const device = createDevice({}, {
		startVacuum: async () => { throw expected; },
	});

	await assert.rejects(device.onCapabilityPlay(true, {}), expected);
});

test('startVacuum serializes numeric options for the SwitchBot command', async () => {
	const calls = [];
	const device = createDevice({}, {
		setDeviceData: async (data) => {
			calls.push(data);
			return true;
		},
	});

	assert.equal(await device.startVacuum('sweep', '2', '3'), true);
	assert.deepEqual(calls, [{
		command: 'startClean',
		parameter: { action: 'sweep', param: { fanLevel: 2, times: 3 } },
		commandType: 'command',
	}]);
});

test('startVacuum maps the legacy sweep-and-mop mode to the K11+ mop command', async () => {
	const calls = [];
	const device = createDevice({}, {
		setDeviceData: async (data) => calls.push(data),
	});

	await device.startVacuum('sweep_mop', '4', '1');
	assert.deepEqual(calls, [{
		command: 'startClean',
		parameter: { action: 'mop', param: { fanLevel: 4, times: 1 } },
		commandType: 'command',
	}]);
});

test('shared Flow signature uses cycles, not the water-level argument', async () => {
	const calls = [];
	const device = createDevice({}, { setDeviceData: async (data) => calls.push(data) });
	await device.startVacuum('sweep', 2, 1, 3);
	assert.deepEqual(calls[0].parameter, { action: 'sweep', param: { fanLevel: 2, times: 3 } });
});

test('initialization registers Dock without operating the robot', async () => {
	const parent = Object.getPrototypeOf(VacuumK11HubDevice.prototype);
	const originalInit = parent.onInit;
	const listeners = {};
	const commands = [];
	const values = {};
	const device = createDevice(values, {
		setCapabilityValue: async (id, value) => { values[id] = value; },
		getCapabilityOptions: () => ({}),
		setCapabilityOptions: async () => {},
		registerCapabilityListener: (id, handler) => { listeners[id] = handler; },
		hasCapability: () => false,
		getData: () => ({ id: 'test-vacuum' }),
		_operateDevice: async (...args) => { commands.push(args); return true; },
		getStoreValue: () => null,
		getSettings: () => ({}),
		setStoreValue: async () => {},
		addCapability: async () => {},
		pollHubDeviceValues: async () => true,
		log: () => {},
		error: (error) => assert.fail(error.message),
		homey: { app: { registerHomeyWebhook: async () => {} }, setInterval: () => 1 },
	});
	try
	{
		parent.onInit = async () => {};
		await device.onInit();
		assert.deepEqual(commands, []);
		assert.equal(typeof listeners.robot_vaccum_dock, 'function');
		assert.equal(await listeners.robot_vaccum_dock(true, {}), true);
		assert.deepEqual(commands, [['dock']]);
	}
	finally
	{
		parent.onInit = originalInit;
	}
});

test('water level capability is present only while the K11+ is mopping', async () => {
	const values = { vaccum_clean_mode: 'sweep', vaccum_water_level: '2' };
	const calls = [];
	const device = createDevice(values, {
		hasCapability: (capability) => values[capability] !== undefined,
		addCapability: async (capability) => {
			values[capability] = null;
			calls.push(['add', capability]);
		},
		removeCapability: async (capability) => {
			delete values[capability];
			calls.push(['remove', capability]);
		},
		registerCapabilityListener: (capability) => calls.push(['listener', capability]),
		setCapabilityValue: async (capability, value) => { values[capability] = value; },
	});

	await device.syncWaterLevelCapability('sweep');
	await device.syncWaterLevelCapability('mop');

	assert.deepEqual(calls, [
		['remove', 'vaccum_water_level'],
		['add', 'vaccum_water_level'],
		['listener', 'vaccum_water_level'],
	]);
	assert.equal(values.vaccum_water_level, '1');
});

test('initialization displays defaults locally without sending robot commands', async () => {
	const values = {};
	let options = { title: { en: 'Cleaning Mode' } };
	let optionUpdates = 0;
	const device = createDevice(values, {
		setCapabilityValue: async (id, value) => { values[id] = value; },
		getCapabilityOptions: () => options,
		setCapabilityOptions: async (id, value) => { options = value; optionUpdates++; },
		setDeviceData: async () => assert.fail('Initialization must not send a command'),
		_operateDevice: async () => assert.fail('Initialization must not send a command'),
	});
	await device.initializeCleaningOptions();
	await device.initializeCleaningOptions();
	assert.deepEqual(values, { vaccum_clean_mode: 'sweep', vaccum_fan_level: '1', vaccum_times: '1' });
	assert.deepEqual(options.values.map(({ id }) => id), ['sweep', 'sweep_mop']);
	assert.equal(options.values[1].title.en, 'Mop');
	assert.deepEqual(options.title, { en: 'Cleaning Mode' });
	assert.equal(optionUpdates, 1);
});

test('initialization preserves existing cleaning selections', async () => {
	const values = { vaccum_clean_mode: 'sweep_mop', vaccum_fan_level: '4', vaccum_times: '3' };
	const device = createDevice(values, {
		setCapabilityValue: async () => assert.fail('Existing selection changed'),
		getCapabilityOptions: () => ({}),
		setCapabilityOptions: async () => {},
	});
	await device.initializeCleaningOptions();
	assert.deepEqual(values, { vaccum_clean_mode: 'sweep_mop', vaccum_fan_level: '4', vaccum_times: '3' });
});

test('setting commands propagate rejection to Homey instead of logging success', async () => {
	const expected = new Error('SwitchBot rejected command');
	const device = createDevice({ vaccum_clean_mode: 'sweep_mop' }, {
		_operateDevice: async () => { throw expected; },
		error: () => assert.fail('Command rejection must reach the caller'),
	});
	for (const [method, value] of [
		['onCapabilityFanLevel', '2'], ['onCapabilityWaterLevel', '1'],
		['onCapabilityTimes', '2'], ['onCapabilitySetVolume', 0.5],
	])
	{
		await assert.rejects(device[method](value, {}), expected);
	}
});

function createCommandDevice(response)
{
	return createDevice({}, {
		getData: () => ({ id: 'test-vacuum' }),
		getOAuth2ClientForDevice: () => ({ setDeviceData: async () => response }),
		getOfflineCooldownUntil: () => 0,
		clearOfflineCooldown: () => {},
		clearDeviceOfflineWarning: async () => {},
		confirmDeviceOffline: async () => assert.fail('Status cannot prove command acceptance'),
		homey: { app: { updateLog: () => {}, varToString: JSON.stringify }, setTimeout: (fn) => fn() },
	});
}

test('K11 rejects explicit and malformed OAuth failures without a success-producing status probe', async () => {
	for (const response of [{ statusCode: 161 }, { statusCode: 171 }, { statusCode: 190 }, {}, { body: {} }])
	{
		await assert.rejects(createCommandDevice(response).setDeviceData({ command: 'pause' }), /command not accepted/);
	}
});

test('K11 accepts a documented successful OAuth response', async () => {
	for (const response of [{ statusCode: 100 }, { body: { statusCode: 100 } }])
	{
		assert.equal(await createCommandDevice(response).setDeviceData({ command: 'pause' }), true);
	}
});

test('K11 does not retry an unacknowledged command', async () => {
	const device = createCommandDevice(null);
	let commands = 0;
	device.getOAuth2ClientForDevice = () => ({ setDeviceData: async () => { commands++; return null; } });
	await assert.rejects(device.setDeviceData({ command: 'startClean' }), /acceptance is unknown/);
	assert.equal(commands, 1);
});

test('K11 reports missing authentication as failure', async () => {
	const device = createCommandDevice(null);
	device.getOAuth2ClientForDevice = () => null;
	device.logMissingAuthOnce = () => {};
	await assert.rejects(device.setDeviceData({ command: 'pause' }), /authentication is unavailable/);
});

test('strict command handling does not change other hub drivers', async () => {
	const device = createCommandDevice({ statusCode: 161 });
	Object.setPrototypeOf(device, Object.getPrototypeOf(VacuumK11HubDevice.prototype));
	let probes = 0;
	device.confirmDeviceOffline = async () => { probes++; return false; };
	assert.equal(await device.setDeviceData({ command: 'pause' }), true);
	assert.equal(probes, 3);
	device.getOAuth2ClientForDevice = () => null;
	device.logMissingAuthOnce = () => {};
	assert.equal(await device.setDeviceData({ command: 'pause' }), false);
});

function createStatusDevice(data)
{
	const values = { measure_battery: 70 };
	const device = createDevice(values, {
		_getHubDeviceValues: async () => data,
		getData: () => ({ id: 'test-vacuum' }),
		hasCapability: () => true,
		setCapabilityValue: async (id, value) => { values[id] = value; },
		setAvailable: async () => {},
		unsetWarning: async () => {},
		setWarning: async (message) => assert.fail(message),
		error: (error) => assert.fail(error.message),
		homey: { app: { updateLog: () => {}, varToString: JSON.stringify } },
	});
	return { device, values };
}

test('polling and webhooks record zero battery and ignore invalid battery values', async () => {
	for (const battery of [0, 100, null, undefined, -1, 101, '0', 0.5])
	{
		const expected = battery === 0 || battery === 100 ? battery : 70;
		const polled = createStatusDevice({ battery });
		await polled.device.getHubDeviceValues();
		assert.equal(polled.values.measure_battery, expected);
		const webhook = createStatusDevice({});
		await webhook.device.processWebhookMessage({ context: { deviceMac: 'test-vacuum', battery } });
		assert.equal(webhook.values.measure_battery, expected);
	}
});

test('unrelated webhook cannot change K11 battery', async () => {
	const { device, values } = createStatusDevice({});
	await device.processWebhookMessage({ context: { deviceMac: 'another-device', battery: 0 } });
	assert.equal(values.measure_battery, 70);
});
