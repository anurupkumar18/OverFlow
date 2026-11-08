const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {Elasticsearch}=require('../src/elasticsearch');
const now=Date.parse('2026-11-08T00:00:00Z');
const source={id:'source',title:'Kubernetes security',abstract:'Admission controls and policy enforcement',speakers:['Ada'],tags:['Security'],track:'Security',start:'2026-11-10T17:00:00Z',end:'2026-11-10T17:40:00Z',room:'Salt Palace | Level 2 | A',floor:'Level 2',capacity:200};
const safe={...source,id:'safe',room:'Salt Palace | Level 2 | B'},full={...source,id:'full',room:'Salt Palace | Level 2 | C'};
const envelope=items=>({timed_out:false,_shards:{total:1,successful:1,failed:0},hits:{total:{value:items.length,relation:'eq'},hits:items.map(item=>({_source:item,highlight:{abstract:['Kubernetes policy admission controls']}}))}});
const crowd={timed_out:false,_shards:{total:1,successful:1,failed:0},aggregations:{talks:{doc_count_error_upper_bound:0,sum_other_doc_count:0,buckets:[{key:'full',doc_count:200,bookmarks:{doc_count:200},reports:{doc_count:0}}]}}};
const lexical=body=>body.query?.bool?.must?.[0]?.more_like_this||body.retriever?.rrf?.retrievers?.[0]?.standard.query.bool.must[0].more_like_this||body.retriever?.text_similarity_reranker?.retriever.rrf.retrievers[0].standard.query.bool.must[0].more_like_this;
function fixture({mode='bm25',strict=[],broader=[safe],broadStatus=200,broadEnvelope,highlightFails=false,candidates=[safe,full]}={}){
 const calls=[];
 const es=new Elasticsearch({env:{ES_URL:'https://elastic.test',ES_RERANK_INFERENCE_ID:'fixture-rerank'},clock:()=>now,fetchImpl:async(url,options)=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;calls.push({path,body});
  if(path==='/overflow_settings/_doc/search')return Response.json({_source:{mode}});
  if(path==='/_query')return Response.json({error:'unsupported'},{status:400});
  if(path==='/interactions/_search')return Response.json(crowd);
  if(path==='/talks/_search'){
   if(body.size===1000)return Response.json(envelope(candidates));
   if(highlightFails&&body.highlight.fields.semantic_text)return Response.json({error:'copy_to highlighter'},{status:400});
   const broad=lexical(body).minimum_should_match==='10%';
   return Response.json(broad?(broadEnvelope||envelope(broader)):envelope(strict),{status:broad?broadStatus:200});
  }
  throw Error('Unexpected request');
 }});
 return {es,calls,rankings:()=>calls.filter(call=>call.path==='/talks/_search'&&call.body.size!==1000)};
}
test('strict nonempty Plan B matches stay unchanged with no broader request',async()=>{
 const f=fixture({strict:[safe]});const result=await f.es.planBCandidates(source);
 assert.deepEqual(result.items.map(item=>item.id),['safe']);assert.equal(result.degraded,false);assert.equal(result.reason,null);assert.equal(f.rankings().length,1);assert.equal(lexical(f.rankings()[0].body).minimum_should_match,undefined);
});
for(const mode of ['bm25','hybrid','hybrid_rerank'])test(mode+' broadens only a complete empty result and caches the actual broader-match disclosure',async()=>{
 const f=fixture({mode});const result=await f.es.planBCandidates(source);
 assert.equal(result.mode,mode);assert.equal(result.degraded,true);assert.match(result.reason,/Broader topic matches/);assert.deepEqual(result.items.map(item=>item.id),['safe']);assert.match(result.items[0].why_matched,/Kubernetes policy/);
 const rankings=f.rankings();assert.equal(rankings.length,2);assert.equal(lexical(rankings[0].body).minimum_should_match,undefined);assert.equal(lexical(rankings[1].body).minimum_should_match,'10%');
 const strict=structuredClone(rankings[0].body),broad=structuredClone(rankings[1].body);delete lexical(broad).minimum_should_match;delete broad.highlight.fields.abstract.highlight_query.more_like_this.minimum_should_match;assert.deepEqual(broad,strict,'broader request changed filters or ranking configuration');
 const calls=f.calls.length;assert.deepEqual(await f.es.planBCandidates(source),result);assert.equal(f.calls.length,calls);
});
for(const [name,options] of [
 ['still empty',{broader:[]}],['request fails',{broadStatus:503}],
 ['partial response',{broadEnvelope:{...envelope([safe]),timed_out:true}}],
 ['known-full row',{broader:[full]}],
])test('a broader attempt that '+name+' preserves the valid strict empty response',async()=>{
 const f=fixture(options);const result=await f.es.planBCandidates(source);
 assert.equal(result.mode,'bm25');assert.deepEqual(result.items,[]);assert.equal(result.degraded,false);assert.equal(result.reason,null);assert.equal(f.rankings().length,2);assert.equal(f.es.mode,'bm25');
});
test('Plan B does not broaden when every candidate is already known full',async()=>{
 const f=fixture({candidates:[full]});const result=await f.es.planBCandidates(source);
 assert.deepEqual(result.items,[]);assert.equal(f.rankings().length,1);
});
test('broader matches reuse lexical highlighting fallback without retrying unsupported semantic highlighting',async()=>{
 const f=fixture({mode:'hybrid',highlightFails:true});const result=await f.es.planBCandidates(source);
 assert.equal(result.mode,'hybrid');assert.equal(result.degraded,true);assert.match(result.reason,/Broader topic matches/);assert.match(result.items[0].why_matched,/Kubernetes policy/);
 const rankings=f.rankings();assert.equal(rankings.length,3);assert.ok(rankings[0].body.highlight.fields.semantic_text);assert.equal(rankings[1].body.highlight.fields.semantic_text,undefined);assert.equal(rankings[2].body.highlight.fields.semantic_text,undefined);assert.equal(lexical(rankings[2].body).minimum_should_match,'10%');
});
test('broader rerank retry shares the initial 300ms stage and retains strict empty after its timeout',async t=>{
 const rankings=[];
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/overflow_settings/_doc/search'){res.end(JSON.stringify({_source:{mode:'hybrid_rerank'}}));return;}
  if(path==='/_query'){res.writeHead(400);res.end('{}');return;}
  if(path==='/interactions/_search'){res.end(JSON.stringify(crowd));return;}
  if(body.size===1000){res.end(JSON.stringify(envelope([safe,full])));return;}
  rankings.push(body);
  if(lexical(body).minimum_should_match==='10%')return;
  setTimeout(()=>res.end(JSON.stringify(envelope([]))),230);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const es=new Elasticsearch({env:{ES_URL:'http://127.0.0.1:'+server.address().port,ES_RERANK_INFERENCE_ID:'fixture-rerank'},clock:()=>now});
 const start=performance.now(),result=await es.planBCandidates(source),elapsed=performance.now()-start;
 assert.equal(result.mode,'hybrid_rerank');assert.equal(result.degraded,false);assert.deepEqual(result.items,[]);assert.equal(rankings.length,2);assert.ok(rankings.every(body=>body.retriever?.text_similarity_reranker));assert.ok(elapsed<475,`Observed ${elapsed}ms; retry may have reset the300ms stage`);
});
