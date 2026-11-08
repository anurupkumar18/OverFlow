const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {snapshotSearch,normalizeTalk,planB,facets} = require('./schedule');
const MAX_BODY=16384;
class HttpError extends Error { constructor(status,message) {super(message);this.status=status;} }
function string(value,label,max=160) {if(typeof value!=='string'||!value.trim()||value.length>max) throw new HttpError(400,`Invalid ${label}.`);return value.trim();}
function id(value,label='id') {const v=string(value,label,128);if(!/^[A-Za-z0-9_-]+$/.test(v))throw new HttpError(400,`Invalid ${label}.`);return v;}
async function body(req) {
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')) throw new HttpError(415,'Use application/json.');
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw new HttpError(413,'Request body is too large.');chunks.push(chunk);}
 let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'Invalid JSON.');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'Expected a JSON object.');return value;
}
function authorized(req,secret) {if(!secret)return false;const supplied=Buffer.from(req.headers.authorization||'');const wanted=Buffer.from('Bearer '+secret);return supplied.length===wanted.length&&crypto.timingSafeEqual(supplied,wanted);}
function searchFilters(url) {
 const q=url.searchParams.get('q')||'', day=url.searchParams.get('day')||'',track=url.searchParams.get('track')||'',available=url.searchParams.get('available')||'false';
 if(q.length>500||track.length>160||!['true','false'].includes(available))throw new HttpError(400,'Invalid search filters.');
 if(day&&(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day))throw new HttpError(400,'Invalid day; use YYYY-MM-DD.');
 const offsetValue=url.searchParams.get('offset')||'0';
 if(!/^\d{1,4}$/.test(offsetValue)||Number(offsetValue)>1000)throw new HttpError(400,'Invalid offset; use an integer from 0 to 1000.');
 return {q:q.trim(),day,track,available:available==='true',offset:Number(offsetValue)};
}
function verifiedStatus(status) {
 return status?.status === 'available' &&
  Number.isFinite(status.p95_ms) && status.p95_ms >= 0 &&
  [status.error_ratio, status.degraded_share].every(value => Number.isFinite(value) && value >= 0 && value <= 1) &&
  typeof status.as_of === 'string' && /Z$/.test(status.as_of) && Number.isFinite(Date.parse(status.as_of));
}
function createApp({catalog,env=process.env,clock=Date.now,es=null,statusProvider=null,observer=null,publicDir=path.join(__dirname,'../public')}={}) {
 if(!catalog||!Array.isArray(catalog.talks)||!catalog.talks.length)throw new Error('A nonempty verified catalog is required.');
 const talks=catalog.talks.map(t=>normalizeTalk({...t,fullness:undefined})); const byId=new Map(talks.map(t=>[t.id,t]));
 const version=env.APP_VERSION||'dev';const source=catalog.source;
 const engine=es; const fallbackReason='Live search is unavailable; browsing the verified schedule snapshot.';
 async function query(filters) {
   if(engine?.searchTalks){try{return {...await engine.searchTalks(filters,talks),source,version,facets:facets(talks)};}catch{/* Snapshot fallback never exposes provider errors. */}}
   return {...snapshotSearch(talks,filters),mode:'snapshot',degraded:true,source,version};
 }
 async function one(talkId) {
   const item=byId.get(talkId);if(!item)throw new HttpError(404,'Talk not found.');
   if(engine?.getTalk){try{return {...await engine.getTalk(talkId),source};}catch{}}
   return {item,mode:'snapshot',degraded:true,source};
 }
 return async function app(req,res) {
  const started=performance.now();let route='unknown';
  const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(JSON.stringify(value));try{observer?.({route,status,duration_ms:performance.now()-started,mode:value?.mode||null,degraded:value?.degraded??null});}catch{}};
  try{
   if((req.url||'').length>4096)throw new HttpError(414,'URL too long.');
   const url=new URL(req.url,'http://localhost');const pathname=url.pathname;
   if(pathname==='/healthz'||pathname==='/readyz'){route=pathname;return send(200,{ok:true,version});}
   if(pathname==='/api/deps'||pathname==='/api/admin/mode'){if(!authorized(req,env.ADMIN_TOKEN))throw new HttpError(401,'Internal route requires a valid bearer token.');}
   if(req.method==='GET'&&pathname==='/api/search'){route='/api/search';return send(200,await query(searchFilters(url)));}
   if(req.method==='GET'&&/^\/api\/(talks|planb)\/[^/]+$/.test(pathname)){
    const [, ,kind,encoded]=pathname.split('/');route=`/api/${kind}/:id`;let talkId;try{talkId=id(decodeURIComponent(encoded));}catch{throw new HttpError(400,'Invalid talk id.');}
    const current=await one(talkId);if(kind==='talks')return send(200,current);
    let candidates=talks, mode='snapshot',degraded=true,reason=fallbackReason;
    if(engine?.planBCandidates){try{const result=await engine.planBCandidates(current.item);candidates=result.items;mode=result.mode;degraded=result.degraded;reason=result.reason||null;}catch{}}
    const items=planB(current.item,candidates,new Date(clock()));
    if(items.some(t=>t.fullness.signal==='unavailable'))reason=[reason,'Crowd state is unknown; these alternatives are not confirmed available.'].filter(Boolean).join(' ');
    return send(200,{items,mode,degraded,reason,source_talk:current.item});
   }
   if(req.method==='GET'&&pathname==='/api/config'){route=pathname;let live=false;try{live=Boolean(await engine?.available?.());}catch{}return send(200,{version,live_interactions:live,event:{name:'KubeCon + CloudNativeCon North America 2026',timezone:'America/Denver'},data_source:source});}
   if(req.method==='GET'&&pathname==='/api/status'){route=pathname;let status=null;try{status=await statusProvider?.();}catch{}const valid=verifiedStatus(status);return send(200,{status:valid?'available':'unavailable',p95_ms:valid?status.p95_ms:null,error_ratio:valid?status.error_ratio:null,degraded_share:valid?status.degraded_share:null,as_of:valid?status.as_of:null,version,search_mode:engine?.mode||'snapshot'});}
   if(req.method==='GET'&&pathname==='/api/deps') {
    route=pathname;
    let connected=false, status=null;
    await Promise.all([
     (async()=>{try{connected=Boolean(await engine?.available?.());}catch{}})(),
     (async()=>{try{status=await statusProvider?.();}catch{}})()
    ]);
    return send(200,{elasticsearch:{configured:Boolean(engine),connected},telemetry:{configured:Boolean(statusProvider),verified_status:verifiedStatus(status)},version});
   }
   if(req.method==='POST'&&pathname==='/api/admin/mode'){route=pathname;const input=await body(req);if(!['bm25','hybrid','hybrid_rerank'].includes(input.mode))throw new HttpError(400,'Invalid search mode.');if(!engine?.setMode)throw new HttpError(503,'Elasticsearch is unavailable; mode cannot be changed.');await engine.setMode(input.mode);return send(200,{ok:true,mode:input.mode});}
   if(req.method==='POST'&&(pathname==='/api/interactions'||pathname==='/api/subscriptions')){
    route=pathname;const input=await body(req);const talkId=id(input.talk_id,'talk_id'), attendee=id(input.attendee_id,'attendee_id');if(!byId.has(talkId))throw new HttpError(404,'Talk not found.');
    if(pathname==='/api/interactions'&&!['bookmark','unbookmark','full_report'].includes(input.type))throw new HttpError(400,'Invalid interaction type.');
    if(!engine||!await engine.available())throw new HttpError(503,'Live interactions require a verified Elasticsearch connection. Personal saves remain in your browser.');
    if(pathname==='/api/interactions')await engine.interact({talk_id:talkId,attendee_id:attendee,type:input.type});else await engine.subscribe({talk_id:talkId,attendee_id:attendee});
    return send(200,{ok:true});
   }
   if(req.method==='GET'&&pathname==='/api/alerts'){route=pathname;const attendee=id(url.searchParams.get('attendee_id'),'attendee_id');if(!engine||!await engine.available())throw new HttpError(503,'Live alerts require a verified Elasticsearch connection.');return send(200,{items:await engine.alerts(attendee,byId)});}
   if(pathname.startsWith('/api/'))throw new HttpError(404,'API route not found.');
   if(req.method!=='GET'&&req.method!=='HEAD')throw new HttpError(405,'Method not allowed.');
   let decoded;try{decoded=decodeURIComponent(pathname);}catch{throw new HttpError(400,'Invalid path.');}
   if(decoded.split('/').some(p=>p.startsWith('.')||p==='..')||decoded.includes('\\')||decoded.includes('\0'))throw new HttpError(404,'Not found.');
   const filename=path.resolve(publicDir,'.'+(decoded==='/'?'/index.html':decoded));
   if(!filename.startsWith(path.resolve(publicDir)+path.sep))throw new HttpError(404,'Not found.');
   const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webp':'image/webp'}[path.extname(filename)];if(!mime)throw new HttpError(404,'Not found.');
   let content;try{const real=await fs.realpath(filename);if(!real.startsWith(await fs.realpath(publicDir)+path.sep))throw Error();content=await fs.readFile(real);}catch{throw new HttpError(404,'Not found.');}
   res.writeHead(200,{'content-type':mime,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:content);
  }catch(error){if(!res.headersSent)send(error.status||503,{error:error instanceof HttpError?error.message:'Service dependency is unavailable. Please try again.'});else res.end();}
 };
}
module.exports={createApp,HttpError};
