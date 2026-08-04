// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { escapeHtml } from '../../lib/dom';
import { DiffMeta, HunkNodeRefs, state } from '../../state/state';

/** Scans diff lines for unified-diff hunk header markers. */
function scanHunkStarts(lines: string[]): { idx: number; rest: string[]; starts: number[] } {
    const idx = lines.findIndex((l) => (l || '').startsWith('@@'));
    const rest = idx >= 0 ? lines.slice(idx) : [];
    const starts: number[] = [];
    rest.forEach((l, i) => { if ((l || '').startsWith('@@')) starts.push(i); });
    return { idx, rest, starts };
}
/** Markup for a selectable hunk-selection label (checkbox + screen-reader text). */
function hunkSelectionLabelHtml(h: number): string {
    return `<label class="pick-toggle"><input type="checkbox" class="pick-hunk" data-hunk="${h}" /><span class="sr-only">Include hunk</span></label>`;
}

/** Returns contiguous hunk indices derived from unified diff lines. */
export function allHunkIndices(lines: string[]) {
    const meta = state.currentDiffMeta;
    if (meta && meta.totalHunks > 0) {
        return Array.from({ length: meta.totalHunks }, (_, i) => i);
    }
    if (!Array.isArray(lines) || !lines.length) return [] as number[];
    return scanHunkStarts(lines).starts.map((_, i) => i);
}

/** Parses diff lines into reusable metadata for hunk rendering. */
function buildDiffMeta(lines: string[]): DiffMeta {
    const { idx, rest, starts } = scanHunkStarts(lines);
    if (starts.length === 0) return {
        offset: Math.max(0, idx),
        rest,
        starts,
        changeCounts: [],
        totalHunks: 0,
    };
    starts.push(rest.length);
    const changeCounts: number[] = [];
    for (let h = 0; h < starts.length - 1; h++) {
        const s = starts[h];
        const e = starts[h + 1];
        const block = rest.slice(s + 1, e);
        const cnt = block.reduce((acc, ln) => {
            const first = (ln || '')[0] || ' ';
            return acc + ((first === '+' || first === '-') ? 1 : 0);
        }, 0);
        changeCounts[h] = cnt;
    }
    return {
        offset: Math.max(0, idx),
        rest,
        starts,
        changeCounts,
        totalHunks: Math.max(0, starts.length - 1),
    };
}

/** Builds a DOM fragment for diff hunks and caches node references. */
function buildDiffFragment(lines: string[]): DocumentFragment {
    const meta = buildDiffMeta(lines);
    state.currentDiffMeta = meta;
    const fragment = document.createDocumentFragment();
    const nodes = new Map<number, HunkNodeRefs>();
    if (meta.totalHunks <= 0) {
        const empty = document.createElement('div');
        empty.className = 'hunk';
        const hline = document.createElement('div');
        hline.className = 'hline';
        const gutter = document.createElement('div');
        gutter.className = 'gutter';
        const code = document.createElement('div');
        code.className = 'code';
        code.textContent = 'No textual hunks to display';
        hline.appendChild(gutter);
        hline.appendChild(code);
        empty.appendChild(hline);
        fragment.appendChild(empty);
        state.currentDiffHunkNodes = nodes;
        return fragment;
    }
    for (let h = 0; h < meta.totalHunks; h++) {
        const s = meta.starts[h];
        const e = meta.starts[h + 1];
        const hunkLines = meta.rest.slice(s, e);
        const offset = meta.offset + s;
        const lineCheckboxes: Record<number, HTMLInputElement> = {};
        const lineRows = hunkLines.map((ln, i) => {
            const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
            const lineRow = document.createElement('div');
            lineRow.className = `hline${first === '+' ? ' add' : first === '-' ? ' del' : ''}`;
            const lineGutter = document.createElement('div');
            lineGutter.className = 'gutter';
            if (first === '+' || first === '-') {
                const leftNumber = document.createElement('span');
                leftNumber.className = 'line-number line-number-left';
                const rightNumber = document.createElement('span');
                rightNumber.className = 'line-number line-number-right';
                const numberText = String(offset + i + 1);
                if (first === '-') leftNumber.textContent = numberText;
                else rightNumber.textContent = numberText;
                lineGutter.appendChild(leftNumber);
                const lineLabel = document.createElement('label');
                lineLabel.className = 'pick-toggle';
                const lineCheckbox = document.createElement('input');
                lineCheckbox.type = 'checkbox';
                lineCheckbox.className = 'pick-line';
                lineCheckbox.dataset.hunk = String(h);
                lineCheckbox.dataset.line = String(i);
                lineLabel.appendChild(lineCheckbox);
                const srLine = document.createElement('span');
                srLine.className = 'sr-only';
                srLine.textContent = 'Include line';
                lineLabel.appendChild(srLine);
                lineGutter.appendChild(lineLabel);
                lineGutter.appendChild(rightNumber);
                lineCheckboxes[i] = lineCheckbox;
            }
            if (first !== '+' && first !== '-') {
                const lineNumber = document.createElement('span');
                lineNumber.className = 'line-number line-number-right';
                lineNumber.textContent = String(offset + i + 1);
                lineGutter.appendChild(lineNumber);
            }
            const code = document.createElement('div');
            code.className = 'code';
            code.innerHTML = escapeHtml(String(ln || ''));
            lineRow.appendChild(lineGutter);
            lineRow.appendChild(code);
            return lineRow;
        });
        const hunkEls: HTMLElement[] = [];
        const hunkCheckboxes: HTMLInputElement[] = [];
        let currentSegmentRows: HTMLElement[] = [];
        const flushSegment = () => {
            if (currentSegmentRows.length === 0) return;
            const hunkEl = document.createElement('div');
            hunkEl.className = 'hunk';
            hunkEl.dataset.hunkIndex = String(h);
            hunkEl.innerHTML = `<div class="hunk-selection-body">${hunkSelectionLabelHtml(h)}</div>`;
            const selectionBody = hunkEl.querySelector<HTMLElement>('.hunk-selection-body');
            if (selectionBody) {
                currentSegmentRows.forEach((row) => {
                    selectionBody.appendChild(row);
                });
            }
            const hunkCheckbox = selectionBody?.querySelector<HTMLInputElement>('.pick-hunk');
            fragment.appendChild(hunkEl);
            hunkEls.push(hunkEl);
            if (hunkCheckbox) hunkCheckboxes.push(hunkCheckbox);
            currentSegmentRows = [];
        };
        hunkLines.forEach((ln, i) => {
            const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
            const row = lineRows[i];
            if (first === '+' || first === '-') {
                currentSegmentRows.push(row);
                return;
            }
            flushSegment();
            fragment.appendChild(row);
        });
        flushSegment();
        nodes.set(h, { hunkEls, hunkCheckboxes, lineCheckboxes });
    }
    state.currentDiffHunkNodes = nodes;
    return fragment;
}

export { buildDiffFragment, buildDiffMeta };

/** Renders diff hunks as HTML with selectable hunk and line checkboxes. */
export function renderHunksWithSelection(lines: string[]) {
    if (!lines || !lines.length) return '';
    const { idx, rest, starts } = scanHunkStarts(lines);
    starts.push(rest.length);
    if (starts.length <= 1) {
        return '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">No textual hunks to display</div></div></div>';
    }
    let html = '';
    for (let h = 0; h < starts.length - 1; h++) {
        const s = starts[h];
        const e = starts[h + 1];
        const hunkLines = rest.slice(s, e);
        const offset = (idx >= 0 ? idx : 0) + s;
        const body = hunkLines.map((ln, i) => {
            const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
            const isChange = first === '+' || first === '-';
            const numberText = `${offset + i + 1}`;
            const leftNumber = isChange && first === '-' ? `<span class="line-number line-number-left">${numberText}</span>` : isChange ? `<span class="line-number line-number-left"></span>` : '';
            const rightNumber = isChange && first === '+' ? `<span class="line-number line-number-right">${numberText}</span>` : isChange ? `<span class="line-number line-number-right"></span>` : `<span class="line-number line-number-right">${numberText}</span>`;
            const lineCheckbox = isChange ? `<label class="pick-toggle"><input type="checkbox" class="pick-line" data-hunk="${h}" data-line="${i}" /><span class="sr-only">Include line</span></label>` : '';
            const t = first === '+' ? 'add' : first === '-' ? 'del' : '';
            return `<div class="hline ${t}"><div class="gutter">${leftNumber}${lineCheckbox}${rightNumber}</div><div class="code">${escapeHtml(String(ln))}</div></div>`;
        });
        let currentSegmentRows: string[] = [];
        const flushSegment = () => {
            if (currentSegmentRows.length === 0) return;
            html += `<div class="hunk" data-hunk-index="${h}"><div class="hunk-selection-body">${hunkSelectionLabelHtml(h)}${currentSegmentRows.join('')}</div></div>`;
            currentSegmentRows = [];
        };
        hunkLines.forEach((ln, i) => {
            const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
            const row = body[i];
            if (first === '+' || first === '-') {
                currentSegmentRows.push(row);
                return;
            }
            flushSegment();
            html += row;
        });
        flushSegment();
    }
    return html;
}

/** Renders diff hunks as static, read-only HTML. */
export function renderHunksReadonly(lines: string[]) {
    if (!lines || !lines.length) return '';
    const { idx, rest, starts } = scanHunkStarts(lines);
    starts.push(rest.length);
    if (starts.length <= 1) {
        return '<div class="hunk"><div class="hline"><div class="gutter"></div><div class="code">No textual hunks to display</div></div></div>';
    }
    let html = '';
    for (let h = 0; h < starts.length - 1; h++) {
        const s = starts[h];
        const e = starts[h + 1];
        const hunkLines = rest.slice(s, e);
        const offset = (idx >= 0 ? idx : 0) + s;
        html += `<div class="hunk">${hunkLines.map((ln, i) => hline(ln, offset + i + 1)).join('')}</div>`;
    }
    return html;
}

/** Renders one read-only diff line row. */
function hline(ln: string, n: number) {
    const first = (typeof ln === 'string' ? ln[0] : ' ') || ' ';
    const t = first === '+' ? 'add' : first === '-' ? 'del' : '';
    return `<div class="hline ${t}"><div class="gutter">${n}</div><div class="code">${escapeHtml(String(ln))}</div></div>`;
}
