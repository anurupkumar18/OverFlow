const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'});
const denverDay = value => dayFormat.format(new Date(value));
function normalizeTalk(t, fullness) {
  const capacity = Number.isFinite(t.capacity) ? t.capacity : null;
  const f=fullness||t.fullness||{};
  const safeFullness={bookmarks:f.bookmarks??null,reports:f.reports??null,capacity,capacity_source:'estimate',pressure:f.pressure??null,likely_full:f.likely_full??null,signal:f.signal==='live'?'live':'unavailable'};
  return {id:t.id,title:t.title,abstract:t.abstract,speakers:t.speakers||[],room:t.room,tags:t.tags||[],track:t.track,level:t.level,source_url:t.source_url, start:new Date(t.start).toISOString(),end:new Date(t.end).toISOString(), floor:t.floor || null, capacity, capacity_source:'estimate', synthetic:false,
    fullness:safeFullness,...(typeof t.why_matched==='string'?{why_matched:t.why_matched.slice(0,500)}:{})};
}
const chronological = (a,b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id);
function facets(talks) { return {days:[...new Set(talks.map(t=>denverDay(t.start)))].sort(), tracks:[...new Set(talks.map(t=>t.track).filter(Boolean))].sort()}; }
function matches(t,{q='',day='',track='',available=false}={}) {
  const terms = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [t.title,t.abstract,...(t.speakers||[]),...(t.tags||[]),t.track].join(' ').toLocaleLowerCase();
  return (!day || denverDay(t.start)===day) && (!track || t.track===track) && (!available || t.fullness?.likely_full!==true) && terms.every(term=>haystack.includes(term));
}
function snapshotSearch(talks,filters={}) {
  const all = talks.map(t=>normalizeTalk(t)).filter(t=>matches(t,filters)).sort(chronological);
  const offset=filters.offset||0;
  return {items:all.slice(offset,offset+100),total:all.length,has_more:offset+100<all.length,next_offset:offset+100<all.length?offset+100:null,facets:facets(talks),reason:filters.available ? 'Crowd signals are unavailable; unknown rooms remain eligible and are not confirmed available.' : 'Live search is unavailable; browsing the verified schedule snapshot.'};
}
function planB(source,talks,now=new Date(),{ranked=false}={}) {
  const venue = t => t.venue || (t.room?.includes('|') ? t.room.split('|')[0].trim() : null);
  const sameFloor = t => Boolean(source.floor && t.floor && source.floor===t.floor && venue(source) && venue(source)===venue(t));
  const topics = t => [...new Set([...(t.tags||[]),t.track].filter(Boolean))];
  const sourceTopics = new Set(topics(source).map(v=>v.toLowerCase()));
  const sharedTopics = t => topics(t).filter(v=>sourceTopics.has(v.toLowerCase()));
  const near = t=>Math.abs(Date.parse(t.start)-Date.parse(source.start));
  return talks.map(t=>normalizeTalk(t)).filter(t=>t.id!==source.id && t.room!==source.room && near(t)<=600000 && Date.parse(t.end)>now.valueOf() && t.fullness.likely_full!==true)
    .sort((a,b)=>Number(sameFloor(b))-Number(sameFloor(a)) || (ranked?0:sharedTopics(b).length-sharedTopics(a).length || near(a)-near(b) || chronological(a,b))).slice(0,3).map(t=>({...t,why_matched:[sameFloor(t)?'Same floor':venue(source)&&venue(t)&&venue(source)!==venue(t)?'Different venue':t.floor?'Floor '+t.floor:'Floor unknown', ranked&&t.why_matched?'Related text: '+t.why_matched:sharedTopics(t).length?'Shared topic: '+sharedTopics(t).join(', '):'Related time slot', 'Starts within 10 minutes', t.fullness.signal==='unavailable'?'Crowd state unknown; availability is not confirmed':'No current full signal'].join(' · ')}));
}
module.exports = {normalizeTalk,snapshotSearch,planB,denverDay,facets,matches};
