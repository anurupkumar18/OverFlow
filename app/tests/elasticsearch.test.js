const test=require('node:test');const assert=require('node:assert/strict');
const {Elasticsearch}=require('../src/elasticsearch');
const talk={id:'a',title:'Kubernetes',abstract:'Containers',speakers:['Ada'],tags:[],track:'Cloud',start:'2026-11-10T17:00:00Z',end:'2026-11-10T17:40:00Z',room:'Salt Palace | Level 2 | A',floor:'Level 2',capacity:200,synthetic:false};
function fixture({mode='hybrid_rerank',failModes=[],crowd=[],clock=()=>Date.parse('2026-11-08T00:00:00Z')}={}){
 const calls=[];let setting=mode;
 const fetchImpl=async(url,options={})=>{const p=new URL(url).pathname;const body=options.body?JSON.parse(options.body):null;calls.push({path:p,body,method:options.method});
  if(p==='/overflow_settings/_doc/search')return Response.json({_source:{mode:setting}});
  if(p==='/interactions/_search')return Response.json({aggregations:{talks:{buckets:crowd}}});
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
 const buckets=[{key:'a',bookmarks:{doc_count:180},reports:{doc_count:2}}];const {es,calls}=fixture({mode:'bm25',crowd:buckets});
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
