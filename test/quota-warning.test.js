'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function mockHomey(request, parent, isMain)
{
	if (request === 'homey-oauth2app') return { OAuth2App: class OAuth2App {}, OAuth2Client: class OAuth2Client {}, OAuth2Device: class {}, OAuth2Driver: class {}, OAuth2Token: class {}, OAuth2Error: class extends Error {} };
	if (request === 'homey') return { App: class App {}, Device: class {}, Driver: class {} };
	return originalLoad.call(this, request, parent, isMain);
};
const App = require('../app');
Module._load = originalLoad;

function createApp()
{
	const sent = [];
	const app = Object.assign(Object.create(App.prototype), {
		apiCalls: 0,
		updateLog() {},
		persistApiCalls() {},
		homey: {
			setTimeout: () => ({}),
			notifications: { createNotification: async (n) => { sent.push(n.excerpt); } },
		},
	});
	return { app, sent };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('one quota warning is sent when daily calls reach 8,000', async () =>
{
	const { app, sent } = createApp();
	app.apiCalls = 7998;
	app.incrementApiCalls();
	await flush();
	assert.equal(sent.length, 0);
	app.incrementApiCalls();
	app.incrementApiCalls();
	await flush();
	assert.equal(sent.length, 1);
	assert.match(sent[0], /8000 of 10000/);
});

test('the warning re-arms after the daily reset', async () =>
{
	const { app, sent } = createApp();
	app.apiCalls = 8500;
	app.incrementApiCalls();
	await flush();
	app.resetAPICount();
	app.apiCalls = 8000;
	app.incrementApiCalls();
	await flush();
	assert.equal(sent.length, 2);
});

test('a failing notification never breaks call counting', async () =>
{
	const { app } = createApp();
	app.homey.notifications.createNotification = async () => { throw new Error('down'); };
	app.apiCalls = 8000;
	assert.equal(app.incrementApiCalls(), 8001);
	await flush();
});
