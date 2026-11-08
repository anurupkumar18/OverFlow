const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { browserTelemetryConfig } = require('../src/browser-telemetry');
const { createApp } = require('../src/app');
const ready = { DASH0_BROWSER_ENABLED:'true', DASH0_BROWSER_ENDPOINT:'https://ingress.example.test', DASH0_BROWSER_TOKEN:'auth_browser_only_test', DASH0_BROWSER_DATASET:'website', NODE_ENV:'production' };
const browserModule = import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname,'../public/js/telemetry.js'),'utf8')).toString('base64'));

test('browser telemetry needs explicit enablement and never exposes server credentials', () => {
  const privateEnv = { ES_API_KEY:'auth_es_secret', ADMIN_TOKEN:'auth_admin_secret', DASH0_READ_TOKEN:'auth_read_secret', OTEL_EXPORTER_OTLP_HEADERS:'authorization=Bearer auth_server_secret' };
  assert.deepEqual(browserTelemetryConfig({...ready,...privateEnv,DASH0_BROWSER_ENABLED:'false'}),{enabled:false});
  const value = browserTelemetryConfig({...ready,...privateEnv});
  assert.equal(value.enabled,true); assert.equal(value.token,ready.DASH0_BROWSER_TOKEN);
  assert.equal(value.endpoint,'https://ingress.example.test');
  for (const secret of Object.values(privateEnv)) assert.ok(!JSON.stringify(value).includes(secret));
  for (const token of ['auth_es_secret','auth_admin_secret','auth_read_secret','auth_server_secret']) assert.deepEqual(browserTelemetryConfig({...ready,...privateEnv,DASH0_BROWSER_TOKEN:token}),{enabled:false});
  for (const name of ['OTEL_EXPORTER_OTLP_TRACES_HEADERS','OTEL_EXPORTER_OTLP_METRICS_HEADERS','OTEL_EXPORTER_OTLP_LOGS_HEADERS']) assert.deepEqual(browserTelemetryConfig({...ready,[name]:'authorization=Bearer%20'+ready.DASH0_BROWSER_TOKEN}),{enabled:false});
});

test('browser ingest configuration rejects unsafe URLs, missing dataset and malformed values', () => {
  for (const endpoint of ['javascript:alert(1)','https://name:secret@ingress.example.test','https://ingress.example.test?token=secret','https://ingress.example.test/#secret','http://ingress.example.test','http://127.0.0.1:4318','https://ingress.example.test/v1/traces']) {
    assert.deepEqual(browserTelemetryConfig({...ready,DASH0_BROWSER_ENDPOINT:endpoint}),{enabled:false},endpoint);
  }
  assert.deepEqual(browserTelemetryConfig({...ready,DASH0_BROWSER_DATASET:''}),{enabled:false});
  assert.deepEqual(browserTelemetryConfig({...ready,DASH0_BROWSER_TOKEN:'auth_token\nheader'}),{enabled:false});
  assert.equal(browserTelemetryConfig({...ready,NODE_ENV:'test',DASH0_BROWSER_ENDPOINT:'http://127.0.0.1:4318'}).enabled,true);
});

test('public config and CSP expose only dedicated browser ingest configuration and its exact origin', async t => {
  const talk = {id:'a',title:'Test',abstract:'Test',speakers:['Speaker'],start:'2026-11-10T17:00:00Z',end:'2026-11-10T18:00:00Z',room:'A',capacity:200,capacity_source:'estimate'};
  const server = http.createServer(createApp({catalog:{source:{name:'fixture'},talks:[talk]},env:{...ready,APP_VERSION:'rum-test',DASH0_READ_TOKEN:'private-read'}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const config=await fetch(base+'/api/config').then(r=>r.json());
  assert.equal(config.browser_rum.enabled,true); assert.equal(config.browser_rum.token,ready.DASH0_BROWSER_TOKEN);
  assert.ok(!JSON.stringify(config).includes('private-read'));
  const page=await fetch(base+'/');
  assert.match(page.headers.get('content-security-policy'),/connect-src 'self' https:\/\/ingress\.example\.test;/);
  assert.doesNotMatch(page.headers.get('content-security-policy'),/connect-src[^;]*\*/);
});

function harness(createBrowserTelemetry) {
  const values=new Map();const events=new Map();const calls=[];let loaded=0;
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const sdk={init:opts=>calls.push(['init',opts]),identify:id=>calls.push(['identify',id]),sendEvent:(...args)=>calls.push(['event',...args]),reportError:(...args)=>calls.push(['error',...args])};
  const target={addEventListener:(name,fn)=>events.set(name,fn)};
  const telemetry=createBrowserTelemetry({loadSdk:async()=>{loaded++;return sdk;},getStorage:()=>storage,randomUUID:()=> '11111111-1111-4111-8111-111111111111',eventTarget:target,documentTarget:target});
  return {telemetry,calls,events,values,sdk,loaded:()=>loaded};
}

test('disabled browser telemetry has no SDK load, identity storage or event listeners', async()=>{
  const {createBrowserTelemetry}=await browserModule;const h=harness(createBrowserTelemetry);
  assert.equal(await h.telemetry.start({enabled:false},'test'),false);
  h.telemetry.track('search');
  assert.equal(h.loaded(),0);assert.equal(h.values.size,0);assert.equal(h.events.size,0);assert.equal(h.calls.length,0);
});

test('browser telemetry initializes once with privacy-safe options and an independent anonymous identity', async()=>{
  const {createBrowserTelemetry}=await browserModule;const h=harness(createBrowserTelemetry);
  h.values.set('overflow.attendee.v1','attendee-do-not-export');
  assert.equal(await h.telemetry.start(browserTelemetryConfig(ready),'build-123'),true);
  assert.equal(await h.telemetry.start(browserTelemetryConfig(ready),'build-123'),true);
  assert.equal(h.loaded(),1);
  const options=h.calls.find(c=>c[0]==='init')[1];
  assert.equal(options.serviceName,'overflow-web');assert.equal(options.serviceVersion,'build-123');
  assert.deepEqual(options.enabledInstrumentations,['@dash0/navigation','@dash0/web-vitals','@dash0/fetch']);
  assert.deepEqual(options.headersToCapture,[]);assert.equal(options.disableVcsDetection,true);
  assert.equal(options.sessionRecording,undefined);assert.equal(options.enableTransportCompression,false);
  assert.match(h.calls.find(c=>c[0]==='identify')[1],/^rum-[a-f0-9-]+$/);
  assert.ok(!JSON.stringify(h.calls).includes('attendee-do-not-export'));
});

test('URL scrubber removes search input, attendee IDs, fragments and unexpected paths from all URL fields',async()=>{
  const {scrubUrlAttributes}=await browserModule;
  const scrubbed=scrubUrlAttributes({'url.full':'https://overflow.example/api/search?q=secret-query&attendee_id=private-id#secret','url.query':'q=secret-query&attendee_id=private-id','url.fragment':'secret','url.path':'/api/search'});
  assert.ok(!JSON.stringify(scrubbed).includes('secret'));assert.ok(!JSON.stringify(scrubbed).includes('private-id'));
  assert.equal(scrubbed['url.full'],'https://overflow.example/api/search');
  assert.equal(scrubUrlAttributes({'url.full':'https://overflow.example/untrusted-private-path','url.path':'/untrusted-private-path'})['url.path'],'/REDACTED');
});

test('custom actions and error capture never export arbitrary text or original exception details',async()=>{
  const {createBrowserTelemetry}=await browserModule;const h=harness(createBrowserTelemetry);
  await h.telemetry.start(browserTelemetryConfig(ready),'test');
  h.telemetry.track('search');h.telemetry.track('secret-query');
  h.events.get('error')({message:'secret-query',error:new Error('private-id')});
  h.events.get('unhandledrejection')({reason:new Error('private-id')});
  const sent=h.calls.filter(c=>['event','error'].includes(c[0]));
  assert.equal(sent.filter(c=>c[0]==='event').length,1);assert.equal(sent.filter(c=>c[0]==='error').length,2);
  assert.ok(!JSON.stringify(sent).includes('private-id'));assert.ok(!JSON.stringify(sent).includes('secret-query'));
});

test('SDK load or storage failures do not reject or block product actions',async()=>{
  const {createBrowserTelemetry}=await browserModule;
  const failed=createBrowserTelemetry({loadSdk:async()=>{throw Error('offline')},eventTarget:{},documentTarget:{}});
  assert.equal(await failed.start(browserTelemetryConfig(ready),'test'),false);assert.doesNotThrow(()=>failed.track('search'));
  const calls=[];
  const blocked=createBrowserTelemetry({loadSdk:async()=>({init(){},identify:id=>calls.push(id),sendEvent(){},reportError(){}}),getStorage:()=>{throw Error('blocked')},randomUUID:()=> '11111111-1111-4111-8111-111111111111',eventTarget:{addEventListener(){}},documentTarget:{addEventListener(){}}});
  assert.equal(await blocked.start(browserTelemetryConfig(ready),'test'),true);assert.equal(calls.length,1);
});
