import { qs, qsa, escapeHtml } from '../lib/dom';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { state, prefs, statusLabel, statusClass } from '../state/state';

const filterInput = qs<HTMLInputElement>('#filter');
const listEl      = qs<HTMLElement>('#file-list');
const countEl     = qs<HTMLElement>('#changes-count');

const diffHeadPath = qs<HTMLElement>('#diff-path');
const diffEl       = qs<HTMLElement>('#diff');

export function bindRepoHotkeys(commitBtn: HTMLButtonElement | null, openSheet: (w: 'clone'|'add'|'switch') => void) {
    if (!filterInput) return;
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (e.ctrlKey && key === 'f') { e.preventDefault(); filterInput.focus(); }
        if (e.ctrlKey && key === 'r') { e.preventDefault(); openSheet('switch'); }
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); commitBtn?.click(); }
        if (e.key === 'Escape') {
            const modal = document.getElementById('modal');
            const about = document.getElementById('about-modal');
            if (modal?.classList.contains('show')) openSheet('clone'); // no-op, keep focus; or close in caller
            if (about?.classList.contains('show')) about.classList.remove('show');
        }
    });
}

export function bindFilter() {
    filterInput?.addEventListener('input', () => renderList());
}

export function renderList() {
    if (!listEl || !countEl || !filterInput || !diffHeadPath || !diffEl) return;

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

function highlightRow(index: number) {
    const rows = qsa<HTMLElement>('.row', listEl || undefined as any);
    rows.forEach((el, i) => el.classList.toggle('active', i === index));
}

async function selectFile(file: { path: string }, index: number) {
    if (!diffHeadPath || !diffEl) return;
    highlightRow(index);
    diffHeadPath.textContent = file.path || '(unknown file)';
    diffEl.innerHTML = '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading…</div></div></div>';

    try {
        let lines: string[] = [];
        if (TAURI.has && file.path) {
            lines = await TAURI.invoke<string[]>('git_diff_file', { path: file.path });
        }
        diffEl.innerHTML = renderHunk(lines || []);
    } catch (e) {
        console.error(e);
        diffEl.innerHTML = `<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Failed to load diff</div></div></div>`;
    }
}

function selectHistory(commit: any, index: number) {
    if (!diffHeadPath || !diffEl) return;
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

export async function hydrateBranches() {
    try {
        if (!TAURI.has) return;
        const list = await TAURI.invoke<any[]>('list_branches');
        state.hasRepo = Array.isArray(list) && list.length > 0;
        if (state.hasRepo) {
            state.branches = list;
            state.branch = list.find(b => b.current)?.name || state.branch || 'main';
        } else {
            state.branch = '';
            state.branches = [];
            state.files = [];
            state.commits = [];
            renderList();
        }
    } catch {}
}

export async function hydrateStatus() {
    try {
        if (!TAURI.has) return;
        const result = await TAURI.invoke<{ files: any[] }>('git_status');
        state.hasRepo = true;
        if (result && Array.isArray(result.files)) {
            state.files = result.files as any;
            renderList();
        }
    } catch {
        state.hasRepo = false;
        state.files = [];
        renderList();
    }
}

export async function hydrateCommits() {
    try {
        if (!TAURI.has) return;
        const list = await TAURI.invoke<any[]>('git_log', { limit: 100 });
        state.hasRepo = true;
        if (Array.isArray(list)) {
            state.commits = list as any;
            if (prefs.tab === 'history') renderList();
        }
    } catch {
        state.hasRepo = false;
        state.commits = [];
    }
}

function renderHunk(hunk: string[]) {
    return `<div class="hunk">${
        (hunk || []).map((ln, i) => {
            const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
            const t = first === '+' ? 'add' : first === '-' ? 'del' : '';
            return `<div class="hline ${t}"><div class="gutter">${i+1}</div><div class="code">${escapeHtml(String(ln))}</div></div>`;
        }).join('')
    }</div>`;
}
