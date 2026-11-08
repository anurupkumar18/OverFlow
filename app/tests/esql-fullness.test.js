const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {Elasticsearch}=require('../src/elasticsearch');
const now=Date.parse('2026-11-08T22:00:00Z');
const talks=[{id:'a',capacity:200},{id:'b',capacity:100}];
const columns=[{name:'talk_id',type:'keyword'},{name:'bookmarks',type:'long'},{name:'reports',type:'long'},{name:'row_count',type:'long'}];
const table=values=>({is_partial:false,columns,values});
const aggregate=buckets=>({timed_out:false,_shards:{total:1,successful:1,failed:0},aggregations:{talks:{doc_count_error_upper_bound:0,sum_other_doc_count:0,buckets}}});
function fixture({esql=table([['a',20,2,1]]),esqlStatus=200,esqlHeaders={},fallback=aggregate([]),fallbackStatus=200}={}){
 const calls=[];
 const es=new Elasticsearch({env:{ES_URL:'https://elastic.test',ES_API_KEY:'fixture-private'},clock:()=>now,fetchImpl:async(url,options)=>{
  calls.push({url,body:options.body?JSON.parse(options.body):undefined});
  if(new URL(url).pathname==='/_query')return Response.json(esql,{status:esqlStatus,headers:esqlHeaders});
  if(new URL(url).pathname==='/interactions/_search')return Response.json(fallback,{status:fallbackStatus});
  throw Error('Unexpected request');
 }});
 return {es,calls};
}
test('ES|QL provides exact counts with complete table proof and confirmed absent groups become zero',async()=>{
 const f=fixture();const counts=await f.es.fullness(talks);
 assert.equal(counts.get('a').bookmarks,20);assert.equal(counts.get('a').reports,2);assert.equal(counts.get('a').pressure,.1);assert.equal(counts.get('a').likely_full,true);assert.equal(counts.get('b').bookmarks,0);assert.equal(counts.get('b').reports,0);assert.equal(counts.get('b').likely_full,false);assert.equal(counts.get('b').signal,'live');
 assert.equal(f.es.lastCrowdQueryMethod,'esql');assert.equal(f.calls.length,1);
});
test('ES|QL query scopes IDs, smoke exclusions and inclusive report times using typed JSON filters',async()=>{
 const f=fixture();await f.es.fullness(talks);const call=f.calls[0],body=call.body;
 assert.equal(new URL(call.url).pathname,'/_query');assert.equal(new URL(call.url).searchParams.get('allow_partial_results'),'false');assert.equal(new URL(call.url).searchParams.get('format'),'json');assert.equal(body.columnar,false);
 assert.match(body.query,/COUNT\(\*\) WHERE type == "bookmark"/);assert.match(body.query,/COUNT\(\*\) WHERE type == "full_report"/);assert.match(body.query,/INLINE STATS row_count = COUNT\(\*\)/);assert.match(body.query,/INLINE STATS[\s\S]*LIMIT 1000/);assert.doesNotMatch(body.query,/COUNT_DISTINCT|SAMPLE|approximation=true/);
 assert.deepEqual(body.filter.bool.filter,[{terms:{talk_id:['a','b']}}]);assert.deepEqual(body.filter.bool.must_not,[{prefix:{attendee_id:'smoke-'}}]);assert.equal(body.filter.bool.minimum_should_match,1);
 assert.deepEqual(body.filter.bool.should,[{term:{type:'bookmark'}},{bool:{filter:[{term:{type:'full_report'}},{range:{timestamp:{gte:'2026-11-08T21:50:00.000Z',lte:'2026-11-08T22:00:00.000Z'}}}]}}]);
});
test('an empty ES|QL table only becomes live zero after a complete aggregation confirms it',async()=>{
 const f=fixture({esql:table([])});const counts=await f.es.fullness(talks);
 assert.equal(f.calls.length,2);assert.equal(f.es.lastCrowdQueryMethod,'aggregations');assert.equal(counts.get('a').bookmarks,0);assert.equal(counts.get('a').signal,'live');
});
test('empty ES|QL plus incomplete aggregation remains unavailable, never live zero',async()=>{
 const f=fixture({esql:table([]),fallback:{...aggregate([]),timed_out:true}});
 await assert.rejects(f.es.fullness(talks),/unavailable/);assert.equal(f.es.lastCrowdQueryMethod,'unavailable');
});
const invalidTables=[
 ['partial flag',{...table([]),is_partial:true}],
 ['missing completeness flag',{columns,values:[]}],
 ['duplicate ID',table([['a',1,0,2],['a',1,0,2]])],
 ['unrequested ID',table([['other',1,0,1]])],
 ['truncated table',table([['a',1,0,2]])],
 ['inconsistent row count',table([['a',1,0,2],['b',0,1,1]])],
 ['missing count',table([['a',1,null,1]])],
 ['fractional count',table([['a',1.5,0,1]])],
 ['unsafe count',table([['a',Number.MAX_SAFE_INTEGER+1,0,1]])],
 ['negative count',table([['a',-1,0,1]])],
 ['wrong schema',{...table([['a',1,0,1]]),columns:[...columns.slice(0,3),{name:'row_count',type:'double'}]}],
 ['approximation columns',{...table([['a',1,0,1,1]]),columns:[...columns,{name:'_approximation_certified(bookmarks)',type:'boolean'}]}],
 ['wrong row width',table([['a',1,0,1,'extra']])],
];
for(const [name,esql] of invalidTables)test('ES|QL '+name+' is discarded before independent aggregation fallback',async()=>{
 const f=fixture({esql,fallback:aggregate([{key:'a',doc_count:3,bookmarks:{doc_count:3},reports:{doc_count:0}}])});
 const counts=await f.es.fullness(talks);assert.equal(f.calls.length,2);assert.equal(f.es.lastCrowdQueryMethod,'aggregations');assert.equal(counts.get('a').bookmarks,3);
});
test('ES|QL evaluation Warning is discarded even when the table otherwise looks complete',async()=>{
 const f=fixture({esqlHeaders:{Warning:'299 Elasticsearch "evaluation failed; private value"'},fallbackStatus:503});
 await assert.rejects(f.es.fullness(talks),/unavailable/);assert.equal(f.es.lastCrowdQueryMethod,'unavailable');assert.equal(f.calls.length,2);
});
test('unsupported ES|QL falls back to complete aggregation without claiming ES|QL execution',async()=>{
 const f=fixture({esqlStatus:400,esql:{error:'unsupported INLINE STATS'},fallback:aggregate([{key:'a',doc_count:200,bookmarks:{doc_count:200},reports:{doc_count:0}}])});
 const counts=await f.es.fullness(talks);assert.equal(f.calls.length,2);assert.equal(f.es.lastCrowdQueryMethod,'aggregations');assert.equal(counts.get('a').likely_full,true);
});
test('empty input performs no provider query',async()=>{
 const f=fixture();assert.equal((await f.es.fullness([])).size,0);assert.equal(f.calls.length,0);
});
test('a hanging ES|QL request leaves time for a successful aggregation within the original deadline',async t=>{
 const paths=[];const server=http.createServer((req,res)=>{
  paths.push(new URL(req.url,'http://localhost').pathname);
  if(req.url.startsWith('/_query'))return;
  res.end(JSON.stringify(aggregate([])));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const es=new Elasticsearch({env:{ES_URL:'http://127.0.0.1:'+server.address().port},clock:()=>now});const start=performance.now();const counts=await es.fullness(talks,180);const elapsed=performance.now()-start;
 assert.deepEqual(paths,['/_query','/interactions/_search']);assert.equal(counts.get('a').bookmarks,0);assert.equal(es.lastCrowdQueryMethod,'aggregations');assert.ok(elapsed<300,`Observed ${elapsed}ms`);
});
test('two hanging transports share one fullness deadline, not a fresh budget per attempt',async t=>{
 const paths=[];const server=http.createServer(req=>{paths.push(new URL(req.url,'http://localhost').pathname);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const es=new Elasticsearch({env:{ES_URL:'http://127.0.0.1:'+server.address().port},clock:()=>now});const start=performance.now();await assert.rejects(es.fullness(talks,180),/unavailable/);const elapsed=performance.now()-start;
 assert.deepEqual(paths,['/_query','/interactions/_search']);assert.equal(es.lastCrowdQueryMethod,'unavailable');assert.ok(elapsed<300,`Observed ${elapsed}ms`);
});

test('an empty ES|QL table cannot erase a full-room count found by its confirming aggregation',async()=>{
 const f=fixture({esql:table([]),fallback:aggregate([{key:'a',doc_count:200,bookmarks:{doc_count:200},reports:{doc_count:0}}])});
 const counts=await f.es.fullness(talks);assert.equal(counts.get('a').bookmarks,200);assert.equal(counts.get('a').likely_full,true);assert.equal(f.es.lastCrowdQueryMethod,'aggregations');
});
test('column order is decoded by verified names and preserves numeric count meaning',async()=>{
 const f=fixture({esql:{is_partial:false,columns:[columns[2],columns[0],columns[3],columns[1]],values:[[1,'a',1,180]]}});
 const counts=await f.es.fullness(talks);assert.equal(counts.get('a').bookmarks,180);assert.equal(counts.get('a').reports,1);assert.equal(counts.get('a').pressure,.9);assert.equal(counts.get('a').likely_full,false);assert.equal(f.calls.length,1);assert.equal(f.es.lastCrowdQueryMethod,'esql');
});

test('unsupported ES|QL cancels its unfinished response body before returning the fallback',async t=>{
 let resolveClosed;const closed=new Promise(resolve=>{resolveClosed=resolve;});
 const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/_query')){res.on('close',()=>resolveClosed(true));res.writeHead(400,{'content-type':'application/json'});res.write('{"error":"unsupported"}');return;}
  res.end(JSON.stringify(aggregate([])));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const es=new Elasticsearch({env:{ES_URL:'http://127.0.0.1:'+server.address().port},clock:()=>now});
 await es.fullness(talks,180);
 const canceled=await Promise.race([closed,new Promise(resolve=>setTimeout(()=>resolve(false),200))]);
 assert.equal(canceled,true,'ES|QL response body remained connected after fallback');
});
