/* =========================
   Tauri bridges (guarded)
   ========================= */
const TAURI = (function () {
  const has = typeof window !== "undefined" && window.__TAURI__ && window.__TAURI__.core;
  const invoke = has ? window.__TAURI__.core.invoke : async () => {};
  const listen = has && window.__TAURI__.event ? window.__TAURI__.event.listen : async () => ({ unlisten(){} });
  return { has, invoke, listen };
})();

/* =========================
   DOM references
   ========================= */
const qs  = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

const statusEl     = qs('#status');

const repoSwitch   = qs('#repo-switch');
const fetchBtn     = qs('#fetch-btn');
const pushBtn      = qs('#push-btn');
const themeBtn     = qs('#theme-btn');
const cloneBtn     = qs('#clone-btn');

const tabs         = qsa('.tab');
const workGrid     = qs('.work');
const leftPanel    = qs('#left');
const resizer      = qs('#resizer');
const filterInput  = qs('#filter');
const listEl       = qs('#file-list');
const countEl      = qs('#changes-count');

const diffHeadPath = qs('#diff-path');
const diffEl       = qs('#diff');

const commitBox    = qs('#commit');
const commitSummary= qs('#commit-summary');
const commitDesc   = qs('#commit-desc');
const commitBtn    = qs('#commit-btn');

/* ---- Branch UI ---- */
const branchBtn    = qs('#branch-switch');
const branchName   = qs('#branch-name');
const branchPop    = qs('#branch-pop');
const branchFilter = qs('#branch-filter');
const branchList   = qs('#branch-list');

const repoTitleEl  = qs('#repo-title');
const repoBranchEl = qs('#repo-branch');

/* ----- Command Sheet (modal) ----- */
const modal        = qs('#modal');
const sheetTabs    = qsa('.seg-btn[data-sheet]');
const sheetPanels  = {
  clone:  qs('#sheet-clone'),
  add:    qs('#sheet-add'),
  switch: qs('#sheet-switch'),
};
const cloneUrl     = qs('#clone-url');
const clonePath    = qs('#clone-path');
const doClone      = qs('#do-clone');
const addPath      = qs('#add-path');
const doAdd        = qs('#do-add');
const recentList   = qs('#recent-list');

/* ----- Settings modal ----- */
const settingsModal  = qs('#settings-modal');
const settingsSave   = qs('#settings-save');
const settingsReset  = qs('#settings-reset');
const settingsNav    = qs('#settings-nav');
const settingsPanels = qs('#settings-panels');

/* General */
const setThemeSel         = qs('#set-theme');
const setLanguageSel      = qs('#set-language');
const setUpdateChannelSel = qs('#set-update-channel');
const setReopenLastChk    = qs('#set-reopen-last');
const setChecksOnLaunch   = qs('#set-checks-on-launch');

/* Git */
const setGitBackend       = qs('#set-git-backend');
const setAutoFetchChk     = qs('#set-auto-fetch');
const setAutoFetchMin     = qs('#set-auto-fetch-minutes');
const setPruneOnFetch     = qs('#set-prune-on-fetch');
const setWatcherDebounce  = qs('#set-watcher-debounce-ms');
const setLargeRepoThresh  = qs('#set-large-repo-threshold-mb');
const setHookPolicy       = qs('#set-hook-policy');
const setRespectAutocrlf  = qs('#set-respect-autocrlf');

/* Diff */
const setTabWidth         = qs('#set-tab-width');
const setIgnoreWhitespace = qs('#set-ignore-whitespace');
const setMaxFileSizeMb    = qs('#set-max-file-size-mb');
const setIntraline        = qs('#set-intraline');
const setBinaryPlaceholders = qs('#set-binary-placeholders');

/* LFS */
const setLfsEnabled       = qs('#set-lfs-enabled');
const setLfsConcurrency   = qs('#set-lfs-concurrency');
const setLfsBandwidth     = qs('#set-lfs-bandwidth');
const setLfsRequireLock   = qs('#set-lfs-require-lock');
const setLfsBgFetch       = qs('#set-lfs-bg-fetch');

/* Performance */
const setGraphCap         = qs('#set-graph-cap');
const setProgressiveRender= qs('#set-progressive-render');
const setGpuAccel         = qs('#set-gpu-accel');
const setIndexWarm        = qs('#set-index-warm');
const setBgIndexOnBattery = qs('#set-bg-index-on-battery');

/* UX */
const setUiScale          = qs('#set-ui-scale');
const setFontMono         = qs('#set-font-mono');
const setVimNav           = qs('#set-vim-nav');
const setCbMode           = qs('#set-cb-mode');

qsa('[data-close], .backdrop', modal).forEach(el => el.addEventListener('click', closeSheet));
qsa('[data-proto]').forEach(b => b.addEventListener('click', () => {
  qsa('[data-proto]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));

/* ----- About modal ----- */
const aboutModal    = qs('#about-modal');
const aboutVersion  = qs('#about-version');
const aboutBuild    = qs('#about-build');
const aboutHome     = qs('#about-home');
const aboutRepo     = qs('#about-repo');
const aboutLicenses = qs('#about-licenses');
if (aboutModal) {
  qsa('[data-close], .backdrop', aboutModal).forEach(el =>
    el.addEventListener('click', () => aboutModal.classList.remove('show'))
  );
}

/* =========================
   Preferences (persisted) vs Runtime state
   ========================= */
const PREFS_KEY = 'ovcs.prefs.v1';
function safeParse(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

// Persisted UI preferences
const defaultPrefs = {
  theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  leftW: 0,            // px; 0 = compute from container
  tab: 'changes',
};
let prefs = Object.assign({}, defaultPrefs, safeParse(localStorage.getItem(PREFS_KEY)));
function savePrefs() { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }

// Non-persisted runtime state (always hydrated from backend)
let state = {
  hasRepo: false,
  branch:   '',
  branches: [ { name: '', current: true } ],
  files:    [],     // [{ path, status, hunks: [...] }]
  commits:  [],     // [{ id, msg, meta, author }]
};

function hasRepo()    { return !!state.hasRepo && !!state.branch; }
function hasChanges() { return Array.isArray(state.files) && state.files.length > 0; }

/* =========================
   Utilities
   ========================= */
function notify(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  setTimeout(() => { if (statusEl.textContent === text) statusEl.textContent = 'Ready'; }, 2200);
}
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  prefs.theme = theme; savePrefs();
  if (setThemeSel) setVal(setThemeSel, theme);
}
function toggleTheme() { setTheme(prefs.theme === 'dark' ? 'light' : 'dark'); }
function statusLabel(s) { return s === 'A' ? 'Added' : s === 'M' ? 'Modified' : s === 'D' ? 'Deleted' : 'Changed'; }
function statusClass(s) { return s === 'A' ? 'add' : s === 'M' ? 'mod' : s === 'D' ? 'del' : 'mod'; }
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

/* =========================
   Boot
   ========================= */
applyInitial();
function applyInitial() {
  setTheme(prefs.theme);

  const curBranch = (state.branches.find(b => b.current) || {name: state.branch}).name;
  state.branch = curBranch;
  if (branchName) branchName.textContent = curBranch;

  setTab(prefs.tab);
  initResizer();
  renderList();
  refreshRepoActions();
  hydrateBranches();
  hydrateStatus();
  hydrateCommits();
}

/* =========================
   Tabs (Changes / History)
   ========================= */
tabs.forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
function setTab(tab) {
  prefs.tab = tab; savePrefs();
  tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  commitBox.style.display = tab === 'history' ? 'none' : 'grid';
  diffHeadPath.textContent = tab === 'history' ? 'Commit details' : 'Select a file to view changes';
  diffEl.innerHTML = '';
  renderList();
}

/* =========================
   Left panel: resizer + filter + rendering
   ========================= */
function initResizer() {
  const MIN_LEFT  = 220;   // keep list usable
  const MIN_RIGHT = 360;   // keep diff usable
  const GUTTER    = 6;

  function clampLeft(px, cw) {
    const max = Math.max(MIN_LEFT, cw - MIN_RIGHT - GUTTER);
    return Math.max(MIN_LEFT, Math.min(max, px));
  }
  function currentContainerWidth() {
    return workGrid.getBoundingClientRect().width || window.innerWidth;
  }
  function initialLeftPx() {
    const cw = currentContainerWidth();
    const px = prefs.leftW && prefs.leftW > 0 ? prefs.leftW : Math.round(cw * 0.32);
    return clampLeft(px, cw);
  }
  function applyColumns(px) {
    workGrid.style.gridTemplateColumns = `${px}px ${GUTTER}px 1fr`;
  }

  // boot
  let leftPx = initialLeftPx();
  applyColumns(leftPx);

  // drag handlers
  let dragging = false, x0 = 0, left0 = 0;
  resizer.addEventListener('mousedown', (e) => {
    dragging = true; x0 = e.clientX; left0 = leftPx;
    document.body.style.cursor = 'col-resize';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const cw = currentContainerWidth();
    leftPx = clampLeft(left0 + (e.clientX - x0), cw);
    applyColumns(leftPx);
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    prefs.leftW = leftPx; savePrefs();
  });

  // keep sane on window resize and at the stacked breakpoint
  function onResize() {
    const stacked = window.matchMedia('(max-width: 980px)').matches;
    if (stacked) {
      workGrid.style.gridTemplateColumns = ''; // let CSS 1-column layout take over
      return;
    }
    const cw = currentContainerWidth();
    leftPx = clampLeft(leftPx, cw);
    applyColumns(leftPx);
  }
  window.addEventListener('resize', onResize);
}

filterInput.addEventListener('input', renderList);
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); filterInput.focus(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'r') { e.preventDefault(); openSheet('switch'); }
  if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); commitBtn.click(); }
  if (e.key === 'Escape') {
    if (modal?.classList.contains('show')) closeSheet();
    if (aboutModal?.classList.contains('show')) aboutModal.classList.remove('show');
  }
});

function refreshRepoActions() {
  const repo = hasRepo();

  // Titlebar items
  fetchBtn && (fetchBtn.disabled  = !repo);
  pushBtn  && (pushBtn.disabled   = !repo);
  branchBtn&& (branchBtn.disabled = !repo);

  // Commit panel
  const summaryFilled = !!commitSummary?.value.trim();
  if (commitSummary) commitSummary.disabled = !repo || !hasChanges();
  if (commitDesc)    commitDesc.disabled    = !repo;
  if (commitBtn)     commitBtn.disabled     = !repo || !hasChanges() || !summaryFilled;

  // Optional: visually mute the whole commit box when inactive
  if (commitBox) commitBox.classList.toggle('disabled', !repo || !hasChanges());
}

// keep button state live while typing summary
commitSummary?.addEventListener('input', refreshRepoActions);


function renderList() {
  listEl.innerHTML = '';
  const isHistory = prefs.tab === 'history';
  const q = filterInput.value.trim().toLowerCase();

  if (isHistory) {
    const commits = (state.commits || []).filter(c =>
      !q || c.msg?.toLowerCase().includes(q) || c.id?.includes(q)
    );

    countEl.textContent = `${commits.length} commit${commits.length === 1 ? '' : 's'}`;

    if (!commits.length) {
      listEl.innerHTML = `<li class="row" aria-disabled="true"><div class="file">No commits loaded.</div></li>`;
      diffHeadPath.textContent = 'Commit details';
      diffEl.innerHTML = '';
      return;
    }

    commits.forEach((c, i) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.innerHTML = `<span class="badge">${(c.id || '').slice(0,7)}</span>
                      <div class="file" title="${escapeHtml(c.msg || '')}">${escapeHtml(c.msg || '(no message)')}</div>
                      <span class="badge">${escapeHtml(c.meta || '')}</span>`;
      li.addEventListener('click', () => selectHistory(c, i));
      listEl.appendChild(li);
    });
    selectHistory(commits[0], 0);
    return;
  }

  const files = (state.files || []).filter(f =>
    !q || (f.path || '').toLowerCase().includes(q)
  );
  countEl.textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;

  if (!files.length) {
    listEl.innerHTML = `<li class="row" aria-disabled="true"><div class="file">No changes. Clone or add a repository to get started.</div></li>`;
    diffHeadPath.textContent = 'Select a file to view changes';
    diffEl.innerHTML = '';
    return;
  }

  files.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('role', 'option');
    li.innerHTML = `
      <span class="status ${statusClass(f.status)}">${escapeHtml(f.status || '')}</span>
      <div class="file" title="${escapeHtml(f.path || '')}">${escapeHtml(f.path || '')}</div>
      <span class="badge">${statusLabel(f.status)}</span>`;
    li.addEventListener('click', () => selectFile(f, i));
    listEl.appendChild(li);
  });

  selectFile(files[0], 0);
}

function highlightRow(index) {
  qsa('.row', listEl).forEach((el, i) => el.classList.toggle('active', i === index));
}

async function selectFile(file, index) {
  highlightRow(index);
  diffHeadPath.textContent = file.path || '(unknown file)';
  diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading…</div></div></div>';

  try {
    let lines = [];
    if (TAURI.has && file.path) {
      lines = await TAURI.invoke('git_diff_file', { path: file.path });
    }
    diffEl.innerHTML = renderHunk(lines || []); // one hunk from flat lines
  } catch (e) {
    console.error(e);
    diffEl.innerHTML = `<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Failed to load diff</div></div></div>`;
  }
}

function selectHistory(commit, index) {
  highlightRow(index);
  const id = (commit.id || '').slice(0,7);
  diffHeadPath.textContent = `Commit ${id || '(unknown)'}`;
  diffEl.innerHTML = `
    <div class="hunk">
      <div class="hline"><div class="gutter">commit</div><div class="code">${escapeHtml(commit.id || '')}</div></div>
      <div class="hline"><div class="gutter">Author</div><div class="code">${escapeHtml(commit.author || 'You <you@example.com>')}</div></div>
      <div class="hline"><div class="gutter">Message</div><div class="code">${escapeHtml(commit.msg || '')}</div></div>
    </div>`;
}

function renderHunks(hunks) { return hunks.map(renderHunk).join(''); }

// Accepts an array of strings like ["+foo", "-bar", " baz"]
function renderHunk(hunk) {
  return `<div class="hunk">${
    (hunk || []).map((ln, i) => {
      const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
      const t = first === '+' ? 'add' : first === '-' ? 'del' : '';
      const safe = escapeHtml(String(ln));
      return `<div class="hline ${t}"><div class="gutter">${i+1}</div><div class="code">${safe}</div></div>`;
    }).join('')
  }</div>`;
}

/* =========================
   Commit action (hook)
   ========================= */
commitBtn.addEventListener('click', async () => {
  const summary = commitSummary.value.trim();
  if (!summary) { commitSummary.focus(); notify('Summary is required'); return; }
  try {
    if (TAURI.has) await TAURI.invoke('commit_changes', {
      summary, description: commitDesc.value || ''
    });
    notify(`Committed to ${state.branch}: ${summary}`);
    commitSummary.value = ''; commitDesc.value = '';
    hydrateStatus();
    hydrateCommits();
  } catch (e) {
    console.error(e); notify('Commit failed');
  }
});

/* =========================
   Title actions: fetch/push/theme/clone
   ========================= */
themeBtn?.addEventListener('click', toggleTheme);

fetchBtn?.addEventListener('click', async () => {
  try {
    if (TAURI.has) await TAURI.invoke('git_fetch', {});
    notify('Fetched');
    hydrateStatus();
    hydrateCommits();
  } catch (e) { console.error(e); notify('Fetch failed'); }
});

pushBtn?.addEventListener('click', async () => {
  try {
    if (TAURI.has) await TAURI.invoke('git_push', {});
    notify('Pushed');
  } catch (e) { console.error(e); notify('Push failed'); }
});

cloneBtn?.addEventListener('click', () => openSheet('clone'));
repoSwitch?.addEventListener('click', () => openSheet('switch'));

/* =========================
   Native Menu (Tauri v2): route ids -> UI commands
   ========================= */
TAURI.listen?.('menu', ({ payload: id }) => {
  switch (id) {
    case 'clone_repo': openSheet('clone'); break;
    case 'add_repo':   openSheet('add');   break;
    case 'open_repo':  openSheet('switch');break;
    case 'toggle_theme': themeBtn?.click(); break;
    case 'fetch': fetchBtn?.click(); break;
    case 'push':  pushBtn?.click();  break;
    case 'commit': commitBtn?.click(); break;
    case 'docs': notify('Open docs…'); break;
    case 'about': openAbout(); break;
  }
});

TAURI.listen?.('repo:selected', async ({ payload }) => {
  const path =
      typeof payload === 'string'
          ? payload
          : (payload?.path ?? payload?.repoPath ?? payload?.repo ?? payload?.dir ?? '');

  if (path) notify(`Opened ${path}`);

  setRepoHeader(path);           // set name from selected path right away
  closeSheet?.();

  await hydrateBranches();       // updates state.branch
  setRepoHeader(path);           // refresh branch label now that state.branch is known

  await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
});


/* =========================
   Command Sheet (Clone / Add / Switch)
   ========================= */
function openSheet(which = 'clone') {
  modal.classList.add('show');
  setSheet(which);
  const focusId = which === 'clone' ? 'clone-url' : which === 'add' ? 'add-path' : null;
  if (focusId) setTimeout(() => qs('#' + focusId)?.focus(), 0);
}
function closeSheet() { modal.classList.remove('show'); }

sheetTabs.forEach(btn => btn.addEventListener('click', () => setSheet(btn.dataset.sheet)));
function setSheet(which) {
  sheetTabs.forEach(b => {
    const on = b.dataset.sheet === which;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  Object.entries(sheetPanels).forEach(([k, el]) => el.classList.toggle('hidden', k !== which));
}

function setDisabled(id, on) { const el = qs('#' + id); if (el) el.disabled = on; }

async function validateClone() {
  if (!TAURI.has) return;
  const url  = cloneUrl.value.trim();
  const dest = clonePath.value.trim();
  try {
    const res = await TAURI.invoke('validate_clone_input', { url, dest });
    setDisabled('do-clone', !res?.ok);
    if (!res?.ok && res?.reason) notify(res.reason);
  } catch (e) {
    console.error(e);
    setDisabled('do-clone', true);
  }
}

async function validateAdd() {
  if (!TAURI.has) return;
  const path = addPath.value.trim();
  try {
    const res = await TAURI.invoke('validate_add_path', { path });
    setDisabled('do-add', !res?.ok);
    if (!res?.ok && res?.reason) notify(res.reason);
  } catch (e) {
    console.error(e);
    setDisabled('do-add', true);
  }
}

cloneUrl?.addEventListener('input', validateClone);
clonePath?.addEventListener('input', validateClone);
addPath  ?.addEventListener('input', validateAdd);

/* Browse buttons — delegate to Rust (open native dir chooser) */
qs('#browse-clone')?.addEventListener('click', async () => {
  try {
    if (TAURI.has) {
      const dir = await TAURI.invoke('browse_directory', { purpose: 'clone_dest' });
      if (dir) { clonePath.value = dir; validateClone(); }
    }
  } catch (e) { console.error(e); }
});
qs('#browse-add')?.addEventListener('click', async () => {
  try {
    if (TAURI.has) {
      const dir = await TAURI.invoke('browse_directory', { purpose: 'add_repo' });
      if (dir) { addPath.value = dir; validateAdd(); }
    }
  } catch (e) { console.error(e); }
});

/* Primary actions (hooked to Rust) */
doClone?.addEventListener('click', async () => {
  const url  = cloneUrl.value.trim();
  const dest = clonePath.value.trim();
  if (!url || !dest) return;

  try {
    if (TAURI.has) await TAURI.invoke('clone_repo', { url, dest });
    notify(`Cloned ${url} → ${dest}`);
    closeSheet();
    hydrateStatus();
    hydrateCommits();
    hydrateBranches();
  } catch (e) { console.error(e); notify('Clone failed'); }
});
doAdd?.addEventListener('click', async () => {
  const path = addPath.value.trim();
  if (!path) return;

  try {
    if (TAURI.has) await TAURI.invoke('add_repo', { path });
    notify(`Added ${path}`);
    closeSheet();
    hydrateStatus();
    hydrateCommits();
    hydrateBranches();
  } catch (e) { console.error(e); notify('Add failed'); }
});

/* Populate recents (no mock fallback) */
(async function loadRecents() {
  try {
    let recents = [];
    if (TAURI.has) {
      const fromRust = await TAURI.invoke('list_recent_repos').catch(() => null);
      if (Array.isArray(fromRust)) recents = fromRust;
    }
    recentList.innerHTML = (recents || []).map(r =>
      `<li data-path="${r.path}">
         <div><strong>${escapeHtml(r.name || (r.path || '').split('/').pop() || '')}</strong>
         <div class="path">${escapeHtml(r.path || '')}</div></div>
         <button class="tbtn" type="button" data-open>Open</button>
       </li>`
    ).join('');
    recentList.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-open]'); if (!btn) return;
      const li = e.target.closest('li'); if (!li) return;
      const path = li.dataset.path;
      try {
        if (TAURI.has) await TAURI.invoke('open_repo', { path });
        notify(`Opened ${path}`); closeSheet();
        hydrateStatus();
        hydrateCommits();
        hydrateBranches();
      } catch (err) { console.error(err); notify('Open failed'); }
    });
  } catch (e) { console.error(e); }
})();

/* =========================
   Branch popover + actions
   ========================= */
function openBranchPopover() {
  renderBranches();
  const r = branchBtn.getBoundingClientRect();
  branchPop.style.left = `${r.left}px`;
  branchPop.style.top  = `${r.bottom + 6}px`;
  branchPop.hidden = false;
  branchBtn.setAttribute('aria-expanded', 'true');
  setTimeout(() => branchFilter.focus(), 0);
}
function closeBranchPopover() {
  branchPop.hidden = true;
  branchBtn.setAttribute('aria-expanded', 'false');
  branchFilter.value = '';
}
function renderBranches() {
  const q = branchFilter.value.trim().toLowerCase();
  const items = (state.branches || []).filter(b => !q || b.name.toLowerCase().includes(q));

  branchList.innerHTML = items.map(b => {
    const kindType = b.kind?.type || '';              // "Local" | "Remote"
    const remote    = b.kind?.remote || '';           // "origin" when Remote
    let kindLabel = '';

    if (kindType === 'Local' || kindType === 'local') {
      kindLabel = '<span class="badge kind">Local</span>';
    } else if (kindType === 'Remote' || kindType === 'remote') {
      kindLabel = `<span class="badge kind">Remote:${remote || 'remote'}</span>`;
    }

    return `
      <li role="option" data-branch="${b.name}" aria-selected="${b.current ? 'true' : 'false'}">
        <span class="label">
          <span class="branch-dot" aria-hidden="true" style="box-shadow:none;${b.current?'':'opacity:.5'}"></span>
          <span class="name" title="${b.name}">${b.name}</span>
        </span>
        ${b.current ? '<span class="badge">Current</span>' : kindLabel}
      </li>
    `;
  }).join('');
}

branchBtn?.addEventListener('click', (e) => {
  if (branchPop.hidden) openBranchPopover(); else closeBranchPopover();
  e.stopPropagation();
});
document.addEventListener('click', (e) => {
  if (!branchPop.hidden && !branchPop.contains(e.target) && e.target !== branchBtn) {
    closeBranchPopover();
  }
});
window.addEventListener('resize', closeBranchPopover);
branchFilter?.addEventListener('input', renderBranches);

branchList?.addEventListener('click', async (e) => {
  const li = e.target.closest('li[data-branch]');
  if (!li) return;
  const name = li.dataset.branch;

  try {
    if (TAURI.has) await TAURI.invoke('git_checkout_branch', { name });
    state.branches.forEach(b => b.current = (b.name === name));
    state.branch = name;
    branchName.textContent = name;
    renderBranches();
    closeBranchPopover();
    notify(`Switched to ${name}`);
    hydrateStatus();
    hydrateCommits();
  } catch (err) {
    console.error(err); notify('Checkout failed');
  }
});

qs('#branch-new')?.addEventListener('click', async () => {
  const base = (state.branches.find(b => b.current) || {}).name || '';
  const name = prompt(`New branch name (from ${base})`);
  if (!name) return;
  try {
    if (TAURI.has) await TAURI.invoke('git_create_branch', { name, from: base, checkout: true });
    state.branches.forEach(b => b.current = false);
    state.branches.unshift({ name, current: true });
    state.branch = name;
    branchName.textContent = name;
    renderBranches();
    closeBranchPopover();
    notify(`Created branch ${name}`);
    hydrateStatus();
    hydrateCommits();
  } catch (e) { console.error(e); notify('Create branch failed'); }
});

/* Load branches from backend if available */
async function hydrateBranches() {
  try {
    if (!TAURI.has) return;
    const list = await TAURI.invoke('list_branches');
    state.hasRepo = Array.isArray(list) && list.length > 0;
    if (state.hasRepo) {
      state.branches = list;
      const cur = list.find(b => b.current)?.name || state.branch || 'main';
      state.branch = cur;
      branchName.textContent = cur;
      // keep header’s branch label in sync
      if (repoBranchEl) repoBranchEl.textContent = cur;
    } else {
      state.branch = '';
      branchName.textContent = '';
      state.branches = [ { name: '', current: true } ];
      state.files = [];
      state.commits = [];
      renderList();
      resetRepoHeader(); // show “Click to open Repo / No repo open”
    }
    refreshRepoActions();
  } catch (_) { /* silent */ }
}

/* Load working tree status */
async function hydrateStatus() {
  try {
    if (!TAURI.has) return;
    const result = await TAURI.invoke('git_status'); // { files, ahead, behind }
    // If this returns, we consider a repo selected (backend should error if not)
    state.hasRepo = true;
    if (result && Array.isArray(result.files)) {
      state.files = result.files;
      renderList();
    }
  } catch (_) {
    // If status fails, we probably don't have a repo
    state.hasRepo = false;
    state.files = [];
    renderList();
  } finally {
    refreshRepoActions();
  }
}

/* Load commit history */
async function hydrateCommits() {
  try {
    if (!TAURI.has) return;
    const list = await TAURI.invoke('git_log', { limit: 100 });
    // If this succeeds, we have a repo
    state.hasRepo = true;
    if (Array.isArray(list)) {
      state.commits = list;
      if (prefs.tab === 'history') renderList();
    }
  } catch (_) {
    state.hasRepo = false;
    state.commits = [];
  } finally {
    refreshRepoActions();
  }
}

/* =========================
   About dialog
   ========================= */
async function openAbout() {
  try {
    let info = null;
    if (TAURI.has) {
      // Implement this command in Rust to return { version, build, homepage, repository }
      info = await TAURI.invoke('about_info').catch(() => null);
    }
    const version = info?.version ? `v${info.version}` : '';
    const build   = info?.build   ? info.build        : '';
    const home    = info?.homepage || '';
    const repo    = info?.repository || '';

    if (aboutVersion) aboutVersion.textContent = version;
    if (aboutBuild)   aboutBuild.textContent   = build;
    if (aboutHome)  { aboutHome.href = home || '#'; aboutHome.toggleAttribute('disabled', !home); }
    if (aboutRepo)  { aboutRepo.href = repo || '#'; aboutRepo.toggleAttribute('disabled', !repo); }

    aboutModal?.classList.add('show');
  } catch (e) {
    console.error(e);
    notify('Unable to load About');
  }
}

aboutLicenses?.addEventListener('click', async () => {
  try {
    if (TAURI.has) {
      // Optional: implement this on Rust side to show a licenses window or open a file.
      await TAURI.invoke('show_licenses');
    }
  } catch (e) { console.error(e); notify('Unable to show licenses'); }
});

/* =========================
   Backend events
   ========================= */
TAURI.listen?.('git-progress', ({ payload }) => {
  statusEl.textContent = payload?.message || 'Working…';
});

/* =========================
   App focus -> refresh
   ========================= */
(function () {
  // simple throttle so we don’t spam when multiple focus events fire quickly
  let cooling = false;
  const COOL_MS = 350;

  async function refreshAll() {
    statusEl.textContent = 'Refreshing…';
    await Promise.allSettled([hydrateBranches(), hydrateStatus(), hydrateCommits()]);
    statusEl.textContent = 'Ready';
  }

  TAURI.listen?.('app:focus', () => {
    if (cooling) return;
    cooling = true;
    refreshAll().finally(() => {
      setTimeout(() => (cooling = false), COOL_MS);
    });
  });
})();

function setRepoHeader(pathMaybe) {
  if (repoTitleEl && pathMaybe) {
    const base = String(pathMaybe).replace(/[\\/]+$/, '').split(/[/\\]/).pop() || pathMaybe;
    repoTitleEl.textContent = base;
  }
  if (repoBranchEl) {
    repoBranchEl.textContent = state.branch || 'No repo open';
  }
}
function resetRepoHeader() {
  if (repoTitleEl)  repoTitleEl.textContent  = 'Click to open Repo';
  if (repoBranchEl) repoBranchEl.textContent = 'No repo open';
}

TAURI.listen?.('ui:open-settings', () => openSettings());

/* =========================
   Settings helpers
   ========================= */
function toKebab(v){ return String(v ?? '').toLowerCase().replace(/_/g,'-'); }
function setVal(el, v){ if (el) el.value = v ?? ''; }
function setNum(el, v){ if (el) el.value = Number(v ?? 0); }
function setChk(el, v){ if (el) el.checked = !!v; }
function getVal(el){ return el?.value; }
function getNum(el){ const n = Number(el?.value ?? 0); return Number.isFinite(n) ? n : 0; }
function getChk(el){ return !!el?.checked; }

/* Live preview theme when changing in Settings */
setThemeSel?.addEventListener('change', () => {
  const v = getVal(setThemeSel);
  document.documentElement.setAttribute('data-theme', v === 'dark' ? 'dark' : v === 'light' ? 'light' : 'system');
});

async function openSettings() {
  if (!settingsModal) return;
  settingsModal.classList.add('show');           // <-- add this
  settingsModal.setAttribute('aria-hidden', 'false');

  // close buttons/backdrop
  qsa('[data-close], .backdrop', settingsModal).forEach(el =>
      el.addEventListener('click', closeSettings, { once: true })
  );

  await loadSettingsIntoForm();
}

function closeSettings() {
  if (!settingsModal) return;
  settingsModal.classList.remove('show');        // <-- and this
  settingsModal.setAttribute('aria-hidden', 'true');
}

/* Sidebar section switching (buttons carry data-section, forms carry data-panel) */
settingsNav?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-section]');
  if (!btn) return;
  const section = btn.getAttribute('data-section');
  qsa('#settings-nav button').forEach(b => b.classList.toggle('active', b === btn));
  qsa('#settings-panels .panel-form').forEach(p => {
    p.classList.toggle('hidden', p.getAttribute('data-panel') !== section);
  });
});

async function loadSettingsIntoForm() {
  try {
    const cfg = TAURI.has ? await TAURI.invoke('get_global_settings') : null;
    if (!cfg) return;

    // Stash full object so we don’t drop unknown sections on save
    settingsModal.dataset.currentCfg = JSON.stringify(cfg);

    // General
    setVal(setThemeSel, toKebab(cfg.general?.theme));
    setVal(setLanguageSel, toKebab(cfg.general?.language));
    setVal(setUpdateChannelSel, toKebab(cfg.general?.update_channel));
    setChk(setReopenLastChk, cfg.general?.reopen_last_repos);
    setChk(setChecksOnLaunch, cfg.general?.checks_on_launch);

    // Git
    const backend = toKebab(cfg.git?.backend);
    setVal(setGitBackend, backend === 'libgit2' ? 'libgit2' : 'git-system');
    setChk(setAutoFetchChk, cfg.git?.auto_fetch);
    setNum(setAutoFetchMin, cfg.git?.auto_fetch_minutes);
    setChk(setPruneOnFetch, cfg.git?.prune_on_fetch);
    setNum(setWatcherDebounce, cfg.git?.watcher_debounce_ms);
    setNum(setLargeRepoThresh, cfg.git?.large_repo_threshold_mb);
    setVal(setHookPolicy, toKebab(cfg.git?.allow_hooks));
    setChk(setRespectAutocrlf, cfg.git?.respect_core_autocrlf);

    // Diff
    setNum(setTabWidth, cfg.diff?.tab_width);
    setVal(setIgnoreWhitespace, toKebab(cfg.diff?.ignore_whitespace));
    setNum(setMaxFileSizeMb, cfg.diff?.max_file_size_mb);
    setChk(setIntraline, cfg.diff?.intraline);
    setChk(setBinaryPlaceholders, cfg.diff?.show_binary_placeholders);

    // LFS
    setChk(setLfsEnabled, cfg.lfs?.enabled);
    setNum(setLfsConcurrency, cfg.lfs?.concurrency);
    setNum(setLfsBandwidth, cfg.lfs?.bandwidth_kbps);
    setChk(setLfsRequireLock, cfg.lfs?.require_lock_before_edit);
    setChk(setLfsBgFetch, cfg.lfs?.background_fetch_on_checkout);

    // Performance
    setNum(setGraphCap, cfg.performance?.graph_node_cap);
    setChk(setProgressiveRender, cfg.performance?.progressive_render);
    setChk(setGpuAccel, cfg.performance?.gpu_accel);
    setChk(setIndexWarm, cfg.performance?.index_warm_on_open);
    setChk(setBgIndexOnBattery, cfg.performance?.background_index_on_battery);

    // UX
    setVal(setUiScale, cfg.ux?.ui_scale);
    setVal(setFontMono, cfg.ux?.font_mono);
    setChk(setVimNav, cfg.ux?.vim_nav);
    setVal(setCbMode, toKebab(cfg.ux?.color_blind_mode));
  } catch (e) {
    console.error(e);
    notify('Failed to load settings');
  }
}

function collectSettingsFromForm() {
  const base = JSON.parse(settingsModal.dataset.currentCfg || '{}');

  const general = {
    ...base.general,
    theme: getVal(setThemeSel),
    language: getVal(setLanguageSel),
    update_channel: getVal(setUpdateChannelSel),
    reopen_last_repos: getChk(setReopenLastChk),
    checks_on_launch: getChk(setChecksOnLaunch),
  };

  const git = {
    ...base.git,
    backend: getVal(setGitBackend),
    auto_fetch: getChk(setAutoFetchChk),
    auto_fetch_minutes: getNum(setAutoFetchMin),
    prune_on_fetch: getChk(setPruneOnFetch),
    watcher_debounce_ms: getNum(setWatcherDebounce),
    large_repo_threshold_mb: getNum(setLargeRepoThresh),
    allow_hooks: getVal(setHookPolicy),
    respect_core_autocrlf: getChk(setRespectAutocrlf),
  };

  const diff = {
    ...base.diff,
    tab_width: getNum(setTabWidth),
    ignore_whitespace: getVal(setIgnoreWhitespace),
    max_file_size_mb: getNum(setMaxFileSizeMb),
    intraline: getChk(setIntraline),
    show_binary_placeholders: getChk(setBinaryPlaceholders),
  };

  const lfs = {
    ...base.lfs,
    enabled: getChk(setLfsEnabled),
    concurrency: getNum(setLfsConcurrency),
    bandwidth_kbps: getNum(setLfsBandwidth),
    require_lock_before_edit: getChk(setLfsRequireLock),
    background_fetch_on_checkout: getChk(setLfsBgFetch),
  };

  const performance = {
    ...base.performance,
    graph_node_cap: getNum(setGraphCap),
    progressive_render: getChk(setProgressiveRender),
    gpu_accel: getChk(setGpuAccel),
    index_warm_on_open: getChk(setIndexWarm),
    background_index_on_battery: getChk(setBgIndexOnBattery),
  };

  const ux = {
    ...base.ux,
    ui_scale: Number(getVal(setUiScale)),
    font_mono: getVal(setFontMono),
    vim_nav: getChk(setVimNav),
    color_blind_mode: getVal(setCbMode),
  };

  return { ...base, general, git, diff, lfs, performance, ux };
}

/* Save + Defaults */
settingsSave?.addEventListener('click', async () => {
  try {
    const next = collectSettingsFromForm();
    if (TAURI.has) await TAURI.invoke('set_global_settings', { cfg: next });
    notify('Settings saved');

    // Apply relevant immediate effects
    const theme = next.general?.theme || 'system';
    document.documentElement.setAttribute('data-theme', theme);

    closeSettings();
  } catch (e) {
    console.error(e);
    notify('Failed to save settings');
  }
});

settingsReset?.addEventListener('click', async () => {
  try {
    // Ask backend for defaults by clearing then saving defaults, or rebuild locally:
    if (!TAURI.has) return;
    const cur = await TAURI.invoke('get_global_settings');

    // Overwrite only sections we expose; leave unknown sections untouched
    cur.general = { theme: 'system', language: 'system', update_channel: 'stable', reopen_last_repos: true, checks_on_launch: true, telemetry: false, crash_reports: false };
    cur.git = { backend: 'git-system', auto_fetch: true, auto_fetch_minutes: 30, prune_on_fetch: true, watcher_debounce_ms: 300, large_repo_threshold_mb: 500, allow_hooks: 'ask', respect_core_autocrlf: true };
    cur.diff = { tab_width: 4, ignore_whitespace: 'none', max_file_size_mb: 10, intraline: true, show_binary_placeholders: true, external_diff: {enabled:false,path:'',args:''}, external_merge: {enabled:false,path:'',args:''}, binary_exts: ['png','jpg','dds','uasset'] };
    cur.lfs = { enabled: true, concurrency: 4, bandwidth_kbps: 0, require_lock_before_edit: false, background_fetch_on_checkout: true };
    cur.performance = { graph_node_cap: 5000, progressive_render: true, gpu_accel: true, index_warm_on_open: true, background_index_on_battery: false };
    cur.ux = { ui_scale: 1.0, font_mono: 'monospace', vim_nav: false, color_blind_mode: 'none' };

    await TAURI.invoke('set_global_settings', { cfg: cur });
    await loadSettingsIntoForm();
    notify('Defaults restored');
  } catch (e) {
    console.error(e);
    notify('Failed to restore defaults');
  }
});
