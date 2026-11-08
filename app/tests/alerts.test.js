const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../public/js/alerts.js'),'utf8')).toString('base64'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const alert=(id='a',message='Room likely full')=>({talk_id:id,type:'likely_full',message,item:{id,title:'Session '+id,capacity:200,capacity_source:'estimate',fullness:{signal:'live',bookmarks:0,reports:2,capacity:200,capacity_source:'estimate',pressure:0,likely_full:true}}});
async function harness(fetcher=async()=>({items:[]})) {
  const {createAlertWatcher}=await modulePromise;
  let now=0,id=0;const timers=new Map(),calls=[],states=[],notices=[];
  const watcher=createAlertWatcher({fetchAlerts:(attendee,signal)=>{calls.push({attendee,signal});return fetcher(attendee,signal);},onState:value=>states.push(value),onAlerts:value=>notices.push(value),setTimer:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimer:id=>timers.delete(id)});
  async function tick(ms){const end=now+ms;while(true){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();}
  return {watcher,calls,states,notices,timers,tick};
}

test('no alerts are polled before explicit watch, then complete requests recur every15 seconds',async()=>{
  const h=await harness();await h.tick(60000);assert.equal(h.calls.length,0);
  h.watcher.watch('a','attendee');await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].attendee,'attendee');
  await h.tick(14999);assert.equal(h.calls.length,1);await h.tick(1);assert.equal(h.calls.length,2);
});
test('slow requests never overlap and request timeout cancels the current request',async()=>{
  const h=await harness(()=>new Promise(()=>{}));h.watcher.watch('a','attendee');await flush();
  await h.tick(7999);assert.equal(h.calls.length,1);assert.equal(h.calls[0].signal.aborted,false);
  await h.tick(1);assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.watcher.snapshot().status,'unavailable');
  await h.tick(29999);assert.equal(h.calls.length,1);await h.tick(1);assert.equal(h.calls.length,2);
});
test('hidden/pagehide state aborts and suppresses stale results; visible resumes one request',async()=>{
  let finish;const h=await harness(()=>new Promise(resolve=>{finish=resolve;}));
  h.watcher.watch('a','attendee');await flush();h.watcher.setVisible(false);await flush();
  assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.watcher.snapshot().status,'hidden');
  finish({items:[alert()]});await flush();assert.equal(h.notices.length,0);await h.tick(90000);assert.equal(h.calls.length,1);
  h.watcher.setVisible(true);await flush();assert.equal(h.calls.length,2);
});
test('local pause retains watches without polling and resume restarts without a subscription write',async()=>{
  const h=await harness();h.watcher.watch('a','attendee');await flush();h.watcher.pause();
  assert.equal(h.watcher.snapshot().status,'paused');assert.deepEqual(h.watcher.snapshot().watched,['a']);
  await h.tick(120000);assert.equal(h.calls.length,1);h.watcher.resume();await flush();assert.equal(h.calls.length,2);
});
test('new and changed alerts announce once, stale server watches are excluded, disappearance resets detection',async()=>{
  let items=[alert(),alert('old')];const h=await harness(async()=>({items}));h.watcher.watch('a','attendee');await flush();
  assert.equal(h.notices.length,1);assert.equal(h.notices[0].length,1);
  await h.tick(15000);assert.equal(h.notices.length,1);
  items=[alert('a','New warning')];await h.tick(15000);assert.equal(h.notices.length,2);
  items=[];await h.tick(15000);items=[alert('a','New warning')];await h.tick(15000);assert.equal(h.notices.length,3);
});
test('failed requests back off to a bounded120 seconds and success restores15-second polling',async()=>{
  let fail=true;const h=await harness(async()=>{if(fail)throw Error('unavailable');return {items:[]};});
  h.watcher.watch('a','attendee');await flush();assert.equal(h.watcher.snapshot().retry_ms,30000);
  await h.tick(30000);assert.equal(h.watcher.snapshot().retry_ms,60000);
  await h.tick(60000);assert.equal(h.watcher.snapshot().retry_ms,120000);
  await h.tick(120000);assert.equal(h.watcher.snapshot().retry_ms,120000);
  fail=false;await h.tick(120000);assert.equal(h.watcher.snapshot().status,'watching');assert.equal(h.watcher.snapshot().retry_ms,15000);
});
test('malformed alerts are unavailable rather than an all-clear and do not reset last alert knowledge',async()=>{
  let response={items:[alert()]};const h=await harness(async()=>response);h.watcher.watch('a','attendee');await flush();
  response={items:null};await h.tick(15000);assert.equal(h.watcher.snapshot().status,'unavailable');
  response={items:[alert()]};await h.tick(30000);assert.equal(h.notices.length,1);assert.equal(h.watcher.snapshot().status,'watching');
});
test('rapid pause/visibility/resume changes keep one request and duplicate alerts remain quiet',async()=>{
  let finish;let first=true;const h=await harness(()=>{if(first){first=false;return new Promise(resolve=>{finish=resolve;});}return Promise.resolve({items:[alert(),alert('a','Duplicate ignored')]});});
  h.watcher.watch('a','attendee');h.watcher.pause();h.watcher.resume();h.watcher.setVisible(false);h.watcher.setVisible(true);await flush();await h.tick(0);
  assert.equal(h.calls.length,2);assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.notices.length,1);
  finish({items:[alert('a','Stale request')]});await flush();assert.equal(h.notices.length,1);
  await h.tick(15000);assert.equal(h.calls.length,3);assert.equal(h.notices.length,1);
});
test('named alert and validated fullness persist until a successful check clears them',async()=>{
  let response={items:[alert()]};const h=await harness(async()=>response);h.watcher.watch('a','attendee');await flush();
  assert.equal(h.watcher.snapshot().items[0].title,'Session a');assert.equal(h.watcher.snapshot().items[0].message,'Room likely full');assert.equal(h.watcher.snapshot().items[0].fullness.reports,2);
  h.watcher.pause();assert.equal(h.watcher.snapshot().items[0].talk_id,'a');
  response={items:null};h.watcher.resume();await flush();assert.equal(h.watcher.snapshot().status,'unavailable');assert.equal(h.watcher.snapshot().items[0].title,'Session a');
  response={items:[]};await h.tick(30000);assert.deepEqual(h.watcher.snapshot().items,[]);
});
test('malformed or inconsistent authoritative fullness fails closed',async()=>{
  for(const mutate of [a=>{delete a.item.fullness;},a=>{a.item.id='wrong';},a=>{a.item.fullness.reports=-1;},a=>{a.item.fullness.signal='unavailable';},a=>{a.item.fullness.pressure=1;},a=>{a.item.fullness.likely_full=false;},a=>{a.item.capacity=400;}]){
    const value=alert();mutate(value);const h=await harness(async()=>({items:[value]}));h.watcher.watch('a','attendee');await flush();
    assert.equal(h.watcher.snapshot().status,'unavailable');assert.equal(h.notices.length,0);
  }
});
test('acknowledging another room while paused retains it without resuming, and resume includes both rooms',async()=>{
  const h=await harness(async()=>({items:[alert('a'),alert('b')]}));h.watcher.watch('a','attendee');await flush();h.watcher.pause();
  h.watcher.watch('b','attendee',{activate:false});await flush();assert.equal(h.watcher.snapshot().status,'paused');assert.deepEqual(h.watcher.snapshot().watched,['a','b']);assert.equal(h.calls.length,1);
  h.watcher.resume();await flush();assert.equal(h.calls.length,2);assert.equal(h.watcher.snapshot().items.length,2);assert.equal(h.notices.at(-1)[0].talk_id,'b');
});
