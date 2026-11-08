// Real browser SDK -> localhost collector -> real backend correlation. No cloud account.
// Run after npm run build:browser --prefix app and playwright install chromium.
const http=require('node:http');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const {chromium}=require('../app/node_modules/playwright');
const payloads=[];
let child,browser;
const collector=http.createServer((req,res)=>{
  const headers={'access-control-allow-origin':req.headers.origin||'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type, dash0-dataset','content-type':'application/json'};
  if(req.method==='OPTIONS'){res.writeHead(204,headers);return res.end();}
  let size=0;const chunks=[];
  req.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)req.destroy();else chunks.push(chunk);});
  req.on('end',()=>{
    try { if(payloads.length<200)payloads.push(JSON.parse(Buffer.concat(chunks))); } catch { /* Assertion below detects missing valid telemetry. */ }
    res.writeHead(200,headers);res.end('{}');
  });
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const records=()=>payloads.flatMap(p=>p.resourceLogs||[]).flatMap(r=>(r.scopeLogs||[]).flatMap(s=>(s.logRecords||[]).map(log=>({resource:r.resource,log}))));
const spans=()=>payloads.flatMap(p=>p.resourceSpans||[]).flatMap(r=>(r.scopeSpans||[]).flatMap(s=>(s.spans||[]).map(span=>({resource:r.resource,span}))));
const attribute=(attrs,name)=>attrs?.find(a=>a.key===name)?.value?.stringValue;
async function until(check,message,timeout=10000){const stop=Date.now()+timeout;while(Date.now()<stop){if(check())return;await delay(100);}throw Error(message);}
const watchdog=setTimeout(()=>{child?.kill('SIGKILL');collector.closeAllConnections();collector.close();browser?.close();process.exitCode=1;console.error('Browser telemetry smoke exceeded its 45 second deadline.');},45000);
(async()=>{
  await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve));
  const endpoint='http://127.0.0.1:'+collector.address().port;
  child=spawn(process.execPath,['--require','./telemetry.cjs','server.js'],{cwd:path.join(__dirname,'../app'),env:{PATH:process.env.PATH,PORT:'0',APP_VERSION:'rum-smoke',NODE_ENV:'test',OTEL_EXPORTER_OTLP_ENDPOINT:endpoint,OTEL_EXPORTER_OTLP_PROTOCOL:'http/json',OTEL_BSP_SCHEDULE_DELAY:'100',OTEL_LOG_LEVEL:'error',DASH0_API_URL:endpoint,DASH0_READ_TOKEN:'auth_local_server_read',DASH0_QUERY_P95_MS:'secret-outbound-query-92741',DASH0_BROWSER_ENABLED:'true',DASH0_BROWSER_ENDPOINT:endpoint,DASH0_BROWSER_TOKEN:'auth_local_browser_smoke',DASH0_BROWSER_DATASET:'local-smoke'},stdio:['ignore','pipe','pipe']});
  let port,serverOutput='';
  child.stdout.on('data',chunk=>{serverOutput+=chunk;for(const line of serverOutput.split('\n')){try{const event=JSON.parse(line);if(event.event==='listening')port=event.port;}catch{}}});
  child.stderr.on('data',()=>{});
  await until(()=>port,'Temporary app did not start');
  const base='http://127.0.0.1:'+port;
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(base+'/?private=secret-page-92741');
  await page.waitForFunction(()=>localStorage.getItem('overflow.rum.anonymous.v1'));
  await page.locator('#talk-results article').first().waitFor();
  let traceparent;
  page.on('request',request=>{if(request.url().includes('/api/search?')&&request.url().includes('secret-rum-query-92741'))traceparent=request.headers().traceparent;});
  await page.getByRole('searchbox',{name:'Search sessions, speakers, or topics'}).fill('secret-rum-query-92741');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#results-count').textContent.trim()==='0 sessions');
  await page.evaluate(()=>window.dispatchEvent(new ErrorEvent('error',{message:'secret-error-92741',error:new Error('secret-error-92741')})));
  // Closing the page flushes Web Vitals such as LCP/CLS through the SDK's visibility handler.
  await delay(1500);await page.close();
  await until(()=>records().some(r=>attribute(r.log.attributes,'event.name')==='overflow.ui.action'),'Browser custom event did not reach local collector');
  await until(()=>records().some(r=>attribute(r.log.attributes,'event.name')==='browser.error'),'Sanitized browser error did not reach local collector');
  await until(()=>records().some(r=>/web_vital/.test(attribute(r.log.attributes,'event.name')||'')),'Web Vital did not reach local collector');
  assert.match(traceparent||'',/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  const [,traceId,parentId]=traceparent.split('-');
  await until(()=>spans().some(({resource,span})=>attribute(resource?.attributes,'service.name')==='overflow'&&span.traceId===traceId&&span.parentSpanId===parentId),'Backend did not export the browser request parent trace');
  assert.ok(spans().some(({resource,span})=>attribute(resource?.attributes,'service.name')==='overflow-web'&&span.traceId===traceId&&span.spanId===parentId),'Browser request span missing');
  await until(()=>spans().some(({resource,span})=>attribute(resource?.attributes,'service.name')==='overflow'&&span.kind===3&&attribute(span.attributes,'url.path')==='/REDACTED'),'Sanitized outgoing provider span missing');
  const serialized=JSON.stringify(payloads);
  for(const secret of ['secret-page-92741','secret-rum-query-92741','secret-error-92741','secret-outbound-query-92741','auth_local_server_read']) {
    const fields=spans().flatMap(({resource,span})=>(span.attributes||[]).filter(a=>JSON.stringify(a.value).includes(secret)).map(a=>({service:attribute(resource?.attributes,'service.name'),attribute:a.key})));
    assert.ok(!serialized.includes(secret),'Private input was exported: '+secret+' '+JSON.stringify(fields));
  }
  assert.ok(records().some(r=>/^rum-/.test(attribute(r.log.attributes,'user.id')||'')),'Independent anonymous identity absent');
  assert.deepEqual(pageErrors,[]);
  console.log(JSON.stringify({collector:'local',browser_sdk:'@dash0/sdk-web@0.30.0',checks:['browser events','sanitized errors','Web Vitals','anonymous identity','same-origin traceparent','matching backend parent span','URL/input redaction in browser/server/outbound spans','no page errors'],remote_verified:false}));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{
  clearTimeout(watchdog);await browser?.close();
  if(child&&!child.killed){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  collector.closeAllConnections();await new Promise(resolve=>collector.close(resolve));
});
