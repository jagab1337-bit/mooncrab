(() => {
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  let preference = 'system';
  try { preference = localStorage.getItem('mooncrab-theme') || 'system'; } catch {}
  const apply = (value) => {
    preference = ['light', 'dark', 'system'].includes(value) ? value : 'system';
    root.dataset.themePreference = preference;
    root.dataset.theme = preference === 'system' ? (scheme.matches ? 'dark' : 'light') : preference;
    try { localStorage.setItem('mooncrab-theme', preference); } catch {}
  };
  apply(preference);
  scheme.addEventListener('change', () => { if (preference === 'system') apply(preference); });
  document.addEventListener('change', event => {
    if (event.target instanceof HTMLSelectElement && event.target.matches('[data-theme-control]')) apply(event.target.value);
  });
})();
