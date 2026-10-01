'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../api');
function app(extra = {}) { return { webhookDiagnostics: {}, homeyWebhook: {}, doWebhookReg: async function () { this.calls = (this.calls || 0) + 1; this.homeyWebhook = {}; this.webhookDiagnostics.lastRegistrationError = null; }, ...extra }; }
test('Healthy receiver never reconnects merely because room is quiet', async () => {
  const a = app(); const r = await api.recoverPresenceReceiver({ homey: { app: a } }); assert.equal(r.accepted, false); assert.equal(a.calls, undefined);
});
test('Missing receiver reconnects once and respects cooldown', async () => {
  const a = app({ homeyWebhook: null }); assert.equal((await api.recoverPresenceReceiver({ homey: { app: a } })).accepted, true);
  a.homeyWebhook = null; assert.equal((await api.recoverPresenceReceiver({ homey: { app: a } })).accepted, false); assert.equal(a.calls, 1);
});
test('Registration in flight cannot be overlapped by recovery', async () => {
  const a = app({ homeyWebhook: null, homeyWebhookRegistrationRunning: true }); assert.equal((await api.recoverPresenceReceiver({ homey: { app: a } })).accepted, false); assert.equal(a.calls, undefined);
});
