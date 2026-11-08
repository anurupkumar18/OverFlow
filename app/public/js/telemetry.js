// Dash0's exporter is the one browser transport exception to api.js.
// It is never loaded without explicit, dedicated browser ingest configuration.
const identityKey = 'overflow.rum.anonymous.v1';
const actions = new Set(['search','save','details','planb','close-dialog','reset','retry','discover','report-full','subscribe','share-interest','export-plan','view-plan']);

function safePath(pathname) {
  if (/^\/api\/(talks|planb)\/[^/]+$/.test(pathname)) return pathname.replace(/\/[^/]+$/, '/:id');
  if (/^\/api\/(search|config|status|interactions|subscriptions|alerts)$/.test(pathname)) return pathname;
  if (['/','/index.html','/styles.css','/favicon.svg'].includes(pathname) || /^\/(?:js|generated)\/[a-zA-Z0-9._-]+\.js$/.test(pathname)) return pathname;
  return '/REDACTED';
}

export function scrubUrlAttributes(attributes) {
  const value = {...attributes};
  let url;
  try { url = new URL(value['url.full']); } catch { /* Attribute-only URL. */ }
  const pathname = safePath(url?.pathname || value['url.path'] || '/');
  value['url.path'] = pathname;
  value['url.query'] = '';
  value['url.fragment'] = '';
  if (url) value['url.full'] = url.origin + pathname;
  else if ('url.full' in value) value['url.full'] = 'REDACTED';
  return value;
}

export function createBrowserTelemetry({loadSdk=()=>import('/generated/telemetry-sdk.js'),getStorage=()=>globalThis.localStorage,randomUUID=()=>globalThis.crypto.randomUUID(),eventTarget=globalThis.window,documentTarget=globalThis.document} = {}) {
  let sdk = null;
  let starting = null;
  let actionCount = 0;
  let errorCount = 0;
  function track(action) {
    if (!sdk || !actions.has(action) || actionCount >= 200) return;
    actionCount++;
    try { sdk.sendEvent('overflow.ui.action',{attributes:{'overflow.ui.action':action},severity:'INFO'}); } catch { /* Telemetry cannot break an action. */ }
  }
  function report(category) {
    if (!sdk || errorCount++ >= 10) return;
    // Never forward arbitrary messages, stacks, search text, or attendee identities.
    try { sdk.reportError(category === 'rejection' ? 'Unhandled browser promise rejection' : 'Unhandled browser error',{attributes:{'overflow.error.category':category}}); } catch { /* Best effort. */ }
  }
  async function start(config, version) {
    if (!config?.enabled) return false;
    if (starting) return starting;
    starting = (async()=>{
      let timer;
      try {
        const loaded = await Promise.race([loadSdk(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Telemetry load timed out')),1500);})]);
        clearTimeout(timer);
        loaded.init({
          serviceName:'overflow-web',serviceVersion:version,environment:config.environment,
          endpoint:{url:config.endpoint,authToken:config.token,dataset:config.dataset},
          enabledInstrumentations:['@dash0/navigation','@dash0/web-vitals','@dash0/fetch'],
          sessionSamplingRate:100,disableVcsDetection:true,headersToCapture:[],
          urlAttributeScrubber:scrubUrlAttributes,
          pageViewInstrumentation:{generateMetadata:()=>({title:'Overflow conference planner'}),trackVirtualPageViews:true,includeParts:['HASH']},
          wrapEventHandlers:false,wrapTimers:false,enableTransportCompression:false,
          maxWaitForResourceTimingsMillis:1000,
        });
        let anonymous;
        try { anonymous = getStorage()?.getItem(identityKey); } catch { /* Storage can be disabled. */ }
        if (!/^rum-[a-f0-9-]{36}$/.test(anonymous || '')) {
          anonymous = 'rum-' + randomUUID();
          try { getStorage()?.setItem(identityKey,anonymous); } catch { /* In-memory identity remains useful. */ }
        }
        loaded.identify(anonymous);
        sdk = loaded;
        eventTarget?.addEventListener('error',()=>report('error'));
        eventTarget?.addEventListener('unhandledrejection',()=>report('rejection'));
        documentTarget?.addEventListener('submit',event=>{if(event.target?.id==='search-form')track('search');});
        documentTarget?.addEventListener('click',event=>{
          const button=event.target?.closest?.('button');
          if(button)track(button.dataset?.action || button.id);
        });
        return true;
      } catch { return false; } finally { clearTimeout(timer); }
    })();
    return starting;
  }
  return {start,track};
}
export const telemetry = createBrowserTelemetry();
