// Moving the site to a new address (CONFIG.movedTo).
//
// Each address has its own browser storage, so a plain redirect would leave people's
// courses and plans behind. The first visit to the old address therefore carries the
// data in a restore link (#r=…), which the new address reads like any restore link.
// After that the old address only forwards (links people shared keep working).
// The data stays inside the #… part, which browsers never send to any server.

import { CONFIG } from './config.js';
import { pack } from './share.js';

const MOVED = 'bgu-schedule:moved';

export function shouldMove() {
  if (!CONFIG.movedTo) return false;
  try {
    return new URL(CONFIG.movedTo).host !== location.host && location.hostname.endsWith('github.io');
  } catch { return false; }
}

/** Sends this visit to the new address. state: everything saved here, or null when there's nothing. */
export async function moveAway(state) {
  const hash = location.hash.slice(1);
  let target = new URL(CONFIG.movedTo);
  if (/\babout\.html$/.test(location.pathname)) target = new URL('about.html', target);
  let alreadyMoved = false;
  try { alreadyMoved = !!localStorage.getItem(MOVED); } catch { /* storage blocked */ }
  if (hash) target.hash = hash; // a shared plan / course list / restore link: pass it on as is
  else if (state && !alreadyMoved) {
    try { target.hash = `r=${await pack(state)}`; } catch { /* go without the data */ }
  }
  try { localStorage.setItem(MOVED, '1'); } catch { /* storage blocked */ }
  // The old service worker would keep serving the old app from cache; it's not needed here any more.
  try {
    for (const r of await navigator.serviceWorker?.getRegistrations?.() || []) r.unregister();
  } catch { /* nothing to remove */ }
  location.replace(target.href);
}
