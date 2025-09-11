import { TAURI } from '../lib/tauri';
import { openModal, closeModal } from '../ui/modals';
import { notify } from '../lib/notify';

export function wireUpdate() {
  const modal = document.getElementById('update-modal') as HTMLElement | null;
  if (!modal || (modal as any).__wired) return;
  (modal as any).__wired = true;

  const installBtn = modal.querySelector('#update-install') as HTMLButtonElement | null;
  installBtn?.addEventListener('click', async () => {
    try {
      if (!TAURI.has) return;
      notify('Downloading update…');
      await TAURI.invoke('updater_install_now');
      notify('Update installed. Restart to apply.');
      closeModal('update-modal');
    } catch {
      notify('Update failed');
    }
  });
}

export async function showUpdateDialog(_data: any) {
  try {
    if (!TAURI.has) return;
    const cfg = await TAURI.invoke<any>('get_global_settings');
    const about = await TAURI.invoke<any>('about_info');
    const channel = String(cfg?.general?.update_channel || 'stable');
    const current = String(about?.version || '').trim();

    const fetchJson = async (url: string) => {
      const r = await fetch(url, { cache: 'no-store' }); return r.ok ? r.json() : null;
    };

    const stable = await fetchJson('https://api.github.com/repos/Jordonbc/OpenVCS/releases/latest');
    const nightly = await fetchJson('https://api.github.com/repos/Jordonbc/OpenVCS/releases/tags/openvcs-nightly');

    const norm = (v: string) => String(v || '').replace(/^v/i, '').trim();
    const stableTag = norm(stable?.tag_name || stable?.name || '');
    const nightlyTag = norm(nightly?.tag_name || nightly?.name || '');

    const newerThanCurrent = (v: string) => v && v !== '' && norm(current) !== norm(v);

    let show = false;
    let pick = null as any;

    if (channel === 'stable') {
      if (newerThanCurrent(stableTag)) { show = true; pick = stable; }
    } else {
      // Nightly: pick the most recent by published_at timestamp
      const sDate = Date.parse(String(stable?.published_at || stable?.created_at || '')) || 0;
      const nDate = Date.parse(String(nightly?.published_at || nightly?.created_at || '')) || 0;
      pick = (nDate > sDate ? nightly : stable) || nightly || stable;
      show = !!pick;
    }

    if (!show || !pick) { notify('Already up to date'); return; }

    openModal('update-modal');
    const modal = document.getElementById('update-modal') as HTMLElement | null;
    if (!modal) return;
    const verEl = modal.querySelector('#update-version');
    const notesEl = modal.querySelector('#update-notes');
    const v = pick?.tag_name || pick?.name || '';
    const body = String(pick?.body || '').trim();
    if (verEl) verEl.textContent = v ? `Version ${v}` : 'Update available';
    if (notesEl) (notesEl as HTMLElement).textContent = body || '(No changelog provided)';
  } catch {
    notify('Update check failed');
  }
}

function inferString(obj: any, keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k as any];
    if (typeof v === 'string' && v.trim()) return v;
  }
  // nested common containers
  if (obj.update && typeof obj.update === 'object') {
    const v = inferString(obj.update, keys); if (v) return v;
  }
  if (obj.manifest && typeof obj.manifest === 'object') {
    const v = inferString(obj.manifest, keys); if (v) return v;
  }
  return undefined;
}
