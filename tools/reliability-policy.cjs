'use strict';
function findings(snapshot, now, previous = {}) {
  const issues = [];
  const w = snapshot.webhook || {};
  const age = value => now - Date.parse(value || '');
  if (age(w.startedAt) < 180000) return { issues, polls: previous };
  if (!w.receiverPresent && !w.registrationInProgress) issues.push('receiver-missing');
  if (w.lastRegistrationError) issues.push('receiver-registration-failed');
  if (w.registrationInProgress && age(w.lastRegistrationAttemptAt) > 60000) issues.push('receiver-registration-blocked');
  if (w.lastProviderError) issues.push('provider-registration-failed');
  const p = snapshot.polling || {};
  if (p.devices > 0 && Number.isFinite(p.intervalSeconds) && age(p.finishedAt || p.startedAt) > Math.max(180000, p.intervalSeconds * 2000)) issues.push('poll-coverage-missing');
  const polls = { ...previous };
  for (const d of snapshot.devices || []) {
    const prior = polls[d.id] || { count: 0 };
    if (d.lastPollAttemptAt !== prior.at) polls[d.id] = { at: d.lastPollAttemptAt, count: d.lastError ? prior.count + 1 : 0 };
    if (polls[d.id]?.count >= 2) issues.push('repeated-poll-failure:' + d.id);
    if (d.queuedReports > 0 && age(d.lastApplyStartedAt) > 60000) issues.push('update-queue-blocked:' + d.id);
    if (d.lastApplyError) issues.push('update-apply-failed:' + d.id);
  }
  return { issues: issues.sort(), polls };
}
module.exports = { findings };
