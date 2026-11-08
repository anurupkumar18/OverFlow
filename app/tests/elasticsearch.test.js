const test=require('node:test');const assert=require('node:assert/strict');
const {Elasticsearch}=require('../src/elasticsearch');
const talk={id:'a',title:'Kubernetes',abstract:'Containers',speakers:['Ada'],tags:[],track:'Cloud',start:'2026-11-10T17:00:00Z',end:'2026-11-10T17:40:00Z',room:'Salt Palace | Level 2 | A',floor:'Level 2',capacity:200,synthetic:false};
function fixture({mode='hybrid_rerank',failModes=[],crowd=[],clock=()=>Date.parse('2026-11-08T00:00:00Z')}={}){
 const calls=[];let setting=mode;
 const fetchImpl=async(url,options={})=>{const p=new URL(url).pathname;const body=options.body?JSON.parse(options.body):null;calls.push({path:p,body,method:options.method});
  if(p==='/overflow_settings/_doc/search')return Response.json({_source:{mode:setting}});
  if(p==='/interactions/_search')return Response.json({timed_out:false,_shards:{total:1,successful:1,skipped:0,failed:0},aggregations:{talks:{doc_count_error_upper_bound:0,sum_other_doc_count:0,buckets:crowd}}});
  if(p==='/talks/_search'){const actual=body.retriever?.text_similarity_reranker?'hybrid_rerank':body.retriever?.rrf?'hybrid':'bm25';if(failModes.includes(actual))return Response.json({error:'provider secret'},{status:400});return Response.json({hits:{total:{value:101,relation:'eq'},hits:[{_id:'a',_source:talk}]}});}
  return Response.json({result:'created'});
 };
 return {es:new Elasticsearch({env:{ES_URL:'https://elastic.test',ES_API_KEY:'private',ES_RERANK_INFERENCE_ID:'rerank'},fetchImpl,clock}),calls,setMode:m=>{setting=m;}};
}
test('semantic failure ladder reports the executed BM25 mode without leaking provider details',async()=>{
 const {es,calls}=fixture({failModes:['hybrid_rerank','hybrid']});const result=await es.searchTalks({q:'Kubernetes'},[talk]);
 assert.equal(result.mode,'bm25');assert.equal(result.degraded,true);assert.equal(result.items[0].id,'a');assert.equal(result.total,101);assert.doesNotMatch(result.reason,/secret/);
 const searches=calls.filter(c=>c.path==='/talks/_search');assert.equal(searches.length,3);
 assert.equal(searches[0].body.retriever.text_similarity_reranker.rank_window_size,20);
 assert.equal(searches[1].body.retriever.rrf.retrievers[1].standard.query.bool.must[0].semantic.field,'semantic_text');
});
test('results expire at 60 seconds and runtime mode settings refresh within 10 seconds',async()=>{
 let now=Date.parse('2026-11-08T00:00:00Z');const f=fixture({mode:'bm25',clock:()=>now});
 await f.es.searchTalks({q:'a'},[talk]);await f.es.searchTalks({q:'a'},[talk]);assert.equal(f.calls.filter(c=>c.path==='/talks/_search').length,1);
 f.setMode('hybrid');now+=10001;const switched=await f.es.searchTalks({q:'a'},[talk]);assert.equal(switched.mode,'hybrid');
 now+=60001;await f.es.searchTalks({q:'a'},[talk]);assert.equal(f.calls.filter(c=>c.path==='/talks/_search').length,3);
});
test('fullness uses the capacity denominator and exactly two recent unique reports imply full',async()=>{
 const buckets=[{key:'a',doc_count:182,bookmarks:{doc_count:180},reports:{doc_count:2}}];const {es,calls}=fixture({mode:'bm25',crowd:buckets});
 const result=await es.searchTalks({q:'Kubernetes'},[talk]);
 assert.equal(result.items[0].fullness.pressure,0.9);assert.equal(result.items[0].fullness.reports,2);assert.equal(result.items[0].fullness.likely_full,true);
 const crowd=calls.find(c=>c.path==='/interactions/_search').body;assert.deepEqual(crowd.query.bool.must_not,[{prefix:{attendee_id:'smoke-'}}]);
 const filtered=await es.searchTalks({q:'Kubernetes',available:true},[talk]);assert.equal(filtered.items.length,0);
 const search=calls.filter(c=>c.path==='/talks/_search').at(-1).body;assert.deepEqual(search.query.bool.must_not,[{terms:{id:['a']}}]);
});
test('interactions use stable unique attendee documents and exclude unbounded duplicate reports',async()=>{
 const {es,calls}=fixture({mode:'bm25'});
 await es.interact({talk_id:'a',attendee_id:'person',type:'full_report'});await es.interact({talk_id:'a',attendee_id:'person',type:'full_report'});
 const writes=calls.filter(c=>c.method==='PUT');assert.equal(writes.length,2);assert.equal(writes[0].path,writes[1].path);assert.equal(writes[0].body.type,'full_report');
 await es.interact({talk_id:'a',attendee_id:'person',type:'unbookmark'});assert.equal(calls.at(-1).method,'DELETE');
});

test('an unavailable crowd index preserves unknown values rather than inventing zeros',async()=>{
 const es=new Elasticsearch({env:{ES_URL:'https://elastic.test',SEARCH_MODE:'bm25'},fetchImpl:async(url)=>{
  const path=new URL(url).pathname;if(path==='/talks/_search')return Response.json({hits:{total:{value:1},hits:[{_source:talk}]}});
  return Response.json({error:'private provider detail'},{status:503});
 }});
 const result=await es.searchTalks({q:'Kubernetes',available:true},[talk]);assert.equal(result.items[0].fullness.bookmarks,null);assert.equal(result.items[0].fullness.signal,'unavailable');assert.equal(result.degraded,true);assert.match(result.reason,/unknown/);
});

test('a stalled Elasticsearch HTTP request is aborted within its explicit budget',async t=>{
 const http=require('node:http');const server=http.createServer(()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const es=new Elasticsearch({env:{ES_URL:'http://127.0.0.1:'+server.address().port}});
 const start=performance.now();await assert.rejects(es.request('/talks/_search',{body:{query:{match_all:{}}},timeout:30}),/unavailable/);assert.ok(performance.now()-start<500);
});

test('empty query executes chronological lexical browse and does not claim semantic reranking',async()=>{
 const {es,calls}=fixture({mode:'hybrid_rerank'});const result=await es.searchTalks({q:''},[talk]);assert.equal(result.mode,'bm25');assert.equal(result.degraded,false);
 const query=calls.find(c=>c.path==='/talks/_search').body;assert.equal(query.retriever,undefined);assert.deepEqual(query.sort,[{start:'asc'},{id:'asc'}]);
});

test('Elasticsearch credentials cannot be sent to public plaintext or embedded-auth URLs',()=>{
 assert.throws(()=>new Elasticsearch({env:{ES_URL:'http://public.example',ES_API_KEY:'private'}}),/Invalid Elasticsearch URL/);
 assert.throws(()=>new Elasticsearch({env:{ES_URL:'https://user:password@elastic.example'}}),/Invalid Elasticsearch URL/);
 assert.doesNotThrow(()=>new Elasticsearch({env:{ES_URL:'http://127.0.0.1:9200'}}));
});

const completeCrowd = buckets => ({timed_out:false,_shards:{total:1,successful:1,skipped:0,failed:0},aggregations:{talks:{doc_count_error_upper_bound:0,sum_other_doc_count:0,buckets}}});
const badCrowdResponses = [
 ['timed-out empty aggregation',{...completeCrowd([]),timed_out:true}],
 ['failed shard empty aggregation',{...completeCrowd([]),_shards:{total:2,successful:1,skipped:0,failed:1}}],
 ['truncated terms aggregation',{...completeCrowd([]),aggregations:{talks:{doc_count_error_upper_bound:0,sum_other_doc_count:1,buckets:[]}}}],
 ['missing bucket counts',completeCrowd([{key:'a',doc_count:1,bookmarks:{},reports:{doc_count:0}}])],
 ['negative bucket counts',completeCrowd([{key:'a',doc_count:1,bookmarks:{doc_count:-1},reports:{doc_count:0}}])],
 ['string bucket counts',completeCrowd([{key:'a',doc_count:1,bookmarks:{doc_count:'0'},reports:{doc_count:0}}])],
];
for (const [name,crowd] of badCrowdResponses) {
 test(name+' stays unknown and disclosed in search and Plan B',async()=>{
  const es=new Elasticsearch({env:{ES_URL:'https://elastic.test',SEARCH_MODE:'bm25'},fetchImpl:async(url)=>{
   const path=new URL(url).pathname;
   if(path==='/overflow_settings/_doc/search')return Response.json({_source:{mode:'bm25'}});
   if(path==='/interactions/_search')return Response.json(crowd);
   return Response.json({timed_out:false,_shards:{total:1,successful:1,failed:0},hits:{total:{value:1,relation:'eq'},hits:[{_source:{...talk,id:'alternative',room:'Salt Palace | Level 2 | B'}}]}});
  }});
  const search=await es.searchTalks({q:'Kubernetes',available:true},[talk]);
  assert.equal(search.items[0].fullness.bookmarks,null);assert.equal(search.items[0].fullness.reports,null);
  assert.equal(search.items[0].fullness.likely_full,null);assert.equal(search.items[0].fullness.signal,'unavailable');assert.equal(search.degraded,true);assert.match(search.reason,/unknown|unavailable/i);
  const candidates=await es.planBCandidates(talk);assert.equal(candidates.items[0].fullness.signal,'unavailable');assert.equal(candidates.items[0].fullness.likely_full,null);assert.equal(candidates.degraded,true);assert.match(candidates.reason,/unavailable/i);
 });
}

for (const [name,response] of [
 ['timed out empty',{timed_out:true,_shards:{total:1,successful:1,failed:0},hits:{total:{value:0,relation:'eq'},hits:[]}}],
 ['failed shards with surviving hit',{timed_out:false,_shards:{total:2,successful:1,failed:1},hits:{total:{value:1,relation:'eq'},hits:[{_source:{talk_id:'a'}}]}}],
 ['truncated hits',{timed_out:false,_shards:{total:1,successful:1,failed:0},hits:{total:{value:2,relation:'eq'},hits:[{_source:{talk_id:'a'}}]}}],
 ['inexact total',{timed_out:false,_shards:{total:1,successful:1,failed:0},hits:{total:{value:1,relation:'gte'},hits:[{_source:{talk_id:'a'}}]}}],
]) {
 test('alerts rejects '+name+' rather than claiming no full-room alerts',async()=>{
  const es=new Elasticsearch({env:{ES_URL:'https://elastic.test'},fetchImpl:async(url)=>Response.json(new URL(url).pathname==='/talk_alerts/_search'?response:completeCrowd([{key:'a',doc_count:2,bookmarks:{doc_count:0},reports:{doc_count:2}}])),clock:()=>Date.parse('2026-11-08T00:00:00Z')});
  await assert.rejects(es.alerts('person',new Map([['a',talk]])),/unavailable/);
 });
}
test('complete subscription search permits verified empty alerts and actual full-room alerts',async()=>{
 let subscriptions=[];const es=new Elasticsearch({env:{ES_URL:'https://elastic.test'},clock:()=>Date.parse('2026-11-08T00:00:00Z'),fetchImpl:async(url,options)=>{
  if(new URL(url).pathname==='/talk_alerts/_search'){
   const body=JSON.parse(options.body);assert.equal(body.track_total_hits,true);
   return Response.json({timed_out:false,_shards:{total:1,successful:1,failed:0},hits:{total:{value:subscriptions.length,relation:'eq'},hits:subscriptions}});
  }
  return Response.json(completeCrowd([{key:'a',doc_count:2,bookmarks:{doc_count:0},reports:{doc_count:2}}]));
 }});
 assert.deepEqual(await es.alerts('person',new Map([['a',talk]])),[]);
 subscriptions=[{_source:{talk_id:'a',attendee_id:'person'}}];const alerts=await es.alerts('person',new Map([['a',talk]]));assert.equal(alerts[0].talk_id,'a');assert.equal(alerts[0].item.fullness.likely_full,true);
});

test('per-query lower mode ceiling pins ordering and cannot override runtime rollback',async()=>{
 const f=fixture({mode:'hybrid_rerank'});
 assert.equal((await f.es.searchTalks({q:'cloud',mode:'hybrid'},[talk])).mode,'hybrid');
 assert.equal((await f.es.searchTalks({q:'cloud',mode:'bm25'},[talk])).mode,'bm25');
 f.setMode('bm25');f.es.settingsAt=-Infinity;
 assert.equal((await f.es.searchTalks({q:'cloud',mode:'hybrid_rerank'},[talk])).mode,'bm25');
 assert.equal(f.es.requestedMode,'bm25');
});

const alternative = (id, extra={}) => ({...talk,id,room:'Salt Palace | Level 2 | '+id,...extra});
function planFixture({mode='hybrid_rerank',failModes=[],candidateOverride,rankOverride,crowdOverride,semanticHighlightFails=false,clock=()=>Date.parse('2026-11-08T00:00:00Z')}={}) {
 const candidates=[alternative('rank-first'),alternative('rank-second'),alternative('full')];
 const envelope=(items,total=items.length)=>({timed_out:false,_shards:{total:1,successful:1,failed:0},hits:{total:{value:total,relation:'eq'},hits:items.map(item=>({_id:item.id,_source:item,highlight:{abstract:['A related Kubernetes excerpt']}}))}});
 const calls=[];let setting=mode;
 const es=new Elasticsearch({env:{ES_URL:'https://elastic.test',ES_RERANK_INFERENCE_ID:'verified-test-endpoint'},clock,fetchImpl:async(url,options)=>{
  const path=new URL(url).pathname;const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body,signal:options.signal});
  if(path==='/overflow_settings/_doc/search')return Response.json({_source:{mode:setting}});
  if(path==='/interactions/_search')return Response.json(crowdOverride||completeCrowd([{key:'full',doc_count:200,bookmarks:{doc_count:200},reports:{doc_count:0}}]));
  if(path==='/talks/_search'){
   if(body.size===1000)return Response.json(candidateOverride||envelope(candidates));
   const actual=body.retriever?.text_similarity_reranker?'hybrid_rerank':body.retriever?.rrf?'hybrid':'bm25';
   if(failModes.includes(actual)||(semanticHighlightFails&&body.highlight?.fields?.semantic_text))return Response.json({error:'private provider response'},{status:400});
   return Response.json(rankOverride||envelope(candidates.slice(0,2)));
  }
  throw Error('Unexpected request');
 }});
 return {es,calls,candidates,envelope,setMode:mode=>{setting=mode;}};
}
test('Plan B executes filtered more_like_this plus semantic RRF and bounded rerank with actual matched excerpt',async()=>{
 const f=planFixture();const result=await f.es.planBCandidates(talk);
 assert.equal(result.mode,'hybrid_rerank');assert.equal(result.degraded,false);assert.deepEqual(result.items.map(t=>t.id),['rank-first','rank-second']);assert.match(result.items[0].why_matched,/Kubernetes excerpt/);
 const ranked=f.calls.find(c=>c.body?.retriever?.text_similarity_reranker).body;
 const reranker=ranked.retriever.text_similarity_reranker;assert.equal(ranked.size,20);assert.equal(reranker.rank_window_size,20);assert.equal(reranker.inference_id,'verified-test-endpoint');assert.match(reranker.inference_text,/Kubernetes/);
 const children=reranker.retriever.rrf.retrievers;
 assert.deepEqual(children[0].standard.query.bool.must[0].more_like_this.fields,['title','abstract']);assert.equal(children[0].standard.query.bool.must[0].more_like_this.min_term_freq,1);
 assert.equal(children[1].standard.query.bool.must[0].semantic.field,'semantic_text');
 for(const child of children){const query=child.standard.query.bool;assert.equal(query.filter[0].range.start.gte,'2026-11-10T16:50:00.000Z');assert.equal(query.filter[0].range.start.lte,'2026-11-10T17:10:00.000Z');assert.deepEqual(query.must_not,[{term:{room:talk.room}},{term:{id:talk.id}},{terms:{id:['full']}}]);}
});
test('Plan B fallback reports only an executed lower mode and honors runtime rollback/cache',async()=>{
 let now=Date.parse('2026-11-08T00:00:00Z');const f=planFixture({failModes:['hybrid_rerank'],clock:()=>now});
 const result=await f.es.planBCandidates(talk);assert.equal(result.mode,'hybrid');assert.equal(result.degraded,true);assert.match(result.reason,/hybrid/);assert.doesNotMatch(result.reason,/private/);
 const calls=f.calls.length;await f.es.planBCandidates(talk);assert.equal(f.calls.length,calls);
 f.setMode('bm25');now+=10001;const rollback=await f.es.planBCandidates(talk);assert.equal(rollback.mode,'bm25');assert.equal(rollback.degraded,false);
 const request=f.calls.filter(c=>c.path==='/talks/_search').at(-1).body;assert.ok(request.query.bool.must[0].more_like_this);assert.equal(request.retriever,undefined);
});
test('Plan B semantic highlighting failure keeps successful hybrid retrieval with lexical explanation',async()=>{
 const f=planFixture({mode:'hybrid',semanticHighlightFails:true});const result=await f.es.planBCandidates(talk);
 assert.equal(result.mode,'hybrid');assert.equal(result.degraded,false);assert.match(result.items[0].why_matched,/Kubernetes excerpt/);
 const queries=f.calls.filter(c=>c.body?.retriever?.rrf);assert.equal(queries.length,2);assert.ok(queries[0].body.highlight.fields.semantic_text);assert.equal(queries[1].body.highlight.fields.semantic_text,undefined);assert.ok(queries[1].body.highlight.fields.abstract);
});
for(const [name,override] of [
 ['partial candidate shards',{timed_out:false,_shards:{total:2,successful:1,failed:1},hits:{total:{value:0,relation:'eq'},hits:[]}}],
 ['truncated candidate window',{timed_out:false,_shards:{total:1,successful:1,failed:0},hits:{total:{value:1,relation:'eq'},hits:[]}}],
 ['inexact candidate total',{timed_out:false,_shards:{total:1,successful:1,failed:0},hits:{total:{value:0,relation:'gte'},hits:[]}}],
])test('Plan B rejects '+name+' instead of silently ranking an incomplete safe set',async()=>{
 const f=planFixture({candidateOverride:override});await assert.rejects(f.es.planBCandidates(talk),/unavailable/);
});
test('Plan B partial ranked hits fall through modes and reject if no complete ranking succeeds',async()=>{
 const f=planFixture({rankOverride:{timed_out:true,_shards:{total:1,successful:1,failed:0},hits:{total:{value:0,relation:'eq'},hits:[]}}});
 await assert.rejects(f.es.planBCandidates(talk),/unavailable/);
 const rankings=f.calls.filter(c=>c.path==='/talks/_search'&&c.body.size!==1000);assert.ok(rankings.some(c=>c.body.retriever?.text_similarity_reranker));assert.ok(rankings.some(c=>c.body.retriever?.rrf));assert.ok(rankings.some(c=>c.body.query?.bool?.must?.[0]?.more_like_this));
});

test('Plan B aborts the reranker at its 300ms budget and returns executed hybrid fallback',async t=>{
 const http=require('node:http');const calls=[];const item=alternative('safe');
 const search={timed_out:false,_shards:{total:1,successful:1,failed:0},hits:{total:{value:1,relation:'eq'},hits:[{_source:item,highlight:{semantic_text:['Containers on Kubernetes']}}]}};
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;
  if(req.url==='/overflow_settings/_doc/search'){res.end(JSON.stringify({_source:{mode:'hybrid_rerank'}}));return;}
  if(req.url==='/interactions/_search'){res.end(JSON.stringify(completeCrowd([])));return;}
  calls.push(body);
  if(body.retriever?.text_similarity_reranker)return;
  res.end(JSON.stringify(search));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const es=new Elasticsearch({env:{ES_URL:'http://127.0.0.1:'+server.address().port,ES_RERANK_INFERENCE_ID:'local-fixture'},clock:()=>Date.parse('2026-11-08T00:00:00Z')});
 const start=performance.now();const result=await es.planBCandidates(talk);const elapsed=performance.now()-start;
 assert.equal(result.mode,'hybrid');assert.equal(result.degraded,true);assert.equal(result.items[0].id,'safe');assert.ok(elapsed>=250&&elapsed<1500,`Observed ${elapsed}ms`);assert.equal(calls.filter(body=>body.retriever?.text_similarity_reranker).length,1);assert.ok(calls.some(body=>body.retriever?.rrf));
});

test('Plan B rejects a ranked response missing rows below its requested window',async()=>{
 const f=planFixture();const incomplete=f.envelope(f.candidates.slice(0,1),2);
 const broken=planFixture({rankOverride:incomplete});
 await assert.rejects(broken.es.planBCandidates(talk),/unavailable/);
});
