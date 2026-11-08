# Overflow product design

## Intent
Help KubeCon NA 2026 attendees find a worthwhile talk and an alternative before walking to a full room. Build now, autonomously, per the user's current instruction. The two pasted documents are reference briefs, not independent authorization for external actions. Do not fabricate human decisions, evaluation labels, provider findings, PRs, or deployment evidence.

## Scope
One Node 22+ stateless service based on skyhook-io/cnh-starter; vanilla accessible browser UI. Elasticsearch is the only server datastore. A verified public schedule snapshot provides read-only fallback. Local browser bookmarks are explicitly personal and do not count as crowd signals. No LLM in the request path.

Core: discover talks; query/topic/day filters; inspect talk; save/remove a local plan; Plan B with explanation, same-floor preference, +/-10 minute start window, different room, not ended and not likely full. Live interactions, runtime search mode, alerts, ES ingestion, evaluation tooling, telemetry, and deployment manifests are implemented with honest connection states. Missing external access never creates fake evidence.

## Visual direction (agent choices)
An attendee's field guide: airy two-column discovery canvas, a narrow personal itinerary rail, and focused talk detail / Plan B sheets. A large, carefully spaced sans-serif headline and a simple curved path symbol identify Overflow. Avoid marketing stats and decorative card grids. Search and talks are the focal content.

Palette pending missing attachment: Paper #F7F8FA, White #FFFFFF, Ink #19232D, Muted #5D6976, Blue #315DE3, Sea #276D65. Reserve amber for honest warnings. System font stack (-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif) intentionally uses San Francisco on Apple platforms. Type scale 13/15/17/22/32/48. Content mostly left aligned. 12px and 20px corner radii depend on role; quiet borders, minimal shadows. Compact controls have minimum 44px targets.

References: https://developer.apple.com/design/human-interface-guidelines/design-principles/ ; https://developer.apple.com/design/tips/ ; https://linear.app/now/behind-the-latest-design-refresh . Apply clarity, hierarchy, adaptive layout, consistent actions, visible focus, and reduced-motion support. Not an Apple clone.

## API contract
All JSON responses use snake_case. Talk: {id,title,abstract,speakers: string[],start,end,room,floor: string|null,capacity: number|null,capacity_source:'estimate',tags:string[],track,level,source_url,synthetic:false,fullness:{bookmarks:number|null,reports:number|null,capacity:number|null,capacity_source:'estimate',pressure:number|null,likely_full:boolean|null,signal:'live'|'unavailable'},why_matched?:string}.

GET /api/search?q=&day=YYYY-MM-DD&track=&available=false -> {items:Talk[],total,mode,degraded,reason:string|null,source,facets:{days:string[],tracks:string[]},version}. Limit displayed results to 100; total is all matching. Empty query browses chronological schedule. Day filter uses America/Denver. All times in API end with Z.
GET /api/talks/:id -> {item:Talk,mode,degraded,source}.
GET /api/planb/:id -> {items:Talk[],mode,degraded,reason,source_talk:Talk}. Up to 3; floor unknown must not claim same floor. Unknown crowd signals remain eligible with disclosure, never labeled available.
GET /api/status -> {status:'available'|'unavailable',p95_ms:number|null,error_ratio:number|null,degraded_share:number|null,as_of:string|null,version,search_mode}.
GET /api/config -> {version,live_interactions:boolean,event:{name,timezone},data_source}. No secrets.
POST /api/interactions {talk_id,attendee_id,type:'bookmark'|'unbookmark'|'full_report'} -> {ok:true} or 503 when no ES. Anonymous id is browser-generated, bounded; smoke- ids excluded from crowds.
POST /api/subscriptions {talk_id,attendee_id} and GET /api/alerts?attendee_id= -> {items:[]}; unavailable yields 503 and readable reason. UI enables live actions only when config permits.
GET /api/deps internal, protected by ADMIN_TOKEN; POST /api/admin/mode {mode} likewise. /healthz and /readyz never call external services.

## Honesty and constraints
Every search and Plan B response contains mode and degraded. Mode ladder hybrid_rerank > hybrid > bm25 > snapshot; no claiming a mode without running it. Snapshot is read-only with visible banner. Crowd state unavailable is distinct from zero. Every fullness payload carries denominator and estimate source. Credentials only in environment on server. Never print/read existing secret files. All external calls bounded. No fabricated occupancy or scores. Human relevance labels remain empty until supplied. Prepared-before-11 claim replaced with actual Nov 8 build disclosure.

## Success and QA
Node tests cover schedule, Plan B, fallback, input validation, auth and secret boundaries. Run timezone matrix UTC/Denver/Tokyo. Playwright exercises desktop and mobile, keyboard, search/filter, empty state, saved persistence, detail and Plan B. Manually inspect screenshots and UI flows; report as agent-operated manual QA, not human acceptance. Independent review verifies implementation and claims. Live integrations must be separately verified before called complete.
