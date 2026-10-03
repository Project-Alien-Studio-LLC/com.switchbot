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

const LockAdvancedHubDevice = require('../lib/lock_advanced_hub_device');

Module._load = originalLoad;

function createLock(initial = {})
{
	const values = { locked: true, locked_status: 'Locked', ...initial };
	const triggers = [];
	const device = Object.assign(Object.create(LockAdvancedHubDevice.prototype), {
		reportQueue: Promise.resolve(),
		lastSampleTime: -Infinity,
		homey: { __: (key) => ({ locked: 'Locked', unlocked: 'Unlocked' })[key], app: { updateLog: () => {} } },
		error: () => {},
		getData: () => ({ id: 'LOCKMAC' }),
		getCapabilityValue: (name) => values[name],
		// Yield like the real SDK so concurrent reports could interleave.
		setCapabilityValue: async (name, value) => { await new Promise((resolve) => setImmediate(resolve)); values[name] = value; },
		driver: {
			triggerLocked: async () => triggers.push('locked'),
			triggerUnlocked: async () => triggers.push('unlocked'),
			triggerLatched: async () => triggers.push('latched'),
		},
	});
	return { device, values, triggers };
}

const webhook = (lockState, timeOfSample) => ({ context: { deviceMac: 'LOCKMAC', lockState, doorState: 'closed', timeOfSample } });

test('a mismatch is repaired even when the status text did not change', async () =>
{
	// The state left behind on Oct 2: status Locked, lock control Unlocked.
	const lock = createLock({ locked: false, locked_status: 'Locked' });
	await lock.device.applyReport({ lockState: 'LOCKED' });
	assert.equal(lock.values.locked, true);
	assert.deepEqual(lock.triggers, ['locked']);
});

test('two reports arriving together end on the newest state', async () =>
{
	const lock = createLock({ locked: true, locked_status: 'Locked' });
	await Promise.all([
		lock.device.processWebhookMessage(webhook('UNLOCKED', 1000)),
		lock.device.processWebhookMessage(webhook('LOCKED', 2000)),
	]);
	assert.equal(lock.values.locked, true);
	assert.equal(lock.values.locked_status, 'Locked');
});

test('a late webhook sampled before the applied one is ignored', async () =>
{
	const lock = createLock({ locked: true, locked_status: 'Locked' });
	await lock.device.processWebhookMessage(webhook('LOCKED', 2000));
	await lock.device.processWebhookMessage(webhook('UNLOCKED', 1000));
	assert.equal(lock.values.locked, true);
	assert.equal(lock.values.locked_status, 'Locked');
	assert.deepEqual(lock.triggers, []);
});

test('an unchanged state fires no Flow trigger', async () =>
{
	const lock = createLock({ locked: true });
	await lock.device.applyReport({ lockState: 'locked' });
	await lock.device.applyReport({ lockState: 'locked' });
	assert.deepEqual(lock.triggers, []);
});

test('unlock, then lock, updates the control and fires each trigger once', async () =>
{
	const lock = createLock({ locked: true });
	await lock.device.processWebhookMessage(webhook('UNLOCKED', 1000));
	assert.equal(lock.values.locked, false);
	await lock.device.processWebhookMessage(webhook('LOCKED', 2000));
	assert.equal(lock.values.locked, true);
	assert.deepEqual(lock.triggers, ['unlocked', 'locked']);
});

test('jammed and in-motion reports leave the lock control alone', async () =>
{
	for (const state of ['JAMMED', 'locking', 'unlocking'])
	{
		const lock = createLock({ locked: true });
		await lock.device.applyReport({ lockState: state });
		assert.equal(lock.values.locked, true, state);
		assert.deepEqual(lock.triggers, [], state);
	}
	const jammed = createLock({ locked: true });
	await jammed.device.applyReport({ lockState: 'jammed' });
	assert.equal(jammed.values.alarm_generic, true);
});

test('webhooks without a sample time are still applied', async () =>
{
	const lock = createLock({ locked: true });
	await lock.device.processWebhookMessage(webhook('UNLOCKED', undefined));
	assert.equal(lock.values.locked, false);
});
