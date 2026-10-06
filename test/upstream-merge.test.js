'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Module = require('node:module');

const originalLoad = Module._load;
let requestImpl;
Module._load = function(request, parent, isMain) {
  if (request === 'homey') return {};
  if (request === 'homey-oauth2app') return {
    OAuth2Client: class { async _executeRequest(...args) { return requestImpl(...args); } },
    OAuth2Error: Error, OAuth2Token: class {},
  };
  return originalLoad.call(this, request, parent, isMain);
};
const Client = require('../lib/SwitchBotOAuth2Client');
Module._load = originalLoad;
function client() {
  return Object.assign(Object.create(Client.prototype), {
    debug() {}, homey: { setTimeout(fn) { fn(); }, app: { updateLog() {} } },
  });
}
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', undefined]) {
  test(`transport never retries ${method || 'unknown'} commands after DNS failure`, async () => {
    let calls = 0;
    requestImpl = async () => { calls++; throw Object.assign(new Error('EAI_AGAIN'), {code:'EAI_AGAIN'}); };
    await assert.rejects(client()._executeRequest({method, path:'/scenes/test/execute'}), /EAI_AGAIN/);
    assert.equal(calls, 1);
  });
}
test('GET retries DNS failures up to three attempts and returns recovered status', async () => {
  let calls = 0;
  requestImpl = async () => { if (++calls < 3) throw Object.assign(new Error('DNS'), {code:'EAI_AGAIN'}); return {statusCode:100}; };
  assert.deepEqual(await client()._executeRequest({method:'GET',path:'/devices/test/status'}), {statusCode:100});
  assert.equal(calls, 3);
});
test('GET retry is bounded and does not replay timeout failures', async () => {
  for (const code of ['EAI_AGAIN', 'ETIMEDOUT']) {
    let calls = 0;
    requestImpl = async () => { calls++; throw Object.assign(new Error(code), {code}); };
    await assert.rejects(client()._executeRequest({method:'GET'}), new RegExp(code));
    assert.equal(calls, code === 'EAI_AGAIN' ? 3 : 1);
  }
});

// Execute the production polling method with a simulated single-radio Homey.
const source = fs.readFileSync(require.resolve('../app'), 'utf8');
const pollSource = source.slice(source.indexOf('\tasync onBLEPoll()'), source.lastIndexOf('\n}\n'));
const Poller = vm.runInNewContext(`(class { ${pollSource} })`, {Date, BLE_ADVERTISEMENT_STALE_POLL_MS:120000, BLE_POLLING_INTERVAL:30000});
function poller(states) {
  const events = [];
  const devices = new Map(states.map((s, i) => [String(i), {async getDeviceValues() {
    events.push('start'+i); await Promise.resolve(); events.push('end'+i);
  }}]));
  const p = Object.assign(new Poller(), {
    bleBusy:false, bleDiscovery:false, bleAdvertisementSupported:true,
    bleRegisteredDevices:new Set(devices.keys()), blePollingFallbackDevices:new Set(),
    getBLERegisteredDevices:()=>devices,
    getOrCreateBLEAdvertisementDeviceState:(key)=>states[Number(key)],
    pauseBLEAdvertisementSubscriptions:async()=>{events.push('pause');return ['sensor'];},
    resumeBLEAdvertisementSubscriptions:async(ids)=>{if(ids.length)events.push('resume');},
    updateLog(){}, recordBLEDeviceError:(key)=>events.push('error'+key),
    homey:{ble:{discover:async()=>events.push('discover')},setTimeout:()=>{events.push('timer');return 1;}},
  });
  return {p, events, devices};
}
test('empty recent advertisements still poll serially and restore monitors', async () => {
  const {p,events}=poller([{localSeenAt:Date.now()},{}]);
  await p.onBLEPoll();
  assert.deepEqual(events,['pause','discover','start0','end0','start1','end1','resume','timer']);
  assert.equal(p.bleBusy,false);
});
test('fresh parsed state leaves radio and advertisement monitors undisturbed', async () => {
  const {p,events}=poller([{parsedSeenAt:Date.now()}]);
  await p.onBLEPoll(); assert.deepEqual(events,['timer']);
});
test('discovery failure still polls and device failure does not block the next device', async () => {
  const {p,events,devices}=poller([{},{}]);
  p.homey.ble.discover=async()=>{throw Error('unavailable');};
  devices.get('0').getDeviceValues=async()=>{throw Error('missing');};
  await p.onBLEPoll();
  assert.deepEqual(events,['pause','error0','start1','end1','resume','timer']);
});
test('monitor pause or resume failure releases polling flags and schedules the next poll', async () => {
  for(const operation of ['pauseBLEAdvertisementSubscriptions','resumeBLEAdvertisementSubscriptions']) {
    const {p,events}=poller([{}]);p[operation]=async()=>{throw Error('radio failure');};
    await p.onBLEPoll();assert.equal(p.bleBusy,false);assert.equal(p.blePolling,false);assert.equal(events.at(-1),'timer');
  }
});
