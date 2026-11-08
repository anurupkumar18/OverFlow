import { api } from './api.js';
import { icon } from './icons.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const zone = 'America/Denver';
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' });
const shortDayFormat = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' });
const dateKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const storageKey = 'overflow.personal-plan.v1';
const state = {
  filters: { q: '', day: '', track: '', available: false },
  items: new Map(), saved: new Map(), config: null, mode: null, view: 'discover',
  searchSequence: 0, dialogSequence: 0, searchController: null, dialogController: null,
  debounce: null, toastTimer: null, dialogSource: null, lastFocus: null, storageAvailable: true,
  loaded: [], nextOffset: null, total: 0, facetDays: '',
};

function time(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Time unavailable' : timeFormat.format(date); }
function dateKey(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : dateKeyFormat.format(date); }
function day(value, short = false) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date unavailable' : (short ? shortDayFormat : dayFormat).format(date); }
function dayFromKey(value) { return new Date(`${value}T12:00:00-07:00`); }
function safeUrl(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; } }
function savedTalks() { return [...state.saved.values()].sort((a, b) => new Date(a.start) - new Date(b.start) || a.title.localeCompare(b.title)); }
function cacheTalk(talk) { if (talk?.id) state.items.set(String(talk.id), talk); }
function findTalk(id) { return state.items.get(String(id)) || state.saved.get(String(id)); }

function announce(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast.hidden = true; }, 4600);
}
function loadSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(data)) for (const talk of data.slice(0, 600)) {
      if (talk && typeof talk.id === 'string' && typeof talk.title === 'string' && Array.isArray(talk.speakers) && !Number.isNaN(Date.parse(talk.start)) && !Number.isNaN(Date.parse(talk.end))) state.saved.set(talk.id, talk);
    }
  } catch { state.storageAvailable = false; }
}
function persistSaved() {
  try { localStorage.setItem(storageKey, JSON.stringify(savedTalks())); return true; }
  catch { state.storageAvailable = false; return false; }
}
function toggleSaved(id) {
  const talk = findTalk(id);
  if (!talk) return;
  const wasSaved = state.saved.has(String(id));
  const restorePlanFocus = Boolean(document.activeElement?.closest('#plan-results'));
  if (wasSaved) state.saved.delete(String(id)); else state.saved.set(String(id), talk);
  const persisted = persistSaved();
  renderPersonalPlan();
  if (restorePlanFocus) ($('#plan-results [data-action="save"]') || $('#plan-results [data-action="discover"]'))?.focus();
  document.querySelectorAll('[data-action="save"]').forEach((button) => {
    const saved = state.saved.has(button.dataset.id);
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', `${saved ? 'Remove' : 'Save'} ${findTalk(button.dataset.id)?.title || 'talk'}${saved ? ' from' : ' to'} my plan`);
    if (button.classList.contains('dialog-save')) button.innerHTML = `${icon(saved ? 'check' : 'bookmark')} ${saved ? 'Saved to my plan' : 'Save to my plan'}`;
  });
  if (!persisted) announce('Browser storage is unavailable. Your plan is saved for this visit only.');
  else announce(wasSaved ? 'Removed from your personal plan.' : 'Saved to your personal plan on this device.');
}

function signalMarkup(talk) {
  const full = talk.fullness || {};
  const capacity = Number.isFinite(full.capacity) && full.capacity > 0 ? full.capacity : Number.isFinite(talk.capacity) && talk.capacity > 0 ? talk.capacity : null;
  const live = full.signal === 'live';
  const bookmarks = Number.isFinite(full.bookmarks) ? full.bookmarks : '—';
  const reports = Number.isFinite(full.reports) ? full.reports : '—';
  if (!live) return `<span class="signal-label">Room signal unavailable</span><span>${capacity ? `Capacity ${capacity} · planning estimate` : 'Capacity unknown'}</span>`;
  const label = full.likely_full === true ? 'Likely full' : full.likely_full === false ? 'No full-room indication' : 'Room fullness unknown';
  return `<span class="signal-label has-live ${full.likely_full === true ? 'is-full' : ''}">${label}</span><span>${bookmarks} crowd bookmarks / ${capacity || '?'} estimated seats · ${reports} full reports</span>`;
}
function rowMarkup(talk, { alternative = false, conflict = false } = {}) {
  const id = escapeHtml(talk.id);
  const saved = state.saved.has(String(talk.id));
  const speakers = Array.isArray(talk.speakers) ? talk.speakers.join(', ') : '';
  const room = talk.room || 'Room not published';
  return `<article class="talk-row" data-talk-id="${id}">
    <div class="talk-time"><strong>${escapeHtml(time(talk.start))}</strong><span>to ${escapeHtml(time(talk.end))}</span></div>
    <div class="talk-info">
      <p class="talk-track">${escapeHtml(talk.track || 'Conference session')}</p>
      ${conflict ? '<span class="conflict-label">Overlaps another saved talk</span>' : ''}
      <h3 class="talk-title"><button type="button" class="title-button" data-action="details" data-id="${id}">${escapeHtml(talk.title)}</button></h3>
      <p class="talk-speakers">${escapeHtml(speakers || 'Speaker details not published')}</p>
      <p class="talk-room">${icon('pin')}<span>${escapeHtml(room)}</span></p>
    </div>
    <button type="button" class="save-button" data-action="save" data-id="${id}" aria-pressed="${saved}" aria-label="${saved ? 'Remove' : 'Save'} ${escapeHtml(talk.title)}${saved ? ' from' : ' to'} my plan">${icon('bookmark')}</button>
    ${alternative ? `<p class="planb-why">${escapeHtml(talk.why_matched || 'Starts around the same time in a different room. Room signals may be unavailable.')}</p>` : ''}
    <div class="talk-bottom"><div class="room-signal">${signalMarkup(talk)}</div><button class="planb-button" type="button" data-action="planb" data-id="${id}" aria-label="Find Plan B for ${escapeHtml(talk.title)}">Plan B ${icon('route')}</button></div>
  </article>`;
}
function groupedMarkup(talks, conflicts = new Set()) {
  let lastDay = '';
  return talks.map((talk) => {
    const key = dateKey(talk.start);
    const heading = key !== lastDay ? `<h3 class="talk-group-label">${escapeHtml(day(talk.start))}</h3>` : '';
    lastDay = key;
    return `${heading}${rowMarkup(talk, { conflict: conflicts.has(String(talk.id)) })}`;
  }).join('');
}
function emptyMarkup(title, text, action = '', actionLabel = '', iconName = 'search') {
  return `<div class="empty-state">${icon(iconName)}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${action ? `<button type="button" class="button button-secondary" data-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>` : ''}</div>`;
}
function loadingMarkup() { return `<div aria-label="Loading talks">${[0, 1, 2].map(() => '<div class="loading-row" aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>').join('')}</div>`; }

function renderPersonalPlan() {
  const talks = savedTalks();
  $('#nav-plan-count').textContent = String(talks.length);
  $('#view-plan').innerHTML = `${talks.length ? `View my plan (${talks.length})` : 'View my plan'} ${icon('arrow')}`;
  $('#export-plan').innerHTML = `${icon('download')} Export calendar`;
  $('#export-plan').disabled = talks.length === 0;
  $('#rail-plan').innerHTML = talks.length ? talks.slice(0, 4).map((talk) => `<div class="rail-item"><p class="rail-item-day">${escapeHtml(day(talk.start, true))} · ${escapeHtml(time(talk.start))}</p><button data-action="details" data-id="${escapeHtml(talk.id)}" type="button">${escapeHtml(talk.title)}</button><p class="rail-item-room">${escapeHtml(talk.room || 'Room not published')}</p></div>`).join('') + (talks.length > 4 ? `<p class="rail-overflow">+ ${talks.length - 4} more in your plan</p>` : '') : `<div class="rail-empty">${icon('bookmark')}<h3>Your plan starts here.</h3><p>Tap the bookmark on a talk to make it part of your day.</p></div>`;
  const conflicts = new Set();
  for (let i = 0; i < talks.length; i++) for (let j = i + 1; j < talks.length; j++) {
    if (new Date(talks[j].start) >= new Date(talks[i].end)) break;
    if (new Date(talks[i].start) < new Date(talks[j].end)) { conflicts.add(String(talks[i].id)); conflicts.add(String(talks[j].id)); }
  }
  const warning = $('#plan-conflicts');
  warning.hidden = !conflicts.size;
  warning.innerHTML = `${icon('alert')} ${conflicts.size} saved talks overlap. Keep them as options, or use Plan B to compare before you head out.`;
  $('#plan-results').innerHTML = talks.length ? groupedMarkup(talks, conflicts) : emptyMarkup('Make time for what interests you.', 'Save a session from Discover to start your itinerary. Your plan stays in this browser and can be exported to your calendar.', 'discover', 'Explore the schedule', 'bookmark');
  if (!state.storageAvailable) $('.device-note').innerHTML = `${icon('info')}<span>Browser storage unavailable. Saves last for this visit only.</span>`;
}

function renderFacets(facets) {
  if (!facets) return;
  const days = [...new Set(facets.days || [])].filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
  if (days.length) {
    if (state.facetDays !== days.join(',')) $('#day-tabs').innerHTML = `<button type="button" data-day="" aria-pressed="${!state.filters.day}">All days</button>${days.map((value) => {
      const date = dayFromKey(value);
      const label = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', day: 'numeric' }).format(date);
      return `<button type="button" data-day="${value}" aria-pressed="${state.filters.day === value}">${escapeHtml(label)}</button>`;
    }).join('')}`;
    state.facetDays = days.join(',');
    const first = dayFromKey(days[0]); const last = dayFromKey(days[days.length - 1]);
    const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: zone }).format(first);
    const firstDay = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: zone }).format(first);
    const lastDay = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: zone }).format(last);
    $('#event-dates').textContent = `${month} ${firstDay}${firstDay === lastDay ? '' : `–${lastDay}`}`;
  }
  const select = $('#track-select');
  select.innerHTML = '<option value="">All tracks</option>' + [...new Set(facets.tracks || [])].sort().map((track) => `<option value="${escapeHtml(track)}">${escapeHtml(track)}</option>`).join('');
  select.value = state.filters.track;
}
function updateNotice(data) {
  state.mode = data.mode;
  state.noticeData = data;
  const snapshot = data.mode === 'snapshot';
  const live = Boolean(state.config?.live_interactions) && !snapshot;
  const notice = $('#catalog-notice');
  notice.classList.toggle('is-live', live && !data.degraded);
  $('#notice-icon').innerHTML = icon(live ? 'signal' : 'offline');
  $('#notice-title').textContent = snapshot ? 'Offline catalog · Live room signals unavailable' : data.degraded ? 'Search is running with limited connections' : live ? 'Conference catalog · Live crowd signals enabled' : 'Conference catalog · Live room signals unavailable';
  $('#notice-description').textContent = snapshot ? 'Official schedule snapshot. Capacity figures are planning estimates, not venue data.' : data.degraded ? (data.reason || 'Some search or room services are unavailable. Results may use a fallback.') : live ? 'Crowd bookmarks and full-room reports are signals, not a headcount. Capacities are estimates.' : 'Explore the schedule and save your own plan. Capacity figures are planning estimates.';
  $('#available-filter').disabled = !live;
  $('#available-filter').parentElement.title = live ? 'Exclude talks flagged likely full from crowd signals.' : 'Requires live crowd signals. Missing signals are never treated as empty rooms.';
}
function updateFilterUi() {
  $('#clear-filters').hidden = !state.filters.q && !state.filters.day && !state.filters.track && !state.filters.available;
  $('#day-tabs').querySelectorAll('[data-day]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.day === state.filters.day)));
}
async function search({ append = false } = {}) {
  clearTimeout(state.debounce);
  const sequence = ++state.searchSequence;
  state.searchController?.abort();
  const controller = new AbortController(); state.searchController = controller;
  const container = $('#talk-results');
  container.setAttribute('aria-busy', 'true');
  if (!append) { state.loaded = []; state.nextOffset = null; container.innerHTML = loadingMarkup(); $('#results-count').textContent = 'Finding sessions…'; $('#result-limit').hidden = true; $('#load-more').hidden = true; }
  else { $('#load-more').disabled = true; $('#load-more').textContent = 'Loading more…'; }
  updateFilterUi();
  try {
    const data = await api.search({ ...state.filters, offset: append ? state.nextOffset || 0 : 0 }, controller.signal);
    if (sequence !== state.searchSequence) return;
    const items = Array.isArray(data.items) ? data.items.slice(0, 100) : [];
    items.forEach(cacheTalk);
    state.loaded = append ? [...state.loaded, ...items.filter((talk) => !state.loaded.some((previous) => previous.id === talk.id))] : items;
    state.total = data.total ?? state.loaded.length;
    state.nextOffset = Number.isInteger(data.next_offset) ? data.next_offset : null;
    renderFacets(data.facets);
    updateNotice(data);
    $('#results-title').textContent = state.filters.q ? 'Your search results' : state.filters.day ? dayFormat.format(dayFromKey(state.filters.day)) : 'Explore the schedule';
    $('#results-count').textContent = `${data.total ?? items.length} ${(data.total ?? items.length) === 1 ? 'session' : 'sessions'}`;
    $('#result-context').textContent = state.filters.q ? `Matching “${state.filters.q}”${state.filters.track ? ` in ${state.filters.track}` : ''}. All times in Salt Lake City (MST).` : state.filters.track ? `${state.filters.track}. All times in Salt Lake City (MST).` : 'Follow your curiosity. Your next idea might be one room over.';
    container.innerHTML = state.loaded.length ? groupedMarkup(state.loaded) : emptyMarkup('A different path might help.', 'No sessions match these filters. Try a broader topic or explore the full schedule.', 'reset', 'Reset filters');
    $('#load-more').hidden = state.nextOffset === null;
    $('#load-more').disabled = false;
    $('#load-more').textContent = 'Load more sessions';
    if (Number(data.total) > state.loaded.length) {
      $('#result-limit').hidden = false;
      $('#result-limit').textContent = `Showing ${state.loaded.length} of ${data.total} sessions. Load more, or choose a day, track, or topic.`;
    }
    updateFilterUi();
  } catch (error) {
    if (error.name === 'AbortError' || sequence !== state.searchSequence) return;
    if (append) { announce('More sessions could not load. Try again.'); $('#load-more').disabled = false; $('#load-more').textContent = 'Try loading more again'; return; }
    container.innerHTML = emptyMarkup('The schedule could not load.', error.message || 'Check your connection and try again. Your personal plan is still saved.', 'retry', 'Try again', 'offline');
    $('#results-count').textContent = 'Unable to load';
    $('#notice-icon').innerHTML = icon('offline');
    $('#notice-title').textContent = 'The catalog connection is unavailable';
    $('#notice-description').textContent = 'Try again in a moment. You can still open your personal plan.';
  } finally { if (sequence === state.searchSequence) container.setAttribute('aria-busy', 'false'); }
}
function resetFilters() {
  state.filters = { q: '', day: '', track: '', available: false };
  $('#search-input').value = ''; $('#track-select').value = ''; $('#available-filter').checked = false;
  search();
}

function switchView(view, { focus = false } = {}) {
  state.view = view === 'plan' ? 'plan' : 'discover';
  const isPlan = state.view === 'plan';
  $('#discover-hero').hidden = isPlan;
  $('#discover-view').hidden = isPlan;
  $('#plan-view').hidden = !isPlan;
  document.querySelectorAll('[data-view]').forEach((button) => {
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const hash = `#${state.view}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  if (isPlan) renderPersonalPlan();
  document.title = isPlan ? 'My plan — Overflow' : 'Overflow — Your conference, considered';
  if (focus) { $('#main').focus(); window.scrollTo({ top: 0, behavior: 'instant' }); }
}

function beginDialog() {
  const dialog = $('#talk-dialog');
  if (!dialog.open) { state.lastFocus = document.activeElement; dialog.showModal(); }
  state.dialogController?.abort();
  const controller = new AbortController(); state.dialogController = controller;
  const sequence = ++state.dialogSequence;
  dialog.scrollTop = 0;
  $('#dialog-content').innerHTML = `<div class="dialog-header"><button class="dialog-close" data-action="close-dialog" aria-label="Close dialog" type="button">${icon('close')}</button><h2 id="dialog-title">Loading session…</h2></div><div class="dialog-body">${loadingMarkup()}</div>`;
  $('.dialog-close', dialog).focus();
  return { sequence, controller };
}
function renderDialogError(message, type, id) {
  $('#dialog-content').innerHTML = `<div class="dialog-header"><button class="dialog-close" data-action="close-dialog" aria-label="Close dialog" type="button">${icon('close')}</button><h2 id="dialog-title">This session could not load.</h2></div><div class="dialog-body">${emptyMarkup('Try reconnecting.', message, '', '', 'offline')}<button class="button button-primary" data-action="${type}" data-id="${escapeHtml(id)}" type="button">Try again</button></div>`;
  $('.dialog-close').focus();
}
async function openDetails(id) {
  const { sequence, controller } = beginDialog();
  try {
    const data = await api.talk(id, controller.signal);
    if (sequence !== state.dialogSequence) return;
    const talk = data.item;
    if (!talk) throw new Error('This talk is not in the current catalog.');
    cacheTalk(talk);
    const saved = state.saved.has(String(talk.id));
    const sourceUrl = safeUrl(talk.source_url);
    const live = Boolean(state.config?.live_interactions) && data.mode !== 'snapshot';
    const full = talk.fullness || {};
    $('#dialog-content').innerHTML = `<div class="dialog-header">
      <button class="dialog-close" data-action="close-dialog" aria-label="Close session details" type="button">${icon('close')}</button>
      <p class="talk-track">${escapeHtml(talk.track || 'Conference session')}</p>
      <h2 id="dialog-title">${escapeHtml(talk.title)}</h2>
      <p class="dialog-speakers">${escapeHtml((talk.speakers || []).join(', ') || 'Speaker details not published')}</p>
      <div class="dialog-meta"><span>${icon('calendar')} ${escapeHtml(day(talk.start))}</span><span>${icon('clock')} ${escapeHtml(time(talk.start))}–${escapeHtml(time(talk.end))} MST</span><span>${icon('pin')} ${escapeHtml(talk.room || 'Room not published')}</span></div>
    </div><div class="dialog-body">
      <h3>About this session</h3><p class="abstract">${escapeHtml(talk.abstract || 'An abstract has not been published for this session.')}</p>
      ${talk.level ? `<p class="dialog-footnote">Session level: ${escapeHtml(talk.level)}</p>` : ''}
      <div class="dialog-signals"><h3>Room signals</h3><div class="room-signal">${signalMarkup(talk)}</div>
      <p>${full.signal === 'live' ? `${Number.isFinite(full.bookmarks) ? full.bookmarks : 'Unknown'} crowd bookmarks. ${Number.isFinite(full.reports) ? full.reports : 'Unknown'} full-room reports.` : 'Crowd bookmarks and full-room reports are unavailable, rather than zero.'}</p>
      <p class="signal-explanation">Capacity is a planning estimate, not a verified venue capacity. Crowd bookmarks are interest signals, not occupancy. Your personal plan does not contribute to crowd counts.</p></div>
      <div class="dialog-actions"><button class="button button-primary dialog-save" type="button" data-action="save" data-id="${escapeHtml(talk.id)}" aria-pressed="${saved}" aria-label="${saved ? 'Remove' : 'Save'} ${escapeHtml(talk.title)}${saved ? ' from' : ' to'} my plan">${icon(saved ? 'check' : 'bookmark')} ${saved ? 'Saved to my plan' : 'Save to my plan'}</button><button class="button button-secondary" type="button" data-action="planb" data-id="${escapeHtml(talk.id)}">${icon('route')} Find a Plan B</button></div>
      <p class="dialog-footnote">Saved only on this device. A personal save does not reserve a seat.</p>
      ${sourceUrl ? `<a class="dialog-source" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">View official session ${icon('external')}</a>` : '<p class="dialog-footnote">An official session link is not available.</p>'}
      ${live ? `<section class="live-actions"><h3>Help fellow attendees</h3><p>Live actions are separate from your device-only plan. Report only what you observe at the room.</p><div class="live-actions-buttons"><button class="button button-secondary" type="button" data-action="report-full" data-id="${escapeHtml(talk.id)}">${icon('alert')} Report room full</button><button class="button button-secondary" type="button" data-action="subscribe" data-id="${escapeHtml(talk.id)}">${icon('bell')} Check room alerts</button></div><p id="live-feedback" class="live-feedback" role="status"></p></section>` : ''}
    </div>`;
    $('.dialog-close').focus();
  } catch (error) { if (error.name !== 'AbortError' && sequence === state.dialogSequence) renderDialogError(error.message, 'details', id); }
}
async function openPlanB(id) {
  const { sequence, controller } = beginDialog();
  state.dialogSource = String(id);
  try {
    const data = await api.planB(id, controller.signal);
    if (sequence !== state.dialogSequence) return;
    const source = data.source_talk || findTalk(id);
    const items = (Array.isArray(data.items) ? data.items : []).slice(0, 3);
    items.forEach(cacheTalk);
    if (source) cacheTalk(source);
    $('#dialog-content').innerHTML = `<div class="dialog-header">
      <button class="dialog-close" data-action="close-dialog" aria-label="Close Plan B" type="button">${icon('close')}</button>
      <button class="back-button" data-action="details" data-id="${escapeHtml(id)}" type="button">${icon('back')} Back to session</button>
      <h2 id="dialog-title">Another room. A new idea.</h2>
      <p class="dialog-subheading">Plan B for <strong>${escapeHtml(source?.title || 'your session')}</strong>${source ? `, ${escapeHtml(time(source.start))} on ${escapeHtml(day(source.start, true))}` : ''}.</p>
    </div><div class="dialog-body">
      <p class="planb-note">Starting within 10 minutes, in a different room. Nearby floors are preferred when known; check the venue before walking. ${data.mode === 'snapshot' || data.degraded ? 'Live room signals are unavailable for some or all options. A seat is not guaranteed.' : 'Crowd signals are estimates. A seat is not guaranteed.'}</p>
      <div class="planb-list">${items.length ? items.map((talk) => rowMarkup(talk, { alternative: true })).join('') : emptyMarkup('No good backup in this window.', data.reason || 'There are no eligible sessions starting within 10 minutes in another room. Try exploring a different time in the schedule.', '', '', 'route')}</div>
      <p class="dialog-footnote">${data.mode === 'snapshot' ? 'Offline catalog. ' : ''}Unknown room signals remain eligible and are labeled. Unknown floors never count as a floor match.</p>
    </div>`;
    $('.dialog-close').focus();
  } catch (error) { if (error.name !== 'AbortError' && sequence === state.dialogSequence) renderDialogError(error.message, 'planb', id); }
}
function closeDialog() { $('#talk-dialog').close(); }
function attendeeId() {
  const key = 'overflow.attendee.v1';
  try {
    let id = localStorage.getItem(key);
    if (!id || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
    return id;
  } catch { return state.sessionAttendee ||= crypto.randomUUID(); }
}
async function liveAction(button, type, id) {
  button.disabled = true;
  const feedback = $('#live-feedback');
  try {
    const attendee_id = attendeeId();
    if (type === 'report-full') {
      await api.interaction({ talk_id: id, attendee_id, type: 'full_report' });
      if (feedback?.isConnected) feedback.textContent = 'Full-room report sent. Thank you for sharing what you observed.';
      announce('Full-room report sent.');
    } else {
      await api.subscribe({ talk_id: id, attendee_id });
      const alerts = await api.alerts(attendee_id);
      if (feedback?.isConnected) feedback.textContent = alerts.items?.length ? alerts.items.map((alert) => `${alert.item?.title || 'Watched session'}: ${alert.message || 'A room alert is available.'}`).join(' ') : 'No full-room alerts for your watched sessions right now. Alerts are checked on request; check again before walking.';
      announce('Room alerts checked.');
    }
  } catch (error) { if (feedback?.isConnected) feedback.textContent = error.message; announce(error.message); }
  finally { if (button.isConnected) button.disabled = false; }
}

function exportCalendar() {
  const talks = savedTalks();
  if (!talks.length) return;
  const icsEscape = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r/g, '');
  const utc = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Overflow//Personal Conference Plan//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Overflow conference plan'];
  for (const talk of talks) {
    lines.push('BEGIN:VEVENT', `UID:${icsEscape(talk.id)}@overflow.local`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(talk.start)}`, `DTEND:${utc(talk.end)}`, `SUMMARY:${icsEscape(talk.title)}`, `LOCATION:${icsEscape(talk.room || 'Room not published')}`, `DESCRIPTION:${icsEscape(`${(talk.speakers || []).join(', ')}\n\n${talk.abstract || ''}\n\nSaved with Overflow. This is a personal plan, not a seat reservation.`)}`);
    const url = safeUrl(talk.source_url); if (url) lines.push(`URL:${icsEscape(url)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 folds content lines at 75 UTF-8 octets, without splitting Unicode characters.
  const encoder = new TextEncoder();
  const fold = (line) => {
    let output = ''; let width = 0;
    for (const character of line) { const size = encoder.encode(character).length; if (width + size > 75) { output += '\r\n '; width = 1; } output += character; width += size; }
    return output;
  };
  const blob = new Blob([`${lines.map(fold).join('\r\n')}\r\n`], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'overflow-my-plan.ics'; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce(`Exported ${talks.length} session${talks.length === 1 ? '' : 's'}. Open the calendar file to add your plan.`);
}

function initIcons() {
  const pairs = { 'search-icon': 'search', 'filter-icon': 'filter', 'select-chevron': 'chevron', 'rail-bookmark': 'bookmark', 'device-icon': 'device', 'tip-icon': 'route', 'notice-icon': 'offline' };
  for (const [id, name] of Object.entries(pairs)) $(`#${id}`).innerHTML = icon(name);
}
function initEvents() {
  $('#search-form').addEventListener('submit', (event) => { event.preventDefault(); state.filters.q = $('#search-input').value.trim(); search(); });
  $('#search-input').addEventListener('input', () => {
    state.filters.q = $('#search-input').value.trim();
    clearTimeout(state.debounce);
    // Invalidate the previous response immediately, including during the debounce window.
    state.searchSequence++; state.searchController?.abort();
    state.debounce = setTimeout(search, 260);
  });
  $('#day-tabs').addEventListener('click', (event) => { const button = event.target.closest('[data-day]'); if (button) { state.filters.day = button.dataset.day; search(); } });
  $('#track-select').addEventListener('change', (event) => { state.filters.track = event.target.value; search(); });
  $('#available-filter').addEventListener('change', (event) => { state.filters.available = event.target.checked; search(); });
  $('#clear-filters').addEventListener('click', resetFilters);
  $('#load-more').addEventListener('click', () => search({ append: true }));
  $('[data-view="discover"]').addEventListener('click', () => switchView('discover'));
  $('[data-view="plan"]').addEventListener('click', () => switchView('plan'));
  $('#view-plan').addEventListener('click', () => switchView('plan', { focus: true }));
  $('#export-plan').addEventListener('click', exportCalendar);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action; const id = button.dataset.id;
    if (action === 'save') toggleSaved(id);
    else if (action === 'details') openDetails(id);
    else if (action === 'planb') openPlanB(id);
    else if (action === 'close-dialog') closeDialog();
    else if (action === 'reset') resetFilters();
    else if (action === 'retry') search();
    else if (action === 'discover') switchView('discover', { focus: true });
    else if (action === 'report-full' || action === 'subscribe') liveAction(button, action, id);
  });
  const dialog = $('#talk-dialog');
  dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });
  dialog.addEventListener('close', () => { state.dialogSequence++; state.dialogController?.abort(); if (state.lastFocus?.isConnected) state.lastFocus.focus(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !dialog.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) {
      event.preventDefault(); switchView('discover'); $('#search-input').focus();
    }
  });
  window.addEventListener('hashchange', () => switchView(location.hash === '#plan' ? 'plan' : 'discover'));
  window.addEventListener('storage', (event) => { if (event.key === storageKey) { state.saved.clear(); loadSaved(); renderPersonalPlan(); } });
}

async function init() {
  initIcons(); loadSaved(); renderPersonalPlan(); initEvents();
  switchView(location.hash === '#plan' ? 'plan' : 'discover');
  const configPromise = api.config().then((config) => { state.config = config; if (state.mode) updateNotice(state.noticeData); }).catch(() => { state.config = { live_interactions: false }; });
  // Health is informative, never a gate that prevents reading the schedule.
  const statusPromise = api.status().then((status) => { $('#catalog-notice').dataset.serviceStatus = status.status; }).catch(() => {});
  await Promise.allSettled([configPromise, statusPromise, search()]);
}
init();
