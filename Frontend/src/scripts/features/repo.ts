// src/scripts/features/repo.ts
import { qs, qsa, escapeHtml } from '../lib/dom';
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { state, prefs, statusLabel, statusClass } from '../state/state';

const filterInput   = qs<HTMLInputElement>('#filter');
const listEl        = qs<HTMLElement>('#file-list');
const countEl       = qs<HTMLElement>('#changes-count');

const diffHeadPath  = qs<HTMLElement>('#diff-path');
const diffEl        = qs<HTMLElement>('#diff');

export function bindRepoHotkeys(commitBtn: HTMLButtonElement | null, openSheet: (w: 'clone'|'add'|'switch') => void) {
    if (!filterInput) return;
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (e.ctrlKey && key === 'f') { e.preventDefault(); filterInput.focus(); }
        if (e.ctrlKey && key === 'r') { e.preventDefault(); openSheet('switch'); }
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); commitBtn?.click(); }
        if (e.key === 'Escape') {
            const about = document.getElementById('about-modal');
            if (about?.classList.contains('show')) about.classList.remove('show');
            // do not force-open the command sheet on Esc; let modal system handle closes
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
            li.innerHTML = `
        <span class="badge">${(c.id || '').slice(0,7)}</span>
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
    const rows = qsa<HTMLElement>('.row', listEl || (undefined as any));
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

/* ---------------- hydration ---------------- */

/** Keep names consistent with backend: git_list_branches / git_current_branch */
export async function hydrateBranches() {
    if (!TAURI.has) return;
    try {
        const list = await TAURI.invoke<any[]>('git_list_branches');
        const current = await TAURI.invoke<string>('git_current_branch').catch(() => '');

        const has = Array.isArray(list) && list.length > 0;
        state.hasRepo = state.hasRepo || has; // don’t flip to false if another hydrate confirms true

        if (has) {
            state.branches = list as any;
            state.branch = current || (list.find((b: any) => b.current)?.name) || state.branch || 'main';
            window.dispatchEvent(new CustomEvent('app:branches-updated'));
        }
    } catch (e) {
        // Don’t nuke state here; status/summary calls will decide hasRepo
        console.warn('hydrateBranches failed', e);
    }
}

/** Status drives file list; on failure we clear files but don’t assert repo absence unless it’s consistent */
export async function hydrateStatus() {
    if (!TAURI.has) return;
    try {
        const result = await TAURI.invoke<{ files: any[]; ahead?: number; behind?: number }>('git_status');
        state.hasRepo = true;
        state.files = Array.isArray(result?.files) ? (result.files as any) : [];
        // ahead/behind are optional in older backends; default to 0
        (state as any).ahead = Number((result as any)?.ahead || 0);
        (state as any).behind = Number((result as any)?.behind || 0);
        renderList();
        window.dispatchEvent(new CustomEvent('app:status-updated'));
    } catch (e) {
        console.warn('hydrateStatus failed', e);
        state.files = [];
        renderList();
        window.dispatchEvent(new CustomEvent('app:status-updated'));
    }
}

export async function hydrateCommits() {
    if (!TAURI.has) return;
    try {
        const list = await TAURI.invoke<any[]>('git_log', { limit: 100 });
        state.hasRepo = true;
        state.commits = Array.isArray(list) ? (list as any) : [];
        if (prefs.tab === 'history') renderList();
    } catch (e) {
        console.warn('hydrateCommits failed', e);
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
