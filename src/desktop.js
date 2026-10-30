const KEY = 'totem-desktop-invitation';

export function controlUrl(invitation) {
  const url = new URL('/control', location.origin);
  url.searchParams.set('room', invitation.room);
  url.hash = `token=${invitation.token}`;
  return url.href;
}

export function shareScreen(invitation) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...invitation, updated: Date.now() })); } catch { /* Direct link still works. */ }
}

export function currentScreen() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return value?.room && value?.token && Date.now() - value.updated < 10000 ? value : null;
  } catch { return null; }
}

export function openWindow(url, name) {
  // No monitor API or extended-display permission is needed.
  const win = window.open(url, name, 'popup=yes,width=1000,height=700,resizable=yes,scrollbars=yes');
  win?.focus();
  return Boolean(win);
}

export function followScreen() {
  function sync() {
    const invitation = currentScreen();
    if (invitation && new URLSearchParams(location.search).get('room') !== invitation.room) {
      location.replace(controlUrl(invitation));
    }
  }
  window.addEventListener('storage', event => { if (event.key === KEY) sync(); });
  sync();
}
