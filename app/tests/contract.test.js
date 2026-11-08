const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createApp, ROUTES} = require('../src/app');
const contract = require('../../contract/api.json');
const catalog = require('../data/catalog.json');

function operations() {
  return Object.entries(contract.paths).flatMap(([route, methods]) => Object.entries(methods)
    .filter(([method]) => ['get','post','put','patch','delete','head'].includes(method))
    .map(([method, details]) => ({method:method.toUpperCase(),path:route,caller:details['x-caller'],details})));
}

test('every routable endpoint declares its method and caller in the API contract', () => {
  const declared = operations();
  assert.ok(declared.every(route => ['browser','internal'].includes(route.caller)), 'Every operation must declare x-caller');
  const shape = routes => routes.map(({method,path,caller}) => ({method,path,caller})).sort((a,b) => (a.method+a.path).localeCompare(b.method+b.path));
  assert.deepEqual(shape(ROUTES || []), shape(declared));
});

test('browser API wrappers reach every browser contract route and no internal route', async t => {
  const server = http.createServer(createApp({catalog, env:{APP_VERSION:'contract-test'}, clock:()=>Date.parse('2026-11-08T12:00:00Z')}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const originalFetch=global.fetch;
  const calls=[];
  global.fetch=async(input, options={})=>{
    const url=new URL(input,`http://127.0.0.1:${server.address().port}`);
    const response=await originalFetch(url,options);
    calls.push({method:options.method||'GET',path:url.pathname,status:response.status});
    return response;
  };
  t.after(()=>{global.fetch=originalFetch;});
  const source=await fs.readFile(path.join(__dirname,'../public/js/api.js'),'utf8');
  const {api}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const id=catalog.talks[0].id;
  await Promise.allSettled([api.search({}),api.talk(id),api.planB(id),api.config(),api.status(),
    api.interaction({talk_id:id,attendee_id:'contract-fixture',type:'bookmark'}),
    api.subscribe({talk_id:id,attendee_id:'contract-fixture'}),api.alerts('contract-fixture')]);
  const normalize=value=>value.replace(/^\/api\/(talks|planb)\/[^/]+$/, '/api/$1/{id}');
  const browser=operations().filter(route=>route.caller==='browser');
  assert.equal(calls.length,browser.length);
  for(const call of calls){
    const declared=browser.find(route=>route.method===call.method&&route.path===normalize(call.path));
    assert.ok(declared,`Undeclared browser call ${call.method} ${normalize(call.path)}`);
    assert.ok(declared.details.responses[String(call.status)],`Undocumented HTTP ${call.status} on ${declared.path}`);
  }
  assert.deepEqual(new Set(calls.map(call=>call.method+' '+normalize(call.path))),new Set(browser.map(route=>route.method+' '+route.path)));
});

test('runtime registry rejects undocumented methods before a handler runs', async t => {
  const server=http.createServer(createApp({catalog,env:{},clock:()=>Date.parse('2026-11-08T12:00:00Z')}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const route of ['/healthz','/readyz','/api/search']) {
    assert.equal((await fetch(base+route,{method:'POST'})).status,405,route);
  }
  assert.equal((await fetch(base+'/api/undeclared')).status,404);
});
