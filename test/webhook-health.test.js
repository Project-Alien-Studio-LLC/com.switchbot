'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ensureWebhookHealth = require('../lib/webhook-health');

const url = 'https://example.test/homey';
function fixture({ urls = [url], enable = true, deviceList = 'ALL' } = {})
{
	const calls = [];
	let details = { url, enable, deviceList };
	return {
		calls,
		client: {
			async getWebhook() { calls.push('query'); return { statusCode: 100, body: { urls } }; },
			async getWebhookDetails() { calls.push('details'); return { statusCode: 100, body: [details] }; },
			async setWebhook() { calls.push('setup'); return { statusCode: 100 }; },
			async enableWebhook() { calls.push('enable'); details = { url, enable: true, deviceList: 'ALL' }; return { statusCode: 100 }; },
		},
	};
}

test('a healthy webhook anywhere in the URL list is verified without rewriting it', async () => {
	const f = fixture({ urls: ['https://example.test/other', url] });
	const result = await ensureWebhookHealth(f.client, url);
	assert.equal(result.repaired, false);
	assert.deepEqual(f.calls, ['query', 'details']);
});

test('disabled or restricted webhook is repaired and verified by a fresh read', async () => {
	for (const initial of [{ enable: false }, { deviceList: 'SOME' }])
	{
		const f = fixture(initial);
		const result = await ensureWebhookHealth(f.client, url);
		assert.equal(result.enabled, true);
		assert.equal(result.repaired, true);
		assert.deepEqual(f.calls, ['query', 'details', 'enable', 'details']);
	}
});

test('an accepted enable response without changed configuration is not considered recovery', async () => {
	const f = fixture({ enable: false });
	f.client.enableWebhook = async () => ({ statusCode: 100 });
	await assert.rejects(ensureWebhookHealth(f.client, url), /not confirmed/);
});

test('missing webhook is created and its configuration read back', async () => {
	const f = fixture({ urls: [] });
	const result = await ensureWebhookHealth(f.client, url);
	assert.equal(result.created, true);
	assert.deepEqual(f.calls, ['query', 'setup', 'details']);
});

test('failed or malformed queries never imply a healthy feed or trigger speculative setup', async () => {
	for (const response of [null, { statusCode: 190 }, { statusCode: 100, body: {} }])
	{
		const f = fixture();
		f.client.getWebhook = async () => response;
		await assert.rejects(ensureWebhookHealth(f.client, url), /query failed/);
		assert.equal(f.calls.length, 0);
	}
	const f = fixture();
	f.client.getWebhookDetails = async () => ({ statusCode: 100, body: [{ url }] });
	await assert.rejects(ensureWebhookHealth(f.client, url), /status missing/);
	assert.deepEqual(f.calls, ['query']);
});

test('a different integration webhook is preserved and surfaced as a conflict', async () => {
	const f = fixture({ urls: ['https://example.test/other'] });
	await assert.rejects(ensureWebhookHealth(f.client, url), /Another SwitchBot webhook/);
	assert.deepEqual(f.calls, ['query']);
});

const source = fs.readFileSync(require.resolve('../app'), 'utf8');
const methods = source.slice(source.indexOf('\tasync ensureSwitchBotWebhook()'), source.indexOf('\tgetFirstSavedOAuth2Client()'));
const App = vm.runInNewContext(`(class { ${methods} })`, { Homey: { env: { WEBHOOK_URL: url } }, Date, ensureWebhookHealth, WEBHOOK_AUTH_MISSING_INTERVAL_MS: 300000 });

test('provider failure still schedules a retry and clears the in-progress diagnostic', async () => {
	const timers = [];
	const app = Object.assign(new App(), {
		openToken: 'present', openSecret: 'present',
		hub: { async getWebhook() { throw new Error('SwitchBot webhook query timed out'); } },
		hasWebhookEligibleDevices: () => true,
		hasHubAuthAvailable: () => true,
		formatRateLimitErrorMessage: (s) => s,
		redactSensitiveLogData: (s) => s,
		updateLog() {},
		homey: { setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {} },
	});
	app.homey.app = app;
	await app.setupSwitchBotWebhook();
	assert.equal(app.webhookDiagnostics.providerCheckInProgress, false);
	assert.match(app.webhookDiagnostics.lastProviderError, /timed out/);
	assert.equal(timers[0].ms, 60000);
	assert.ok(app.webhookDiagnostics.nextProviderCheckAt);
});
