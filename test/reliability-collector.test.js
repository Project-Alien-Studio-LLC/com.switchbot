'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../tools/reliability-collector.cjs');
function run(dir, prelude) {
  const output = spawnSync(process.execPath, ['-e', prelude + ';require(' + JSON.stringify(script) + ')'], { env: { ...process.env, SWITCHBOT_EVIDENCE_DIR: dir, HOMEY_LOCAL_TOKEN: 'test-only' }, encoding: 'utf8' });
  assert.equal(output.status, 0, output.stderr); return JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
}
test('Completed fixed trial makes zero network calls and preserves its end', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchbot-test-'));
  const end = Date.now() - 1000; fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ endsAt: end }));
  const s = run(dir, 'global.fetch=()=>{throw new Error("NETWORK AFTER END")}'); assert.equal(s.endsAt, end); assert.ok(s.completedAt); assert.equal(fs.existsSync(path.join(dir, 'collector.lock')), false);
});
test('Healthy collector samples survive process restart without extending trial', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchbot-test-'));
  const stub = 'global.fetch=async()=>({ok:true,json:async()=>({webhook:{startedAt:new Date(Date.now()-600000).toISOString(),receiverPresent:true},devices:[]})})';
  const a = run(dir, stub), b = run(dir, stub); assert.equal(b.endsAt, a.endsAt); assert.equal(b.samples, 2); assert.deepEqual(b.active, []);
});
test('Missing evidence cannot resolve an existing receiver fault', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchbot-test-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ endsAt: Date.now()+60000, polls:{}, streaks:{}, active:['receiver-missing'], samples:0 }));
  const s = run(dir, 'global.fetch=async()=>{throw new Error("offline")}'); assert.ok(s.active.includes('receiver-missing')); assert.equal(s.appRestartAt, undefined);
});
