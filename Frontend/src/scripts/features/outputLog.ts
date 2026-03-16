// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { initOverlayScrollbarsFor, refreshOverlayScrollbarsFor } from '../lib/scrollbars';

type OutputLevel = 'info' | 'warn' | 'error';
type OutputLogEntry = { ts_ms: number; level: OutputLevel; source: string; message: string };
type LogTab = 'vcs' | 'app';

function fmtTime(ts: number) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour12: false });
  } catch {
    return '';
  }
}

function levelFrom(entry: OutputLogEntry): OutputLevel {
  const lvl = String(entry?.level || 'info').toLowerCase();
  if (lvl === 'warn' || lvl === 'warning') return 'warn';
  if (lvl === 'error') return 'error';
  return 'info';
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c] || c);
}

function renderRow(entry: OutputLogEntry) {
  const lvl = levelFrom(entry);
  const time = fmtTime(Number(entry.ts_ms || 0));
  const src = String(entry.source || '').trim();
  const msg = String(entry.message || '');
  const prefix = `${time} ${src}${src ? ':' : ''}`;
  const line = `${prefix} ${msg}`.trimEnd();
  return `<div class="outlog-row outlog-${lvl}"><span class="outlog-line">${escapeHtml(line)}</span></div>`;
}

function setActiveTab(root: HTMLElement, next: LogTab) {
  root.dataset.activeTab = next;
  const tabs = root.querySelectorAll<HTMLButtonElement>('.outlog-tab');
  tabs.forEach((btn) => {
    const isActive = btn.dataset.tab === next;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.tabIndex = isActive ? 0 : -1;
  });
}

export async function initOutputLogViewIfRequested(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search || '');
  if (params.get('view') !== 'output-log') return false;

  const app = document.getElementById('app');
  if (app) app.style.display = 'none';

  document.body.classList.add('output-log-body');

  const root = document.createElement('div');
  root.id = 'output-log-view';
  root.innerHTML = `
    <header class="outlog-head">
      <div class="outlog-left">
        <div class="outlog-title">Output Log</div>
        <div class="outlog-tabs" role="tablist" aria-label="Output log tabs">
          <button class="tbtn outlog-tab is-active" type="button" role="tab" aria-selected="true" data-tab="vcs">VCS</button>
          <button class="tbtn outlog-tab" type="button" role="tab" aria-selected="false" data-tab="app">Application</button>
        </div>
      </div>
      <div class="outlog-actions">
        <label class="outlog-autoscroll"><input type="checkbox" id="outlog-autoscroll" checked /> Auto-scroll</label>
        <button class="tbtn" id="outlog-clear" type="button">Clear</button>
      </div>
    </header>
    <div class="outlog-body">
      <div class="outlog-list" id="outlog-list-vcs" role="log" aria-live="polite"></div>
      <div class="outlog-list outlog-hidden" id="outlog-list-app" role="log" aria-live="polite"></div>
    </div>
  `;
  document.body.appendChild(root);
  initOverlayScrollbarsFor(root);
  refreshOverlayScrollbarsFor(root);

  root.dataset.activeTab = 'vcs';

  const listVcs = document.getElementById('outlog-list-vcs') as HTMLElement | null;
  const listApp = document.getElementById('outlog-list-app') as HTMLElement | null;
  const auto = document.getElementById('outlog-autoscroll') as HTMLInputElement | null;
  const clearBtn = document.getElementById('outlog-clear') as HTMLButtonElement | null;

  const activeTab = (): LogTab => (root.dataset.activeTab === 'app' ? 'app' : 'vcs');
  const listFor = (tab: LogTab) => (tab === 'app' ? listApp : listVcs);

  const append = (tab: LogTab, entries: OutputLogEntry[]) => {
    const list = listFor(tab);
    if (!list || !entries.length) return;
    list.insertAdjacentHTML('beforeend', entries.map(renderRow).join(''));
    if (auto?.checked && activeTab() === tab) list.scrollTop = list.scrollHeight;
  };

  const replace = (tab: LogTab, entries: OutputLogEntry[]) => {
    const list = listFor(tab);
    if (!list) return;
    list.replaceChildren();
    append(tab, entries);
  };

  const syncVisibility = () => {
    const tab = activeTab();
    listVcs?.classList.toggle('outlog-hidden', tab !== 'vcs');
    listApp?.classList.toggle('outlog-hidden', tab !== 'app');
    const list = listFor(tab);
    if (auto?.checked) list && (list.scrollTop = list.scrollHeight);
    refreshOverlayScrollbarsFor(root);
  };

  let appPollTimer: number | undefined;
  const stopAppPolling = () => {
    if (appPollTimer !== undefined) window.clearInterval(appPollTimer);
    appPollTimer = undefined;
  };

  const startAppPolling = () => {
    stopAppPolling();
    if (!TAURI.has) return;
    const poll = async () => {
      try {
        const entries = await TAURI.invoke<OutputLogEntry[]>('tail_app_log', { maxLines: 1500 });
        replace('app', Array.isArray(entries) ? entries : []);
      } catch {
        // ignore
      }
    };
    void poll();
    appPollTimer = window.setInterval(poll, 1000);
  };

  root.querySelectorAll<HTMLButtonElement>('.outlog-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = (btn.dataset.tab === 'app' ? 'app' : 'vcs') as LogTab;
      setActiveTab(root, next);
      syncVisibility();
      if (next === 'app') startAppPolling();
      else stopAppPolling();
    });
  });

  if (TAURI.has) {
    try {
      const entries = await TAURI.invoke<OutputLogEntry[]>('get_output_log');
      append('vcs', Array.isArray(entries) ? entries : []);
    } catch {
      // ignore
    }
  }

  clearBtn?.addEventListener('click', async () => {
    if (!TAURI.has) return;

    const tab = activeTab();
    listFor(tab)?.replaceChildren();
    try {
      if (tab === 'vcs') await TAURI.invoke('clear_output_log');
      else await TAURI.invoke('clear_app_log');
    } catch {
      notify('Failed to clear output log');
    }
  });

  TAURI.listen?.('vcs:log', (ev: any) => {
    const e = (ev?.payload || {}) as OutputLogEntry;
    append('vcs', [e]);
  });

  syncVisibility();
  startAppPolling();
  return true;
}
