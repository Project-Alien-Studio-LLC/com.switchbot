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

function createApp(devices)
{
	const timers = [];
	const app = Object.assign(Object.create(App.prototype), {
		apiCalls: 9000,
		numConnections: 1,
		updateLog() {},
		hasHubAuthAvailable: () => true,
		homey: {
			setTimeout: (fn, ms) => { timers.push(ms); return {}; },
			clearTimeout() {},
			app: { updateLog() {}, apiCalls: 9000 },
			drivers: { getDrivers: () => ({ hub: { getDevices: () => devices } }) },
		},
	});
	app.homey.app = app;
	app.onHubPoll = App.prototype.onHubPoll.bind(app);
	return { app, timers };
}

test('a 429 during a poll cycle stops the rest of the cycle and pauses polling', async () =>
{
	let polled = 0;
	let appRef;
	const device = (limit) => ({ pollHubDeviceValues: async () => { polled++; if (limit) appRef.noteRateLimited(); return true; } });
	const { app, timers } = createApp([device(true), device(false), device(false)]);
	appRef = app;
	await app.onHubPoll();
	assert.equal(polled, 1);
	assert.ok(timers.at(-1) > 29 * 60 * 1000, `paused ${timers.at(-1)} ms`);
	assert.equal(app.hubPollingStatus.pausedForRateLimit, true);
});

test('while paused no device is polled; afterwards polling resumes', async () =>
{
	let polled = 0;
	const { app, timers } = createApp([{ pollHubDeviceValues: async () => { polled++; return true; } }]);
	app.rateLimitedUntil = Date.now() + 60_000;
	await app.onHubPoll();
	assert.equal(polled, 0);
	assert.ok(timers.at(-1) <= 60_000 && timers.at(-1) > 0);
	app.rateLimitedUntil = Date.now() - 1;
	await app.onHubPoll();
	assert.equal(polled, 1);
});

test('the polling budget leaves half the daily quota for commands and restarts', async () =>
{
	const devices = Array.from({ length: 71 }, () => ({ pollHubDeviceValues: async () => true }));
	const { app, timers } = createApp(devices);
	app.numConnections = 1;
	await app.onHubPoll();
	const callsPerDay = 86400000 / timers.at(-1) * 71;
	assert.ok(callsPerDay <= 5000 + 1, `polling would use ${Math.round(callsPerDay)} calls/day`);
});
