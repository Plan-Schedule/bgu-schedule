// Anonymous visit counter (GoatCounter): no cookies, nothing about the person or
// what they chose. Sent as a plain image request, so no third-party script runs.
//
// What is sent: the page path (never the #… part: restore links carry all the
// user's data there), the page title, the referring site (only its domain),
// the screen size, and the names of a few actions (e.g. "plan-saved").
// Switched off when CONFIG.statsUrl is empty, on localhost, and for people who
// ask sites not to track them (Do Not Track / Global Privacy Control).

import { CONFIG } from './config.js';

const enabled = () =>
  !!CONFIG.statsUrl &&
  location.protocol === 'https:' &&
  navigator.doNotTrack !== '1' &&
  !navigator.globalPrivacyControl;

function send(params) {
  if (!enabled()) return;
  try {
    const url = new URL(CONFIG.statsUrl);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
    url.searchParams.set('rnd', Math.random().toString(36).slice(2, 8));
    new Image().src = url.href;
  } catch { /* counting must never break the app */ }
}

function refDomain() {
  try {
    const r = document.referrer && new URL(document.referrer);
    return r && r.origin !== location.origin ? r.origin : '';
  } catch { return ''; }
}

const seen = new Set();

/** One visit. Opening the installed app is counted under its own path so it's visible in the stats. */
export function pageview() {
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  send({
    p: location.pathname + (installed ? '?installed' : ''),
    t: document.title,
    r: refDomain(),
    s: `${screen.width},${screen.height},${Math.round(devicePixelRatio || 1)}`,
  });
}

/** A named action, counted at most once per visit. */
export function event(name) {
  if (seen.has(name)) return;
  seen.add(name);
  send({ p: name, t: name, e: 'true' });
}
