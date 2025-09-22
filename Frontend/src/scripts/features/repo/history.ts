import { escapeHtml } from '../../lib/dom';
import { buildCtxMenu, CtxItem } from '../../lib/menu';
import { TAURI } from '../../lib/tauri';
import { notify } from '../../lib/notify';
import { state, statusClass } from '../../state/state';
import { diffEl, diffHeadPath, listEl, countEl } from './context';
import { renderHunksReadonly, highlightRow } from './diffView';
import { hydrateStatus, hydrateCommits } from './hydrate';
import { updateCommitButton } from './commit';

export function renderHistoryList(query: string): boolean {
    if (!listEl || !countEl || !diffHeadPath || !diffEl) return false;
    listEl.innerHTML = '';
    const commits = (state.commits || []).filter((c) =>
        !query || c.msg?.toLowerCase().includes(query) || c.id?.includes(query)
    );
    countEl.textContent = `${commits.length} commit${commits.length === 1 ? '' : 's'}`;

    if (!commits.length) {
        listEl.innerHTML = '<li class="row" aria-disabled="true"><div class="file">No commits loaded.</div></li>';
        diffHeadPath.textContent = 'Commit details';
        diffEl.innerHTML = '';
        updateCommitButton();
        return true;
    }

    const ahead = Number((state as any).ahead || 0);
    const behind = Number((state as any).behind || 0);
    if (behind > 0) {
        const info = document.createElement('li');
        info.className = 'row notice';
        info.innerHTML = `<div class="file" title="Commits exist on the remote that are not pulled locally">↓ ${behind} incoming commit${behind === 1 ? '' : 's'} on remote</div>`;
        listEl.appendChild(info);
    }

    const aheadIds: Set<string> = (state as any).aheadIds || new Set<string>();
    let aheadFallbackRemaining = aheadIds.size > 0 ? 0 : ahead;
    commits.forEach((c, i) => {
        const li = document.createElement('li');
        const isIncoming = Boolean((c as any)?.incoming);
        li.className = isIncoming ? 'row commit incoming' : 'row commit';
        const short = (c.id || '').slice(0, 7);
        const whenRaw = String(c.meta || '').split('•')[0].trim();
        const rel = formatTimeAgo(whenRaw);
        const exact = (c.meta || '').trim();
        let isAhead = false;
        if (c?.id) {
            if (aheadIds.size > 0) {
                isAhead = aheadIds.has(c.id);
            } else if (!isIncoming && aheadFallbackRemaining > 0) {
                isAhead = true;
                aheadFallbackRemaining -= 1;
            }
        }
        const remoteRef = String(((c as any)?.remoteRef || 'remote')).trim();
        const remoteLabel = remoteRef === '@{upstream}' ? 'upstream' : remoteRef;
        const statusTag = isAhead
            ? `<span class=\"tag up\" title=\"Not on remote yet\">↑ outgoing</span>`
            : isIncoming
                ? `<span class=\"tag down\" title=\"${escapeHtml(`Fetched from ${remoteLabel}; pull to apply locally`)}\">↓ incoming</span>`
                : '';
        li.innerHTML = `
        <span class="badge hash" title="${escapeHtml(c.id || '')}">${escapeHtml(short)}</span>
        <div class="file" title="${escapeHtml(c.msg || '')}">${escapeHtml(c.msg || '(no message)')}</div>
        ${statusTag}
        <span class="badge time" title="${escapeHtml(exact)}">${escapeHtml(rel)}</span>`;
        li.addEventListener('click', () => selectHistory(c, i));
        li.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            const x = (ev as MouseEvent).clientX, y = (ev as MouseEvent).clientY;
            const items: CtxItem[] = [];
            items.push({ label: 'Copy hash', action: async () => {
                try {
                    await navigator.clipboard.writeText(c.id || '');
                    notify('Hash copied');
                } catch { /* ignore */ }
            }});
            if (isAhead) {
                items.push({ label: '---' });
                items.push({ label: 'Undo to this commit', action: async () => {
                    if (!TAURI.has) return;
                    try {
                        await TAURI.invoke('git_undo_to_commit', { id: c.id });
                        await Promise.allSettled([hydrateStatus(), hydrateCommits()]);
                    } catch { notify('Undo failed'); }
                }});
            }
            buildCtxMenu(items, x, y);
        });
        listEl.appendChild(li);
    });
    selectHistory(commits[0], 0);
    updateCommitButton();
    return true;
}

export async function selectHistory(commit: any, index: number) {
    if (!diffHeadPath || !diffEl) return;
    highlightRow(index);
    const id = (commit.id || '').slice(0, 7);
    diffHeadPath.textContent = `Commit ${id || '(unknown)'}`;
    diffEl.innerHTML = `
    <div class="hunk">
      <div class="hline"><div class="gutter">commit</div><div class="code">${escapeHtml(commit.id || '')}</div></div>
      <div class="hline"><div class="gutter">Author</div><div class="code">${escapeHtml(commit.author || 'You <you@example.com>')}</div></div>
      <div class="hline"><div class="gutter">Message</div><div class="code">${escapeHtml(commit.msg || '')}</div></div>
    </div>
    <div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Loading diff…</div></div></div>`;

    try {
        let lines: string[] = [];
        if (TAURI.has && commit.id) {
            lines = await TAURI.invoke<string[]>('git_diff_commit', { id: commit.id });
        }
        const files = parseCommitDiffByFile(lines || []);
        if (files.length === 0) {
            const diffHtml = renderHunksReadonly(lines || []);
            const label = diffHtml ? '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Changes</div></div></div>' : '';
            diffEl.innerHTML = `
    <div class="hunk">
      <div class="hline"><div class="gutter">commit</div><div class="code">${escapeHtml(commit.id || '')}</div></div>
      <div class="hline"><div class="gutter">Author</div><div class="code">${escapeHtml(commit.author || 'You <you@example.com>')}</div></div>
      <div class="hline"><div class="gutter">Message</div><div class="code">${escapeHtml(commit.msg || '')}</div></div>
    </div>
    ${label}${diffHtml || ''}`;
            return;
        }

        const sidebar = `<div class="commit-files" style="width: 280px; flex: 0 0 280px; border-right: 1px solid var(--panel-border, #333); overflow:auto;">
          ${files.map((f, i) => {
              const cls = i === 0 ? 'row active' : 'row';
              const status = (f.status || '').toUpperCase();
              return `<div class="${cls}" data-idx="${i}"><span class="status ${statusClass(status)}">${escapeHtml(status)}</span><div class="file" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</div></div>`;
          }).join('')}
        </div>`;
        const right = `<div class="commit-right" style="flex:1; overflow:auto; padding-left: 8px; display:flex; flex-direction:column;"><div class="commit-content">${renderHunksReadonly(files[0].lines)}</div></div>`;

        diffEl.innerHTML = `
    <div class="hunk">
      <div class="hline"><div class="gutter">commit</div><div class="code">${escapeHtml(commit.id || '')}</div></div>
      <div class="hline"><div class="gutter">Author</div><div class="code">${escapeHtml(commit.author || 'You <you@example.com>')}</div></div>
      <div class="hline"><div class="gutter">Message</div><div class="code">${escapeHtml(commit.msg || '')}</div></div>
    </div>
    <div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">${files.length} file${files.length === 1 ? '' : 's'} changed</div></div></div>
    <div class="commit-diff" style="display:flex; min-height: 240px; gap: 8px;">${sidebar}${right}</div>`;

        const sideEl = diffEl.querySelector('.commit-files');
        const contentEl = diffEl.querySelector('.commit-content');
        if (sideEl && contentEl) {
            sideEl.querySelectorAll<HTMLElement>('.row').forEach((row) => {
                row.addEventListener('click', () => {
                    sideEl.querySelectorAll('.row').forEach((r) => r.classList.remove('active'));
                    row.classList.add('active');
                    const idx = Number(row.getAttribute('data-idx') || '-1');
                    if (idx >= 0 && idx < files.length) {
                        (contentEl as HTMLElement).innerHTML = renderHunksReadonly(files[idx].lines);
                    }
                });
            });
        }
    } catch (e) {
        console.warn('git_diff_commit failed', e);
        diffEl.innerHTML += '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">Failed to load diff</div></div></div>';
    }
}

export function parseCommitDiffByFile(lines: string[]): { path: string; status: string; lines: string[] }[] {
    if (!Array.isArray(lines) || lines.length === 0) return [];
    const files: { path: string; status: string; lines: string[] }[] = [];
    let i = 0;
    while (i < lines.length) {
        const l = lines[i] || '';
        if (l.startsWith('diff --git ')) {
            const parts = l.split(' ');
            const aPath = parts[2] || '';
            const bPath = parts[3] || '';
            const pathA = aPath.startsWith('a/') ? aPath.slice(2) : aPath;
            const pathB = bPath.startsWith('b/') ? bPath.slice(2) : bPath;
            const path = pathB || pathA;
            let j = i + 1;
            while (j < lines.length && !String(lines[j]).startsWith('diff --git ')) j++;
            const block = lines.slice(i, j);
            const prelude = block.slice(0, Math.min(block.length, 10));
            const isAdd = prelude.some((s) => s.startsWith('new file mode') || s.startsWith('--- /dev/null'));
            const isDel = prelude.some((s) => s.startsWith('deleted file mode') || s.startsWith('+++ /dev/null'));
            const status = isAdd ? 'A' : isDel ? 'D' : 'M';
            files.push({ path, status, lines: block });
            i = j;
            continue;
        }
        i++;
    }
    return files;
}

export function formatTimeAgo(isoMaybe: string): string {
    try {
        const d = new Date(String(isoMaybe || '').trim());
        const t = d.getTime();
        if (!isFinite(t)) return (isoMaybe || '').trim();
        const now = Date.now();
        let sec = Math.max(0, Math.round((now - t) / 1000));
        if (sec < 45) return 'just now';
        if (sec < 90) return '1 minute ago';
        let min = Math.round(sec / 60);
        if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
        let hr = Math.round(min / 60);
        if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
        let day = Math.round(hr / 24);
        if (day === 1) return 'yesterday';
        if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
        let wk = Math.round(day / 7);
        if (wk === 1) return '1 week ago';
        if (wk < 5) return `${wk} weeks ago`;
        let mon = Math.round(day / 30);
        if (mon === 1) return '1 month ago';
        if (mon < 12) return `${mon} months ago`;
        let yr = Math.round(day / 365);
        return `${yr} year${yr === 1 ? '' : 's'} ago`;
    } catch {
        return (isoMaybe || '').trim();
    }
}
