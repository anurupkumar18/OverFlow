const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createApp}=require('../src/app');
const source={id:'source',title:'Kubernetes security',abstract:'Policies for Kubernetes',speakers:['Ada'],tags:['Security'],track:'Security',start:'2026-11-10T17:00:00Z',end:'2026-11-10T17:40:00Z',room:'Salt Palace | Level 2 | A',floor:'Level 2',capacity:200};
const alternative=(id,extra={})=>({...source,id,room:'Salt Palace | Level 2 | '+id,...extra});
async function request(t,es,talks){
 const server=http.createServer(createApp({catalog:{source:{name:'QA fixture'},talks:[source,...talks]},env:{},es,clock:()=>Date.parse('2026-11-08T00:00:00Z')}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 return (await fetch('http://127.0.0.1:'+server.address().port+'/api/planb/source')).json();
}
test('Plan B HTTP preserves actual provider ranking and explanation within venue/floor preference',async t=>{
 const candidates=[alternative('nearby-lowest',{floor:'Level 1'}),alternative('z-provider-best',{tags:['Storage'],track:'Storage',why_matched:'Policy enforcement on Kubernetes'}),alternative('a-provider-second')];
 const result=await request(t,{planBCandidates:async()=>({items:candidates,mode:'hybrid',degraded:false})},candidates);
 assert.equal(result.mode,'hybrid');assert.equal(result.degraded,false);assert.deepEqual(result.items.map(t=>t.id),['z-provider-best','a-provider-second','nearby-lowest']);assert.match(result.items[0].why_matched,/Policy enforcement/);
});
test('Plan B ranking failure exposes actual snapshot mode and preserves eligibility invariants',async t=>{
 const candidates=[alternative('safe'),alternative('same-room',{room:source.room}),alternative('late',{start:'2026-11-10T17:10:01Z'})];
 const result=await request(t,{planBCandidates:async()=>{throw Error('private provider failure');}},candidates);
 assert.equal(result.mode,'snapshot');assert.equal(result.degraded,true);assert.deepEqual(result.items.map(t=>t.id),['safe']);assert.doesNotMatch(result.reason,/private/);assert.equal(result.items[0].fullness.signal,'unavailable');
});

test('Plan B keeps verified full-room exclusions and crowd observations when all ranking modes fail',async t=>{
 const {Elasticsearch}=require('../src/elasticsearch');
 const local=[alternative('full',{title:'Local full room',capacity:400}),alternative('safe',{title:'Local safe talk',capacity:100}),alternative('unobserved',{title:'Local-only alternative'})];
 const remote=[{...local[0],title:'Provider title must not replace the snapshot',capacity:200}, {...local[1],title:'Provider safe title',capacity:200}];
 const es=new Elasticsearch({env:{ES_URL:'https://elastic.test',ES_RERANK_INFERENCE_ID:'fixture-rerank'},clock:()=>Date.parse('2026-11-08T00:00:00Z'),fetchImpl:async(url,options)=>{
  const path=new URL(url).pathname;const body=options.body?JSON.parse(options.body):null;
  if(path==='/overflow_settings/_doc/search')return Response.json({_source:{mode:'hybrid_rerank'}});
  if(path==='/talks/_doc/source')return Response.json({_source:source});
  if(path==='/interactions/_search'){
   const requested=body.query.bool.filter[0].terms.talk_id;
   const buckets=requested.includes('full')?[{key:'full',doc_count:200,bookmarks:{doc_count:200},reports:{doc_count:0}},{key:'safe',doc_count:20,bookmarks:{doc_count:20},reports:{doc_count:0}}]:[];
   return Response.json({timed_out:false,_shards:{total:1,successful:1,failed:0},aggregations:{talks:{doc_count_error_upper_bound:0,sum_other_doc_count:0,buckets}}});
  }
  if(path==='/talks/_search'&&body.size===1000)return Response.json({timed_out:false,_shards:{total:1,successful:1,failed:0},hits:{total:{value:2,relation:'eq'},hits:remote.map(item=>({_source:item}))}});
  return Response.json({error:'private ranking provider error'},{status:503});
 }});
 const result=await request(t,es,local);
 assert.equal(result.mode,'snapshot');assert.equal(result.degraded,true);assert.doesNotMatch(JSON.stringify(result),/private ranking|Provider title|Provider safe/);
 assert.ok(!result.items.some(item=>item.id==='full'));
 const safe=result.items.find(item=>item.id==='safe');assert.equal(safe.title,'Local safe talk');assert.equal(safe.fullness.signal,'live');assert.equal(safe.fullness.bookmarks,20);assert.equal(safe.fullness.capacity,100);assert.equal(safe.fullness.pressure,.2);assert.equal(safe.fullness.likely_full,false);
 const unknown=result.items.find(item=>item.id==='unobserved');assert.equal(unknown.fullness.signal,'unavailable');assert.equal(unknown.fullness.bookmarks,null);assert.equal(unknown.fullness.likely_full,null);
 assert.match(result.reason,/snapshot/);assert.match(result.reason,/verified crowd/);
});
