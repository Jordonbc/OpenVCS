import { TAURI } from '../lib/tauri';
import { notify } from '../lib/notify';
import { openModal } from '../ui/modals';

type SshCommandOutput = { code: number; stdout: string; stderr: string };
type SshKeyCandidate = { path: string; name: string };

let wired = false;

function fmtAgentStatus(out: SshCommandOutput | null | undefined): string {
  if (!out) return 'Unable to query ssh-agent.';
  const msg = [out.stdout, out.stderr].filter(Boolean).join('\n').trim();
  if (out.code === 0) return msg || 'Keys loaded.';
  if (out.code === 1) return msg || 'The agent has no identities.';
  if (out.code === 2) return msg || 'ssh-agent is not running or not reachable.';
  return msg || `ssh-add exited with code ${out.code}`;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify('Copied to clipboard');
  } catch {
    notify('Unable to copy to clipboard');
  }
}

export function wireSshKeys() {
  const modal = document.getElementById('ssh-keys-modal') as HTMLElement | null;
  if (!modal || (modal as any).__wired) return;
  (modal as any).__wired = true;
  wired = true;

  const statusEl = modal.querySelector('#ssh-keys-agent-status') as HTMLPreElement | null;
  const listEl = modal.querySelector('#ssh-keys-list') as HTMLElement | null;
  const noneEl = modal.querySelector('#ssh-keys-none') as HTMLElement | null;
  const selectedEl = modal.querySelector('#ssh-keys-selected') as HTMLElement | null;
  const refreshBtn = modal.querySelector('#ssh-keys-refresh') as HTMLButtonElement | null;
  const copyBtn = modal.querySelector('#ssh-keys-copy') as HTMLButtonElement | null;
  const addBtn = modal.querySelector('#ssh-keys-add') as HTMLButtonElement | null;

  let selectedPath = '';

  function setSelected(path: string) {
    selectedPath = String(path || '').trim();
    if (selectedEl) selectedEl.textContent = selectedPath || '';
    if (!listEl) return;
    listEl.querySelectorAll<HTMLElement>('[data-key-path]').forEach((el) => {
      el.classList.toggle('primary', el.dataset.keyPath === selectedPath);
    });
  }

  async function refresh() {
    if (!TAURI.has) return;
    if (refreshBtn) refreshBtn.disabled = true;
    if (addBtn) addBtn.disabled = true;
    try {
      const [agent, keys] = await Promise.all([
        TAURI.invoke<SshCommandOutput>('ssh_agent_list_keys'),
        TAURI.invoke<SshKeyCandidate[]>('ssh_key_candidates'),
      ]);

      if (statusEl) statusEl.textContent = fmtAgentStatus(agent);

      const list = Array.isArray(keys) ? keys : [];
      if (listEl) {
        listEl.innerHTML = '';
        for (const k of list) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tbtn';
          btn.dataset.keyPath = k.path;
          btn.textContent = k.name;
          btn.title = k.path;
          btn.addEventListener('click', () => setSelected(k.path));
          listEl.appendChild(btn);
        }
      }
      if (noneEl) noneEl.style.display = list.length ? 'none' : '';
      if (!selectedPath && list[0]?.path) setSelected(list[0].path);
    } catch (e) {
      if (statusEl) statusEl.textContent = `Unable to query ssh-agent: ${String(e || '')}`.trim();
      notify('Unable to load SSH keys');
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
      if (addBtn) addBtn.disabled = false;
    }
  }

  refreshBtn?.addEventListener('click', refresh);
  copyBtn?.addEventListener('click', () => {
    if (!selectedPath) { notify('Select a key first'); return; }
    copyToClipboard(`ssh-add "${selectedPath.replace(/[\\"]/g, (ch) => '\\' + ch)}"`);
  });
  addBtn?.addEventListener('click', async () => {
    if (!TAURI.has) return;
    if (!selectedPath) { notify('Select a key first'); return; }
    if (addBtn) addBtn.disabled = true;
    try {
      const out = await TAURI.invoke<SshCommandOutput>('ssh_add_key', { path: selectedPath });
      const msg = [out.stdout, out.stderr].filter(Boolean).join('\n').trim();
      if (out.code === 0) {
        notify('Key added to ssh-agent');
        await refresh();
      } else if (/enter passphrase|bad passphrase|passphrase/i.test(msg)) {
        notify('Key is encrypted; run ssh-add in a terminal to enter the passphrase');
      } else {
        notify(msg || `ssh-add failed (code ${out.code})`);
      }
    } catch (e) {
      notify(`ssh-add failed: ${String(e || '')}`.trim());
    } finally {
      if (addBtn) addBtn.disabled = false;
    }
  });

  (modal as any).__open = (path?: string) => {
    if (path) setSelected(path);
    refresh();
  };
}

export function openSshKeysModal(preselectPath?: string) {
  openModal('ssh-keys-modal');
  if (!wired) wireSshKeys();
  const modal = document.getElementById('ssh-keys-modal') as any;
  modal?.__open?.(preselectPath);
}

