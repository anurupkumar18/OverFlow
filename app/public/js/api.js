// This module is the only browser network boundary. No credentials belong here.
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  let body;
  try { body = await response.json(); } catch { throw new Error('The server returned an unreadable response. Try again.'); }
  if (!response.ok) {
    const reason = typeof body?.error === 'string' ? body.error : body?.error?.message || body?.message || body?.reason;
    throw new Error(typeof reason === 'string' ? reason : `The request could not be completed (${response.status}).`);
  }
  return body;
}
export const api = {
  search(filters, signal) {
    const query = new URLSearchParams({ q: filters.q || '', day: filters.day || '', track: filters.track || '', available: String(Boolean(filters.available)), offset: String(filters.offset || 0) });
    return request(`/api/search?${query}`, { signal });
  },
  talk(id, signal) { return request(`/api/talks/${encodeURIComponent(id)}`, { signal }); },
  planB(id, signal) { return request(`/api/planb/${encodeURIComponent(id)}`, { signal }); },
  config() { return request('/api/config'); },
  status() { return request('/api/status'); },
  interaction(data) { return request('/api/interactions', { method: 'POST', body: JSON.stringify(data) }); },
  subscribe(data) { return request('/api/subscriptions', { method: 'POST', body: JSON.stringify(data) }); },
  alerts(attendeeId) { return request(`/api/alerts?${new URLSearchParams({ attendee_id: attendeeId })}`); },
};
