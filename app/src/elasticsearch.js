const crypto=require('node:crypto');
const {normalizeTalk}=require('./schedule');
const MODES=['hybrid_rerank','hybrid','bm25'];
class DependencyError extends Error {constructor(status){super('Elasticsearch dependency unavailable.');this.statusCode=status;}}
function midnight(day){
 const desired=Date.parse(day+'T00:00:00Z');let instant=desired+7*3600000;
 const format=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let i=0;i<3;i++){const p=Object.fromEntries(format.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);instant+=desired-represented;}
 return new Date(instant).toISOString();
}
function filtersFor(filters,fullIds=[]){
 const filter=[];
 if(filters.day){const next=new Date(Date.parse(filters.day+'T00:00:00Z')+86400000).toISOString().slice(0,10);filter.push({range:{start:{gte:midnight(filters.day),lt:midnight(next)}}});}
 if(filters.track)filter.push({term:{track:filters.track}});
 const must=filters.q?[{multi_match:{query:filters.q,fields:['title^3','abstract','speakers^2','tags^2','track'],type:'best_fields',operator:'and'}}]:[{match_all:{}}];
 return {bool:{must,filter,...(filters.available&&fullIds.length?{must_not:[{terms:{id:fullIds}}]}:{})}};
}
// Crowd absence can mean zero only after the entire aggregation is verified complete.
function validatedCrowdBuckets(data, talks) {
 const shards = data?._shards;
 const aggregation = data?.aggregations?.talks;
 if (data?.timed_out !== false || !shards ||
     !Number.isSafeInteger(shards.total) || shards.total < 1 ||
     shards.successful !== shards.total || shards.failed !== 0 ||
     !aggregation || aggregation.sum_other_doc_count !== 0 ||
     aggregation.doc_count_error_upper_bound !== 0 || !Array.isArray(aggregation.buckets)) {
  throw new DependencyError(502);
 }
 const requestedIds = new Set(talks.map(talk => talk.id));
 const buckets = new Map();
 const isCount = value => Number.isSafeInteger(value) && value >= 0;
 for (const bucket of aggregation.buckets) {
  const bookmarks = bucket?.bookmarks?.doc_count;
  const reports = bucket?.reports?.doc_count;
  if (!requestedIds.has(bucket?.key) || buckets.has(bucket.key) ||
      !isCount(bucket.doc_count) || !isCount(bookmarks) || !isCount(reports) ||
      bookmarks + reports > bucket.doc_count ||
      (bucket.doc_count_error_upper_bound !== undefined && bucket.doc_count_error_upper_bound !== 0)) {
   throw new DependencyError(502);
  }
  buckets.set(bucket.key, bucket);
 }
 return buckets;
}
class Elasticsearch {
 constructor({env=process.env,fetchImpl=fetch,clock=Date.now,withStage=(_name,fn)=>fn()}={}){
  this.env=env;this.fetch=fetchImpl;this.clock=clock;this.withStage=withStage;
  this.url=(env.ES_URL||env.ELASTICSEARCH_URL||'').replace(/\/$/,'');
  const parsed=new URL(this.url);if(!['http:','https:'].includes(parsed.protocol)||(parsed.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('Invalid Elasticsearch URL.');
  this.indexes={talks:env.ES_TALKS_INDEX||'talks',interactions:env.ES_INTERACTIONS_INDEX||'interactions',alerts:env.ES_SUBSCRIPTIONS_INDEX||'talk_alerts',settings:env.ES_SETTINGS_INDEX||'overflow_settings'};
  for(const value of Object.values(this.indexes))if(!/^[a-z0-9_-]+$/.test(value))throw new Error('Invalid Elasticsearch index name.');
  this.mode='snapshot';this.requestedMode=MODES.includes(env.SEARCH_MODE)?env.SEARCH_MODE:'hybrid_rerank';this.cache=new Map();this.settingsAt=-Infinity;this.healthAt=-Infinity;this.healthy=false;
 }
 async request(endpoint,{method='POST',body,timeout=1500,allow404=false}={}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.max(1,timeout));timer.unref?.();
  try{
   const headers={'content-type':'application/json'};if(this.env.ES_API_KEY)headers.authorization='ApiKey '+this.env.ES_API_KEY;
   const response=await this.fetch(this.url+endpoint,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,redirect:'error'});
   if(response.status===404&&allow404)return null;
   if(!response.ok)throw new DependencyError(response.status);
   if(method==='HEAD'||response.status===204)return {};
   const chunks=[];let length=0;
   for await(const chunk of response.body){length+=chunk.length;if(length>4*1024*1024){controller.abort();throw new DependencyError(502);}chunks.push(chunk);}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch(e){if(e instanceof DependencyError)throw e;throw new DependencyError(503);}finally{clearTimeout(timer);}
 }
 async settings(){
  if(this.clock()-this.settingsAt<10000)return this.requestedMode;
  try{const result=await this.request(`/${this.indexes.settings}/_doc/search`,{method:'GET',allow404:true,timeout:700});if(MODES.includes(result?._source?.mode)&&result._source.mode!==this.requestedMode){this.requestedMode=result._source.mode;this.cache.clear();}}
  catch{/* Keep configured mode; request execution still determines reported mode. */}
  this.settingsAt=this.clock();return this.requestedMode;
 }
 async setMode(mode){if(!MODES.includes(mode))throw new DependencyError(400);await this.request(`/${this.indexes.settings}/_doc/search`,{method:'PUT',body:{mode,updated_at:new Date(this.clock()).toISOString()}});this.requestedMode=mode;this.settingsAt=this.clock();this.cache.clear();}
 async available(){if(this.clock()-this.healthAt<10000)return this.healthy;this.healthy=false;try{await Promise.all(Object.values(this.indexes).map(index=>this.request('/'+index,{method:'HEAD',timeout:1000})));this.healthy=true;}catch{}this.healthAt=this.clock();return this.healthy;}
 async fullness(talks,timeout=1000){
  const now=this.clock();
  const requestBody = {
   size:0,
   query:{bool:{filter:[{terms:{talk_id:talks.map(t=>t.id)}}],must_not:[{prefix:{attendee_id:'smoke-'}}]}},
   aggs:{talks:{terms:{field:'talk_id',size:1000},aggs:{
    bookmarks:{filter:{term:{type:'bookmark'}}},
    reports:{filter:{bool:{filter:[
     {term:{type:'full_report'}},
     {range:{timestamp:{gte:new Date(now-600000).toISOString(),lte:new Date(now).toISOString()}}}
    ]}}}
   }}}
  };
  const data=await this.request(`/${this.indexes.interactions}/_search`,{timeout,body:requestBody});
  const buckets = validatedCrowdBuckets(data, talks);
  return new Map(talks.map(t=>{
   const bucket=buckets.get(t.id),bookmarks=bucket?bucket.bookmarks.doc_count:0,reports=bucket?bucket.reports.doc_count:0,capacity=Number.isFinite(t.capacity)?t.capacity:null,pressure=capacity>0?bookmarks/capacity:null;
   return [t.id,{bookmarks,reports,capacity,capacity_source:'estimate',pressure,likely_full:reports>=2||(pressure!==null&&pressure>=1),signal:'live'}];
  }));
 }
 buildSearch(mode,filters,fullIds=[]){
  const query=filtersFor(filters,fullIds);const base={size:100,from:filters.offset||0,track_total_hits:true,_source:{excludes:['semantic_text']}};
  if(!filters.q)return {...base,query,sort:[{start:'asc'},{id:'asc'}]};
  if(mode==='bm25')return {...base,query};
  const bool=query.bool;
  const semantic={bool:{must:[{semantic:{field:'semantic_text',query:filters.q}}],filter:bool.filter,...(bool.must_not?{must_not:bool.must_not}:{})}};
  const rrf={rrf:{retrievers:[{standard:{query}},{standard:{query:semantic}}],rank_window_size:100+(filters.offset||0),rank_constant:60}};
  if(mode==='hybrid')return {...base,retriever:rrf};
  if(!this.env.ES_RERANK_INFERENCE_ID)throw new DependencyError(503);
  return {...base,size:20,retriever:{text_similarity_reranker:{retriever:rrf,field:'abstract',inference_id:this.env.ES_RERANK_INFERENCE_ID,inference_text:filters.q,rank_window_size:20}}};
 }
 async searchTalks(filters,talks){
  const wanted=await this.settings();const key=JSON.stringify([wanted,filters]);const cached=this.cache.get(key);
  if(cached&&this.clock()-cached.at<60000){this.mode=cached.result.mode;return structuredClone(cached.result);}
  const began=performance.now();let crowd=null;try{crowd=await this.withStage('crowd',()=>this.fullness(talks));}catch{}
  const fullIds=crowd?[...crowd].filter(([,f])=>f.likely_full).map(([id])=>id):[];
  // Empty queries execute chronological lexical browse, never claim semantic work.
  const modes=filters.q?MODES.slice(Math.max(MODES.indexOf(wanted),filters.offset>0?1:0)):['bm25'];
  for(const mode of modes){
   try{
    const timeout=mode==='hybrid_rerank'?300:Math.min(1500,4500-(performance.now()-began));if(timeout<=0)break;
    const request=this.buildSearch(mode,filters,fullIds);
    const data=await this.withStage(mode,()=>this.request(`/${this.indexes.talks}/_search`,{body:request,timeout}));
    if(data.timed_out||data._shards?.failed||!Array.isArray(data.hits?.hits))throw new DependencyError(502);
    const items=data.hits.hits.map(h=>normalizeTalk({...h._source,id:h._source.id||h._id,fullness:undefined},crowd?.get(h._source.id||h._id))).filter(t=>!filters.available||!t.fullness.likely_full);
    const total=typeof data.hits.total==='number'?data.hits.total:data.hits.total?.value;
    if(!Number.isFinite(total))throw new DependencyError(502);
    const degraded=Boolean(filters.q&&mode!==wanted)||!crowd;
    const reason=[filters.q&&mode!==wanted?'A higher search mode was unavailable; results use '+mode+'.':null,!crowd?'Crowd signals are unavailable; unknown rooms remain eligible and are not confirmed available.':null].filter(Boolean).join(' ')||null;
    const next=(filters.offset||0)+request.size;
    const result={items:items.slice(0,100),total,has_more:next<total&&next<=1000,next_offset:next<total&&next<=1000?next:null,mode,degraded,reason};this.mode=mode;
    if(this.cache.size>=100)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{at:this.clock(),result});return structuredClone(result);
   }catch{/* Execute the next actual mode; no provider internals in the response. */}
  }
  this.mode='snapshot';throw new DependencyError(503);
 }
 async getTalk(id){
  const data=await this.request(`/${this.indexes.talks}/_doc/${encodeURIComponent(id)}`,{method:'GET'});if(!data?._source)throw new DependencyError(502);
  let crowd;try{crowd=await this.fullness([data._source]);}catch{}
  return {item:normalizeTalk({...data._source,id,fullness:undefined},crowd?.get(id)),mode:'bm25',degraded:!crowd};
 }
 async planBCandidates(source){
  const data=await this.request(`/${this.indexes.talks}/_search`,{body:{size:1000,query:{bool:{filter:[{range:{start:{gte:new Date(Date.parse(source.start)-600000).toISOString(),lte:new Date(Date.parse(source.start)+600000).toISOString()}}},{range:{end:{gt:new Date(this.clock()).toISOString()}}}],must_not:[{term:{room:source.room}},{term:{id:source.id}}]}},_source:{excludes:['semantic_text']}}});
  if(data.timed_out||data._shards?.failed||!Array.isArray(data.hits?.hits))throw new DependencyError(502);
  const talks=data.hits.hits.map(h=>({...h._source,id:h._source.id||h._id,fullness:undefined}));let crowd;try{crowd=await this.fullness(talks);}catch{}
  return {items:talks.map(t=>normalizeTalk(t,crowd?.get(t.id))),mode:'bm25',degraded:!crowd,reason:crowd?null:'Crowd signals are unavailable.'};
 }
 async interact({talk_id,attendee_id,type}){
  const kind=type==='full_report'?'report':'bookmark';const doc=crypto.createHash('sha256').update(JSON.stringify([kind,talk_id,attendee_id])).digest('hex');
  await this.request(`/${this.indexes.interactions}/_doc/${doc}?refresh=wait_for`,{method:type==='unbookmark'?'DELETE':'PUT',allow404:type==='unbookmark',body:type==='unbookmark'?undefined:{talk_id,attendee_id,type,timestamp:new Date(this.clock()).toISOString()}});this.cache.clear();
 }
 async subscribe({talk_id,attendee_id}){
  const doc=crypto.createHash('sha256').update(JSON.stringify([talk_id,attendee_id])).digest('hex');await this.request(`/${this.indexes.alerts}/_doc/${doc}?refresh=wait_for`,{method:'PUT',body:{talk_id,attendee_id,created_at:new Date(this.clock()).toISOString()}});
 }
 async alerts(attendee_id,byId){
  const subscriptions=await this.request(`/${this.indexes.alerts}/_search`,{body:{size:1000,query:{term:{attendee_id}}}});
  if(!Array.isArray(subscriptions.hits?.hits))throw new DependencyError(502);
  const talks=subscriptions.hits.hits.map(h=>byId.get(h._source.talk_id)).filter(t=>t&&Date.parse(t.end)>this.clock());if(!talks.length)return [];
  const crowd=await this.fullness(talks);return talks.filter(t=>crowd.get(t.id).likely_full).map(t=>({talk_id:t.id,type:'likely_full',message:'This talk has a crowd signal indicating it may be full.',item:normalizeTalk(t,crowd.get(t.id))}));
 }
}
module.exports={Elasticsearch,DependencyError,midnight};
