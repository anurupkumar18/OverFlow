// Polling fallback for explicit watches. Network calls remain in api.js.
function normalizedAlert(value) {
  const full=value?.item?.fullness;
  if(!value||typeof value.talk_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.talk_id)||value.type!=='likely_full'||value.item?.id!==value.talk_id||typeof value.item?.title!=='string'||!value.item.title.trim()||(value.message!==undefined&&typeof value.message!=='string')||!full)throw Error('Incomplete alert.');
  const count=n=>Number.isSafeInteger(n)&&n>=0;
  if(full.signal!=='live'||full.capacity_source!=='estimate'||value.item.capacity_source!=='estimate'||value.item.capacity!==full.capacity||full.likely_full!==true||!count(full.bookmarks)||!count(full.reports)||(full.capacity!==null&&(!Number.isFinite(full.capacity)||full.capacity<=0)))throw Error('Invalid room observations.');
  const pressure=full.capacity===null?null:full.bookmarks/full.capacity;
  if((pressure===null&&full.pressure!==null)||(pressure!==null&&(!Number.isFinite(full.pressure)||Math.abs(full.pressure-pressure)>1e-9))||!((pressure!==null&&pressure>=1)||full.reports>=2))throw Error('Inconsistent room observations.');
  return {talk_id:value.talk_id,type:'likely_full',message:(value.message||'This room may be full.').slice(0,400),title:value.item.title.slice(0,3000),fullness:{signal:'live',bookmarks:full.bookmarks,reports:full.reports,capacity:full.capacity,capacity_source:'estimate',pressure:full.pressure,likely_full:true}};
}
export function createAlertWatcher({fetchAlerts,onState=()=>{},onAlerts=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,visible=true}={}) {
  const watched=new Set();let attendee=null,active=false,status='inactive',timer=null,request=null,busy=false,epoch=0,errors=0,retry=15000,seen=new Map(),items=[];
  const snapshot=()=>({status,active,watched:[...watched],items:items.map(item=>({...item,fullness:{...item.fullness}})),retry_ms:retry});
  const publish=()=>{try{onState(snapshot());}catch{/* Presentation must not break scheduling. */}};
  const canPoll=()=>active&&visible&&watched.size>0;
  function cancel(){epoch++;if(timer!==null)clearTimer(timer);timer=null;request?.abort();}
  function schedule(delay){if(timer!==null)clearTimer(timer);timer=null;if(canPoll())timer=setTimer(()=>{timer=null;void poll();},delay);}
  async function poll(){
    if(busy||!canPoll())return;
    busy=true;const generation=epoch;const controller=new AbortController();request=controller;
    const timeout=setTimer(()=>controller.abort(),8000);
    try{
      const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('Alert request cancelled or timed out.')),{once:true}));
      const result=await Promise.race([fetchAlerts(attendee,controller.signal),aborted]);
      if(generation!==epoch)return;
      if(!Array.isArray(result?.items)||result.items.length>1000)throw Error('Incomplete alerts response.');
      const normalized=result.items.map(normalizedAlert);const next=new Map();const changed=[];const current=[];
      for(const item of normalized){
        if(!watched.has(item.talk_id)||next.has(item.talk_id))continue;
        const safe=item;
        const fingerprint=JSON.stringify([safe.type,safe.message,safe.title]);
        if(!next.has(safe.talk_id)&&seen.get(safe.talk_id)!==fingerprint)changed.push(safe);
        next.set(safe.talk_id,fingerprint);
        current.push(safe);
      }
      seen=next;items=current;errors=0;retry=15000;status='watching';publish();
      if(changed.length){try{onAlerts(changed);}catch{/* Notifications are best effort. */}}
    }catch{
      if(generation!==epoch)return;
      errors++;retry=Math.min(15000*2**Math.min(errors,3),120000);status='unavailable';publish();
    }finally{
      clearTimer(timeout);busy=false;if(request===controller)request=null;
      if(canPoll())schedule(generation===epoch?retry:0);
    }
  }
  function watch(id,attendeeId,{activate=true}={}){
    if(attendee&&attendee!==attendeeId){cancel();watched.clear();seen.clear();items=[];}
    attendee=attendeeId;watched.add(String(id));active=Boolean(activate);status=!active?'paused':visible?'checking':'hidden';retry=15000;errors=0;
    if(!active)cancel();
    if(timer!==null)clearTimer(timer);timer=null;publish();void poll();
  }
  function pause(){active=false;cancel();status=watched.size?'paused':'inactive';publish();}
  function resume(){if(!watched.size)return;active=true;status=visible?'checking':'hidden';publish();void poll();}
  function setVisible(value){
    if(visible===Boolean(value))return;visible=Boolean(value);cancel();
    if(active){status=visible?'checking':'hidden';publish();if(visible)void poll();}
  }
  return {watch,pause,resume,setVisible,snapshot};
}
