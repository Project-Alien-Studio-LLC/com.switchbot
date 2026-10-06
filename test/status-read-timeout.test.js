'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const test = require('node:test');

let getCalls = 0;
let lastRequest;
let lastOptions;
let postCalls = 0;
const originalLoad = Module._load;
Module._load = function mockDependencies(request, parent, isMain)
{
	if (request === 'homey') return { env: { USER_AGENT_HEADER: 'test' } };
	if (request === 'homey-oauth2app') return {
		OAuth2Client: class {
			async onBuildRequest(req) { return { url: req.path, opts: { method: req.method, body: req.body } }; }
		},
		OAuth2Token: class {},
		OAuth2Error: Error,
	};
	if (request === 'https') return {
		get() {
			getCalls++;
			lastRequest = new EventEmitter();
			lastRequest.destroy = (err) => {
				lastRequest.destroyed = true;
				lastRequest.emit('error', err);
				lastRequest.emit('close');
			};
			return lastRequest;
		},
		request(options) {
			postCalls++;
			lastOptions = options;
			lastRequest = new EventEmitter();
			lastRequest.write = () => {};
			lastRequest.end = () => {};
			lastRequest.destroy = (err) => {
				lastRequest.destroyed = true;
				lastRequest.emit('error', err);
				lastRequest.emit('close');
			};
			return lastRequest;
		},
	};
	return originalLoad.call(this, request, parent, isMain);
};
const OAuthClient = require('../lib/SwitchBotOAuth2Client');
const TokenClient = require('../lib/hub_interface');
Module._load = originalLoad;

test('OAuth status reads have a deadline without modifying command requests', async () => {
	const client = Object.assign(Object.create(OAuthClient.prototype), {
		homey: { app: { getAPICount: () => 0, updateLog: () => {} } },
	});
	const status = await client.onBuildRequest({ method: 'GET', path: '/devices/sensor/status' });
	assert.equal(status.opts.timeout, 15000);
	const command = await client.onBuildRequest({ method: 'POST', path: '/devices/sensor/commands', body: 'command' });
	assert.equal(command.opts.timeout, undefined);
	assert.equal(command.opts.body, 'command');
	const webhook = await client.onBuildRequest({ method: 'POST', path: '/webhook/queryWebhook' });
	assert.equal(webhook.opts.timeout, 15000);
});

test('a silent token status read is destroyed and rejects without retrying', async () => {
	let cleared = false;
	const client = new TokenClient({
		app: { openToken: 'test-token', openSecret: 'test-secret', updateLog: () => {}, incrementApiCalls: () => {} },
		settings: { get: () => null },
		setTimeout: (fn, ms) => { assert.equal(ms, 15000); return setTimeout(fn, 5); },
		clearTimeout: (timer) => { cleared = true; clearTimeout(timer); },
	});
	await assert.rejects(client.getDeviceData('test-sensor'), /timed out/);
	assert.equal(lastRequest.destroyed, true);
	assert.equal(cleared, true);
	assert.equal(getCalls, 1);
});

test('a read blocked before network fetch also times out without replay or late acceptance', async () => {
	let calls = 0;
	let finish;
	const client = Object.assign(Object.create(OAuthClient.prototype), {
		get: () => { calls++; return new Promise((resolve) => { finish = resolve; }); },
		homey: { app: {}, setTimeout: (fn) => setTimeout(fn, 5), clearTimeout },
	});
	await assert.rejects(client.getDeviceData('test-sensor'), /status read timed out/);
	finish({ statusCode: 100 });
	assert.equal(calls, 1);
});

test('a silent token webhook query uses v1.1 and is destroyed so health checks can retry', async () => {
	const client = new TokenClient({
		app: { openToken: 'test-token', openSecret: 'test-secret', updateLog() {}, varToString: JSON.stringify, incrementApiCalls() {} },
		setTimeout: (fn, ms) => { assert.equal(ms, 15000); return setTimeout(fn, 5); },
		clearTimeout,
	});
	await assert.rejects(client.getWebhook(), /webhook request timed out/);
	assert.equal(lastOptions.path, '/v1.1/webhook/queryWebhook');
	assert.equal(lastRequest.destroyed, true);
	assert.equal(postCalls, 1);
});
