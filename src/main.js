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
const commitBranch = qs('#commit-branch');

/* ---- Branch UI ---- */
const branchBtn    = qs('#branch-switch');
const branchName   = qs('#branch-name');
const branchPop    = qs('#branch-pop');
const branchFilter = qs('#branch-filter');
const branchList   = qs('#branch-list');

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

qsa('[data-close], .backdrop', modal).forEach(el => el.addEventListener('click', closeSheet));
qsa('[data-proto]').forEach(b => b.addEventListener('click', () => {
  qsa('[data-proto]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));

/* =========================
   App state (persisted)
   ========================= */
const STORE_KEY = 'ovcs.desktop.v1';
const initial = {
  theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  leftW: 0,       // pixels; 0 means compute from container
  tab: 'changes',
  branch: 'main',
  branches: [
    { name: 'main', current: true },
    { name: 'develop', current: false },
    { name: 'feature/ui-refresh', current: false },
  ],
  demo: {
    ahead: 2, behind: 0,
    files: [
      { path: 'src/main.rs', status: 'M', hunks: [['@@ 1,6 1,6 @@', '-fn main() {', '+fn main() {', '    println!("Running OpenVCS...");', '}']] },
      { path: 'src/ui/panel.rs', status: 'A', hunks: [['@@ 0,0 1,12 @@', '+pub struct Panel {', '+  pub title: String,', '+}']] },
      { path: 'README.md', status: 'D', hunks: [['@@ 1,3 0,0 @@', '-# OpenVCS', '-CLI + Tauri prototype', '-Work in progress']] },
      { path: 'tauri.conf.json', status: 'M', hunks: [['@@ 10,14 10,14 @@', '  "tauri": {', '-    "bundle": {', '+    "bundle": { "active": true,', '      "identifier": "app.openvcs"', '    }', '  }']] },
    ],
  },
};
let state = Object.assign({}, initial, safeParse(localStorage.getItem(STORE_KEY)));
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function safeParse(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

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
  state.theme = theme; save();
}
function toggleTheme() { setTheme(state.theme === 'dark' ? 'light' : 'dark'); }
function statusLabel(s) { return s === 'A' ? 'Added' : s === 'M' ? 'Modified' : s === 'D' ? 'Deleted' : 'Changed'; }
function statusClass(s) { return s === 'A' ? 'add' : s === 'M' ? 'mod' : s === 'D' ? 'del' : 'mod'; }
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

/* =========================
   Boot
   ========================= */
applyInitial();
function applyInitial() {
  setTheme(state.theme);
  const curBranch = (state.branches.find(b => b.current) || {name: state.branch}).name;
  state.branch = curBranch;
  commitBranch.textContent = curBranch;
  if (branchName) branchName.textContent = curBranch;
  setTab(state.tab);
  initResizer();      // sets initial grid track & handlers
  renderList();       // populate left list
  hydrateBranches();  // try to load from backend if available
}

/* =========================
   Tabs (Changes / History)
   ========================= */
tabs.forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
function setTab(tab) {
  state.tab = tab; save();
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
    const px = state.leftW && state.leftW > 0 ? state.leftW : Math.round(cw * 0.32);
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
    state.leftW = leftPx; save();
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
  if (e.key === 'Escape' && modal.classList.contains('show')) { closeSheet(); }
});

function renderList() {
  listEl.innerHTML = '';
  const isHistory = state.tab === 'history';
  const q = filterInput.value.trim().toLowerCase();

  if (isHistory) {
    const commits = [
      { id: 'b2c4a1e', msg: 'UI: introduce modern desktop layout', meta: 'You · 2m ago' },
      { id: '9a77df0', msg: 'feat(core): add repo indexer',        meta: 'You · 2h ago' },
      { id: 'ce22bb1', msg: 'chore: cargo update',                  meta: 'bot · yesterday' },
    ].filter(c => !q || c.msg.toLowerCase().includes(q) || c.id.includes(q));

    countEl.textContent = `${commits.length} commits`;
    commits.forEach((c, i) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.innerHTML = `<span class="badge">${c.id.slice(0,7)}</span>
                      <div class="file" title="${c.msg}">${c.msg}</div>
                      <span class="badge">${c.meta}</span>`;
      li.addEventListener('click', () => selectHistory(c, i));
      listEl.appendChild(li);
    });
    if (commits[0]) selectHistory(commits[0], 0);
    return;
  }

  const files = (state.demo.files || []).filter(f =>
    !q || f.path.toLowerCase().includes(q)
  );
  countEl.textContent = `${files.length} files`;

  files.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('role', 'option');
    li.innerHTML = `
      <span class="status ${statusClass(f.status)}">${f.status}</span>
      <div class="file" title="${f.path}">${f.path}</div>
      <span class="badge">${statusLabel(f.status)}</span>`;
    li.addEventListener('click', () => selectFile(f, i));
    listEl.appendChild(li);
  });

  if (files.length) selectFile(files[0], 0);
}

function highlightRow(index) {
  qsa('.row', listEl).forEach((el, i) => el.classList.toggle('active', i === index));
}
function selectFile(file, index) {
  highlightRow(index);
  diffHeadPath.textContent = file.path;
  diffEl.innerHTML = file.hunks.map(renderHunk).join('');
}
function selectHistory(commit, index) {
  highlightRow(index);
  diffHeadPath.textContent = `Commit ${commit.id.slice(0,7)}`;
  diffEl.innerHTML = `
    <div class="hunk">
      <div class="hline"><div class="gutter">commit</div><div class="code">${commit.id}</div></div>
      <div class="hline"><div class="gutter">Author</div><div class="code">You &lt;you@example.com&gt;</div></div>
      <div class="hline"><div class="gutter">Message</div><div class="code">${commit.msg}</div></div>
    </div>`;
}
function renderHunk(hunk) {
  return `<div class="hunk">${
    hunk.map((ln, i) => {
      const t = ln.startsWith('+') ? 'add' : ln.startsWith('-') ? 'del' : '';
      const safe = ln.replace(/&/g,'&amp;').replace(/</g,'&lt;');
      return `<div class="hline ${t}"><div class="gutter">${i+1}</div><div class="code">${safe}</div></div>`;
    }).join('')
  }</div>`;
}

/* =========================
   Commit action (mock + hook)
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
  } catch (e) {
    console.error(e); notify('Commit failed');
  }
});

/* =========================
   Title actions: fetch/push/theme/clone
   ========================= */
themeBtn?.addEventListener('click', toggleTheme);

fetchBtn?.addEventListener('click', async () => {
  try { if (TAURI.has) await TAURI.invoke('git_fetch', {}); notify('Fetched'); }
  catch (e) { console.error(e); notify('Fetch failed'); }
});

pushBtn?.addEventListener('click', async () => {
  try { if (TAURI.has) await TAURI.invoke('git_push', {}); notify('Pushed'); }
  catch (e) { console.error(e); notify('Push failed'); }
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
    case 'toggle_left':  /* basic toggle for wide layout */
      {
        const stacked = window.matchMedia('(max-width: 980px)').matches;
        if (!stacked) {
          const isHidden = leftPanel.style.display === 'none';
          leftPanel.style.display = isHidden ? '' : 'none';
          workGrid.style.gridTemplateColumns = isHidden ? '' : `0px 6px 1fr`;
        }
      }
      break;
    case 'fetch': fetchBtn?.click(); break;
    case 'push':  pushBtn?.click();  break;
    case 'commit': commitBtn?.click(); break;
    case 'docs': notify('Open docs…'); break;
    case 'about': notify('Open About…'); break;
  }
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

/* Validation (simple heuristics; Rust side should re-validate) */
function isLikelyGitUrl(v) { return /\.git(\s|$)/i.test(v) && (v.startsWith('http') || v.includes('@')); }
function isLikelyPath(v)   { return v.startsWith('/') || v.startsWith('~'); }
function setDisabled(id, on) { const el = qs('#' + id); if (el) el.disabled = on; }
function validateClone()  { setDisabled('do-clone', !(isLikelyGitUrl(cloneUrl.value.trim()) && isLikelyPath(clonePath.value.trim()))); }
function validateAdd()    { setDisabled('do-add', !isLikelyPath(addPath.value.trim())); }

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
  } catch (e) { console.error(e); notify('Clone failed'); }
});
doAdd?.addEventListener('click', async () => {
  const path = addPath.value.trim();
  if (!path) return;

  try {
    if (TAURI.has) await TAURI.invoke('add_repo', { path });
    notify(`Added ${path}`);
    closeSheet();
  } catch (e) { console.error(e); notify('Add failed'); }
});

/* Populate recents and wire per-item Open buttons */
(async function loadRecents() {
  try {
    let recents = [
      { name: 'OpenVCS',    path: '~/Projects/OpenVCS' },
      { name: 'Lunaris',    path: '~/Projects/Lunaris' },
      { name: 'HarmonyLink',path: '~/Projects/HarmonyLink' },
    ];
    if (TAURI.has) {
      const fromRust = await TAURI.invoke('list_recent_repos').catch(() => null);
      if (Array.isArray(fromRust) && fromRust.length) recents = fromRust;
    }
    recentList.innerHTML = recents.map(r =>
      `<li data-path="${r.path}">
         <div><strong>${escapeHtml(r.name || r.path.split('/').pop())}</strong>
         <div class="path">${escapeHtml(r.path)}</div></div>
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
  branchList.innerHTML = items.map(b => `
    <li role="option" data-branch="${b.name}" aria-selected="${b.current ? 'true' : 'false'}">
      <span class="label">
        <span class="branch-dot" aria-hidden="true" style="box-shadow:none;${b.current?'':'opacity:.5'}"></span>
        <span class="name" title="${b.name}">${b.name}</span>
      </span>
      ${b.current ? '<span class="badge">Current</span>' : ''}
    </li>
  `).join('');
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
    // update UI state
    state.branches.forEach(b => b.current = (b.name === name));
    state.branch = name;
    branchName.textContent = name;
    commitBranch.textContent = name;
    save();
    renderBranches();
    closeBranchPopover();
    notify(`Switched to ${name}`);
  } catch (err) {
    console.error(err); notify('Checkout failed');
  }
});

qs('#branch-new')?.addEventListener('click', async () => {
  const base = (state.branches.find(b => b.current) || {}).name || 'main';
  const name = prompt(`New branch name (from ${base})`);
  if (!name) return;
  try {
    if (TAURI.has) await TAURI.invoke('git_create_branch', { name, from: base, checkout: true });
    state.branches.forEach(b => b.current = false);
    state.branches.unshift({ name, current: true });
    state.branch = name;
    branchName.textContent = name;
    commitBranch.textContent = name;
    save();
    renderBranches();
    closeBranchPopover();
    notify(`Created branch ${name}`);
  } catch (e) { console.error(e); notify('Create branch failed'); }
});

/* Load branches from backend if available */
async function hydrateBranches() {
  try {
    if (!TAURI.has) return;
    const list = await TAURI.invoke('list_branches'); // expect [{name, current}]
    if (Array.isArray(list) && list.length) {
      state.branches = list;
      const cur = list.find(b => b.current)?.name || state.branch || 'main';
      state.branch = cur;
      branchName.textContent = cur;
      commitBranch.textContent = cur;
      save();
    }
  } catch (e) { /* silent if not implemented */ }
}

/* =========================
   Backend events
   ========================= */
TAURI.listen?.('git-progress', ({ payload }) => {
  statusEl.textContent = payload?.message || 'Working…';
});
