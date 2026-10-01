'use strict';
// Only diagnostics GETs are sampled. Recovery is a separately gated app-only action.
const fs = require('node:fs');
const path = require('node:path');
const { findings } = require('./reliability-policy.cjs');
const dir = process.env.SWITCHBOT_EVIDENCE_DIR;
if (!dir || !process.env.HOMEY_LOCAL_TOKEN) throw new Error('Evidence directory and Homey authentication required');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const statePath = path.join(dir, 'state.json');
const lockPath = path.join(dir, 'collector.lock');
let lock;
try { lock = fs.openSync(lockPath, 'wx', 0o600); } catch (e) {
  if (e.code !== 'EEXIST') throw e;
  const pid = Number(fs.readFileSync(lockPath, 'utf8'));
  if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid collector lock; manual inspection required');
  try { process.kill(pid, 0); process.exit(0); } catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
  fs.unlinkSync(lockPath); lock = fs.openSync(lockPath, 'wx', 0o600);
}
fs.writeSync(lock, String(process.pid));
function save(state) { fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 }); fs.renameSync(statePath + '.tmp', statePath); }
const now = Date.now();
let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { startedAt: now, endsAt: now + 86400000, polls: {}, streaks: {}, active: [], samples: 0 };
const base = 'http://192.168.68.95/api';
async function request(route, body) {
  if (Date.now() >= state.endsAt) throw new Error('Verification window ended');
  const r = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + process.env.HOMEY_LOCAL_TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Homey HTTP ' + r.status);
  return r.json();
}
async function notify(text) {
  await request('/manager/flow/flowcardaction/homey%3Amanager%3Anotifications/homey%3Amanager%3Anotifications%3Acreate_notification/run', { args: { text: 'SwitchBot reliability: ' + text }, tokens: {}, state: {} });
}
(async () => {
  if (now >= state.endsAt) { state.completedAt ||= now; save(state); return; }
  let snapshot, result;
  try { snapshot = await request('/app/com.switchbot/getPresenceDiagnostics/'); result = findings(snapshot, now, state.polls); }
  catch (e) { snapshot = { collectionError: e.message }; result = { issues: ['collector-coverage-missing'], polls: state.polls }; }
  // Save evidence before notifications or recovery, retain at most 48 hours.
  const file = path.join(dir, 'samples-' + new Date(now).toISOString().slice(0, 10) + '.jsonl');
  fs.appendFileSync(file, JSON.stringify({ at: now, snapshot }) + '\n', { mode: 0o600 });
  for (const name of fs.readdirSync(dir).filter(n => /^samples-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))) {
    const target = path.join(dir, name);
    const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean).filter(line => JSON.parse(line).at >= now - 172800000);
    if (!lines.length) fs.unlinkSync(target); else { fs.writeFileSync(target + '.tmp', lines.join('\n') + '\n', { mode: 0o600 }); fs.renameSync(target + '.tmp', target); }
  }
  state.samples++; state.lastSampleAt = now; state.polls = result.polls;
  const previousStreaks = state.streaks;
  state.streaks = Object.fromEntries(result.issues.map(key => [key, (previousStreaks[key] || 0) + 1]));
  const confirmed = result.issues.filter(key => state.streaks[key] >= 2);
  save(state);
  for (const key of confirmed.filter(k => !state.active.includes(k))) {
    try { await notify('Confirmed ' + key + '. Evidence saved.'); state.active.push(key); save(state); }
    catch (e) { state.lastNotificationError = e.message; save(state); }
  }
  for (const key of state.active.filter(k => !snapshot.collectionError && !result.issues.includes(k))) {
    state.clearStreaks ||= {}; state.clearStreaks[key] = (state.clearStreaks[key] || 0) + 1;
    if (state.clearStreaks[key] >= 2) { try { await notify('Recovered ' + key + '.'); state.active = state.active.filter(k => k !== key); delete state.clearStreaks[key]; save(state); } catch (e) { state.lastNotificationError = e.message; save(state); } }
  }
  for (const key of result.issues) if (state.clearStreaks) delete state.clearStreaks[key];
  const receiverFault = confirmed.some(k => k === 'receiver-missing' || k === 'receiver-registration-failed');
  if (receiverFault && !state.receiverRecoveryAt && !snapshot.webhook?.registrationInProgress) {
    state.receiverRecoveryAt = now; save(state);
    try { state.receiverRecoveryResult = await request('/app/com.switchbot/recoverPresenceReceiver/', {}); } catch (e) { state.receiverRecoveryError = e.message; }
    save(state);
  }
  // One app-only restart per fixed trial, only after failed targeted recovery.
  if (receiverFault && state.receiverRecoveryAt && now - state.receiverRecoveryAt >= 300000 && !state.appRestartAt && (state.receiverRecoveryResult?.accepted || state.receiverRecoveryError)) {
    state.appRestartAt = now; save(state);
    try { await notify('Receiver recovery failed; restarting only the SwitchBot app once.'); state.appRestartResult = await request('/manager/apps/app/com.switchbot/restart', {}); } catch (e) { state.appRestartError = e.message; }
    save(state);
  }
  save(state);
})().catch(e => { state.lastCollectorError = e.message; save(state); process.exitCode = 1; }).finally(() => { fs.closeSync(lock); fs.unlinkSync(lockPath); });
