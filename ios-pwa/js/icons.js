(function () {
  const paths = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    wallet:
      '<path d="M20 8H5a2 2 0 0 1 0-4h13v4M5 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h15V8M20 12h-5v4h5"/><path d="M16.8 14h.1"/>',
    home: '<path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    report:
      '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 16v-3m4 3V8m4 8v-5"/>',
    trend: '<path d="M4 4v16h17M7 14l4-5 4 3 6-7"/>',
    food: '<path d="M5 3v6m3-6v6M5 6h3M6.5 9v12M17 3c-4 4-4 9 0 9V3Zm0 9v9"/>',
    bus: '<rect x="4" y="3" width="16" height="16" rx="4"/><path d="M4 11h16M8 19v2m8-2v2M8 15h.1m7.9 0h.1M8 6h8"/>',
    bag: '<path d="M5 8h14l1 13H4L5 8Zm3 0V6a4 4 0 0 1 8 0v2"/>',
    game: '<path d="M7 7h10c3 0 5 11 2 12-2 1-4-3-5-3h-4c-1 0-3 4-5 3C2 18 4 7 7 7ZM8 10v5m-2.5-2.5h5M16 11h.1M18 14h.1"/>',
    heart:
      '<path d="M12 20S2 14 2 8a5 5 0 0 1 10-1A5 5 0 0 1 22 8c0 6-10 12-10 12Z"/><path d="M9 12h6m-3-3v6"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="2"/><rect x="14" y="4" width="6" height="6" rx="2"/><rect x="4" y="14" width="6" height="6" rx="2"/><rect x="14" y="14" width="6" height="6" rx="2"/>',
    settings:
      '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4m8-4v4M8 14h2m4 0h2m-8 3h2"/>',
    note: '<path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M7 13h10M7 17h7"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    export: '<path d="M12 15V3m-4 4 4-4 4 4M4 13v7h16v-7"/>',
    import: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    shield:
      '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/>',
    phone:
      '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
    pie: '<path d="M10 3a9 9 0 1 0 11 11H10V3Z"/><path d="M14 2v8h8a9 9 0 0 0-8-8Z"/>',
    bars: '<path d="M5 20V10h3v10M11 20V4h3v16m3 0V8h3v12"/>',
    refresh: '<path d="M20 8a8 8 0 1 0 .4 7M20 3v5h-5"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',
    cloud:
      '<path d="M7 18a5 5 0 1 1 0-10 6 6 0 0 1 12 1 4.5 4.5 0 0 1 0 9M9 16l3-3 3 3m-3-3v8"/>',
  };
  window.WalletIcon = {
    props: { name: String },
    template:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="paths[name] || paths.wallet"></svg>',
    data: () => ({ paths }),
  };
})();
