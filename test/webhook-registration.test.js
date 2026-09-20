'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(require.resolve('../app'), 'utf8');
const methods = source.slice(source.indexOf('\tasync doWebhookReg()'), source.indexOf('\tasync ensureSwitchBotWebhook()'));
const App = vm.runInNewContext(`(class { ${methods} })`, { Homey: { env: {} }, Math });

test('late-initializing sensors are registered after an in-flight registration, without overlapping handles', async () => {
	const requests = [];
	const timers = [];
	const app = Object.assign(new App(), {
		devicesMACs: ['sensor-a'],
		updateLog() {},
		varToString: JSON.stringify,
		webhookRetryCount: 0,
		homey: {
			cloud: {
				createWebhook: (id, secret, data) => new Promise((resolve) => {
					requests.push({ keys: [...data.$keys], resolve });
				}),
			},
			setTimeout(fn) { timers.push(fn); return timers.length; },
			clearTimeout() {},
		},
	});
	app.homey.app = app;
	const first = app.doWebhookReg();
	app.devicesMACs.push('sensor-b');
	const second = app.doWebhookReg();
	assert.equal(requests.length, 1, 'registration requests must be serialized');
	let unregistered = false;
	requests[0].resolve({ on() {}, async unregister() { unregistered = true; } });
	await Promise.all([first, second]);
	assert.equal(timers.length, 1, 'a trailing registration includes the newly added sensor');
	const trailing = timers[0]();
	await new Promise(setImmediate);
	assert.equal(unregistered, true);
	assert.deepEqual(requests[1].keys, ['sensor-a', 'sensor-b']);
	requests[1].resolve({ on() {}, async unregister() {} });
	await trailing;
});
