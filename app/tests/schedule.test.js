const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotSearch, planB, normalizeTalk } = require('../src/schedule');
const talk = (id, extra = {}) => ({id, title: id, abstract: 'Cloud Kubernetes', speakers: ['Ada'], start: '2026-11-10T17:00:00Z', end: '2026-11-10T17:40:00Z', room: 'Salt Palace | Level 2 | '+id, floor: 'Level 2', capacity: 200, capacity_source: 'estimate', tags: ['Cloud'], track: 'Cloud', level: 'Intermediate', source_url: 'https://example.test', synthetic: false, ...extra});

test('snapshot exposes unknown crowd state and Denver day independently of host timezone', () => {
  const items = [talk('previous', {start:'2026-11-10T06:55:00Z'}), talk('today', {start:'2026-11-10T07:05:00Z'})];
  const result = snapshotSearch(items, {day:'2026-11-10', q:''});
  assert.deepEqual(result.items.map(t=>t.id), ['today']);
  assert.equal(result.items[0].fullness.bookmarks, null);
  assert.equal(result.items[0].fullness.likely_full, null);
  assert.equal(result.items[0].fullness.signal, 'unavailable');
  assert.equal(result.items[0].fullness.capacity, 200);
});

test('search combines literal text, track and safe availability filters with uncapped total', () => {
  const items = Array.from({length:105}, (_,i)=>talk(String(i)));
  const result = snapshotSearch(items, {q:'kubernetes', track:'Cloud', available:true});
  assert.equal(result.total,105); assert.equal(result.items.length,100);
  assert.equal(snapshotSearch(items,{q:'[.*'}).total,0);
  assert.match(result.reason, /unknown|unavailable/i);
});

test('Plan B enforces start window, different room, end boundary, fullness and known-floor priority', () => {
  const source = talk('source');
  const items = [source, talk('near',{floor:null}), talk('same'), talk('full',{fullness:{likely_full:true}}), talk('late',{start:'2026-11-10T17:10:01Z'}),talk('ended',{end:'2026-11-10T17:05:00Z'}),talk('room',{room:'Salt Palace | Level 2 | source'}), talk('boundary',{start:'2026-11-10T16:50:00Z',floor:'Level 1'})];
  const result = planB(source,items,new Date('2026-11-10T17:05:00Z'));
  assert.deepEqual(result.map(t=>t.id), ['same','near','boundary']);
  assert.match(result[0].why_matched,/same floor/i);
  assert.doesNotMatch(result[1].why_matched,/same floor/i);
  assert.match(result[1].why_matched,/unknown|unavailable/i);
});

test('same floor requires same venue; equal floor labels across venues do not imply nearby rooms', () => {
  const source=talk('source',{room:'Salt Palace | Level 2 | A'});
  const result=planB(source,[talk('hyatt',{room:'Hyatt Regency | Level 2 | B'}),talk('palace',{room:'Salt Palace | Level 2 | C'})],new Date('2026-11-10T16:00:00Z'));
  assert.equal(result[0].id,'palace');
  assert.doesNotMatch(result[1].why_matched,/same floor/i);
});

test('Plan B topic overlap breaks same-floor ties and explanations name actual shared topics', () => {
 const source=talk('source',{tags:['Security'],track:'Security'});
 const result=planB(source,[talk('aaa',{tags:['Storage'],track:'Storage'}),talk('zzz',{tags:['Security'],track:'Security'})],new Date('2026-11-08T00:00:00Z'));
 assert.equal(result[0].id,'zzz');assert.match(result[0].why_matched,/Security/);
 const cross=planB(source,[talk('other',{room:'Hyatt Regency | Level 2 | B'})],new Date('2026-11-08T00:00:00Z'));
 assert.match(cross[0].why_matched,/different venue/i);assert.doesNotMatch(cross[0].why_matched,/different floor/i);
});

test('snapshot pagination reaches talks beyond the first 100 without changing matching total',()=>{
 const talks=Array.from({length:205},(_,i)=>talk(String(i).padStart(3,'0')));
 const second=snapshotSearch(talks,{offset:100});assert.equal(second.total,205);assert.equal(second.items[0].id,'100');assert.equal(second.next_offset,200);assert.equal(second.has_more,true);
 const last=snapshotSearch(talks,{offset:200});assert.equal(last.items.length,5);assert.equal(last.has_more,false);assert.equal(last.next_offset,null);
});

test('Talk output does not leak embedding fields or provider metadata',()=>{
 const normalized=normalizeTalk(talk('a',{semantic_text:{secret:'hidden'},provider_key:'private'}));assert.equal(normalized.semantic_text,undefined);assert.equal(normalized.provider_key,undefined);
});

test('every fullness response retains its denominator and unknown signal even with partial input',()=>{
 const result=normalizeTalk(talk('a',{fullness:{likely_full:true,secret:'private'}}));assert.equal(result.fullness.capacity,200);assert.equal(result.fullness.capacity_source,'estimate');assert.equal(result.fullness.signal,'unavailable');assert.equal(result.fullness.secret,undefined);
});

test('live Plan B preserves provider relevance within same-venue floor priority',()=>{
 const source=talk('source',{tags:['Security'],track:'Security'});
 const ranked=[talk('best-other-floor',{floor:'Level 1',tags:['Security'],track:'Security'}),talk('provider-best',{tags:['Storage'],track:'Storage',why_matched:'Kubernetes admission policies'}),talk('provider-second',{tags:['Security'],track:'Security'})];
 const result=planB(source,ranked,new Date('2026-11-08T00:00:00Z'),{ranked:true});
 assert.deepEqual(result.map(t=>t.id),['provider-best','provider-second','best-other-floor']);
 assert.match(result[0].why_matched,/Kubernetes admission policies/);
 assert.match(result[0].why_matched,/Same floor/);
});
