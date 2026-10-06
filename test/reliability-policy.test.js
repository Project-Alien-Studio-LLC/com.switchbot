'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findings } = require('../tools/reliability-policy.cjs');
const now = Date.now();
const healthy = () => ({ webhook: { startedAt: new Date(now - 600000).toISOString(), receiverPresent: true }, devices: [{ id: 'bath', presence: false, queuedReports: 0 }] });
test('A quiet room is not a fault', () => assert.deepEqual(findings(healthy(), now).issues, []));
test('Repeated sampling of one failed poll is not multiple failures', () => {
  const s = healthy(); s.devices[0].lastPollAttemptAt = 'first'; s.devices[0].lastError = 'timeout';
  let a = findings(s, now); a = findings(s, now, a.polls); assert.deepEqual(a.issues, []);
  s.devices[0].lastPollAttemptAt = 'second'; assert.ok(findings(s, now, a.polls).issues.includes('repeated-poll-failure:bath'));
});
test('Missing receiver and blocked queues are diagnosed independently', () => {
  const s = healthy(); s.webhook.receiverPresent = false; s.devices[0].queuedReports = 1; s.devices[0].lastApplyStartedAt = new Date(now - 120000).toISOString();
  assert.deepEqual(findings(s, now).issues, ['receiver-missing', 'update-queue-blocked:bath']);
});
test('Startup grace avoids false alarms', () => {
  const s = healthy(); s.webhook.startedAt = new Date(now).toISOString(); s.webhook.receiverPresent = false;
  assert.deepEqual(findings(s, now).issues, []);
});
