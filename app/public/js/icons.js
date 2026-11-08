const paths = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  filter: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  offline: '<path d="M16 17h2a4 4 0 0 0 1-7.87A7 7 0 0 0 6.3 7.6M4 10.4A4 4 0 0 0 6 18h7M3 3l18 18"/>',
  signal: '<path d="M4 20v-4m5 4v-8m6 8V8m5 12V4"/>',
  device: '<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M10 18h4"/>',
  route: '<circle cx="5" cy="18" r="2"/><path d="M7 18h7a4 4 0 0 0 0-8h-3a4 4 0 0 1 0-8h8m-3 3 3-3 3 3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m4 4h2m3 0h2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  external: '<path d="M14 3h7v7m0-7L11 13M10 4H4v16h16v-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v1"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
};
export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
}
