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

const HubDevice = Object.getPrototypeOf(LockAdvancedHubDevice.prototype);

function createLock(sendCommand)
{
	const timers = [];
	const calls = [];
	const events = [];
	HubDevice.setDeviceData = async function setDeviceData(data)
	{
		calls.push(data);
		return sendCommand(data);
	};
	const device = Object.assign(Object.create(LockAdvancedHubDevice.prototype), {
		homey: {
			setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
			clearTimeout: (timer) => { if (timer) timer.cleared = true; },
			app: { updateLog: (message) => events.push(['log', message]) },
		},
		error: () => {},
		setWarning: async (message) => events.push(['warning', message]),
		unsetWarning: async () => events.push(['unsetWarning']),
		getHubDeviceValues: async () => events.push(['refresh']),
	});
	return { device, timers, calls, events };
}

function deferred()
{
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a fast lock command returns its result and clears the acknowledgement timer', async () =>
{
	const lock = createLock(async () => ({ statusCode: 100 }));
	assert.deepEqual(await lock.device._operateBot('lock'), { statusCode: 100 });
	assert.deepEqual(lock.calls, [{ command: 'lock', parameter: 'default', commandType: 'command' }]);
	assert.equal(lock.timers[0].ms, 8000);
	assert.equal(lock.timers[0].cleared, true);
});

test('a fast failure is still reported to Homey', async () =>
{
	const lock = createLock(async () => { throw new Error('Error: SwitchBot device is offline'); });
	await assert.rejects(lock.device._operateBot('lock'), /offline/);
});

test('a slow lock command is acknowledged before the Homey timeout and sent only once', async () =>
{
	const command = deferred();
	const lock = createLock(() => command.promise);
	const pending = lock.device._operateBot('lock');
	await flush();
	lock.timers[0].fn();
	assert.equal(await pending, null);
	command.resolve({ statusCode: 100 });
	await flush();
	assert.equal(lock.calls.length, 1);
	assert.deepEqual(lock.events.at(-1), ['unsetWarning']);
});

test('a slow command that later fails shows a warning and refreshes the lock state', async () =>
{
	const command = deferred();
	const lock = createLock(() => command.promise);
	const pending = lock.device._operateBot('unlock');
	await flush();
	lock.timers[0].fn();
	assert.equal(await pending, null);
	command.reject(new Error('lock jammed'));
	await flush();
	assert.ok(lock.events.some(([kind, message]) => kind === 'warning' && /Last unlock command failed: lock jammed/.test(message)));
	assert.ok(lock.events.some(([kind]) => kind === 'refresh'));
	assert.equal(lock.calls.length, 1);
});
