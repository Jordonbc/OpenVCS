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

export async function showUpdateDialog(data: any) {
  openModal('update-modal');
  const modal = document.getElementById('update-modal') as HTMLElement | null;
  if (!modal) return;
  let version = inferString(data, ['version', 'target', 'tag', 'name']) || '';
  let notes = inferString(data, ['notes', 'body', 'changelog', 'releaseNotes', 'content']) || '';
  if (!version || !notes) {
    try {
      const res = await fetch('https://api.github.com/repos/Jordonbc/OpenVCS/releases/latest', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        version = version || String(j.tag_name || j.name || '');
        notes = notes || String(j.body || '');
      }
    } catch {}
  }
  const verEl = modal.querySelector('#update-version');
  const notesEl = modal.querySelector('#update-notes');
  if (verEl) verEl.textContent = version ? `Version ${version}` : 'Update available';
  if (notesEl) (notesEl as HTMLElement).textContent = (notes || '').trim() || '(No changelog provided)';
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
