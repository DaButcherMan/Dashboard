/* ══════════════════════════════════════════
   util.js — shared helpers and the icon set.
   Loaded FIRST so `DASH.*` is available to every module.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  // ── HTML / string safety ────────────────────────────────────────────
  D.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  D.uid = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  // ── Icons ───────────────────────────────────────────────────────────
  // Stroke-based, 24×24, inheriting currentColor and sized by CSS. Keeping
  // them inline means no icon-font request and no layout shift.
  const PATHS = {
    grid:     'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    check:    'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
    calendar: 'M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM16 3v4M8 3v4M3 11h18',
    school:   'M22 10L12 5 2 10l10 5 10-5zM6 12.5V17c0 1.1 2.7 3 6 3s6-1.9 6-3v-4.5',
    work:     'M4 7h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2zM16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16',
    fitness:  'M22 12h-4l-3 9L9 3l-3 9H2',
    family:   'M17 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9.5 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
    money:    'M21 12V7H5a2 2 0 010-4h14v4M3 5v14a2 2 0 002 2h16v-5M18 12a2 2 0 000 4h4v-4z',
    trophy:   'M6 9H4.5a2.5 2.5 0 010-5H6M18 9h1.5a2.5 2.5 0 000-5H18M5 22h14M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 3.8M18 2H6v7a6 6 0 0012 0V2z',
    settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    plus:     'M12 5v14M5 12h14',
    clock:    'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
    target:   'M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z',
    zap:      'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    flag:     'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
    trend:    'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
    alert:    'M12 22a10 10 0 100-20 10 10 0 000 20zM12 8v5M12 16.5v.01',
    chevron:  'M9 18l6-6-6-6',
    menu:     'M3 12h18M3 6h18M3 18h18',
    close:    'M18 6L6 18M6 6l12 12',
    search:   'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
    sun:      'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon:     'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
    pin:      'M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    inbox:    'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v7a2 2 0 01-2 2H4a2 2 0 01-2-2v-7z',
    refresh:  'M21 12a9 9 0 11-2.6-6.4M21 3v6h-6',
    play:     'M8 5.5v13l10.5-6.5z',
  };

  D.icon = function (name, cls) {
    const d = PATHS[name];
    if (!d) return '';
    return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  };

  // ── Dates ───────────────────────────────────────────────────────────
  // Day keys are 'YYYY-MM-DD' local strings: they sort lexicographically and
  // survive JSON without timezone drift.

  D.dayKey = function (d) {
    const x = new Date(d);
    return x.getFullYear() + '-' +
      String(x.getMonth() + 1).padStart(2, '0') + '-' +
      String(x.getDate()).padStart(2, '0');
  };

  D.parseDayKey = function (key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  D.today = function () { return D.dayKey(new Date()); };

  D.addDays = function (d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };

  // Midnight-anchored, so "tomorrow" is 1 regardless of the clock.
  D.daysBetween = function (aKey, bKey) {
    return Math.round((D.parseDayKey(bKey) - D.parseDayKey(aKey)) / 86400000);
  };

  D.startOfWeek = function (d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay());       // Sunday-first
    return x;
  };

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  D.DOW_SHORT = DOW;
  D.DOW_MIN   = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  D.fmtDay = function (key) {
    const d = D.parseDayKey(key);
    return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate();
  };

  D.fmtDayLong = function (key) {
    const d = D.parseDayKey(key);
    return MON[d.getMonth()] + ' ' + d.getDate();
  };

  // '14:05' or a Date → '2:05 PM'.
  D.fmtTime = function (t) {
    let h, m;
    if (t instanceof Date) { h = t.getHours(); m = t.getMinutes(); }
    else {
      const p = String(t).split(':');
      h = Number(p[0]); m = Number(p[1] || 0);
    }
    if (!isFinite(h)) return '';
    const ap = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + String(m).padStart(2, '0') + ' ' + ap;
  };

  // Compact variant for dense timelines: '2:05 PM' → '2:05p'.
  D.fmtTimeShort = function (t) {
    const s = D.fmtTime(t);
    return s.replace(':00', '').replace(' AM', 'a').replace(' PM', 'p');
  };

  D.toMinutes = function (hhmm) {
    const p = String(hhmm).split(':');
    return Number(p[0]) * 60 + Number(p[1] || 0);
  };

  D.minToHHMM = function (m) {
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' +
           String(m % 60).padStart(2, '0');
  };

  D.minutesNow = function () {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  };

  // The relative label you actually scan for on a due date.
  D.dueLabel = function (key) {
    if (!key) return '';
    const n = D.daysBetween(D.today(), key);
    if (n < -1)   return Math.abs(n) + 'd late';
    if (n === -1) return 'Yesterday';
    if (n === 0)  return 'Today';
    if (n === 1)  return 'Tomorrow';
    if (n < 7)    return n + 'd';
    return D.fmtDayLong(key);
  };

  D.humanMins = function (m) {
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60), r = m % 60;
    return h + 'h' + (r ? ' ' + r + 'm' : '');
  };

  // ── DOM ─────────────────────────────────────────────────────────────
  D.el  = function (sel, root) { return (root || document).querySelector(sel); };
  D.els = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  D.toast = function (msg) {
    let t = D.el('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2600);
  };

  // Clamp a 0..1 ratio for progress rendering.
  D.pct = function (done, total) {
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  };

})(window.DASH);
