/* ══════════════════════════════════════════
   app.js — navigation, views, rendering, interaction.

   Rendering is full-redraw-per-view: cheap at this data size, and it keeps
   state in the Store rather than smeared across the DOM. Every click is
   handled by one delegated listener reading `data-act`.
   ══════════════════════════════════════════ */
window.DASH = window.DASH || {};
(function (D) {
  'use strict';

  const esc = D.esc;
  const S   = () => D.Store;

  let view = 'overview';       // 'overview' | 'tasks' | … | 'area:school'
  let areaId = null;
  let taskFilter = 'open';
  let sportsTab = 'recent';    // Results is the default view
  let sportsCache = null;
  let sportsError = null;

  const NAV_MAIN = [
    { view: 'overview', icon: 'grid',     label: 'Overview' },
    { view: 'tasks',    icon: 'check',    label: 'Tasks' },
    { view: 'calendar', icon: 'calendar', label: 'Calendar' },
  ];
  const NAV_MORE = [
    { view: 'sports',   icon: 'trophy',   label: 'Sports' },
    { view: 'settings', icon: 'settings', label: 'Settings' },
  ];

  const TITLES = {
    overview: ['Overview',  ''],
    tasks:    ['Tasks',     'Everything on your plate'],
    calendar: ['Calendar',  'Classes, meetings and appointments'],
    sports:   ['Sports',    'Fixtures and results for your teams'],
    settings: ['Settings',  'Preferences, backup and calendar sources'],
  };

  // ── Navigation ──────────────────────────────────────────────────────
  function navButton(item) {
    const active = view === item.view;
    return `<button class="nav-item ${active ? 'active' : ''}"
              data-act="goto" data-view="${esc(item.view)}">
              ${D.icon(item.icon)}<span>${esc(item.label)}</span>
              ${item.badge ? `<span class="badge ${item.badgeHot ? 'hot' : ''}">${item.badge}</span>` : ''}
            </button>`;
  }

  function buildNav() {
    const overdue = D.Tasks.overdue().length;
    const open    = D.Tasks.open().length;

    const main = NAV_MAIN.map((i) => {
      const it = Object.assign({}, i);
      if (i.view === 'tasks' && open) {
        it.badge = open;
        it.badgeHot = overdue > 0;
      }
      return it;
    });

    D.el('#nav-main').innerHTML  = main.map(navButton).join('');
    D.el('#nav-more').innerHTML  = NAV_MORE.map(navButton).join('');
    D.el('#nav-areas').innerHTML = S().areas.map((a) => {
      // No count for a weight-only area: its page does not list tasks, so a
      // badge would point at something you cannot click through to.
      const n = a.id === WEIGHT_ONLY
        ? 0 : D.Tasks.open().filter((t) => t.area === a.id).length;
      const active = view === 'area:' + a.id;
      return `<button class="nav-item ${active ? 'active' : ''}"
                data-act="goto" data-view="area:${esc(a.id)}">
                ${D.icon(a.icon)}<span>${esc(a.name)}</span>
                ${n ? `<span class="badge">${n}</span>` : ''}
              </button>`;
    }).join('');

    // Mobile: five destinations, the fifth opening the full sidebar.
    const bottom = [
      { view: 'overview', icon: 'grid',     label: 'Home' },
      { view: 'tasks',    icon: 'check',    label: 'Tasks', dot: overdue > 0 },
      { view: 'calendar', icon: 'calendar', label: 'Calendar' },
      { view: 'sports',   icon: 'trophy',   label: 'Sports' },
    ];
    D.el('#bottomnav').innerHTML = bottom.map((b) => `
      <button class="${view === b.view ? 'active' : ''}" data-act="goto" data-view="${b.view}">
        ${D.icon(b.icon)}<span>${esc(b.label)}</span>
        ${b.dot ? '<span class="dot"></span>' : ''}
      </button>`).join('') + `
      <button data-act="open-menu">${D.icon('menu')}<span>More</span></button>`;
  }

  function route(next) {
    // Leaving Sports with the picker open would strand the fixtures card
    // hidden behind it, so close the picker on the way out.
    const picker = D.el('#picker-card');
    if (next !== 'sports' && picker && !picker.hidden) setPicker(false);

    view = next;
    areaId = next.startsWith('area:') ? next.slice(5) : null;

    // Explicit 'block', not '': the stylesheet hides .view by default, so an
    // empty string would fall back to display:none and show nothing.
    const viewId = areaId ? 'view-area' : 'view-' + next;
    D.els('.view').forEach((v) => {
      v.style.display = v.id === viewId ? 'block' : 'none';
    });

    if (areaId) {
      const a = S().area(areaId);
      setTitle(a ? a.name : 'Area', a ? subForArea(a) : '');
    } else {
      const t = TITLES[next] || ['Dashboard', ''];
      setTitle(t[0], next === 'overview' ? overviewSub() : t[1]);
    }

    closeMenu();
    buildNav();
    render();
    window.scrollTo(0, 0);
  }

  function setTitle(t, sub) {
    D.el('#page-title').textContent = t;
    D.el('#page-sub').textContent = sub || '';
  }

  // Date first: on a narrow screen the subtitle truncates, and the date is
  // the half worth keeping.
  function overviewSub() {
    const name = S().settings.name;
    const when = new Date().toLocaleDateString(undefined,
      { weekday: 'long', month: 'long', day: 'numeric' });
    return when + (name ? ' · ' + greeting() + ', ' + name : '');
  }

  function subForArea(a) {
    if (a.id === WEIGHT_ONLY) {
      const n = D.Weight.all().length;
      return n ? n + ' reading' + (n === 1 ? '' : 's') : 'No readings yet';
    }
    const open = D.Tasks.open().filter((t) => t.area === a.id).length;
    return open ? open + ' open task' + (open === 1 ? '' : 's') : 'Nothing open';
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  function render() {
    if (areaId)               renderArea();
    else if (view === 'overview') renderOverview();
    else if (view === 'tasks')    renderTasks();
    else if (view === 'calendar') renderCalendar();
    else if (view === 'sports')   renderSports();
    else if (view === 'settings') renderSettings();
  }

  // ── Shared fragments ────────────────────────────────────────────────
  function dueChip(t) {
    if (!t.due) return '';
    const today = D.today();
    const cls = t.due < today ? 'late' : t.due === today ? 'today'
              : D.daysBetween(today, t.due) <= 3 ? 'soon' : '';
    return `<span class="chip ${cls}">${esc(D.dueLabel(t.due))}</span>`;
  }

  // Where an imported row came from. Calendar feeds name themselves through
  // Sync.providers; the pasted-page importer is not a feed, so it is named here.
  function sourceLabel(source) {
    if (source === 'canvas-paste') return 'Canvas';
    return (D.Sync.providers[source] || {}).label || source;
  }

  function areaChip(id) {
    const a = S().area(id);
    if (!a) return '';
    return `<span class="chip"><i class="dot" style="background:${esc(a.color)}"></i>${esc(a.name)}</span>`;
  }

  function taskRow(t, opts) {
    const bits = [];
    const chip = dueChip(t);
    if (chip) bits.push(chip);
    if (t.priority === 2) bits.push('<span class="chip high">High</span>');
    else if (t.priority === 1) bits.push('<span class="chip med">Med</span>');
    if (!opts?.hideArea && t.area) bits.push(areaChip(t.area));

    if (t.category) bits.push(`<span class="chip">${esc(t.category)}</span>`);

    const course = t.course && S().courses.find((c) => c.id === t.course);
    if (course) bits.push(`<span>${esc(course.code || course.name)}</span>`);
    else if (t.courseName) bits.push(`<span>${esc(t.courseName)}</span>`);
    if (t.source && t.source !== 'manual') {
      bits.push(`<span>${esc(sourceLabel(t.source))}</span>`);
    }

    return `
      <div class="row ${t.priority === 2 && !t.done ? 'priority' : ''}">
        <button class="check ${t.done ? 'on' : ''}" data-act="toggle-task"
                data-id="${esc(t.id)}" aria-label="Mark ${esc(t.title)} done"
                aria-pressed="${t.done ? 'true' : 'false'}"></button>
        <div class="main">
          <div class="title ${t.done ? 'done' : ''}">${esc(t.title)}</div>
          ${bits.length ? `<div class="meta">${bits.join('')}</div>` : ''}
        </div>
        <div class="actions">
          <button class="btn sm ghost" data-act="edit-task" data-id="${esc(t.id)}">Edit</button>
        </div>
      </div>`;
  }

  function emptyState(title, note, actLabel, act) {
    return `<div class="empty"><strong>${esc(title)}</strong>${esc(note || '')}
      ${act ? `<div style="margin-top:10px"><button class="btn sm" data-act="${esc(act)}">${esc(actLabel)}</button></div>` : ''}
    </div>`;
  }

  // Timeline used by Overview and each area page.
  function timeline(items, opts) {
    if (!items.length) {
      return `<div class="empty"><strong>Nothing scheduled</strong>${esc(opts?.emptyNote || 'Your next few days are clear.')}</div>`;
    }
    const today = D.today();
    const now = D.minutesNow();
    let lastDay = null;
    let html = '<div class="timeline">';
    items.forEach((o) => {
      if (o.dayKey !== lastDay) {
        lastDay = o.dayKey;
        const label = o.dayKey === today ? 'Today'
          : D.daysBetween(today, o.dayKey) === 1 ? 'Tomorrow'
          : D.fmtDay(o.dayKey);
        html += `<div class="tl-day">${esc(label)}</div>`;
      }
      const isNow = o.dayKey === today && !o.allDay &&
                    o.startMin <= now && (o.endMin || o.startMin + 50) > now;
      const meta = [o.location, o.subtitle, D.KIND_LABEL[o.kind]]
        .filter(Boolean).map(esc).join(' · ');
      html += `
        <div class="tl-item ${isNow ? 'now' : ''}">
          <div class="tl-time">${o.allDay ? 'All day' : esc(D.fmtTimeShort(D.minToHHMM(o.startMin)))}</div>
          <div class="tl-rail"><span class="tl-dot" style="background:${esc(o.color)}"></span></div>
          <div>
            <div class="tl-title">${esc(o.title)}</div>
            ${meta ? `<div class="tl-meta">${meta}</div>` : ''}
          </div>
        </div>`;
    });
    return html + '</div>';
  }

  function statCard(o) {
    return `
      <button class="stat ${o.tone || ''}" data-act="goto" data-view="${esc(o.go || 'tasks')}">
        <div class="stat-label">${D.icon(o.icon)}${esc(o.label)}</div>
        <div class="stat-value">${esc(String(o.value))}</div>
        <div class="stat-note">${o.note || ''}</div>
      </button>`;
  }

  // ── Overview ────────────────────────────────────────────────────────
  function renderOverview() {
    const h = D.Stats.headline();
    const today = D.today();

    D.el('#ov-stats').innerHTML = [
      statCard({
        label: 'Due today', icon: 'clock', value: h.dueToday, go: 'tasks',
        tone: h.dueToday ? 'warn' : '',
        note: h.todayEvents
          ? h.todayEvents + ' event' + (h.todayEvents === 1 ? '' : 's') + ' scheduled'
          : 'No events today',
      }),
      statCard({
        label: 'Overdue', icon: 'alert', value: h.overdue, go: 'tasks',
        tone: h.overdue ? 'alert' : 'good',
        note: h.overdue ? 'Needs attention' : 'All caught up',
      }),
      statCard({
        label: 'Done this week', icon: 'trend', value: h.weekDone, go: 'tasks',
        tone: 'info',
        note: `<span class="up">${h.weekPct}%</span> of ${D.Stats.week().target} target`,
      }),
      statCard({
        label: 'Open tasks', icon: 'inbox', value: D.Tasks.open().length, go: 'tasks',
        note: 'Across all areas',
      }),
    ].join('');

    // Now / next banner
    const cur = D.Agenda.current();
    const next = D.Agenda.nextUp();
    const slot = D.el('#nowbar-slot');
    if (cur || next) {
      const o = cur || next;
      slot.innerHTML = `
        <div class="nowbar">
          <div>
            <div class="kicker">${cur ? 'Happening now' : 'Up next'}</div>
            <div class="what">${esc(o.title)}</div>
            <div class="meta">${[o.location, D.KIND_LABEL[o.kind]].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
          <div class="when">
            ${cur ? 'Ends ' + esc(D.fmtTime(D.minToHHMM(o.endMin || o.startMin + 50)))
                  : esc(D.fmtTime(D.minToHHMM(o.startMin))) +
                    '<br><span style="color:var(--ink-3);font-weight:400">in ' +
                    esc(D.humanMins(o.startMin - D.minutesNow())) + '</span>'}
          </div>
        </div>`;
    } else {
      slot.innerHTML = '';
    }

    // Priorities
    const pri = D.Tasks.priorities(7);
    D.el('#pri-count').textContent = pri.length ? pri.length + ' to clear' : '';
    D.el('#ov-priorities').innerHTML = pri.length
      ? pri.map((t) => taskRow(t)).join('')
      : emptyState('Nothing urgent', 'No overdue or due-today tasks.', 'Add a task', 'new-task');

    // Schedule
    D.el('#ov-timeline').innerHTML = timeline(D.Agenda.upcoming(7, 10));

    // Weekly progress
    const w = D.Stats.week();
    const max = Math.max(w.busiest, 1);
    D.el('#wk-range').textContent = w.completed + ' / ' + w.target;
    D.el('#ov-week').innerHTML = `
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px">
        <span class="metric">${w.pct}%<small> of weekly target</small></span>
      </div>
      <div class="bar" style="margin:10px 0 4px"><i style="width:${w.pct}%"></i></div>
      <div class="weekchart">
        ${w.days.map((d) => `
          <div class="col ${d.isToday ? 'today' : ''} ${d.count ? '' : 'empty'}">
            <div class="stack"><span class="fill" style="height:${d.count ? Math.max(8, (d.count / max) * 100) : 4}%"
                 title="${d.count} on ${esc(D.fmtDay(d.key))}"></span></div>
            <span class="d">${esc(d.label)}</span>
          </div>`).join('')}
      </div>`;

    // Goals
    const goals = S().goals;
    D.el('#ov-goals').innerHTML = goals.length
      ? goals.slice(0, 4).map(goalRow).join('')
      : emptyState('No goals yet', 'Track a target you are working toward.', 'Add a goal', 'new-goal');

    // Quick actions
    D.el('#ov-quick').innerHTML = [
      { act: 'new-task',   icon: 'plus',     label: 'New task' },
      { act: 'new-event',  icon: 'calendar', label: 'New event' },
      { act: 'new-course', icon: 'school',   label: 'Add class' },
      { act: 'new-goal',   icon: 'target',   label: 'New goal' },
      { act: 'paste-assignments', icon: 'inbox', label: 'Paste assignments' },
      { act: 'sync-all',   icon: 'refresh',  label: 'Sync calendars' },
    ].map((q) =>
      `<button class="qa" data-act="${q.act}">${D.icon(q.icon)}<span>${esc(q.label)}</span></button>`
    ).join('');

    // Areas rollup
    D.el('#ov-areas').innerHTML = D.Stats.byArea().map((r) => `
      <div class="arow" data-act="goto" data-view="area:${esc(r.area.id)}">
        <span class="swatch" style="background:${esc(r.area.color)}"></span>
        <span class="nm">${esc(r.area.name)}</span>
        <span class="barwrap"><span class="bar thin"><i style="width:${r.pct}%;background:${esc(r.area.color)}"></i></span></span>
        <span class="n">${r.open ? r.open + ' open' : '—'}</span>
        ${D.icon('chevron', 'ic-sm')}
      </div>`).join('');

    renderOverviewSports();
  }

  function goalRow(g) {
    const p = D.Goals.progress(g);
    const a = S().area(g.area);
    return `
      <div class="goal" data-act="edit-goal" data-id="${esc(g.id)}" style="cursor:pointer">
        <div class="goal-top">
          <span class="goal-title">${esc(g.title)}</span>
          <span class="goal-num"><b>${p.current}</b> / ${p.target} ${esc(g.unit || '')}</span>
        </div>
        <div class="bar"><i style="width:${p.pct}%;background:${esc(a ? a.color : 'var(--accent)')}"></i></div>
      </div>`;
  }

  function renderOverviewSports() {
    const box = D.el('#ov-sports');
    if (!box) return;
    if (!S().settings.favTeams.length) {
      box.innerHTML = emptyState('No teams followed', 'Add teams to see fixtures and scores.',
        'Pick teams', 'goto-sports');
      return;
    }
    if (sportsError) { box.innerHTML = `<div class="empty">${esc(sportsError)}</div>`; return; }
    if (!sportsCache) { box.innerHTML = '<div class="empty">Loading scores…</div>'; return; }

    const rows = sportsCache.live.concat(
      sportsCache.upcoming.slice(0, 4),
      sportsCache.live.length || sportsCache.upcoming.length ? [] : sportsCache.recent.slice(0, 3));
    box.innerHTML = rows.length
      ? rows.slice(0, 5).map(gameRow).join('')
      : '<div class="empty">No games in the next few weeks.</div>';
  }

  function gameRow(g) {
    const post = g.state === 'post';
    const side = (s, other) => {
      const lost = post && other.score != null && s.score != null &&
                   Number(s.score) < Number(other.score);
      return `
        <div class="side ${lost ? 'lost' : ''}">
          ${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy">`
                   : '<span style="width:20px"></span>'}
          <span class="nm">${esc(s.name)}</span>
          ${s.score != null && g.state !== 'pre' ? `<span class="sc">${esc(s.score)}</span>` : ''}
        </div>`;
    };
    const when = g.state === 'in'
      ? `<span class="chip live">${esc(g.detail || 'LIVE')}</span>`
      : g.state === 'post'
        ? esc(D.fmtDayLong(g.dayKey))
        : esc(D.dueLabel(g.dayKey)) + '<br>' + esc(D.fmtTimeShort(new Date(g.date)));

    return `
      <div class="game">
        <div class="sides">${side(g.away, g.home)}${side(g.home, g.away)}</div>
        <div class="when">${when}<span class="lg">${esc(g.league)}${g.network ? ' · ' + esc(g.network) : ''}</span></div>
      </div>`;
  }

  // ── Tasks ───────────────────────────────────────────────────────────
  function renderTasks() {
    D.els('#task-filters button').forEach((b) =>
      b.classList.toggle('on', b.dataset.filter === taskFilter));

    let list;
    if (taskFilter === 'open')       list = D.Tasks.queue();
    else if (taskFilter === 'today') list = D.Tasks.overdue().concat(D.Tasks.dueOn(D.today()));
    else if (taskFilter === 'week')  list = D.Tasks.upcoming(7);
    else if (taskFilter === 'done')  list = D.Tasks.done().slice().reverse();
    else                             list = S().tasks.slice();

    D.el('#task-count').textContent = list.length + (list.length === 1 ? ' task' : ' tasks');
    D.el('#task-list').innerHTML = list.length
      ? list.map((t) => taskRow(t)).join('')
      : emptyState('Nothing here', 'Try another filter, or add something.', 'Add a task', 'new-task');

    // Keep the quick-add area picker in step with the areas list.
    const sel = D.el('#quick-area');
    if (sel && !sel.dataset.filled) {
      sel.innerHTML = '<option value="">No area</option>' +
        S().areas.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
      sel.dataset.filled = '1';
    }
  }

  // ── Calendar ────────────────────────────────────────────────────────
  // A month grid on top, the selected day's week listed beneath it. Picking
  // a date moves the list rather than opening a separate view, so the month
  // stays on screen as context for whatever you are reading.
  let calCursor = null;      // first of the displayed month
  let calSelected = null;    // the dayKey the week list follows

  // The month grid folds away once it has scrolled completely out of sight,
  // so the week list gets the whole screen. Scrolling back up deliberately
  // does NOT bring it back — content reappearing under you as you scroll is
  // disorienting, and you rarely want the grid again just because you
  // reached the top. The bubble is the way back, and the state survives
  // leaving and re-entering the view.
  let calCollapsed = false;
  let calObserver = null;

  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];

  function renderCalendar() {
    if (!calSelected) calSelected = D.today();
    if (!calCursor) {
      const d = D.parseDayKey(calSelected);
      calCursor = new Date(d.getFullYear(), d.getMonth(), 1);
    }
    // Kept in sync on every render so the two can never disagree.
    D.el('#cal-month-card').hidden = calCollapsed;
    D.el('#cal-fab').hidden = !calCollapsed;

    renderMonthGrid();
    renderWeekList();
    D.el('#cal-classes').innerHTML = courseList();
  }

  // Fold the grid only once it is genuinely off screen, rather than after an
  // arbitrary number of pixels. The root is inset by the topbar height,
  // because the topbar sits over the content — the grid is already invisible
  // by the time it slides underneath it.
  function watchCalendarVisibility() {
    const card = D.el('#cal-month-card');
    if (!card || !('IntersectionObserver' in window)) return;
    if (calObserver) calObserver.disconnect();

    const top = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 60;

    calObserver = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (view !== 'calendar' || calCollapsed) return;
        // `top < 0` means it went off the TOP — scrolled past. Without it,
        // the callback that fires when the card is hidden for any other
        // reason (switching views, being folded) would re-trigger this.
        if (!e.isIntersecting && e.boundingClientRect.top < 0) collapseCalendar();
      });
    }, { rootMargin: '-' + top + 'px 0px 0px 0px', threshold: 0 });

    calObserver.observe(card);
  }

  function collapseCalendar() {
    const card = D.el('#cal-month-card');
    if (calCollapsed || !card || card.hidden) return;

    // Removing the grid shortens the page, which would yank whatever you
    // were reading upward. Subtract the height it occupied so the week list
    // stays exactly where your eye already is.
    const shrink = card.getBoundingClientRect().height +
                   parseFloat(getComputedStyle(card).marginBottom || 0) + 16;
    calCollapsed = true;
    card.hidden = true;
    D.el('#cal-fab').hidden = false;
    window.scrollTo({ top: Math.max(0, window.scrollY - shrink), behavior: 'auto' });
  }

  // What sits on a day, as coloured marks for the grid.
  function dayMarks(key) {
    const colors = D.Agenda.on(key).map((o) => o.color)
      .concat(D.Tasks.dueOn(key).map((t) =>
        t.area ? S().areaColor(t.area) : 'var(--ink-faint)'));
    return { total: colors.length, colors };
  }

  function renderMonthGrid() {
    const y = calCursor.getFullYear(), m = calCursor.getMonth();
    D.el('#cal-title').textContent = MONTHS_LONG[m] + ' ' + y;

    // Always six weeks from the Sunday on or before the 1st. A fixed number
    // of rows means the week list below does not jump as you page months.
    const first = D.startOfWeek(new Date(y, m, 1));
    const today = D.today();
    let cells = '';

    for (let i = 0; i < 42; i++) {
      const d = D.addDays(first, i);
      const key = D.dayKey(d);
      const marks = dayMarks(key);
      const shown = marks.colors.slice(0, 4);
      const cls = ['mg-day'];
      if (d.getMonth() !== m)   cls.push('is-other');
      if (key === today)        cls.push('is-today');
      if (key === calSelected)  cls.push('is-selected');

      cells += `
        <button class="${cls.join(' ')}" data-act="cal-day" data-key="${esc(key)}"
                aria-pressed="${key === calSelected ? 'true' : 'false'}"
                aria-label="${esc(D.fmtDay(key))}${marks.total ? ', ' + marks.total + ' items' : ', nothing scheduled'}">
          <span class="n">${d.getDate()}</span>
          ${shown.length ? `<span class="mg-dots">${
              shown.map((c) => `<i style="background:${esc(c)}"></i>`).join('')
            }${marks.total > 4 ? `<span class="mg-more">+${marks.total - 4}</span>` : ''}</span>` : ''}
        </button>`;
    }

    D.el('#cal-grid').innerHTML =
      `<div class="mg-dow">${D.DOW_SHORT.map((d) => `<span>${esc(d)}</span>`).join('')}</div>
       <div class="mg-days">${cells}</div>`;
  }

  function renderWeekList() {
    const start = D.startOfWeek(D.parseDayKey(calSelected));
    const startKey = D.dayKey(start);
    const isThisWeek = startKey === D.dayKey(D.startOfWeek(new Date()));

    D.el('#cal-week-title').textContent = isThisWeek
      ? 'This week'
      : D.fmtDayLong(startKey) + ' – ' + D.fmtDayLong(D.dayKey(D.addDays(start, 6)));

    const today = D.today();
    let total = 0;
    const html = [];

    for (let i = 0; i < 7; i++) {
      const k = D.dayKey(D.addDays(start, i));
      const occ = D.Agenda.on(k);
      const due = D.Tasks.dueOn(k);
      total += occ.length + due.length;
      const body = (occ.length ? timeline(occ) : '') + due.map((t) => taskRow(t)).join('');
      const cls = ['daycol'];
      if (k === today) cls.push('is-today');
      if (k === calSelected) cls.push('is-picked');
      html.push(`
        <div class="${cls.join(' ')}" id="cal-day-${esc(k)}">
          <h3>${esc(k === today ? 'Today · ' + D.fmtDay(k) : D.fmtDay(k))}
            <span class="n">${occ.length + due.length || ''}</span></h3>
          ${body || '<div class="empty" style="padding:8px 16px 12px">Clear</div>'}
        </div>`);
    }

    D.el('#cal-week-count').textContent = total
      ? total + (total === 1 ? ' item' : ' items') : 'Nothing scheduled';
    D.el('#cal-body').innerHTML = html.join('');
  }

  function courseList() {
    const cs = S().courses;
    if (!cs.length) {
      return emptyState('No classes yet',
        'Add each class once with the days it meets — it fills your week for the term.',
        'Add a class', 'new-course');
    }
    return cs.map((c) => {
      const meets = (c.meetings || []).map((m) =>
        (m.days || []).map((d) => D.DOW_SHORT[d]).join(' ') + '  ' +
        D.fmtTimeShort(m.start) + (m.end ? '–' + D.fmtTimeShort(m.end) : '')).join(' · ');
      return `
        <div class="row">
          <span class="swatch" style="background:${esc(c.color || 'var(--blue)')};width:8px;height:8px;border-radius:2px;margin-top:6px;flex:none"></span>
          <div class="main">
            <div class="title">${esc(c.name)}</div>
            <div class="meta">
              ${c.code ? `<span class="chip">${esc(c.code)}</span>` : ''}
              <span>${esc(meets || 'No meeting times')}</span>
              ${c.location ? `<span>${esc(c.location)}</span>` : ''}
            </div>
          </div>
          <div class="actions">
            <button class="btn sm ghost" data-act="edit-course" data-id="${esc(c.id)}">Edit</button>
          </div>
        </div>`;
    }).join('');
  }

  // ── Area pages ──────────────────────────────────────────────────────
  // Fitness is the weight log and nothing else for now: no task list, no
  // schedule, no goals. Tasks can still be filed under it — they show up in
  // Tasks and on the Overview — the area page just is not about them.
  const WEIGHT_ONLY = 'fitness';

  function renderArea() {
    const a = S().area(areaId);
    if (!a) return;

    const weightOnly = areaId === WEIGHT_ONLY;
    D.el('#area-stats').hidden = weightOnly;
    D.el('#area-main').hidden = weightOnly;
    D.el('#area-classes-card').hidden = areaId !== 'school';

    // Fitness is three logs behind one switcher; only the chosen panel shows.
    D.el('#fitness-tabs').hidden = !weightOnly;
    D.el('#area-weight-card').hidden  = !weightOnly || fitnessTab !== 'weight';
    D.el('#area-peptide-card').hidden = !weightOnly || fitnessTab !== 'peptides';
    D.el('#area-workout-card').hidden = !weightOnly || fitnessTab !== 'workouts';

    if (weightOnly) { renderFitness(); return; }

    const stat = D.Stats.byArea().find((r) => r.area.id === areaId);
    const openTasks = D.Tasks.queue().filter((t) => t.area === areaId);
    const doneTasks = D.Tasks.done().filter((t) => t.area === areaId);

    D.el('#area-stats').innerHTML = [
      statCard({ label: 'Open', icon: 'inbox', value: stat.open,
                 go: 'area:' + areaId, note: stat.total + ' total' }),
      statCard({ label: 'Overdue', icon: 'alert', value: stat.overdue,
                 go: 'area:' + areaId, tone: stat.overdue ? 'alert' : 'good',
                 note: stat.overdue ? 'Needs attention' : 'On track' }),
      statCard({ label: 'Completed', icon: 'check', value: stat.done,
                 go: 'area:' + areaId, tone: 'info', note: stat.pct + '% of all' }),
      statCard({ label: 'Goals', icon: 'target', value: stat.goals,
                 go: 'area:' + areaId, note: stat.goals ? 'In progress' : 'None set' }),
    ].join('');

    D.el('#area-tasks-title').textContent = a.name + ' tasks';
    D.el('#area-tasks').innerHTML = openTasks.length
      ? openTasks.map((t) => taskRow(t, { hideArea: true })).join('') +
        (doneTasks.length
          ? `<div class="daycol"><h3>Completed<span class="n">${doneTasks.length}</span></h3>` +
            doneTasks.slice(-4).reverse().map((t) => taskRow(t, { hideArea: true })).join('') + '</div>'
          : '')
      : emptyState('Nothing open here', 'Add the first ' + a.name.toLowerCase() + ' task.',
                   'Add task', 'new-task-area');

    // Occurrences belonging to this area (classes count as School).
    const items = [];
    for (let i = 0; i < 14 && items.length < 8; i++) {
      const key = D.dayKey(D.addDays(new Date(), i));
      D.Agenda.on(key).forEach((o) => {
        if (o.area === areaId && items.length < 8) items.push(o);
      });
    }
    D.el('#area-timeline').innerHTML = timeline(items, {
      emptyNote: 'No ' + a.name.toLowerCase() + ' events coming up.',
    });

    const goals = D.Goals.inArea(areaId);
    D.el('#area-goals').innerHTML = goals.length
      ? goals.map(goalRow).join('')
      : emptyState('No goals', 'Set a target for ' + a.name + '.', 'Add goal', 'new-goal-area');

    if (areaId === 'school') D.el('#area-classes').innerHTML = courseList();
  }

  // ── Weight log ──────────────────────────────────────────────────────
  let fitnessTab = 'weight';         // weight | peptides | workouts
  let weightRange = 90;              // days; 0 = everything
  let weightRangeChosen = false;     // true once you pick one yourself
  let weightRecentOpen = false;      // Recent starts collapsed; kept across renders

  function renderFitness() {
    D.els('#fitness-tabs button').forEach((b) =>
      b.classList.toggle('on', b.dataset.tab === fitnessTab));

    if (fitnessTab === 'weight')   return renderWeight();
    if (fitnessTab === 'peptides') return renderPeptides();
    if (fitnessTab === 'workouts') return renderWorkouts();
  }

  // Shared by all three Fitness panels: a strip of headline figures.
  function statStrip(cells) {
    return `<div class="wstats">${cells.map((c) => `
      <div class="wstat ${c.tone || ''}">
        <div class="wstat-label">${esc(c.label)}</div>
        <div class="wstat-value">${esc(c.value)}</div>
        <div class="wstat-note">${esc(c.note || '')}</div>
      </div>`).join('')}</div>`;
  }

  // ── Peptides ────────────────────────────────────────────────────────
  let dosesOpen = false;

  function renderPeptides() {
    const P = D.Peptides;
    const today = D.today();
    const protocols = S().protocols;
    const doses = S().doses;
    const box = D.el('#peptide-body');

    if (!protocols.length) {
      box.innerHTML = emptyState('No protocols yet',
        'Add a protocol — compound, dose and how often — and doses get tracked against it.',
        'Add protocol', 'new-protocol');
      return;
    }

    const up = P.upNext();
    const recent30 = doses.filter((x) => x.date > D.dayKey(D.addDays(new Date(), -30)));
    // Adherence across every active protocol, weighted by doses due rather
    // than averaged per protocol — one daily protocol should not be diluted
    // by a weekly one.
    let due = 0, taken = 0;
    P.active().forEach((p) => {
      const a = P.adherence(p, doses, 30, today);
      if (a) { due += a.due; taken += a.taken; }
    });
    const pct = due ? Math.round((taken / due) * 100) : null;

    // Nothing due but a washout just finished is still something to act on,
    // so the lead cell reports that rather than an empty dash.
    const waiting = P.awaitingRestart();
    const ready = waiting.find((r) => r.restart.ready);
    const soonest = waiting[0];
    const lead = up
      ? { label: 'Next due', value: D.dueLabel(up.date), note: up.protocol.compound,
          tone: up.date <= today ? 'warn' : '' }
      : ready
        ? { label: 'Ready to restart', value: ready.protocol.compound,
            note: 'Off period complete', tone: 'good' }
        : soonest
          ? { label: 'Restart', value: D.dueLabel(soonest.restart.date),
              note: soonest.protocol.compound, tone: '' }
          : { label: 'Next due', value: '—', note: 'Nothing scheduled' };

    box.innerHTML = statStrip([
      lead,
      { label: 'Active', value: String(P.active().length),
        note: protocols.length + ' total' },
      { label: 'Adherence', value: pct == null ? '—' : pct + '%',
        note: due ? taken + ' of ' + due + ' in 30 days' : 'Nothing due yet',
        tone: pct == null ? '' : pct >= 80 ? 'good' : 'warn' },
      { label: 'Doses', value: String(recent30.length), note: 'Last 30 days' },
    ]) + protocols.map((p) => protocolRow(p, doses, today)).join('') + `
      <details class="collapse" id="dose-log"${dosesOpen ? ' open' : ''}>
        <summary>
          <span class="chev">${D.icon('chevron', 'ic-sm')}</span>
          <span>Dose log</span><span class="n">${doses.length}</span>
        </summary>
        ${doses.length ? P.doses().slice(0, 30).map((x) => `
          <div class="row">
            <div class="time">${esc(D.fmtDay(x.date))}</div>
            <div class="main">
              <div class="title">${esc(x.compound)}</div>
              <div class="meta">
                <span class="chip">${esc(x.dose + ' ' + x.unit)}</span>
                ${x.site ? `<span>${esc(x.site)}</span>` : ''}
              </div>
            </div>
            <div class="actions">
              <button class="btn sm ghost danger" data-act="dose-del" data-id="${esc(x.id)}">Delete</button>
            </div>
          </div>`).join('') : '<div class="empty" style="padding:14px 16px">No doses logged.</div>'}
      </details>`;

    const det = D.el('#dose-log');
    if (det) det.addEventListener('toggle', () => { dosesOpen = det.open; });
  }

  function protocolRow(p, doses, today) {
    const P = D.Peptides;
    const a = P.adherence(p, doses, 30, today);
    const cyc = P.cycleProgress(p, today);
    const next = P.nextDue(p, doses, today);
    const back = P.restart(p, today);
    const ended = p.endDate && p.endDate < today;
    const paused = p.active === false;

    // Once the cycle is over, the countdown to going again is the useful
    // status — "Finished" on its own tells you nothing you can act on.
    // A run already picked up by a later cycle is history, not a prompt.
    const newer = P.supersededBy(p, S().protocols, today);

    let status = '';
    if (paused) status = '<span class="chip">Paused</span>';
    else if (newer) status = '<span class="chip">Restarted</span>';
    else if (back && back.ready) status = '<span class="chip live">Ready to restart</span>';
    else if (back && !back.running) status = `<span class="chip soon">Restart ${esc(D.dueLabel(back.date))}</span>`;
    else if (ended) status = '<span class="chip">Finished</span>';
    else if (next) status = `<span class="chip ${next <= today ? 'today' : 'soon'}">Due ${esc(D.dueLabel(next))}</span>`;

    // How far through the washout, so the wait is visible rather than just
    // a number of days.
    const washPct = back && !back.running && back.off
      ? Math.max(0, Math.min(100, Math.round(((back.off - back.daysLeft) / back.off) * 100)))
      : 0;

    return `
      <div class="proto">
        <div class="proto-top">
          <span class="proto-name">${esc(p.compound)}</span>
          <span class="chip">${esc(P.format(p))}</span>
          <span class="chip ghost">${esc(P.describe(p))}</span>
          ${status}
          <span class="spacer"></span>
          ${back && back.ready && !newer
            ? `<button class="btn sm primary" data-act="restart-protocol" data-id="${esc(p.id)}">Restart</button>`
            : (!paused && !ended
              ? `<button class="btn sm" data-act="log-dose" data-protocol="${esc(p.id)}">Log</button>` : '')}
          <button class="btn sm ghost" data-act="edit-protocol" data-id="${esc(p.id)}">Edit</button>
        </div>
        ${cyc ? `
          <div class="proto-meter">
            <div class="bar"><i style="width:${cyc.pct}%"></i></div>
            <span class="proto-note">${cyc.done ? 'Cycle complete'
              : 'Day ' + cyc.day + ' of ' + cyc.total}</span>
          </div>` : ''}
        ${back && !back.running ? `
          <div class="proto-meter">
            <div class="bar thin"><i style="width:${washPct}%;background:var(--blue)"></i></div>
            <span class="proto-note">${back.ready ? 'Off period complete'
              : back.daysLeft + ' day' + (back.daysLeft === 1 ? '' : 's') + ' left · ' + esc(D.fmtDayLong(back.date))}</span>
          </div>` : ''}
        ${back && back.running ? `
          <div class="proto-note" style="text-align:left;margin-top:8px">Then ${esc(P.describeOff(p))} —
            back on ${esc(D.fmtDayLong(back.date))}</div>` : ''}
        ${a ? `
          <div class="proto-meter">
            <div class="bar thin"><i style="width:${a.pct}%;background:${a.pct >= 80 ? 'var(--ok)' : 'var(--warn)'}"></i></div>
            <span class="proto-note">${a.taken}/${a.due} taken · 30 days</span>
          </div>` : ''}
      </div>`;
  }

  // ── Workouts ────────────────────────────────────────────────────────
  // Exercise-first, one day at a time: pick a date, pick an exercise, add
  // sets to it. What you did last time and whether a set is a record are
  // shown while you enter, because those are the two things you act on.
  let woDate = null;                 // the day being logged
  let woExercise = null;             // exercise shown in the progress chart
  let woProgressOpen = false;

  function renderWorkouts() {
    const W = D.Workouts;
    if (!woDate) woDate = D.today();

    D.el('#wo-date').textContent =
      woDate === D.today() ? 'Today' : D.fmtDay(woDate);
    D.el('#wo-today').hidden = woDate === D.today();

    const names = W.exercisesOn(S().sets, woDate);
    const daySets = W.setsOn(woDate);
    const wk = W.weekStats(S().sets);
    const box = D.el('#workout-body');

    const day = names.length
      ? names.map((name) => {
          const mine = daySets.filter((s) =>
            s.exercise.trim().toLowerCase() === name.trim().toLowerCase());
          return `
            <div class="row wo-ex-row" data-act="wo-open" data-exercise="${esc(name)}">
              <div class="main">
                <div class="title">${esc(name)}</div>
                <div class="meta">
                  ${mine.map((s) => `<span class="chip">${esc(W.fmtSet(s))}</span>`).join('')}
                </div>
              </div>
              <div class="wo-vol">${esc(W.volume(mine) ? W.fmtVolume(W.volume(mine)) : '')}</div>
              ${D.icon('chevron', 'ic-sm')}
            </div>`;
        }).join('')
      : `<div class="empty" style="padding:30px 16px">
           <strong>Nothing logged ${esc(woDate === D.today() ? 'today' : 'this day')}</strong>
           Add an exercise to start.
           <div style="margin-top:10px">
             <button class="btn sm" data-act="wo-pick-exercise">Add exercise</button>
           </div>
         </div>`;

    box.innerHTML = `
      ${daySets.length ? `<div class="wo-daybar">
        <span>${daySets.length} set${daySets.length === 1 ? '' : 's'}</span>
        <span>${names.length} exercise${names.length === 1 ? '' : 's'}</span>
        <span class="spacer"></span>
        <span>${esc(W.fmtVolume(W.volume(daySets)))}</span>
      </div>` : ''}
      ${day}
      <details class="collapse" id="wo-progress"${woProgressOpen ? ' open' : ''}>
        <summary>
          <span class="chev">${D.icon('chevron', 'ic-sm')}</span>
          <span>Progress</span>
          <span class="n">${wk.days} day${wk.days === 1 ? '' : 's'} this week</span>
        </summary>
        ${progressSection()}
      </details>`;

    const det = D.el('#wo-progress');
    if (det) det.addEventListener('toggle', () => { woProgressOpen = det.open; });
    const pick = D.el('#wo-chart-pick');
    if (pick) pick.addEventListener('change', (ev) => {
      woExercise = ev.target.value;
      renderWorkouts();
      const d = D.el('#wo-progress');
      if (d) d.open = true;
    });
  }

  function progressSection() {
    const W = D.Workouts;
    const all = S().sets;
    const trained = [];
    const seen = {};
    W.sortSets(all).slice().reverse().forEach((s) => {
      const k = s.exercise.trim().toLowerCase();
      if (!seen[k]) { seen[k] = true; trained.push(s.exercise); }
    });

    if (!trained.length) {
      return '<div class="empty" style="padding:20px 16px">Log a few sessions and progress shows here.</div>';
    }
    if (!woExercise || !trained.some((n) =>
      n.trim().toLowerCase() === woExercise.trim().toLowerCase())) woExercise = trained[0];

    const wk = W.weekStats(all);
    const rec = W.records(all, woExercise);
    const points = W.progression(all, woExercise);

    return `
      <div class="wo-progress-head">
        <select id="wo-chart-pick" aria-label="Exercise">
          ${trained.map((n) => `<option value="${esc(n)}"${
            n === woExercise ? ' selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
      </div>
      ${statStrip([
        { label: 'This week', value: String(wk.days),
          note: wk.sets + ' sets · ' + W.fmtVolume(wk.volume), tone: wk.days ? 'good' : '' },
        { label: 'Best set', value: rec && rec.maxWeight ? W.fmtWeight(rec.maxWeight.weight) : '—',
          note: rec && rec.maxWeight ? rec.maxWeight.reps + ' reps · ' + D.fmtDayLong(rec.maxWeight.date) : 'No data' },
        { label: 'Est. 1RM', value: rec && rec.best ? W.fmtWeight(rec.best.e1rm) : '—',
          note: rec && rec.best ? W.fmtSet(rec.best.set) + ' · ' + D.fmtDayLong(rec.best.set.date) : 'No data' },
        { label: 'Best session', value: rec && rec.maxVolume ? W.fmtVolume(rec.maxVolume.volume) : '—',
          note: rec && rec.maxVolume ? D.fmtDayLong(rec.maxVolume.date) : 'No data' },
      ])}
      ${progressionChart(points)}`;
  }

  // Reuses the weight chart's geometry: progression points are already
  // { date, value }, which is exactly what it plots.
  function progressionChart(points) {
    if (points.length < 2) {
      return `<div class="empty" style="padding:24px 16px">${points.length
        ? 'One session with this lift — log it again to see progression.'
        : 'Nothing to chart yet.'}</div>`;
    }
    const CW = 640, CH = 150, PAD = 14;
    const p = D.Weight.plot(points, { w: CW, h: CH, pad: PAD });
    const last = p.points[p.points.length - 1];
    return `
      <div class="wchart">
        <svg viewBox="0 0 ${CW} ${CH}" preserveAspectRatio="none" role="img"
             aria-label="Estimated one-rep max over time">
          <defs>
            <linearGradient id="wograd" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--accent)" stop-opacity=".22"/>
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="${p.area}" fill="url(#wograd)"/>
          <path d="${p.line}" class="wline" vector-effect="non-scaling-stroke"/>
          ${p.points.map((pt) => `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="2.5" class="wdot">
            <title>${esc(D.fmtDay(pt.e.date) + ' · ' + D.Workouts.fmtWeight(pt.e.value))}</title></circle>`).join('')}
          <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4.5" class="wdot last"/>
        </svg>
        <div class="wscale">
          <span>${esc(D.Workouts.fmtWeight(p.yMax))}</span>
          <span>${esc(D.Workouts.fmtWeight(p.yMin))}</span>
        </div>
        <div class="wdates">
          <span>${esc(D.fmtDayLong(points[0].date))}</span>
          <span>${esc(D.fmtDayLong(points[points.length - 1].date))}</span>
        </div>
      </div>`;
  }

  // Until you choose a range, show the narrowest one that actually holds a
  // trend. Defaulting to 90 days meant two readings months apart drew a
  // blank chart while the readings sat right there in the list below.
  function autoWeightRange() {
    if (weightRangeChosen) return;
    const all = D.Weight.all();
    weightRange = [30, 90, 365].find((d) => D.Weight.windowed(all, d).length >= 2) || 0;
  }

  function renderWeight() {
    autoWeightRange();
    D.els('#weight-range button').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.days) === weightRange));

    const s = D.Weight.stats();
    const box = D.el('#weight-body');

    if (!s.count) {
      box.innerHTML = emptyState('No readings yet',
        'Log your first weight above and the trend builds from there.');
      return;
    }

    const W = D.Weight;
    // A drop is the good direction here, so falling weight reads as positive.
    const tone = (v) => v == null ? '' : v < 0 ? 'good' : v > 0 ? 'warn' : '';
    const cell = (label, value, note, t) => `
      <div class="wstat ${t || ''}">
        <div class="wstat-label">${esc(label)}</div>
        <div class="wstat-value">${esc(value)}</div>
        <div class="wstat-note">${esc(note || '')}</div>
      </div>`;

    const shown = W.windowed(W.all(), weightRange || null);
    // The note names the reading actually compared against, so the figure
    // can never imply a span the log does not cover.
    const since = (from) => from ? 'since ' + D.fmtDayLong(from) : 'Not enough history';
    const stats = [
      cell('Current', W.format(s.current.value), D.dueLabel(s.current.date)),
      cell('7 days',  s.change7 == null ? '—' : W.delta(s.change7) + ' ' + W.unit(),
           since(s.change7From), tone(s.change7)),
      cell('30 days', s.change30 == null ? '—' : W.delta(s.change30) + ' ' + W.unit(),
           since(s.change30From), tone(s.change30)),
      s.target != null
        ? cell('To target', W.format(Math.abs(s.toGo)),
               s.toGo > 0 ? 'to lose' : s.toGo < 0 ? 'to gain' : 'reached', tone(s.toGo))
        : cell('All time', s.changeAll == null ? '—' : W.delta(s.changeAll) + ' ' + W.unit(),
               s.count + ' readings', tone(s.changeAll)),
    ].join('');

    // Newest first, and capped: the chart is the overview, this is the
    // receipts. Anything older stays in the export rather than the DOM.
    const RECENT_CAP = 30;
    const recent = W.all().slice().reverse();
    const older = Math.max(0, recent.length - RECENT_CAP);

    box.innerHTML = `
      <div class="wstats">${stats}</div>
      ${weightChart(shown, s)}
      <details class="collapse" id="weight-recent"${weightRecentOpen ? ' open' : ''}>
        <summary>
          <span class="chev">${D.icon('chevron', 'ic-sm')}</span>
          <span>Recent</span>
          <span class="n">${s.count}</span>
        </summary>
        ${recent.slice(0, RECENT_CAP).map((e) => `
          <div class="row">
            <div class="time">${esc(D.fmtDay(e.date))}</div>
            <div class="main"><div class="title">${esc(W.format(e.value))}</div></div>
            <div class="actions">
              <button class="btn sm ghost danger" data-act="weight-del"
                      data-id="${esc(e.id)}" aria-label="Delete reading">Delete</button>
            </div>
          </div>`).join('')}
        ${older ? `<div class="empty" style="padding:10px 16px">${older} earlier reading${older === 1 ? '' : 's'} not shown</div>` : ''}
      </details>`;

    // <details> is rebuilt on every render, so its open state has to be kept
    // outside the DOM or logging a reading would snap it shut again.
    const det = D.el('#weight-recent');
    if (det) det.addEventListener('toggle', () => { weightRecentOpen = det.open; });
  }

  function weightChart(rows, s) {
    if (rows.length < 2) {
      // Distinguish "you have not logged enough" from "your readings are
      // further apart than this range" — the fix differs.
      const total = D.Weight.all().length;
      return `<div class="empty" style="padding:26px 16px">${total >= 2
        ? '<strong>No trend in this range</strong>Your readings are further apart — try a longer one.'
        : '<strong>One reading so far</strong>Log another and the line starts here.'}</div>`;
    }
    const W = 640, H = 170, PAD = 14;
    const p = D.Weight.plot(rows, { w: W, h: H, pad: PAD, target: s.target });
    const last = p.points[p.points.length - 1];

    return `
      <div class="wchart">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
             aria-label="Weight over the selected range">
          <defs>
            <linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stop-color="var(--accent)" stop-opacity=".22"/>
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="${p.area}" fill="url(#wgrad)"/>
          ${p.targetY != null ? `<line x1="0" y1="${p.targetY.toFixed(1)}"
             x2="${W}" y2="${p.targetY.toFixed(1)}" class="wtarget"/>` : ''}
          <path d="${p.line}" class="wline" vector-effect="non-scaling-stroke"/>
          ${p.points.map((pt) =>
            `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="2.5" class="wdot">
               <title>${esc(D.fmtDay(pt.e.date) + ' · ' + D.Weight.format(pt.e.value))}</title>
             </circle>`).join('')}
          <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4.5" class="wdot last"/>
        </svg>
        <div class="wscale">
          <span>${esc(D.Weight.format(p.yMax))}</span>
          <span>${esc(D.Weight.format(p.yMin))}</span>
        </div>
        <div class="wdates">
          <span>${esc(D.fmtDayLong(rows[0].date))}</span>
          <span>${esc(D.fmtDayLong(rows[rows.length - 1].date))}</span>
        </div>
      </div>`;
  }

  // ── Sports ──────────────────────────────────────────────────────────
  function renderSports() {
    const favs = S().settings.favTeams;
    D.el('#fav-list').innerHTML = favs.length
      ? favs.map((f) => `
        <span class="pill">
          ${f.logo ? `<img src="${esc(f.logo)}" alt="">` : ''}
          ${esc(f.name)}
          <button data-act="unfav" data-key="${esc(f.key)}" data-team="${esc(f.teamId)}"
                  aria-label="Remove ${esc(f.name)}">${D.icon('close')}</button>
        </span>`).join(' ')
      : '<p class="hint">No teams yet. Use <b>Add team</b> to follow one.</p>';


    const box  = D.el('#sports-body');
    const tabs = D.el('#sports-tabs');

    // Tabs render even while loading, so the control does not pop in late.
    // No counts here: each rail reports its own "4 of 4", and a combined
    // total across every team would contradict what those labels say.
    tabs.innerHTML = !favs.length ? '' : [
      ['recent', 'Results'], ['upcoming', 'Upcoming'],
    ].map(([id, label]) => `
      <button data-act="sports-tab" data-tab="${id}" class="${sportsTab === id ? 'on' : ''}"
              aria-pressed="${sportsTab === id ? 'true' : 'false'}">${label}</button>`).join('');

    if (!favs.length) { box.innerHTML = '<div class="empty">Follow a team to see fixtures and results.</div>'; return; }
    if (sportsError)  { box.innerHTML = `<div class="empty">${esc(sportsError)}</div>`; return; }
    if (!sportsCache) { box.innerHTML = '<div class="empty">Loading…</div>'; return; }

    const sec = (label, rows) => rows.length
      ? `<div class="daycol"><h3>${esc(label)}<span class="n">${rows.length}</span></h3>${rows.map(gameRow).join('')}</div>`
      : '';

    // One rail per followed team. Each team's games form their own
    // chronological sequence — oldest result on the left, furthest fixture on
    // the right — so swiping past a team's newest result lands on that same
    // team's next fixture.
    railData = favs.map((f) => {
      // A club's season spans several competitions, so match on any of them —
      // not just the league it was followed under, which would drop every cup
      // tie. Scoping to that team's competitions also stops an id collision
      // in another sport from landing here.
      const comps = new Set(D.Sports.competitionsFor(f.key));
      const mine = (g) => comps.has(g.leagueKey) &&
        (String(g.home.id) === String(f.teamId) || String(g.away.id) === String(f.teamId));
      const results  = sportsCache.recent.filter(mine).slice().reverse();  // oldest → newest
      const live     = sportsCache.live.filter(mine);
      const upcoming = sportsCache.upcoming.filter(mine);

      // Records come from the scoreboard, which backs fixtures; the team
      // schedule that supplies results returns `records: null`. So read it
      // once and show it under the team name rather than per game, where it
      // would appear on some slides and not others.
      //
      // A record is per COMPETITION — a club carries a separate one for its
      // league, its cup and Europe — so take it only from a fixture in the
      // league the team was followed under, and name that league beside it.
      const sideOf = (g) =>
        String(g.home.id) === String(f.teamId) ? g.home : g.away;
      const inLeague = live.concat(upcoming).filter((g) => g.leagueKey === f.key);
      const record = (inLeague.map(sideOf).find((s) => s.record) || {}).record || '';
      const recordIn = record ? (D.Sports.league(f.key) || {}).name || '' : '';

      return {
        id: f.key + ':' + f.teamId,
        fav: f,
        record,
        recordIn,
        timeline: results.concat(live, upcoming),
        nResults: results.length,
        nLive: live.length,
        nUpcoming: upcoming.length,
      };
    });

    box.innerHTML = railData.map(teamBlock).join('') ||
      '<div class="empty">No games found for these teams.</div>';

    railData.forEach((r) => {
      const rail = railEl(r.id);
      if (!rail) return;
      rail.addEventListener('scroll', () => onRailScroll(r.id), { passive: true });
      rail.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowRight') { ev.preventDefault(); railStep(r.id, 1); }
        if (ev.key === 'ArrowLeft')  { ev.preventDefault(); railStep(r.id, -1); }
      });
      // Restore position across re-renders; otherwise land on a live game if
      // there is one, else the newest result — the pivot between past and
      // future, one swipe from either.
      const saved = railPos[r.id];
      const landing = r.nLive ? r.nResults : Math.max(0, r.nResults - 1);
      railScrollTo(r.id, saved != null ? Math.min(saved, r.timeline.length - 1) : landing, false);
      syncRail(r.id);
    });
  }

  // ── Game rails ────────────────────────────────────────────────────────
  let railData = [];
  const railPos = {};          // rail id → slide index, kept across re-renders

  function railById(id) { return railData.find((r) => r.id === id); }

  function teamBlock(r) {
    const f = r.fav;
    const head = `
      <div class="teamblock-head">
        ${f.logo ? `<img src="${esc(f.logo)}" alt="" loading="lazy">` : ''}
        <span class="tb-id">
          <span class="nm">${esc(f.name)}</span>
          ${r.record ? `<span class="rec">${esc(r.record)}${
            r.recordIn ? ` <span class="in">${esc(r.recordIn)}</span>` : ''}</span>` : ''}
        </span>
        ${r.nLive ? '<span class="chip live">Live</span>' : ''}
        <span class="spacer"></span>
      </div>`;

    if (!r.timeline.length) {
      return `<section class="teamblock">${head}
        <div class="empty" style="padding:12px 16px">No games found for this team.</div>
      </section>`;
    }

    return `
      <section class="teamblock">
        ${head}
        <div class="railwrap">
          <div class="gamerail" data-rail="${esc(r.id)}" tabindex="0" role="group"
               aria-label="${esc(f.name)} games, oldest to furthest ahead">
            ${r.timeline.map(gameSlide).join('')}
          </div>
          <div class="railticks">
            ${r.timeline.map(() => '<i></i>').join('')}
          </div>
          <div class="railbar">
            <button class="railbtn prev" data-act="rail-step" data-rail="${esc(r.id)}" data-dir="-1"
                    aria-label="Previous ${esc(f.name)} game">${D.icon('chevron', 'ic-sm')}</button>
            <span class="pos" aria-live="polite"></span>
            <button class="railbtn next" data-act="rail-step" data-rail="${esc(r.id)}" data-dir="1"
                    aria-label="Next ${esc(f.name)} game">${D.icon('chevron', 'ic-sm')}</button>
          </div>
        </div>
      </section>`;
  }

  function gameSlide(g) {
    const post = g.state === 'post';
    const side = (s, other) => {
      const mine = s.score != null ? Number(s.score) : null;
      const theirs = other.score != null ? Number(other.score) : null;
      const lost = post && mine != null && theirs != null && mine < theirs;
      const won  = post && mine != null && theirs != null && mine > theirs;
      return `
        <div class="gs-side ${lost ? 'lost' : ''} ${won ? 'won' : ''}">
          ${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy">`
                   : '<span style="width:30px"></span>'}
          <span class="nm">${esc(s.name)}</span>
          ${g.state !== 'pre' && s.score != null ? `<span class="sc">${esc(s.score)}</span>` : ''}
        </div>`;
    };

    const status = g.state === 'in'
      ? `<span class="chip live">${esc(g.detail || 'LIVE')}</span>`
      : post ? '<span class="chip">Final</span>'
             : `<span class="chip soon">${esc(D.dueLabel(g.dayKey))}</span>`;

    const when = g.state === 'pre'
      ? D.fmtDay(g.dayKey) + ' · ' + D.fmtTime(new Date(g.date))
      : D.fmtDay(g.dayKey);

    return `
      <article class="gameslide">
        <div class="gs-top">
          <span>${esc(g.league)}</span>
          <span class="spacer"></span>
          ${post
            // Once a game is played the broadcaster is no use — the highlights are.
            ? `<a class="recap" href="${esc(D.Sports.recapUrl(g))}"
                  target="_blank" rel="noopener noreferrer"
                  aria-label="Watch highlights of ${esc(g.away.name)} against ${esc(g.home.name)} on YouTube"
               >${D.icon('play', 'ic-sm')}Recap</a>`
            : g.network ? `<span>${esc(g.network)}</span>` : ''}
        </div>
        <div class="gs-teams">
          ${side(g.away, g.home)}
          ${side(g.home, g.away)}
        </div>
        <div class="gs-foot">
          ${status}
          <span class="when">${esc(when)}</span>
          ${g.venue ? `<span>${esc(g.venue)}</span>` : ''}
        </div>
      </article>`;
  }

  // The rail element specifically — the step buttons carry the same id, so an
  // unqualified [data-rail] lookup can return a button.
  function railEl(id) { return D.el('.gamerail[data-rail="' + id + '"]'); }

  // Slide pitch is NOT reliably clientWidth: a sub-pixel difference between
  // the two compounds across the track, so by slide 20 `i * clientWidth`
  // lands between snap points and the scroll silently goes nowhere. Measure
  // the real offsets instead.
  function slideOffsets(rail) {
    const left = rail.getBoundingClientRect().left - rail.scrollLeft;
    return Array.prototype.map.call(rail.children,
      (c) => c.getBoundingClientRect().left - left);
  }

  function railIndexOf(rail) {
    const offs = slideOffsets(rail);
    if (!offs.length) return 0;
    let best = 0, bestD = Infinity;
    offs.forEach((o, i) => {
      const d = Math.abs(o - rail.scrollLeft);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function railScrollTo(id, i, smooth) {
    const rail = railEl(id);
    if (!rail) return;
    const offs = slideOffsets(rail);
    const n = Math.max(0, Math.min(offs.length - 1, i));
    railPos[id] = n;
    rail.scrollTo({ left: offs[n], behavior: smooth ? 'smooth' : 'auto' });
  }

  function railStep(id, dir) {
    const r = railById(id);
    if (!r) return;
    const at = railPos[id] || 0;
    railScrollTo(id, Math.max(0, Math.min(r.timeline.length - 1, at + dir)), true);
  }

  const railRaf = {};
  function onRailScroll(id) {
    if (railRaf[id]) return;
    railRaf[id] = requestAnimationFrame(() => { railRaf[id] = 0; syncRail(id); });
  }

  // Scroll is the source of truth for where a rail sits. The Results/Upcoming
  // control is a command that moves every rail; its highlight only follows the
  // rails when they all agree, so it never contradicts what is on screen.
  function syncRail(id) {
    const r = railById(id);
    const rail = railEl(id);
    if (!r || !rail || !rail.clientWidth || !r.timeline.length) return;

    const i = railIndexOf(rail);
    railPos[id] = i;

    // Look these up through the wrapper rather than by id: rail ids contain
    // dots and colons, which need escaping in a selector and are easy to get
    // wrong. Structure is cheaper to keep correct.
    const wrap = rail.closest('.railwrap');
    const label = D.el('.pos', wrap);
    if (label) {
      let section, n, of;
      if (i < r.nResults) {
        section = 'Results';  n = i + 1;                        of = r.nResults;
      } else if (i < r.nResults + r.nLive) {
        section = 'Live';     n = i - r.nResults + 1;           of = r.nLive;
      } else {
        section = 'Upcoming'; n = i - r.nResults - r.nLive + 1; of = r.nUpcoming;
      }
      label.innerHTML = '<b>' + n + '</b> of ' + of + ' · ' + section;
    }

    D.els('.railticks i', wrap).forEach((t, n) => {
      t.classList.toggle('on', n === i);
      t.classList.toggle('past', n < i);
    });

    const prev = D.el('.railbtn.prev', wrap), next = D.el('.railbtn.next', wrap);
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === r.timeline.length - 1;

    syncSportsTabs();
  }

  // Light the tab only when every rail sits on the same side of its own
  // boundary, so the control never contradicts what is actually on screen.
  function syncSportsTabs() {
    if (!railData.length) return;
    const sides = railData.filter((r) => r.timeline.length).map((r) => {
      const i = railPos[r.id] || 0;
      return i >= r.nResults + r.nLive ? 'upcoming' : 'recent';
    });
    if (!sides.length || !sides.every((s) => s === sides[0])) return;
    if (sides[0] === sportsTab) return;
    sportsTab = sides[0];
    D.els('#sports-tabs button').forEach((b) => {
      const on = b.dataset.tab === sportsTab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // Drop cached games that no longer involve a favorite. The refetch after a
  // team change is a network round trip; without this the removed team's
  // fixtures stay on screen until it lands.
  function pruneSportsCache() {
    if (!sportsCache) return;
    Object.keys(railPos).forEach((k) => delete railPos[k]);   // timelines changed
    const ids = new Set(S().settings.favTeams.map((f) => f.key + ':' + f.teamId));
    const keep = (g) => ids.has(g.leagueKey + ':' + g.home.id) ||
                        ids.has(g.leagueKey + ':' + g.away.id);
    sportsCache = {
      live:     sportsCache.live.filter(keep),
      upcoming: sportsCache.upcoming.filter(keep),
      recent:   sportsCache.recent.filter(keep),
    };
  }

  async function loadSports(force) {
    const favs = S().settings.favTeams;
    if (!favs.length) { sportsCache = null; sportsError = null; return; }
    try {
      sportsError = null;
      sportsCache = await D.Sports.forFavorites(favs, { force });
    } catch (e) {
      console.error(e);
      sportsError = 'Could not reach ESPN. Check your connection.';
    }
    if (view === 'overview') renderOverviewSports();
    if (view === 'sports')   renderSports();
  }

  let pickerTeams = [];
  const PICKER_CAP = 60;

  // The team picker is a long list, so it stays collapsed until asked for.
  // The league list is loaded lazily on first open rather than at boot.
  let pickerLoaded = false;

  function setPicker(open) {
    const card = D.el('#picker-card');
    const btn  = D.el('#picker-toggle');
    card.hidden = !open;
    // Adding a team is its own mode: the fixtures below are irrelevant while
    // you are picking, and hiding them means the picker owns the whole page
    // rather than sitting on top of a long list you have to scroll past.
    D.el('#fixtures-card').hidden = open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.innerHTML = open
      ? D.icon('close') + '<span class="lbl">Done</span>'
      : D.icon('plus') + '<span class="lbl">Add team</span>';
    if (!open) return;
    if (!pickerLoaded) { pickerLoaded = true; renderPicker(D.el('#league-select').value || 'esp.1'); }
    const search = D.el('#team-search');
    setTimeout(() => { search.focus(); card.scrollIntoView({ block: 'nearest' }); }, 30);
  }

  async function renderPicker(leagueKey) {
    const grid = D.el('#team-grid');
    grid.innerHTML = '<div class="empty">Loading teams…</div>';
    D.el('#team-search').value = '';
    try {
      pickerTeams = await D.Sports.teams(leagueKey);
      drawPicker('');
    } catch (e) {
      pickerTeams = [];
      grid.innerHTML = '<div class="empty">Could not load that league.</div>';
    }
  }

  function drawPicker(query) {
    const grid = D.el('#team-grid');
    const q = query.trim().toLowerCase();
    const matches = q
      ? pickerTeams.filter((t) => t.name.toLowerCase().includes(q) ||
                                  t.abbrev.toLowerCase().includes(q))
      : pickerTeams;
    if (!matches.length) {
      grid.innerHTML = '<div class="empty">No team matches that.</div>';
      D.el('#picker-count').textContent = '0 teams';
      return;
    }

    const favs = S().settings.favTeams;
    const isFav = (t) => favs.some((f) => f.key === t.key && f.teamId === t.teamId);
    const shown = matches.slice(0, PICKER_CAP);
    grid.innerHTML = shown.map((t) => `
      <button class="${isFav(t) ? 'on' : ''}" data-act="fav" data-team='${esc(JSON.stringify(t))}'>
        ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : ''}
        <span>${esc(t.name)}</span>
      </button>`).join('');
    // Sits in the card header now, so it has to stay short.
    D.el('#picker-count').textContent = matches.length > shown.length
      ? shown.length + ' of ' + matches.length
      : matches.length + ' teams';
  }

  // ── Sync ────────────────────────────────────────────────────────────
  const SYNC_WORDS = {
    off:          ['Not set up',  'muted'],
    'signed-out': ['Signed out',  'muted'],
    idle:         ['Up to date',  'ok'],
    syncing:      ['Syncing…',    'muted'],
    offline:      ['Offline',     'warn'],
    error:        ['Sync problem','late'],
  };

  // Set between "send me a code" and typing it in. Kept in memory only:
  // it is half of a sign-in, and it should not outlive the page.
  let syncPending = '';

  function renderCloud() {
    const body = D.el('#sync-body');
    const state = D.el('#sync-state');
    if (!body) return;
    const C = D.Cloud;
    const st = C.status;
    const word = SYNC_WORDS[st.phase] || ['', 'muted'];
    state.textContent = word[0];
    state.className = 'count ' + word[1];

    if (!C.configured) {
      body.innerHTML = `
        <p class="hint" style="margin-top:0">
          This dashboard is running on this device alone. To reach it from your
          phone as well, create a Supabase project, run
          <code>supabase/schema.sql</code> in its SQL editor, and paste the
          project URL and anon key into <code>js/config.js</code>.
        </p>`;
      return;
    }

    if (!C.signedIn && syncPending) {
      // inputmode + autocomplete: on a phone this brings up the number pad
      // and offers the code straight from the notification.
      body.innerHTML = `
        <p class="hint" style="margin-top:0">
          Sent to <b>${esc(syncPending)}</b>. Enter the 6-digit code from that email.
        </p>
        <label class="field"><span>Code</span>
          <input type="text" id="sync-code" inputmode="numeric" maxlength="6"
                 autocomplete="one-time-code" placeholder="123456"></label>
        <div style="display:flex; gap:8px; flex-wrap:wrap">
          <button class="btn primary" data-act="cloud-verify">Sign in</button>
          <button class="btn ghost" data-act="cloud-restart">Use a different email</button>
        </div>`;
      return;
    }

    if (!C.signedIn) {
      body.innerHTML = `
        <label class="field" style="margin-top:0"><span>Email</span>
          <input type="email" id="sync-email" placeholder="you@example.com"
                 autocomplete="email"></label>
        <button class="btn primary" data-act="cloud-signin">Email me a code</button>
        ${st.phase === 'offline' ? '<p class="hint">No connection right now — the dashboard still works; sign in when you are back online.</p>' : ''}
        <p class="hint">
          No password. A 6-digit code arrives by email and this device stays
          signed in afterwards. Sign in the same way on your phone to have
          both hold the same dashboard.
        </p>`;
      return;
    }

    const last = st.at ? new Date(st.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    body.innerHTML = `
      <p class="hint" style="margin-top:0">
        Signed in as <b>${esc(st.email)}</b>${last ? ' · last synced ' + esc(last) : ''}
      </p>
      ${st.phase === 'error' ? `<p class="hint late">${esc(st.message)}</p>` : ''}
      ${st.phase === 'offline' ? '<p class="hint">Offline — changes are saved here and go up when the connection returns.</p>' : ''}
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px">
        <button class="btn" data-act="cloud-sync">Sync now</button>
        <button class="btn ghost" data-act="cloud-signout">Sign out</button>
      </div>
      <p class="hint">
        Calendar feed URLs stay on this device and are never uploaded: one of
        those URLs is enough to read your calendar without signing in.
      </p>`;
  }

  // ── Backup ──────────────────────────────────────────────────────────
  // Set once at startup by the persistence request, so the panel can say
  // whether the browser has agreed to keep this data or merely not to
  // delete it yet.
  let persisted = null;

  // localStorage is capped somewhere near 5 MB in every browser that
  // matters. Warn well before it, because the failure mode is a save that
  // does not happen rather than an error you would notice.
  const STORE_CAP = 5 * 1024 * 1024;
  const WARN_AT = 0.7;
  const STALE_DAYS = 14;

  function fmtSize(n) {
    return n < 1024 ? n + ' B'
         : n < 1024 * 1024 ? (n / 1024).toFixed(0) + ' KB'
         : (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function renderBackup() {
    const box = D.el('#backup-status');
    const hint = D.el('#backup-hint');
    if (!box) return;

    const size = S().dataSize();
    const last = S().device.lastExportAt;
    const days = last ? D.daysBetween(D.dayKey(new Date(last)), D.today()) : null;
    const synced = D.Cloud.signedIn;

    const rows = [];

    // How long since the only copy you can read without this browser.
    if (last === null) {
      rows.push(['late', 'Never exported'
        + (synced ? '' : ' — this browser holds the only copy of your data')]);
    } else if (days >= STALE_DAYS) {
      rows.push(['late', 'Last exported ' + days + ' days ago']);
    } else {
      rows.push(['', 'Last exported ' + (days === 0 ? 'today' : days + 'd ago')]);
    }

    // Headroom, measured against the cap that actually bites.
    const pct = size / STORE_CAP;
    rows.push([pct >= WARN_AT ? 'late' : '',
      fmtSize(size) + ' stored'
      + (pct >= WARN_AT ? ' — near the ~5 MB browser limit' : '')]);

    // Whether the browser has agreed to keep it.
    if (persisted === true) {
      rows.push(['', 'Storage marked persistent']);
    } else if (persisted === false) {
      rows.push(['warn', 'The browser may clear this data to free space']);
    }

    box.innerHTML = '<div class="backup-stats">' + rows.map(([cls, text]) =>
      `<span class="hint ${cls}">${esc(text)}</span>`).join('') + '</div>';

    if (hint) {
      hint.textContent = synced
        ? 'Your data is on this device and in your Supabase project. An export is still '
          + 'the only copy that survives losing both, and the only one you can read '
          + 'without either.'
        : 'This device holds the only copy. Export to a file your phone actually keeps — '
          + 'iCloud Drive or Google Drive — because a replaced phone or cleared browser '
          + 'takes everything else with it.';
    }
  }

  // ── Settings ────────────────────────────────────────────────────────
  function renderSettings() {
    renderCloud();
    renderBackup();
    const s = S().settings;
    D.el('#set-name').value   = s.name || '';
    D.el('#set-proxy').value  = s.proxyUrl || '';
    D.el('#set-target').value = s.weeklyTarget || 15;
    D.el('#set-theme').value  = s.theme || 'system';
    D.el('#set-wunit').value  = s.weightUnit || 'lb';
    D.el('#set-wtarget').value = s.weightTarget == null ? '' : s.weightTarget;

    const srcs = s.sources || {};
    D.el('#source-rows').innerHTML = Object.keys(D.Sync.providers).map((n) => {
      const p = D.Sync.providers[n];
      const cfg = srcs[n] || {};
      return `
        <label class="field"><span>${esc(p.label)} feed URL</span>
          <input type="url" id="src-${esc(n)}" value="${esc(cfg.url || '')}"
                 placeholder="${esc(p.placeholder || 'https://…')}"></label>
        <div style="display:flex;gap:8px;align-items:center;margin:-6px 0 16px;flex-wrap:wrap">
          <button class="btn sm" data-act="sync" data-src="${esc(n)}">Sync</button>
          <button class="btn sm ghost" data-act="paste-feed" data-src="${esc(n)}">Paste</button>
          <span class="hint">${cfg.lastSync
            ? 'Last synced ' + esc(new Date(cfg.lastSync).toLocaleString())
            : 'Not synced'}</span>
        </div>`;
    }).join('');
  }

  // ── Theme ───────────────────────────────────────────────────────────
  function applyTheme() {
    let t = S().settings.theme || 'system';
    if (t === 'system') {
      t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
    const dark = t === 'dark';
    D.el('#theme-toggle').innerHTML =
      D.icon(dark ? 'sun' : 'moon') + '<span>' + (dark ? 'Light mode' : 'Dark mode') + '</span>';
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', dark ? '#070C16' : '#0F1A2C');
  }

  // ── Modal ───────────────────────────────────────────────────────────
  function openModal(title, bodyHTML, onSave, extra) {
    D.el('#modal-title').textContent = title;
    D.el('#modal-body').innerHTML = bodyHTML;
    D.el('#modal-back').classList.add('open');
    D.el('#modal-del').hidden = !(extra && extra.onDelete);
    D.el('#modal-back')._save = onSave;
    D.el('#modal-back')._del  = extra && extra.onDelete;
    const first = D.el('#modal-body input, #modal-body textarea, #modal-body select');
    if (first) setTimeout(() => first.focus(), 40);
  }
  function closeModal() { D.el('#modal-back').classList.remove('open'); }

  function areaOptions(sel) {
    return '<option value="">No area</option>' + S().areas.map((a) =>
      `<option value="${esc(a.id)}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  }

  function taskForm(t) {
    t = t || {};
    return `
      <label class="field"><span>Title</span>
        <input type="text" id="f-title" value="${esc(t.title || '')}" placeholder="What needs doing?"></label>
      <div class="field-row">
        <label class="field"><span>Area</span>
          <select id="f-area">${areaOptions(t.area)}</select></label>
        <label class="field"><span>Due</span>
          <input type="date" id="f-due" value="${esc(t.due || '')}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Priority</span>
          <select id="f-pri">
            <option value="0" ${!t.priority ? 'selected' : ''}>Normal</option>
            <option value="1" ${t.priority === 1 ? 'selected' : ''}>Medium</option>
            <option value="2" ${t.priority === 2 ? 'selected' : ''}>High</option>
          </select></label>
        <label class="field"><span>Class (School)</span>
          <select id="f-course"><option value="">— none —</option>${
            S().courses.map((c) => `<option value="${esc(c.id)}" ${t.course === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')
          }</select></label>
      </div>
      <label class="field"><span>Notes</span>
        <textarea id="f-notes" placeholder="Optional">${esc(t.notes || '')}</textarea></label>`;
  }

  function readTaskForm() {
    const title = D.el('#f-title').value.trim();
    if (!title) { D.toast('Give it a title'); return null; }
    return {
      title,
      area:     D.el('#f-area').value || null,
      due:      D.el('#f-due').value || null,
      priority: Number(D.el('#f-pri').value) || 0,
      course:   D.el('#f-course').value || null,
      notes:    D.el('#f-notes').value.trim(),
    };
  }

  function hhmm(d) {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function eventForm(e) {
    e = e || {};
    const start = e.start ? new Date(e.start) : null;
    const end   = e.end ? new Date(e.end) : null;
    const kinds = ['meeting', 'appointment', 'personal', 'event'];
    return `
      <label class="field"><span>Title</span>
        <input type="text" id="f-title" value="${esc(e.title || '')}" placeholder="Advisor meeting"></label>
      <div class="field-row">
        <label class="field"><span>Type</span>
          <select id="f-kind">${kinds.map((k) =>
            `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${D.KIND_LABEL[k]}</option>`).join('')}</select></label>
        <label class="field"><span>Area</span>
          <select id="f-area">${areaOptions(e.area)}</select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Date</span>
          <input type="date" id="f-date" value="${start ? esc(D.dayKey(start)) : esc(D.today())}"></label>
        <label class="field"><span>Start</span>
          <input type="time" id="f-start" value="${start ? esc(hhmm(start)) : '09:00'}"></label>
        <label class="field"><span>End</span>
          <input type="time" id="f-end" value="${end ? esc(hhmm(end)) : ''}"></label>
      </div>
      <label class="field"><span>Location</span>
        <input type="text" id="f-loc" value="${esc(e.location || '')}" placeholder="Optional"></label>`;
  }

  function readEventForm() {
    const title = D.el('#f-title').value.trim();
    if (!title) { D.toast('Give it a title'); return null; }
    const date = D.el('#f-date').value;
    if (!date) { D.toast('Pick a date'); return null; }
    const start = D.el('#f-start').value || '09:00';
    const end   = D.el('#f-end').value;
    return {
      title,
      kind:     D.el('#f-kind').value,
      area:     D.el('#f-area').value || null,
      start:    new Date(date + 'T' + start).toISOString(),
      end:      end ? new Date(date + 'T' + end).toISOString() : null,
      location: D.el('#f-loc').value.trim(),
      allDay:   false,
    };
  }

  function courseForm(c) {
    c = c || {};
    const m = (c.meetings && c.meetings[0]) || {};
    const days = m.days || [];
    return `
      <label class="field"><span>Class name</span>
        <input type="text" id="f-name" value="${esc(c.name || '')}" placeholder="Organic Chemistry"></label>
      <div class="field-row">
        <label class="field"><span>Code</span>
          <input type="text" id="f-code" value="${esc(c.code || '')}" placeholder="CHEM 201"></label>
        <label class="field"><span>Room</span>
          <input type="text" id="f-loc" value="${esc(c.location || '')}" placeholder="Sci 118"></label>
      </div>
      <label class="field"><span>Meets on</span>
        <div class="dow">${D.DOW_SHORT.map((d, i) =>
          `<label><input type="checkbox" class="f-day" value="${i}" ${days.includes(i) ? 'checked' : ''}><span>${d[0]}</span></label>`).join('')}</div>
      </label>
      <div class="field-row">
        <label class="field"><span>Start</span>
          <input type="time" id="f-start" value="${esc(m.start || '09:00')}"></label>
        <label class="field"><span>End</span>
          <input type="time" id="f-end" value="${esc(m.end || '10:15')}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Term starts</span>
          <input type="date" id="f-from" value="${esc(c.startDate || '')}"></label>
        <label class="field"><span>Term ends</span>
          <input type="date" id="f-to" value="${esc(c.endDate || '')}"></label>
      </div>
      <label class="field"><span>Instructor</span>
        <input type="text" id="f-inst" value="${esc(c.instructor || '')}" placeholder="Optional"></label>`;
  }

  function readCourseForm() {
    const name = D.el('#f-name').value.trim();
    if (!name) { D.toast('Give the class a name'); return null; }
    const days = D.els('.f-day:checked').map((c) => Number(c.value));
    return {
      name,
      code:       D.el('#f-code').value.trim(),
      location:   D.el('#f-loc').value.trim(),
      instructor: D.el('#f-inst').value.trim(),
      startDate:  D.el('#f-from').value || null,
      endDate:    D.el('#f-to').value || null,
      meetings:   days.length ? [{
        days,
        start: D.el('#f-start').value || '09:00',
        end:   D.el('#f-end').value || null,
      }] : [],
    };
  }

  function goalForm(g) {
    g = g || {};
    return `
      <label class="field"><span>Goal</span>
        <input type="text" id="f-title" value="${esc(g.title || '')}" placeholder="Run 40 miles"></label>
      <div class="field-row">
        <label class="field"><span>Area</span>
          <select id="f-area">${areaOptions(g.area)}</select></label>
        <label class="field"><span>Type</span>
          <select id="f-kind">
            <option value="count" ${g.kind !== 'tasks' ? 'selected' : ''}>I update it myself</option>
            <option value="tasks" ${g.kind === 'tasks' ? 'selected' : ''}>Track this area&rsquo;s tasks</option>
          </select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Current</span>
          <input type="number" id="f-current" value="${esc(g.current != null ? g.current : 0)}"></label>
        <label class="field"><span>Target</span>
          <input type="number" id="f-target" value="${esc(g.target != null ? g.target : 10)}"></label>
        <label class="field"><span>Unit</span>
          <input type="text" id="f-unit" value="${esc(g.unit || '')}" placeholder="miles"></label>
      </div>`;
  }

  function readGoalForm() {
    const title = D.el('#f-title').value.trim();
    if (!title) { D.toast('Name the goal'); return null; }
    return {
      title,
      area:    D.el('#f-area').value || null,
      kind:    D.el('#f-kind').value,
      current: Number(D.el('#f-current').value) || 0,
      target:  Number(D.el('#f-target').value) || 1,
      unit:    D.el('#f-unit').value.trim(),
    };
  }



  const PALETTE = ['#3B6BD4', '#0D8A7B', '#B4692F', '#8B6FD6', '#2C7F55', '#BC423C'];

  // ── Actions ─────────────────────────────────────────────────────────
  const ACTIONS = {
    goto(el) { route(el.dataset.view); },
    'goto-sports'() { route('sports'); },
    'open-menu'() { D.el('#sidebar').classList.add('open'); D.el('#scrim').classList.add('on'); },

    async 'toggle-task'(el) {
      const t = S().tasks.find((x) => x.id === el.dataset.id);
      if (!t) return;
      await S().update('tasks', t.id, {
        done: !t.done,
        doneAt: !t.done ? new Date().toISOString() : null,
      });
      buildNav(); render();
    },

    'new-task'() {
      openModal('New task', taskForm(), async () => {
        const rec = readTaskForm();
        if (!rec) return;
        await S().add('tasks', Object.assign({ done: false }, rec));
        closeModal(); buildNav(); render(); D.toast('Task added');
      });
    },

    'new-task-area'() {
      openModal('New task', taskForm({ area: areaId }), async () => {
        const rec = readTaskForm();
        if (!rec) return;
        await S().add('tasks', Object.assign({ done: false }, rec));
        closeModal(); buildNav(); render(); D.toast('Task added');
      });
    },

    'edit-task'(el) {
      const t = S().tasks.find((x) => x.id === el.dataset.id);
      if (!t) return;
      openModal('Edit task', taskForm(t), async () => {
        const rec = readTaskForm();
        if (!rec) return;
        await S().update('tasks', t.id, rec);
        closeModal(); buildNav(); render();
      }, { onDelete: async () => {
        await S().remove('tasks', t.id);
        closeModal(); buildNav(); render(); D.toast('Deleted');
      }});
    },

    'new-event'() {
      openModal('New event', eventForm({ area: areaId }), async () => {
        const rec = readEventForm();
        if (!rec) return;
        await S().add('events', rec);
        closeModal(); render(); D.toast('Event added');
      });
    },

    'edit-event'(el) {
      const e = S().events.find((x) => x.id === el.dataset.id);
      if (!e) return;
      openModal('Edit event', eventForm(e), async () => {
        const rec = readEventForm();
        if (!rec) return;
        await S().update('events', e.id, rec);
        closeModal(); render();
      }, { onDelete: async () => {
        await S().remove('events', e.id);
        closeModal(); render(); D.toast('Deleted');
      }});
    },

    'new-course'() {
      openModal('New class', courseForm(), async () => {
        const rec = readCourseForm();
        if (!rec) return;
        rec.color = PALETTE[S().courses.length % PALETTE.length];
        await S().add('courses', rec);
        closeModal(); render(); D.toast('Class added');
      });
    },

    'edit-course'(el) {
      const c = S().courses.find((x) => x.id === el.dataset.id);
      if (!c) return;
      openModal('Edit class', courseForm(c), async () => {
        const rec = readCourseForm();
        if (!rec) return;
        await S().update('courses', c.id, rec);
        closeModal(); render();
      }, { onDelete: async () => {
        await S().remove('courses', c.id);
        closeModal(); render(); D.toast('Deleted');
      }});
    },

    'new-goal'()      { newGoal(null); },
    'new-goal-area'() { newGoal(areaId); },

    'edit-goal'(el) {
      const g = S().goals.find((x) => x.id === el.dataset.id);
      if (!g) return;
      openModal('Edit goal', goalForm(g), async () => {
        const rec = readGoalForm();
        if (!rec) return;
        await S().update('goals', g.id, rec);
        closeModal(); render();
      }, { onDelete: async () => {
        await S().remove('goals', g.id);
        closeModal(); render(); D.toast('Deleted');
      }});
    },

    filter(el) { taskFilter = el.dataset.filter; renderTasks(); },

    // Paging months only redraws the grid — the week list stays put, so the
    // thing you were reading does not vanish while you look ahead.
    'cal-month'(el) {
      calCursor = new Date(calCursor.getFullYear(),
                           calCursor.getMonth() + Number(el.dataset.dir), 1);
      renderMonthGrid();
    },

    'cal-today'() {
      const now = new Date();
      calSelected = D.today();
      calCursor = new Date(now.getFullYear(), now.getMonth(), 1);
      renderCalendar();
    },

    // Return to the top FIRST, instantly, and only then put the grid back.
    // Expanding while scrolled down meant the scroll-to-top animation ran
    // with the collapse rule live, which folded it away again mid-flight —
    // and re-inserting content above the viewport also makes the browser
    // adjust scrollTop, which reads as a downward scroll. At zero, neither
    // can happen.
    'fitness-tab'(el) { fitnessTab = el.dataset.tab; renderArea(); },

    // ── Peptides ──────────────────────────────────────────────────────
    'new-protocol'() { protocolModal(null); },
    'edit-protocol'(el) {
      protocolModal(S().protocols.find((p) => p.id === el.dataset.id) || null);
    },

    'log-dose'(el) {
      const P = D.Peptides;
      const list = S().protocols;
      if (!list.length) return D.toast('Add a protocol first');

      // Default to the protocol whose dose is actually outstanding.
      const up = P.upNext();
      const preset = el.dataset.protocol || (up && up.protocol.id) || list[0].id;
      const chosen = list.find((p) => p.id === preset) || list[0];
      const due = P.nextDue(chosen, S().doses, D.today());

      openModal('Log dose', `
        <label class="field"><span>Protocol</span>
          <select id="f-proto">${list.map((p) =>
            `<option value="${esc(p.id)}"${p.id === chosen.id ? ' selected' : ''}>${
              esc(p.compound + ' · ' + P.format(p))}</option>`).join('')}</select></label>
        <div class="field-row">
          <label class="field"><span>Date</span>
            <input type="date" id="f-ddate" value="${esc(due && due <= D.today() ? due : D.today())}"></label>
          <label class="field"><span>Dose</span>
            <input type="number" id="f-ddose" step="any" min="0" value="${esc(chosen.dose ?? '')}"></label>
          <label class="field"><span>Unit</span>
            <select id="f-dunit">${P.UNITS.map((u) =>
              `<option value="${u}"${u === (chosen.unit || 'mg') ? ' selected' : ''}>${u}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Site (optional)</span>
          <input type="text" id="f-dsite" placeholder="e.g. left delt"></label>`,
        async () => {
          const p = S().protocols.find((x) => x.id === D.el('#f-proto').value);
          const dose = Number(D.el('#f-ddose').value);
          if (!p) return D.toast('Pick a protocol');
          if (!isFinite(dose) || dose <= 0) return D.toast('Enter a dose');
          await S().add('doses', {
            protocolId: p.id, compound: p.compound,
            date: D.el('#f-ddate').value || D.today(),
            dose, unit: D.el('#f-dunit').value,
            site: D.el('#f-dsite').value.trim(), note: '',
          });
          closeModal(); renderFitness(); D.toast('Dose logged');
        });

      // Switching protocol refills the dose it prescribes.
      D.el('#f-proto').addEventListener('change', (ev) => {
        const p = S().protocols.find((x) => x.id === ev.target.value);
        if (!p) return;
        D.el('#f-ddose').value = p.dose ?? '';
        D.el('#f-dunit').value = p.unit || 'mg';
      });
    },

    // Start the same protocol again: carry its settings over into a NEW
    // cycle rather than editing the old one, so the finished run and its
    // dose history stay intact as a record.
    'restart-protocol'(el) {
      const p = S().protocols.find((x) => x.id === el.dataset.id);
      if (!p) return;
      const len = (p.startDate && p.endDate)
        ? D.daysBetween(p.startDate, p.endDate) + 1 : 0;
      protocolModal({
        compound: p.compound, dose: p.dose, unit: p.unit,
        freq: p.freq, everyN: p.everyN, days: (p.days || []).slice(),
        offValue: p.offValue, offUnit: p.offUnit,
        active: true,
        startDate: D.today(),
        endDate: len ? D.dayKey(D.addDays(new Date(), len - 1)) : null,
      });
    },

    async 'dose-del'(el) {
      await S().remove('doses', el.dataset.id);
      renderFitness();
    },

    // ── Workouts ──────────────────────────────────────────────────────
    'wo-day'(el) {
      woDate = D.dayKey(D.addDays(D.parseDayKey(woDate || D.today()),
                                  Number(el.dataset.dir)));
      renderWorkouts();
    },
    'wo-today'() { woDate = D.today(); renderWorkouts(); },

    'wo-pick-exercise'() { exercisePicker(); },
    'wo-open'(el) { setEntry(el.dataset.exercise); },

    'ex-cat'(el) {
      exCat = el.dataset.cat;
      D.els('#ex-cats button, #ex-cats2 button').forEach((b) =>
        b.classList.toggle('on', b.dataset.cat === exCat));
      drawExerciseList(D.el('#ex-search').value, exCat);
    },

    'ex-choose'(el) {
      const name = el.dataset.name;
      closeModal();
      // Straight into logging: choosing an exercise is not the goal, adding
      // a set to it is.
      setTimeout(() => setEntry(name), 60);
    },

    // Anything not in the catalogue is almost certainly a real exercise
    // under a name I did not seed, so keep it — but ask where it belongs
    // rather than dumping everything into "Other".
    'ex-new'(el) {
      const E = D.Exercises;
      const typed = (el && el.dataset.name) ||
                    (D.el('#ex-search') || {}).value || '';
      // If a category tab is showing, that is almost certainly the one
      // meant — "Mine" excepted, since that is not a real category.
      const guess = exCat && exCat !== '__custom' ? exCat : 'Other';

      openModal('New exercise', `
        <label class="field"><span>Name</span>
          <input type="text" id="f-exname" value="${esc(typed.trim())}"
                 placeholder="e.g. Zercher Squat"></label>
        <div class="field-row">
          <label class="field"><span>Category</span>
            <select id="f-excat">
              ${E.CATEGORIES.map((c) =>
                `<option value="${esc(c)}"${c === guess ? ' selected' : ''}>${esc(c)}</option>`).join('')}
              <option value="Other"${guess === 'Other' ? ' selected' : ''}>Other</option>
            </select></label>
          <label class="field"><span>Records</span>
            <select id="f-exkind">
              <option value="lift">Weight &amp; reps</option>
              <option value="bodyweight">Reps (bodyweight)</option>
              <option value="cardio">Time &amp; distance</option>
            </select></label>
        </div>
        <p class="hint">Category decides which tab it appears under.
          Records decides what a set asks you for — and cannot be changed later
          without the old sets no longer matching, so pick it now.</p>`,
        async () => {
          const name = D.el('#f-exname').value.trim();
          if (!name) return D.toast('Name it first');
          const existing = E.find(name);
          if (existing) {
            closeModal();
            D.toast(existing.name + ' already exists');
            return setTimeout(() => setEntry(existing.name), 60);
          }
          // Read the fields BEFORE closing — closeModal empties the body,
          // and querying them afterwards returns null.
          const category = D.el('#f-excat').value;
          await S().add('exercises', {
            name, category, kind: D.el('#f-exkind').value,
          });
          closeModal();
          D.toast('Added to ' + category);
          setTimeout(() => setEntry(name), 60);
        });

      setTimeout(() => { const f = D.el('#f-exname'); if (f) f.focus(); }, 40);
    },

    // Adds a set WITHOUT closing: sets come in runs, and reopening the
    // dialog between each one is the whole friction this avoids.
    async 'wo-log-set'() {
      const name = D.el('#wo-entry').dataset.exercise;
      const kind = D.Exercises.kindOf(name);
      const num = (sel) => Number((D.el(sel) || {}).value) || 0;

      const rec = { date: woDate, exercise: name };
      if (kind === 'cardio') {
        rec.duration = num('#f-dur'); rec.distance = num('#f-dist');
        if (!rec.duration && !rec.distance) return D.toast('Enter a time or distance');
      } else {
        rec.weight = num('#f-w'); rec.reps = num('#f-r');
        if (!rec.reps) return D.toast('Enter reps');
      }
      await S().add('sets', rec);
      setEntry(name, { keep: true });     // stay open, ready for the next set
      renderWorkouts();
    },

    async 'wo-del-one'(el) {
      const name = D.el('#wo-entry').dataset.exercise;
      await S().remove('sets', el.dataset.id);
      setEntry(name, { keep: true });
      renderWorkouts();
    },

    // Repeat the set above — the common case when you are working straight
    // through a prescription like 3×8.
    'wo-repeat'(el) {
      const w = D.el('#f-w'), r = D.el('#f-r');
      if (w) w.value = el.dataset.weight || '';
      if (r) r.value = el.dataset.reps || '';
      ACTIONS['wo-log-set']();
    },

    'weight-range'(el) {
      weightRange = Number(el.dataset.days);
      weightRangeChosen = true;      // your pick now outranks the auto-fit
      renderWeight();
    },

    'log-weight'() {
      const s = D.Weight.stats();
      openModal('Log weight', `
        <div class="field-row">
          <label class="field"><span>Weight (${esc(D.Weight.unit())})</span>
            <input type="number" id="f-w" step="0.1" min="0" max="2000"
                   inputmode="decimal" placeholder="${esc(s.count ? s.current.value : '')}"></label>
          <label class="field"><span>Date</span>
            <input type="date" id="f-wdate" value="${esc(D.today())}"></label>
        </div>
        <p class="hint">Logging a date you have already recorded replaces that
        reading rather than adding a second one.</p>`,
        async () => {
          const field = D.el('#f-w');
          const value = Number(field.value);
          if (!field.value || !isFinite(value) || value <= 0) return D.toast('Enter a weight');
          await S().setWeight(D.el('#f-wdate').value || D.today(), value, '');
          closeModal(); renderWeight(); D.toast('Logged');
        });
    },

    async 'weight-del'(el) {
      await S().remove('weights', el.dataset.id);
      renderWeight();
    },

    'cal-expand'() {
      window.scrollTo({ top: 0, behavior: 'auto' });
      calCollapsed = false;
      renderCalendar();
    },

    'cal-day'(el) {
      calSelected = el.dataset.key;
      const d = D.parseDayKey(calSelected);
      // Clicking a trailing day of an adjacent month follows it there.
      if (d.getMonth() !== calCursor.getMonth() ||
          d.getFullYear() !== calCursor.getFullYear()) {
        calCursor = new Date(d.getFullYear(), d.getMonth(), 1);
      }
      renderCalendar();
    },
    // Tabs jump to the edge of their section nearest the boundary: Results
    // lands on the newest result, Upcoming on the soonest fixture, so the two
    // are always one swipe apart.
    // The tabs move every team's rail at once, each to the edge of its own
    // section nearest its boundary: Results lands on that team's newest
    // result, Upcoming on its soonest fixture.
    'sports-tab'(el) {
      const want = el.dataset.tab;
      sportsTab = want;
      D.els('#sports-tabs button').forEach((b) => {
        const on = b.dataset.tab === want;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      railData.forEach((r) => {
        if (!r.timeline.length) return;
        const target = want === 'upcoming'
          ? Math.min(r.nResults + r.nLive, r.timeline.length - 1)
          : Math.max(0, r.nResults - 1);
        railScrollTo(r.id, target, true);
        syncRail(r.id);
      });
    },

    'rail-step'(el) { railStep(el.dataset.rail, Number(el.dataset.dir)); },

    async fav(el) {
      const t = JSON.parse(el.dataset.team);
      const favs = S().settings.favTeams.slice();
      const i = favs.findIndex((f) => f.key === t.key && f.teamId === t.teamId);
      if (i > -1) favs.splice(i, 1); else favs.push(t);
      await S().saveSettings({ favTeams: favs });
      pruneSportsCache();
      renderSports();
      if (pickerTeams.length) drawPicker(D.el('#team-search').value);
      loadSports(true);
    },

    async unfav(el) {
      const favs = S().settings.favTeams.filter(
        (f) => !(f.key === el.dataset.key && f.teamId === el.dataset.team));
      await S().saveSettings({ favTeams: favs });
      pruneSportsCache();
      renderSports();
      if (pickerTeams.length) drawPicker(D.el('#team-search').value);
      loadSports(true);
    },

    'refresh-sports'() { D.toast('Refreshing scores…'); loadSports(true); },

    'toggle-picker'() { setPicker(D.el('#picker-card').hidden); },


    async sync(el) {
      const name = el.dataset.src;
      const url = D.el('#src-' + name).value.trim();
      const sources = Object.assign({}, S().settings.sources);
      sources[name] = Object.assign({}, sources[name], { url });
      await S().saveSettings({ sources });
      if (!url) return D.toast('Add a feed URL first');
      D.toast('Syncing ' + name + '…');
      try {
        const r = await D.Sync.run(name);
        D.toast('Imported ' + r.tasks + ' tasks, ' + r.events + ' events');
        buildNav(); render();
      } catch (e) { D.toast(e.message); }
    },

    async 'sync-all'() {
      const cfgs = S().settings.sources || {};
      const any = Object.keys(cfgs).some((n) => cfgs[n] && cfgs[n].url);
      if (!any) { route('settings'); return D.toast('Add a calendar feed first'); }
      D.toast('Syncing calendars…');
      const report = await D.Sync.runAll();
      const ok = report.filter((r) => r.ok);
      const bad = report.filter((r) => !r.ok);
      buildNav(); render();
      D.toast(bad.length
        ? ok.length + ' synced, ' + bad.length + ' failed — see Settings'
        : 'Synced ' + ok.length + ' calendar' + (ok.length === 1 ? '' : 's'));
    },

    'paste-assignments'() {
      pasteParsed = null;
      openModal('Paste assignments', `
        <p class="hint">Copy the whole Canvas grades or assignments page and paste
        it below — names, categories and due dates are picked out automatically.
        Canvas times are read as <b>Eastern</b> and converted to
        <b>${esc(D.Canvas.localZone())}</b>.</p>
        <label class="field" style="margin-top:13px"><span>Pasted page</span>
          <textarea id="f-paste" style="min-height:120px"
                    placeholder="Paste the page here…"></textarea></label>
        <div id="paste-preview"></div>`,
        async () => {
          if (!pasteParsed || !pasteParsed.items.length) return D.toast('Nothing to import');
          const r = await importAssignments(pasteParsed);
          closeModal(); buildNav(); render();
          D.toast(r.added + ' added' + (r.updated ? ', ' + r.updated + ' updated' : ''));
        });

      const ta = D.el('#f-paste');
      const update = () => {
        pasteParsed = ta.value.trim() ? D.Canvas.parse(ta.value) : null;
        drawPastePreview();
      };
      ta.addEventListener('input', update);
      ta.addEventListener('paste', () => setTimeout(update, 0));
    },

    'paste-feed'(el) {
      const name = el.dataset.src;
      openModal('Paste ' + name + ' feed', `
        <p class="hint">Open the feed URL in a browser tab, select all, and paste it here.
        Useful for a one-off import, or when no proxy is configured.</p>
        <label class="field" style="margin-top:12px"><span>.ics contents</span>
          <textarea id="f-ics" style="min-height:170px" placeholder="BEGIN:VCALENDAR…"></textarea></label>`,
        async () => {
          const text = D.el('#f-ics').value.trim();
          if (!text) return D.toast('Nothing pasted');
          try {
            const r = await D.Sync.ingestText(name, text);
            closeModal(); buildNav(); render();
            D.toast('Imported ' + r.tasks + ' tasks, ' + r.events + ' events');
          } catch (e) { D.toast(e.message); }
        });
    },

    async export() {
      const blob = new Blob([S().exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dashboard-backup-' + D.today() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      // Recorded on the way out rather than on success: a browser gives no
      // callback for a download, so the honest claim is "you asked for one
      // on this date", which is what the panel says.
      await S().noteExport();
      renderBackup();
    },

    import() { D.el('#import-file').click(); },

    // ── Sync ──────────────────────────────────────────────────────────
    async 'cloud-signin'() {
      const input = D.el('#sync-email');
      const email = (input ? input.value : '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return D.toast('Enter your email address');
      const btn = D.el('[data-act=cloud-signin]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      try {
        await D.Cloud.signIn(email);
        syncPending = email;
        renderCloud();
      } catch (e) {
        D.toast(e.message || 'Could not send the code');
        renderCloud();
      }
    },

    async 'cloud-verify'() {
      const code = (D.el('#sync-code').value || '').replace(/\D/g, '');
      if (code.length < 6) return D.toast('Enter the 6-digit code');
      const btn = D.el('[data-act=cloud-verify]');
      if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
      try {
        await D.Cloud.verify(syncPending, code);
        syncPending = '';
        renderCloud();
        D.toast('Signed in — syncing');
      } catch (e) {
        D.toast(e.message || 'That code did not work');
        renderCloud();
      }
    },

    'cloud-restart'() { syncPending = ''; renderCloud(); },

    async 'cloud-signout'() {
      await D.Cloud.signOut();
      renderCloud();
      D.toast('Signed out — your data is still on this device');
    },

    async 'cloud-sync'() {
      D.toast('Syncing…');
      await D.Cloud.sync();
    },
  };

  // ── Peptide + workout dialogs ───────────────────────────────────────
  // `p` with an id edits it; `p` without one prefills a new protocol
  // (that is how "restart" hands over the previous cycle's settings).
  function protocolModal(p) {
    const P = D.Peptides;
    const it = p || { freq: 'daily', everyN: 3, days: [], unit: 'mg',
                      startDate: D.today(), active: true };

    // A cycle is thought of as "8 weeks", not "ends 1 November", so the form
    // takes a length and derives the end date. A protocol saved before this
    // only has an end date, so read it back into whichever unit divides
    // evenly rather than showing 56 when 8 weeks was meant.
    const len = (() => {
      if (it.lenValue) return { value: it.lenValue, unit: it.lenUnit || 'weeks' };
      if (it.startDate && it.endDate) {
        const days = D.daysBetween(it.startDate, it.endDate) + 1;
        if (days > 0) {
          return days % 7 === 0
            ? { value: days / 7, unit: 'weeks' }
            : { value: days, unit: 'days' };
        }
      }
      return { value: null, unit: 'weeks' };
    })();

    // Start + length → last day on. Shared by the live hint and the save.
    const endFrom = (startDate, value, unit) => {
      const n = Number(value);
      if (!isFinite(n) || n <= 0 || !startDate) return null;
      const days = unit === 'days' ? Math.round(n) : Math.round(n * 7);
      return D.dayKey(D.addDays(D.parseDayKey(startDate), days - 1));
    };

    openModal(p && p.id ? 'Edit protocol' : 'New protocol', `
      <label class="field"><span>Compound</span>
        <input type="text" id="f-comp" value="${esc(it.compound || '')}"
               placeholder="e.g. BPC-157"></label>
      <div class="field-row">
        <label class="field"><span>Dose</span>
          <input type="number" id="f-pdose" step="any" min="0" value="${esc(it.dose ?? '')}"></label>
        <label class="field"><span>Unit</span>
          <select id="f-punit">${P.UNITS.map((u) =>
            `<option value="${u}"${u === (it.unit || 'mg') ? ' selected' : ''}>${u}</option>`).join('')}</select></label>
        <label class="field"><span>Frequency</span>
          <select id="f-freq">${P.FREQS.map((f) =>
            `<option value="${f.id}"${f.id === it.freq ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>
      </div>

      <label class="field" id="f-everyN-wrap"><span>Every how many days</span>
        <input type="number" id="f-everyN" min="1" max="60" value="${esc(it.everyN || 3)}"></label>

      <label class="field" id="f-days-wrap"><span>Days</span>
        <div class="dow">${D.DOW_SHORT.map((d, i) =>
          `<label><input type="checkbox" class="f-pday" value="${i}"${
            (it.days || []).includes(i) ? ' checked' : ''}><span>${d[0]}</span></label>`).join('')}</div>
      </label>

      <div class="field-row">
        <label class="field"><span>Starts</span>
          <input type="date" id="f-pstart" value="${esc(it.startDate || D.today())}"></label>
        <label class="field"><span>Runs for</span>
          <input type="number" id="f-plen" min="1" max="520" placeholder="Optional"
                 value="${esc(len.value ?? '')}"></label>
        <label class="field"><span>&nbsp;</span>
          <select id="f-plenunit">
            <option value="weeks"${len.unit !== 'days' ? ' selected' : ''}>Weeks</option>
            <option value="days"${len.unit === 'days' ? ' selected' : ''}>Days</option>
          </select></label>
      </div>
      <p class="hint" id="f-end-hint" style="margin:-8px 0 14px"></p>

      <div class="field-row">
        <label class="field"><span>Time off after</span>
          <input type="number" id="f-off" min="0" max="365" placeholder="Optional"
                 value="${esc(it.offValue ?? '')}"></label>
        <label class="field"><span>&nbsp;</span>
          <select id="f-offunit">
            <option value="days"${it.offUnit !== 'weeks' ? ' selected' : ''}>Days</option>
            <option value="weeks"${it.offUnit === 'weeks' ? ' selected' : ''}>Weeks</option>
          </select></label>
      </div>
      <p class="hint" id="f-off-hint" style="margin:-8px 0 14px"></p>
      <label class="field"><span>Status</span>
        <select id="f-pactive">
          <option value="1"${it.active !== false ? ' selected' : ''}>Active</option>
          <option value="0"${it.active === false ? ' selected' : ''}>Paused</option>
        </select></label>`,
      async () => {
        const compound = D.el('#f-comp').value.trim();
        if (!compound) return D.toast('Name the compound');
        const freq = D.el('#f-freq').value;
        const days = D.els('.f-pday:checked').map((c) => Number(c.value));
        if (freq === 'weekdays' && !days.length) return D.toast('Pick at least one day');

        const rec = {
          compound,
          dose: D.el('#f-pdose').value === '' ? null : Number(D.el('#f-pdose').value),
          unit: D.el('#f-punit').value,
          freq,
          everyN: Math.max(1, Number(D.el('#f-everyN').value) || 1),
          days,
          startDate: D.el('#f-pstart').value || D.today(),
          // The length is what you set; the end date is derived from it and
          // stored too, so everything downstream keeps reading one field.
          lenValue: D.el('#f-plen').value === '' ? null : Number(D.el('#f-plen').value),
          lenUnit: D.el('#f-plenunit').value,
          endDate: endFrom(D.el('#f-pstart').value || D.today(),
                           D.el('#f-plen').value, D.el('#f-plenunit').value),
          offValue: D.el('#f-off').value === '' ? null : Number(D.el('#f-off').value),
          offUnit: D.el('#f-offunit').value,
          active: D.el('#f-pactive').value === '1',
        };
        if (p && p.id) await S().update('protocols', p.id, rec);
        else await S().add('protocols', rec);
        closeModal(); renderFitness(); D.toast(p && p.id ? 'Protocol updated' : 'Protocol added');
      },
      p && p.id ? { onDelete: async () => {
        // The doses stay: they record what actually went in, and deleting
        // the plan should not erase the history.
        await S().remove('protocols', p.id);
        closeModal(); renderFitness(); D.toast('Protocol removed — doses kept');
      } } : null);

    const sync = () => {
      const f = D.el('#f-freq').value;
      D.el('#f-everyN-wrap').hidden = f !== 'everyN';
      D.el('#f-days-wrap').hidden = f !== 'weekdays';

      // Both dates the inputs imply are shown live, so the counting
      // conventions are visible rather than something to discover later.
      const start = D.el('#f-pstart').value;
      const end = endFrom(start, D.el('#f-plen').value, D.el('#f-plenunit').value);
      D.el('#f-end-hint').textContent = end
        ? 'Last dose ' + D.fmtDay(end) + '.'
        : 'Leave blank to run with no end date.';

      const off = { offValue: Number(D.el('#f-off').value), offUnit: D.el('#f-offunit').value };
      const days = P.offDays(off);
      D.el('#f-off-hint').textContent = !days
        ? 'Set a length and a gap to be told when you can start again.'
        : !end ? 'Needs a length — the gap is counted from your last dose.'
        : 'Counted from the last dose: back on ' +
          D.fmtDay(D.dayKey(D.addDays(D.parseDayKey(end), days))) + '.';
    };
    ['#f-freq', '#f-pstart', '#f-plen', '#f-plenunit', '#f-off', '#f-offunit'].forEach((sel) =>
      D.el(sel).addEventListener('input', sync));
    D.el('#f-freq').addEventListener('change', sync);
    sync();
  }

  // Pick what you are about to do. Recent lifts first, because day to day
  // you rotate through a handful; the full catalogue is behind search and
  // the category filter.
  function exercisePicker() {
    const E = D.Exercises;
    const recent = E.recent(8);

    openModal('Add exercise', `
      <input type="text" id="ex-search" placeholder="Search exercises…"
             autocomplete="off" aria-label="Search exercises">
      <div class="segmented tabbar" id="ex-cats" style="margin:10px 0 4px">
        <button data-act="ex-cat" data-cat="" class="on">All</button>
        ${E.CATEGORIES.slice(0, 4).map((c) =>
          `<button data-act="ex-cat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
      <div class="segmented tabbar" id="ex-cats2" style="margin:0 0 10px">
        ${E.CATEGORIES.slice(4).map((c) =>
          `<button data-act="ex-cat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
        <button data-act="ex-cat" data-cat="__custom">Mine</button>
      </div>
      ${recent.length ? `<div class="ex-recent">
        ${recent.map((n) => `<button class="chip-btn" data-act="ex-choose"
          data-name="${esc(n)}">${esc(n)}</button>`).join('')}
      </div>` : ''}
      <div class="ex-list" id="ex-list"></div>
      <div class="ex-foot">
        <button class="btn sm" data-act="ex-new">${D.icon('plus', 'ic-sm')}New exercise</button>
        <span class="spacer"></span>
        <span class="hint" id="ex-count"></span>
      </div>`,
      // Footer Save is not the way in — you choose by tapping a name.
      () => closeModal());

    D.el('#modal-save').hidden = true;
    drawExerciseList('', '');
    const search = D.el('#ex-search');
    search.addEventListener('input', () => drawExerciseList(search.value, exCat));
    setTimeout(() => search.focus(), 40);
  }

  let exCat = '';

  function drawExerciseList(query, category) {
    const E = D.Exercises;
    let rows;
    if (category === '__custom') {
      rows = E.all().filter((e) => !e.builtIn);
    } else {
      rows = query ? E.search(query) : E.byCategory(category, '');
      if (query && category) rows = rows.filter((e) => e.category === category);
    }
    // Offer to create whatever was typed unless it already exists exactly.
    // Waiting for zero results was wrong: "Bench Press (Paused)" keeps the
    // real Bench Press on screen, so the offer would never appear.
    const typed = String(query || '').trim();
    const exact = typed && D.Exercises.find(typed);
    const create = typed && !exact ? `
      <button class="ex-row ex-create" data-act="ex-new" data-name="${esc(typed)}">
        ${D.icon('plus', 'ic-sm')}
        <span class="ex-name">Add &ldquo;${esc(typed)}&rdquo;</span>
        <span class="ex-cat">New</span>
      </button>` : '';

    D.el('#ex-list').innerHTML = create + rows.map((e) => `
      <button class="ex-row" data-act="ex-choose" data-name="${esc(e.name)}">
        <span class="ex-name">${esc(e.name)}</span>
        <span class="ex-cat">${esc(e.category)}${e.builtIn ? '' : ' · yours'}</span>
      </button>`).join('');

    D.el('#ex-count').textContent = rows.length
      ? rows.length + (rows.length === 1 ? ' exercise' : ' exercises')
      : (typed ? 'No match' : 'None yet');
  }

  // The logging screen for one exercise on one day. What you did last time
  // and your records sit above the inputs, because those are what you are
  // trying to beat.
  function setEntry(name, opts) {
    const W = D.Workouts;
    const already = D.el('#wo-entry');
    const body = setEntryBody(name);

    if (opts && opts.keep && already && already.dataset.exercise === name) {
      D.el('#modal-body').innerHTML = body;      // keep the dialog in place
    } else {
      openModal(name, body, () => closeModal());
      D.el('#modal-save').hidden = false;
      D.el('#modal-save').textContent = 'Done';
    }

    const kind = D.Exercises.kindOf(name);
    const first = D.el(kind === 'cardio' ? '#f-dur' : '#f-w');
    if (first) setTimeout(() => first.focus(), 40);
  }

  function setEntryBody(name) {
    const W = D.Workouts;
    const kind = D.Exercises.kindOf(name);
    const all = S().sets;
    const today = W.onDate(all, woDate).filter((s) =>
      s.exercise.trim().toLowerCase() === name.trim().toLowerCase());
    const prev = W.lastTime(all, name, woDate);
    const rec = W.records(all, name);

    const inputs = kind === 'cardio'
      ? `<div class="field-row">
           <label class="field"><span>Minutes</span>
             <input type="number" id="f-dur" step="any" min="0" inputmode="decimal"></label>
           <label class="field"><span>Distance</span>
             <input type="number" id="f-dist" step="any" min="0" inputmode="decimal"></label>
         </div>`
      : `<div class="field-row">
           <label class="field"><span>Weight (${esc(W.unit())})</span>
             <input type="number" id="f-w" step="any" min="0" inputmode="decimal"
                    value="${esc(today.length ? today[today.length - 1].weight : '')}"></label>
           <label class="field"><span>Reps</span>
             <input type="number" id="f-r" step="1" min="0" inputmode="numeric"
                    value="${esc(today.length ? today[today.length - 1].reps : '')}"></label>
         </div>`;

    return `
      <div id="wo-entry" data-exercise="${esc(name)}">
        ${prev ? `
          <div class="wo-last">
            <div class="wo-last-head">Last time · ${esc(D.fmtDay(prev.date))}</div>
            <div class="wo-last-sets">
              ${prev.sets.map((s) => `<button class="chip-btn" data-act="wo-repeat"
                 data-weight="${esc(s.weight ?? '')}" data-reps="${esc(s.reps ?? '')}"
                 title="Log this again">${esc(W.fmtSet(s))}</button>`).join('')}
            </div>
          </div>` : '<p class="hint">First time logging this one.</p>'}

        ${rec && rec.best ? `<div class="wo-pr">
          <span><b>${esc(W.fmtWeight(rec.maxWeight.weight))}</b> best set</span>
          <span><b>${esc(W.fmtWeight(rec.best.e1rm))}</b> est. 1RM</span>
          <span><b>${esc(W.fmtVolume(rec.maxVolume ? rec.maxVolume.volume : 0))}</b> best day</span>
        </div>` : ''}

        ${inputs}
        <button class="btn primary" data-act="wo-log-set"
                style="width:100%;margin:2px 0 14px">Add set</button>

        <div class="wo-today-head">${esc(woDate === D.today() ? 'Today' : D.fmtDay(woDate))}
          <span class="n">${today.length} set${today.length === 1 ? '' : 's'}</span></div>
        ${today.length ? today.map((s, i) => {
          const pr = W.wouldBeRecord(all.filter((x) => x.id !== s.id), name, s);
          return `
            <div class="wo-set-row">
              <span class="wo-n">${i + 1}</span>
              <span class="wo-val">${esc(W.fmtSet(s))}</span>
              ${pr.weight || pr.e1rm ? '<span class="chip live">PR</span>' : ''}
              <span class="spacer"></span>
              <button class="btn sm ghost danger" data-act="wo-del-one"
                      data-id="${esc(s.id)}" aria-label="Remove set">${D.icon('close', 'ic-sm')}</button>
            </div>`;
        }).join('') : '<div class="empty" style="padding:12px">No sets yet.</div>'}
      </div>`;
  }

  function newGoal(area) {
    openModal('New goal', goalForm({ area }), async () => {
      const rec = readGoalForm();
      if (!rec) return;
      await S().add('goals', rec);
      closeModal(); render(); D.toast('Goal added');
    });
  }

  // ── Pasted assignments ──────────────────────────────────────────────
  let pasteParsed = null;

  // Nothing is written until Save: 39 rows arriving unseen is not an import,
  // it is an accident. The preview says exactly what will land, in the
  // converted time, and which rows already exist.
  function drawPastePreview() {
    const box = D.el('#paste-preview');
    if (!box) return;
    if (!pasteParsed) { box.innerHTML = ''; return; }

    const { course, items } = pasteParsed;
    if (!items.length) {
      box.innerHTML = `<div class="empty" style="padding:16px"><strong>Nothing recognised</strong>
        Make sure the copied text includes the Due column.</div>`;
      return;
    }

    const known = {};
    S().tasks.forEach((t) => { if (t.sourceId) known[t.sourceId] = true; });
    const fresh = items.filter((i) => !known[i.sourceId]).length;
    const again = items.length - fresh;

    box.innerHTML = `
      <div class="card" style="margin-top:6px">
        <div class="card-head">
          <h2>${esc(course ? course.code : 'Assignments')}</h2>
          <span class="spacer"></span>
          <span class="count">${fresh} new${again ? ' · ' + again + ' to update' : ''}</span>
        </div>
        <div class="card-body" style="max-height:220px; overflow-y:auto">
          ${items.map((i) => `
            <div class="row">
              <div class="main">
                <div class="title">${esc(i.title)}</div>
                <div class="meta">
                  <span class="chip soon">${esc(D.fmtDay(i.due) + ' · ' + D.fmtTime(new Date(i.at)))}</span>
                  ${i.category ? `<span class="chip">${esc(i.category)}</span>` : ''}
                  ${known[i.sourceId] ? '<span class="chip">already imported</span>' : ''}
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  async function importAssignments(parsed) {
    const code = parsed.course ? parsed.course.code : '';
    const name = parsed.course ? parsed.course.name : '';

    // Attach to a class you already added, so the tasks group under it.
    const flat = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
    const hit = S().courses.find((c) =>
      (code && flat(c.code) === flat(code)) ||
      (name && flat(c.name) === flat(name)));

    return S().upsertBySource('tasks', parsed.items.map((i) => ({
      title:      i.title,
      area:       'school',
      course:     hit ? hit.id : null,
      courseName: hit ? '' : (code || name),
      category:   i.category,
      due:        i.due,
      dueTime:    i.dueTime,
      priority:   0,
      done:       false,
      source:     'canvas-paste',
      sourceId:   i.sourceId,
    })));
  }

  function closeMenu() {
    D.el('#sidebar').classList.remove('open');
    D.el('#scrim').classList.remove('on');
  }

  // ── Wiring ──────────────────────────────────────────────────────────
  function bind() {
    document.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-act]');
      if (!el) return;
      const fn = ACTIONS[el.dataset.act];
      if (!fn) return;
      ev.preventDefault();
      fn(el);
    });

    D.el('#menu-btn').addEventListener('click', () => ACTIONS['open-menu']());
    D.el('#scrim').addEventListener('click', closeMenu);

    // NOTE: outbound links (Recap) are deliberately left to the browser.
    //
    // It is tempting to intercept the click and call window.open() so a
    // blocked popup can fall back to this tab — but doing so breaks handoff
    // to native apps. Android app links and iOS universal links fire on a
    // real tap of an <a href>; a JS-driven window.open() or location
    // assignment is not treated the same way and keeps the URL in the
    // browser. Since the whole point of the Recap link is to land in the
    // YouTube app on a phone, the plain anchor wins.

    D.el('#theme-toggle').addEventListener('click', async () => {
      const now = document.documentElement.getAttribute('data-theme');
      await S().saveSettings({ theme: now === 'dark' ? 'light' : 'dark' });
      applyTheme();
    });

    D.el('#quick-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = D.el('#quick-input');
      const title = input.value.trim();
      if (!title) return;
      await S().add('tasks', {
        title, done: false, priority: 0,
        area: D.el('#quick-area').value || null,
        due:  D.el('#quick-due').value || null,
      });
      input.value = '';
      buildNav(); renderTasks();
    });

    D.el('#modal-save').addEventListener('click', () => {
      const f = D.el('#modal-back')._save; if (f) f();
    });
    D.el('#modal-del').addEventListener('click', () => {
      const f = D.el('#modal-back')._del;
      if (f && confirm('Delete this permanently?')) f();
    });
    D.el('#modal-cancel').addEventListener('click', closeModal);
    D.el('#modal-back').addEventListener('click', (ev) => {
      if (ev.target.id === 'modal-back') closeModal();
    });

    document.addEventListener('keydown', (ev) => {
      const modalOpen = D.el('#modal-back').classList.contains('open');
      if (ev.key === 'Escape') { closeModal(); closeMenu(); }
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && modalOpen) {
        const f = D.el('#modal-back')._save; if (f) f();
      }
      // 'n' for a new task, when not typing into something.
      if (ev.key === 'n' && !modalOpen && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) {
        ev.preventDefault(); ACTIONS['new-task']();
      }
    });

    D.el('#league-select').addEventListener('change', (ev) => renderPicker(ev.target.value));
    D.el('#team-search').addEventListener('input', (ev) => drawPicker(ev.target.value));

    D.el('#set-name').addEventListener('change', async (ev) => {
      await S().saveSettings({ name: ev.target.value.trim() });
      if (view === 'overview') setTitle('Overview', overviewSub());
    });
    D.el('#set-proxy').addEventListener('change', async (ev) => {
      await S().saveSettings({ proxyUrl: ev.target.value.trim() });
      D.toast('Proxy saved');
    });
    D.el('#set-target').addEventListener('change', async (ev) => {
      await S().saveSettings({ weeklyTarget: Number(ev.target.value) || 15 });
      D.toast('Target updated');
    });
    D.el('#set-theme').addEventListener('change', async (ev) => {
      await S().saveSettings({ theme: ev.target.value });
      applyTheme();
    });
    D.el('#set-wunit').addEventListener('change', async (ev) => {
      // The label only — stored readings are numbers and are NOT converted,
      // because switching units does not change what you weighed.
      await S().saveSettings({ weightUnit: ev.target.value });
      D.toast('Readings are shown in ' + ev.target.value + ' — values unchanged');
    });
    D.el('#set-wtarget').addEventListener('change', async (ev) => {
      const v = ev.target.value.trim();
      await S().saveSettings({ weightTarget: v === '' ? null : Number(v) });
      D.toast(v === '' ? 'Target cleared' : 'Target set');
    });

    D.el('#import-file').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        await S().importJSON(await file.text());
        buildNav(); render(); loadSports(true); applyTheme();
        D.toast('Backup restored');
      } catch (e) { D.toast('That file is not a dashboard backup'); }
      ev.target.value = '';
    });

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((S().settings.theme || 'system') === 'system') applyTheme();
    });

    watchCalendarVisibility();
  }

  // ── Boot ────────────────────────────────────────────────────────────
  async function init() {
    await D.Store.init();

    // Static icon slots.
    D.el('#brand-mark').innerHTML = D.icon('grid');
    D.el('#ic-plus').outerHTML = D.icon('plus');
    D.el('#ic-cal').outerHTML = D.icon('calendar');
    const rs = D.el('#ic-refresh-slot');
    if (rs) rs.innerHTML = D.icon('refresh');
    D.el('#menu-btn').innerHTML = D.icon('menu');

    bind();
    applyTheme();

    // League dropdown, grouped by sport.
    const sel = D.el('#league-select');
    let lastSport = '';
    D.Sports.LEAGUES.forEach((l) => {
      if (l.sport !== lastSport) {
        sel.appendChild(Object.assign(document.createElement('optgroup'), { label: l.sport }));
        lastSport = l.sport;
      }
      sel.lastChild.appendChild(new Option(l.name, l.key));
    });
    sel.value = 'esp.1';
    D.el('#refresh-btn').innerHTML = D.icon('refresh');
    D.el('#cal-prev').innerHTML = D.icon('chevron', 'ic-sm');
    D.el('#cal-next').innerHTML = D.icon('chevron', 'ic-sm');
    D.el('#cal-fab-ic').outerHTML = D.icon('calendar');
    D.el('#ic-paste').outerHTML = D.icon('inbox');
    D.el('#ic-logw').outerHTML = D.icon('plus');
    D.el('#ic-proto').outerHTML = D.icon('plus');
    D.el('#ic-wo').outerHTML = D.icon('plus');
    D.el('#wo-prev').innerHTML = D.icon('chevron', 'ic-sm');
    D.el('#wo-next').innerHTML = D.icon('chevron', 'ic-sm');

    setPicker(false);          // collapsed; the list loads on first open

    route('overview');
    loadSports(false);

    // Last, and unawaited: sync must never hold up first paint, and the app
    // is fully usable whether or not it is configured or reachable.
    D.Cloud.onStatus(() => { if (view === 'settings') renderCloud(); });
    D.Cloud.init();

    // Unawaited: this is a request the browser may take its time over, and
    // nothing on screen depends on the answer.
    S().requestPersistence().then((ok) => {
      persisted = ok;
      if (view === 'settings') renderBackup();
    });

    // Keep "now" honest without a reload.
    setInterval(() => { if (view === 'overview') renderOverview(); }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) loadSports(false);
    });
  }

  D.App = { init, render, route };
})(window.DASH);
