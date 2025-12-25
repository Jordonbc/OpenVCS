import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';

type OutputLevel = 'info' | 'warn' | 'error';
type OutputLogEntry = { ts_ms: number; level: OutputLevel; source: string; message: string };

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
      <div class="outlog-title">Output Log</div>
      <div class="outlog-actions">
        <label class="outlog-autoscroll"><input type="checkbox" id="outlog-autoscroll" checked /> Auto-scroll</label>
        <button class="tbtn" id="outlog-clear" type="button">Clear</button>
      </div>
    </header>
    <div class="outlog-body">
      <div class="outlog-list" id="outlog-list" role="log" aria-live="polite"></div>
    </div>
  `;
  document.body.appendChild(root);

  const list = document.getElementById('outlog-list') as HTMLElement | null;
  const auto = document.getElementById('outlog-autoscroll') as HTMLInputElement | null;
  const clearBtn = document.getElementById('outlog-clear') as HTMLButtonElement | null;

  const append = (entries: OutputLogEntry[]) => {
    if (!list || !entries.length) return;
    list.insertAdjacentHTML('beforeend', entries.map(renderRow).join(''));
    if (auto?.checked) list.scrollTop = list.scrollHeight;
  };

  if (TAURI.has) {
    try {
      const entries = await TAURI.invoke<OutputLogEntry[]>('get_output_log');
      append(Array.isArray(entries) ? entries : []);
    } catch {
      // ignore
    }
  }

  clearBtn?.addEventListener('click', async () => {
    list?.replaceChildren();
    if (!TAURI.has) return;
    try {
      await TAURI.invoke('clear_output_log');
    } catch {
      notify('Failed to clear output log');
    }
  });

  TAURI.listen?.('vcs:log', (ev: any) => {
    const e = (ev?.payload || {}) as OutputLogEntry;
    append([e]);
  });

  return true;
}
