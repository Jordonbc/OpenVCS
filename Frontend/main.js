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
   Lazy HTML fragments (Vite ?raw)
   ========================= */
import settingsHtml from "./modals/settings.html?raw";

const FRAGMENTS = { "settings-modal": settingsHtml };
const loaded = new Set();
const root = document.getElementById("modals-root");

function hydrate(id) {
  if (loaded.has(id)) return;
  const html = FRAGMENTS[id];
  if (!html) throw new Error(`No fragment registered for ${id}`);
  root.insertAdjacentHTML("beforeend", html);
  loaded.add(id);
  // Per-fragment wiring
  if (id === "settings-modal") wireSettings();
}

export function openModal(id) {
  hydrate(id);
  const el = document.getElementById(id);
  if (!el) return;
  el.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

// Declarative open triggers: <button data-modal-open="#settings-modal">
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-modal-open]");
  if (!t) return;
  const id = t.getAttribute("data-modal-open").replace(/^#/, "");
  openModal(id);
});

/* =========================
   DOM helpers
   ========================= */
const qs  = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

/* =========================
   Stable app DOM references
   ========================= */
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

/* ----- Command Sheet (modal) present at load ----- */
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

qsa('[data-close], .backdrop', modal).forEach(el => el.addEventListener('click', closeSheet));
qsa('[data-proto]').forEach(b => b.addEventListener('click', () => {
  qsa('[data-proto]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));

/* ----- About modal (present at load) ----- */
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

const defaultPrefs = {
  theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  leftW: 0,
  tab: 'changes',
};
let prefs = Object.assign({}, defaultPrefs, safeParse(localStorage.getItem(PREFS_KEY)));
function savePrefs() { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }

let state = {
  hasRepo: false,
  branch:   '',
  branches: [ { name: '', current: true } ],
  files:    [],
  commits:  [],
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
  // If settings is open, reflect in the select
  const sel = document.querySelector('#settings-modal #set-theme');
  if (sel) sel.value = theme;
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
  const MIN_LEFT  = 220;
  const MIN_RIGHT = 360;
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

  let leftPx = initialLeftPx();
  applyColumns(leftPx);

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

  function onResize() {
    const stacked = window.matchMedia('(max-width: 980px)').matches;
    if (stacked) {
      workGrid.style.gridTemplateColumns = '';
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

  fetchBtn && (fetchBtn.disabled  = !repo);
  pushBtn  && (pushBtn.disabled   = !repo);
  branchBtn&& (branchBtn.disabled = !repo);

  const summaryFilled = !!commitSummary?.value.trim();
  if (commitSummary) commitSummary.disabled = !repo || !hasChanges();
  if (commitDesc)    commitDesc.disabled    = !repo;
  if (commitBtn)     commitBtn.disabled     = !repo || !hasChanges() || !summaryFilled;

  if (commitBox) commitBox.classList.toggle('disabled', !repo || !hasChanges());
}
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
    diffEl.innerHTML = renderHunk(lines || []);
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
   Commit action
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
   Title actions
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
   Native Menu routing (Tauri v2)
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
    case 'settings': openSettings(); break;
  }
});

TAURI.listen?.('repo:selected', async ({ payload }) => {
  const path =
      typeof payload === 'string'
          ? payload
          : (payload?.path ?? payload?.repoPath ?? payload?.repo ?? payload?.dir ?? '');

  if (path) notify(`Opened ${path}`);

  setRepoHeader(path);
  closeSheet?.();

  await hydrateBranches();
  setRepoHeader(path);

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

/* =========================
   Recents
   ========================= */
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
    const kindType = b.kind?.type || '';
    const remote    = b.kind?.remote || '';
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
      if (repoBranchEl) repoBranchEl.textContent = cur;
    } else {
      state.branch = '';
      branchName.textContent = '';
      state.branches = [ { name: '', current: true } ];
      state.files = [];
      state.commits = [];
      renderList();
      resetRepoHeader();
    }
    refreshRepoActions();
  } catch (_) { /* silent */ }
}

/* Load working tree status */
async function hydrateStatus() {
  try {
    if (!TAURI.has) return;
    const result = await TAURI.invoke('git_status');
    state.hasRepo = true;
    if (result && Array.isArray(result.files)) {
      state.files = result.files;
      renderList();
    }
  } catch (_) {
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

/* =========================
   SETTINGS (lazy modal)
   ========================= */
function toKebab(v){ return String(v ?? '').toLowerCase().replace(/_/g,'-'); }
function setVal(el, v){ if (el) el.value = v ?? ''; }
function setNum(el, v){ if (el) el.value = Number(v ?? 0); }
function setChk(el, v){ if (el) el.checked = !!v; }
function getVal(el){ return el?.value; }
function getNum(el){ const n = Number(el?.value ?? 0); return Number.isFinite(n) ? n : 0; }
function getChk(el){ return !!el?.checked; }

function openSettings() {
  openModal('settings-modal');
}

function wireSettings() {
  const modal = document.getElementById('settings-modal');
  if (!modal || modal.__wired) return;
  modal.__wired = true;

  // Close on backdrop / [data-close]
  modal.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]') || e.target === modal.querySelector('.backdrop')) {
      closeModal('settings-modal');
    }
  });

  // Sidebar switching
  const nav = modal.querySelector('#settings-nav');
  const panels = modal.querySelector('#settings-panels');
  if (nav && panels) {
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-section]');
      if (!btn) return;
      nav.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      const target = btn.getAttribute('data-section');
      panels.querySelectorAll('.panel-form').forEach(p => {
        p.classList.toggle('hidden', p.getAttribute('data-panel') !== target);
      });
    });
  }

  // Live preview theme
  const setThemeSel = modal.querySelector('#set-theme');
  setThemeSel?.addEventListener('change', () => {
    const v = setThemeSel.value;
    document.documentElement.setAttribute('data-theme', v === 'dark' ? 'dark' : v === 'light' ? 'light' : 'system');
  });

  // Save / Reset
  const settingsSave  = modal.querySelector('#settings-save');
  const settingsReset = modal.querySelector('#settings-reset');

  settingsSave?.addEventListener('click', async () => {
    try {
      const next = collectSettingsFromForm(modal);
      if (TAURI.has) await TAURI.invoke('set_global_settings', { cfg: next });
      notify('Settings saved');

      const theme = next.general?.theme || 'system';
      document.documentElement.setAttribute('data-theme', theme);

      closeModal('settings-modal');
    } catch (e) { console.error(e); notify('Failed to save settings'); }
  });

  settingsReset?.addEventListener('click', async () => {
    try {
      if (!TAURI.has) return;
      const cur = await TAURI.invoke('get_global_settings');

      cur.general = { theme: 'system', language: 'system', update_channel: 'stable', reopen_last_repos: true, checks_on_launch: true, telemetry: false, crash_reports: false };
      cur.git = { backend: 'git-system', auto_fetch: true, auto_fetch_minutes: 30, prune_on_fetch: true, watcher_debounce_ms: 300, large_repo_threshold_mb: 500, allow_hooks: 'ask', respect_core_autocrlf: true };
      cur.diff = { tab_width: 4, ignore_whitespace: 'none', max_file_size_mb: 10, intraline: true, show_binary_placeholders: true, external_diff: {enabled:false,path:'',args:''}, external_merge: {enabled:false,path:'',args:''}, binary_exts: ['png','jpg','dds','uasset'] };
      cur.lfs = { enabled: true, concurrency: 4, bandwidth_kbps: 0, require_lock_before_edit: false, background_fetch_on_checkout: true };
      cur.performance = { graph_node_cap: 5000, progressive_render: true, gpu_accel: true, index_warm_on_open: true, background_index_on_battery: false };
      cur.ux = { ui_scale: 1.0, font_mono: 'monospace', vim_nav: false, color_blind_mode: 'none' };

      await TAURI.invoke('set_global_settings', { cfg: cur });
      await loadSettingsIntoForm(modal);
      notify('Defaults restored');
    } catch (e) { console.error(e); notify('Failed to restore defaults'); }
  });

  // First fill
  loadSettingsIntoForm(modal).catch(console.error);
}

function collectSettingsFromForm(root) {
  const m = root || document.getElementById('settings-modal');
  const base = JSON.parse(m?.dataset.currentCfg || '{}');
  const get = (sel) => m?.querySelector(sel);

  const general = {
    ...base.general,
    theme: get('#set-theme')?.value,
    language: get('#set-language')?.value,
    update_channel: get('#set-update-channel')?.value,
    reopen_last_repos: !!get('#set-reopen-last')?.checked,
    checks_on_launch: !!get('#set-checks-on-launch')?.checked,
  };

  const git = {
    ...base.git,
    backend: get('#set-git-backend')?.value,
    auto_fetch: !!get('#set-auto-fetch')?.checked,
    auto_fetch_minutes: Number(get('#set-auto-fetch-minutes')?.value ?? 0),
    prune_on_fetch: !!get('#set-prune-on-fetch')?.checked,
    watcher_debounce_ms: Number(get('#set-watcher-debounce-ms')?.value ?? 0),
    large_repo_threshold_mb: Number(get('#set-large-repo-threshold-mb')?.value ?? 0),
    allow_hooks: get('#set-hook-policy')?.value,
    respect_core_autocrlf: !!get('#set-respect-autocrlf')?.checked,
  };

  const diff = {
    ...base.diff,
    tab_width: Number(get('#set-tab-width')?.value ?? 0),
    ignore_whitespace: get('#set-ignore-whitespace')?.value,
    max_file_size_mb: Number(get('#set-max-file-size-mb')?.value ?? 0),
    intraline: !!get('#set-intraline')?.checked,
    show_binary_placeholders: !!get('#set-binary-placeholders')?.checked,
  };

  const lfs = {
    ...base.lfs,
    enabled: !!get('#set-lfs-enabled')?.checked,
    concurrency: Number(get('#set-lfs-concurrency')?.value ?? 0),
    bandwidth_kbps: Number(get('#set-lfs-bandwidth')?.value ?? 0),
    require_lock_before_edit: !!get('#set-lfs-require-lock')?.checked,
    background_fetch_on_checkout: !!get('#set-lfs-bg-fetch')?.checked,
  };

  const performance = {
    ...base.performance,
    graph_node_cap: Number(get('#set-graph-cap')?.value ?? 0),
    progressive_render: !!get('#set-progressive-render')?.checked,
    gpu_accel: !!get('#set-gpu-accel')?.checked,
    index_warm_on_open: !!get('#set-index-warm')?.checked,
    background_index_on_battery: !!get('#set-bg-index-on-battery')?.checked,
  };

  const ux = {
    ...base.ux,
    ui_scale: Number(get('#set-ui-scale')?.value ?? 1),
    font_mono: get('#set-font-mono')?.value,
    vim_nav: !!get('#set-vim-nav')?.checked,
    color_blind_mode: get('#set-cb-mode')?.value,
  };

  return { ...base, general, git, diff, lfs, performance, ux };
}

async function loadSettingsIntoForm(root) {
  const m = root || document.getElementById('settings-modal');
  if (!m) return;
  const get = (sel) => m.querySelector(sel);

  const cfg = TAURI.has ? await TAURI.invoke('get_global_settings') : null;
  if (!cfg) return;

  m.dataset.currentCfg = JSON.stringify(cfg);

  // General
  const elTheme = get('#set-theme'); if (elTheme) elTheme.value = toKebab(cfg.general?.theme);
  const elLang  = get('#set-language'); if (elLang) elLang.value = toKebab(cfg.general?.language);
  const elChan  = get('#set-update-channel'); if (elChan) elChan.value = toKebab(cfg.general?.update_channel);
  const elReo   = get('#set-reopen-last'); if (elReo) elReo.checked = !!cfg.general?.reopen_last_repos;
  const elChk   = get('#set-checks-on-launch'); if (elChk) elChk.checked = !!cfg.general?.checks_on_launch;

  // Git
  const backend = toKebab(cfg.git?.backend);
  const elGb = get('#set-git-backend'); if (elGb) elGb.value = backend === 'libgit2' ? 'libgit2' : 'git-system';
  const elAf = get('#set-auto-fetch'); if (elAf) elAf.checked = !!cfg.git?.auto_fetch;
  const elAfm= get('#set-auto-fetch-minutes'); if (elAfm) elAfm.value = Number(cfg.git?.auto_fetch_minutes ?? 0);
  const elPr = get('#set-prune-on-fetch'); if (elPr) elPr.checked = !!cfg.git?.prune_on_fetch;
  const elWd = get('#set-watcher-debounce-ms'); if (elWd) elWd.value = Number(cfg.git?.watcher_debounce_ms ?? 0);
  const elLr = get('#set-large-repo-threshold-mb'); if (elLr) elLr.value = Number(cfg.git?.large_repo_threshold_mb ?? 0);
  const elHp = get('#set-hook-policy'); if (elHp) elHp.value = toKebab(cfg.git?.allow_hooks);
  const elRc = get('#set-respect-autocrlf'); if (elRc) elRc.checked = !!cfg.git?.respect_core_autocrlf;

  // Diff
  const elTw = get('#set-tab-width'); if (elTw) elTw.value = Number(cfg.diff?.tab_width ?? 0);
  const elIw = get('#set-ignore-whitespace'); if (elIw) elIw.value = toKebab(cfg.diff?.ignore_whitespace);
  const elMx = get('#set-max-file-size-mb'); if (elMx) elMx.value = Number(cfg.diff?.max_file_size_mb ?? 0);
  const elIn = get('#set-intraline'); if (elIn) elIn.checked = !!cfg.diff?.intraline;
  const elBp = get('#set-binary-placeholders'); if (elBp) elBp.checked = !!cfg.diff?.show_binary_placeholders;

  // LFS
  const elLe = get('#set-lfs-enabled'); if (elLe) elLe.checked = !!cfg.lfs?.enabled;
  const elLc = get('#set-lfs-concurrency'); if (elLc) elLc.value = Number(cfg.lfs?.concurrency ?? 0);
  const elLb = get('#set-lfs-bandwidth'); if (elLb) elLb.value = Number(cfg.lfs?.bandwidth_kbps ?? 0);
  const elLl = get('#set-lfs-require-lock'); if (elLl) elLl.checked = !!cfg.lfs?.require_lock_before_edit;
  const elBg = get('#set-lfs-bg-fetch'); if (elBg) elBg.checked = !!cfg.lfs?.background_fetch_on_checkout;

  // Performance
  const elGc = get('#set-graph-cap'); if (elGc) elGc.value = Number(cfg.performance?.graph_node_cap ?? 0);
  const elPrg= get('#set-progressive-render'); if (elPrg) elPrg.checked = !!cfg.performance?.progressive_render;
  const elGpu= get('#set-gpu-accel'); if (elGpu) elGpu.checked = !!cfg.performance?.gpu_accel;
  const elIdx= get('#set-index-warm'); if (elIdx) elIdx.checked = !!cfg.performance?.index_warm_on_open;
  const elBat= get('#set-bg-index-on-battery'); if (elBat) elBat.checked = !!cfg.performance?.background_index_on_battery;

  // UX
  const elUi = get('#set-ui-scale'); if (elUi) elUi.value = Number(cfg.ux?.ui_scale ?? 1.0);
  const elFm = get('#set-font-mono'); if (elFm) elFm.value = cfg.ux?.font_mono ?? 'monospace';
  const elVn = get('#set-vim-nav'); if (elVn) elVn.checked = !!cfg.ux?.vim_nav;
  const elCb = get('#set-cb-mode'); if (elCb) elCb.value = toKebab(cfg.ux?.color_blind_mode);
}

/* Small public hook for menu handler */
TAURI.listen?.('ui:open-settings', () => openSettings());
