const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createApp}=require('../src/app');
const talk={id:'a',title:'Kubernetes security',abstract:'Safe clusters',speakers:['Ada'],start:'2026-11-10T17:00:00Z',end:'2026-11-10T17:40:00Z',room:'Salt Palace | Level 2 | A',floor:'Level 2',capacity:200,tags:['Security'],track:'Security',level:'Intermediate',source_url:'https://example.test/a',synthetic:false};
async function serve(t,options={}) { const server=http.createServer(createApp({catalog:{source:{name:'Verified fixture'},talks:[talk,{...talk,id:'b',room:'Salt Palace | Level 2 | B'}]},env:{ADMIN_TOKEN:'super-secret'},clock:()=>Date.parse('2026-11-08T00:00:00Z'),...options})); await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r))); const base='http://127.0.0.1:'+server.address().port;return (p,opts)=>fetch(base+p,opts); }

test('snapshot HTTP works with truthful modes, read-only config, status and detail',async t=>{
 const get=await serve(t); const r=await get('/api/search?q=kubernetes'); assert.equal(r.status,200);const result=await r.json();assert.equal(result.mode,'snapshot');assert.equal(result.degraded,true);assert.equal(result.total,2);assert.equal(result.items[0].fullness.reports,null);
 const config=await (await get('/api/config')).json();assert.equal(config.live_interactions,false);assert.equal(config.event.timezone,'America/Denver');
 const status=await (await get('/api/status')).json();assert.equal(status.status,'unavailable');assert.equal(status.p95_ms,null);
 assert.equal((await (await get('/api/talks/a')).json()).item.id,'a');
 const plan=await (await get('/api/planb/a')).json();assert.equal(plan.mode,'snapshot');assert.equal(plan.items[0].id,'b');
 assert.equal((await get('/api/talks/missing')).status,404);
});

test('probes never call dependencies and internal routes require constant secret authentication',async t=>{
 const get=await serve(t,{es:{search(){throw Error('Probe called external');}}});
 assert.equal((await get('/healthz')).status,200);assert.equal((await get('/readyz')).status,200);
 assert.equal((await get('/api/deps')).status,401);
 assert.equal((await get('/api/admin/mode',{method:'POST',headers:{'content-type':'application/json'},body:'{"mode":"hybrid"}'})).status,401);
 const response=await get('/api/deps',{headers:{authorization:'Bearer super-secret'}});assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/super-secret/);
});

test('hostile and oversized inputs receive bounded safe errors; writes unavailable without ES',async t=>{
 const get=await serve(t);
 assert.equal((await get('/api/search?day=invalid')).status,400);
 assert.equal((await get('/api/search?available=banana')).status,400);
 assert.equal((await get('/api/search?q='+ 'x'.repeat(501))).status,400);
 assert.equal((await get('/api/interactions',{method:'POST',headers:{'content-type':'application/json'},body:'{"talk_id":"a","attendee_id":"person","type":"bookmark"}'})).status,503);
 assert.equal((await get('/api/interactions',{method:'POST',headers:{'content-type':'application/json'},body:'{"talk_id":"a","attendee_id":"<script>","type":"bookmark"}'})).status,400);
 assert.equal((await get('/api/interactions',{method:'POST',headers:{'content-type':'application/json'},body:'{'+'x'.repeat(17000)})).status,413);
 assert.equal((await get('/api/interactions',{method:'POST',headers:{'content-type':'application/json'},body:'null'})).status,400);
 assert.equal((await get('/.env')).status,404);assert.equal((await get('/src/app.js')).status,404);
});

test('search rejects negative and fractional pagination instead of silently truncating',async t=>{
 const get=await serve(t);assert.equal((await get('/api/search?offset=-1')).status,400);assert.equal((await get('/api/search?offset=1.5')).status,400);assert.equal((await get('/api/search?offset=1001')).status,400);
});

test('total ES failure falls back to real snapshot with honest unknown crowd state',async t=>{
 const get=await serve(t,{es:{searchTalks:async()=>{throw new Error('secret=do-not-print');}}});
 const response=await get('/api/search?q=Kubernetes');const result=await response.json();assert.equal(result.mode,'snapshot');assert.equal(result.degraded,true);assert.equal(result.total,2);assert.equal(result.items[0].fullness.pressure,null);assert.doesNotMatch(JSON.stringify(result),/do-not-print/);
});

test('successful internal auth can set runtime mode but malformed mode never writes',async t=>{
 let mode=null;const get=await serve(t,{es:{setMode:async value=>{mode=value;}}});const headers={'content-type':'application/json',authorization:'Bearer super-secret'};
 assert.equal((await get('/api/admin/mode',{method:'POST',headers,body:'{"mode":"hybrid"}'})).status,200);assert.equal(mode,'hybrid');
 assert.equal((await get('/api/admin/mode',{method:'POST',headers,body:'{"mode":"invented"}'})).status,400);assert.equal(mode,'hybrid');
});

test('dependency status distinguishes configured provider from verified measurements',async t=>{
 const get=await serve(t,{statusProvider:async()=>({status:'unavailable',p95_ms:null,error_ratio:null,degraded_share:null,as_of:null})});
 const deps=await (await get('/api/deps',{headers:{authorization:'Bearer super-secret'}})).json();assert.equal(deps.telemetry.configured,true);assert.equal(deps.telemetry.verified_status,false);
});

test('only valid actual measurements verify dependency status',async t=>{
 const get=await serve(t,{statusProvider:async()=>({status:'available',p95_ms:120,error_ratio:0.02,degraded_share:0.5,as_of:'2026-11-08T00:00:00Z'})});
 const deps=await (await get('/api/deps',{headers:{authorization:'Bearer super-secret'}})).json();assert.equal(deps.telemetry.verified_status,true);
});
