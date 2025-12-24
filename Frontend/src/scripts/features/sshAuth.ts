import { TAURI } from '../lib/tauri';
import { openModal, closeModal } from '../ui/modals';
import { openRepoSettings } from './repoSettings';

type AuthPrompt = { host: string; remote: string; url: string; message?: string };

let wired = false;

function wireAuthModal() {
  const modal = document.getElementById('ssh-auth-modal') as HTMLElement | null;
  if (!modal || (modal as any).__wired) return;
  (modal as any).__wired = true;

  const hostEl = modal.querySelector('#ssh-auth-host') as HTMLElement | null;
  const remoteEl = modal.querySelector('#ssh-auth-remote') as HTMLElement | null;
  const urlEl = modal.querySelector('#ssh-auth-url') as HTMLElement | null;
  const msgEl = modal.querySelector('#ssh-auth-msg') as HTMLElement | null;
  const okBtn = modal.querySelector('#ssh-auth-ok') as HTMLButtonElement | null;
  const remotesBtn = modal.querySelector('#ssh-auth-open-remotes') as HTMLButtonElement | null;

  (modal as any).__fill = (p: AuthPrompt) => {
    if (hostEl) hostEl.textContent = p.host || '';
    if (remoteEl) remoteEl.textContent = p.remote || '';
    if (urlEl) urlEl.textContent = p.url || '';
    if (msgEl) msgEl.textContent = p.message || '';
  };

  okBtn?.addEventListener('click', () => closeModal('ssh-auth-modal'));
  remotesBtn?.addEventListener('click', () => {
    closeModal('ssh-auth-modal');
    openRepoSettings();
  });
}

export function initSshAuthPrompt() {
  if (!TAURI.has || wired) return;
  wired = true;

  TAURI.listen?.('ui:ssh-auth', (ev: any) => {
    const p = (ev?.payload || {}) as AuthPrompt;
    openModal('ssh-auth-modal');
    wireAuthModal();
    const modal = document.getElementById('ssh-auth-modal') as any;
    modal?.__fill?.(p);
  });
}

