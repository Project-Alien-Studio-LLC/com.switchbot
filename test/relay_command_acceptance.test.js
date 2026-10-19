'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const load = Module._load;
Module._load = function(request, parent, main) {
  if (request === 'homey-oauth2app') return { OAuth2Device: class {} };
  return load.call(this, request, parent, main);
};
const Relay = require('../drivers/relay_hub/device');
Module._load = load;
function fixture(response, status = 0) {
  const calls = [], values = [], warnings = [];
  const d = Object.assign(Object.create(Relay.prototype), {
    requireCommandAcceptance: true, preferOAuthCommands: true,
    getData: () => ({id:'fixture'}),
    getOAuth2ClientForDevice: () => ({setDeviceData:async data=>{calls.push(data);return response;}}),
    getOfflineCooldownUntil:()=>0, clearOfflineCooldown:()=>{}, clearDeviceOfflineWarning:async()=>{},
    confirmDeviceOffline:async()=>assert.fail('Rejected command must not be promoted by cached status'),
    _getHubDeviceValues:async()=>({switchStatus:status}),
    setCapabilityValue:async(k,v)=>values.push([k,v]), unsetWarning:async()=>{},
    setWarning:async x=>warnings.push(x), error:()=>{},
    homey:{app:{updateLog:()=>{},varToString:JSON.stringify},setTimeout:()=>assert.fail('No command retry')},
  });return {d,calls,values,warnings};
}
test('161, transient/rejected and missing acknowledgements never become success or repeat',async()=>{
  for(const response of [{statusCode:161},{statusCode:171},{statusCode:190},{},null]){
    const f=fixture(response);await assert.rejects(f.d.onCapabilityOnOff(false));
    assert.equal(f.calls.length,1);assert.equal(f.values.length,0);assert.equal(f.warnings.length,1);
  }
});
test('accepted OFF with matching explicit source readback succeeds once',async()=>{
 const f=fixture({statusCode:100},0);await f.d.onCapabilityOnOff(false);
 assert.equal(f.calls.length,1);assert.deepEqual(f.values,[['onoff',false]]);
});
test('accepted command with opposite or invalid status fails without changing state',async()=>{
 for(const v of [1,undefined,null,'0',true]){const f=fixture({statusCode:100},v);if(v===undefined)f.d._getHubDeviceValues=async()=>({});await assert.rejects(f.d.onCapabilityOnOff(false));assert.equal(f.calls.length,1);assert.equal(f.values.length,0);}
});
test('status parser preserves unknown instead of manufacturing OFF',()=>{
 const d=fixture({statusCode:100}).d;assert.equal(d.parseSwitchStatus(0),false);assert.equal(d.parseSwitchStatus(1),true);for(const v of [null,undefined,'1','off',2,{},false])assert.throws(()=>d.parseSwitchStatus(v));
});
