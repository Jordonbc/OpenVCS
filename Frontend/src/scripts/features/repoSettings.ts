// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { TAURI } from '../lib/tauri';
import { openModal, closeModal } from '../ui/modals';
import { notify } from '../lib/notify';
import type { RepoSettings } from '../types';

export function openRepoSettings(){ openModal('repo-settings-modal'); }

type RemoteRow = { nameInput: HTMLInputElement; urlInput: HTMLInputElement; removeBtn: HTMLButtonElement };

export async function wireRepoSettings() {
    const modal = document.getElementById('repo-settings-modal') as HTMLElement | null;
    if (!modal || (modal as any).__wired) return;
    (modal as any).__wired = true;

    const nameInput  = modal.querySelector('#git-user-name') as HTMLInputElement | null;
    const emailInput = modal.querySelector('#git-user-email') as HTMLInputElement | null;
    const remotesEl = modal.querySelector('#git-remotes') as HTMLElement | null;
    const addRemoteBtn = modal.querySelector('#git-remote-add') as HTMLButtonElement | null;
    const saveBtn = modal.querySelector('#repo-settings-save') as HTMLButtonElement | null;

    if (saveBtn) {
        saveBtn.style.width = '5rem';
        saveBtn.style.textAlign = 'center';
        saveBtn.style.boxSizing = 'border-box';
    }

    const rows: RemoteRow[] = [];
    let initialRemotesKey = '';

    function addRemoteRow(initial?: { name?: string; url?: string }) {
        if (!remotesEl) return;

        const row = document.createElement('div');
        row.className = 'remote-row';

        const name = document.createElement('input');
        name.type = 'text';
        name.placeholder = 'name';
        name.className = 'remote-name';
        if (initial?.name) name.value = initial.name;

        const url = document.createElement('input');
        url.type = 'text';
        url.placeholder = 'git@host:org/repo.git or https://…';
        url.className = 'remote-url';
        if (initial?.url) url.value = initial.url;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'tbtn remote-remove';
        remove.textContent = 'Remove';

        const entry: RemoteRow = { nameInput: name, urlInput: url, removeBtn: remove };
        rows.push(entry);

        remove.addEventListener('click', () => {
            const idx = rows.indexOf(entry);
            if (idx >= 0) rows.splice(idx, 1);
            row.remove();
        });

        row.append(name, url, remove);
        remotesEl.append(row);
    }

    function clearRemoteRows() {
        rows.splice(0, rows.length);
        remotesEl?.replaceChildren();
    }

    try {
        const cfg = await TAURI.invoke<RepoSettings>('get_repo_settings');
        if (nameInput && cfg?.user_name) nameInput.value = cfg.user_name;
        if (emailInput && cfg?.user_email) emailInput.value = cfg.user_email;

        clearRemoteRows();
        const remotes = cfg?.remotes?.length
            ? cfg.remotes
            : (cfg?.origin_url ? [{ name: 'origin', url: cfg.origin_url }] : []);

        for (const r of remotes) addRemoteRow(r);
        initialRemotesKey = JSON.stringify(
            remotes
                .map(r => ({ name: String(r?.name || '').trim(), url: String(r?.url || '').trim() }))
                .filter(r => r.name && r.url)
                .sort((a, b) => a.name.localeCompare(b.name))
        );
    } catch { /* ignore */ }

    addRemoteBtn?.addEventListener('click', () => addRemoteRow());

    saveBtn?.addEventListener('click', async () => {
        const seen = new Set<string>();
        const remotes: Array<{ name: string; url: string }> = [];
        for (const r of rows) {
            const name = r.nameInput.value.trim();
            const url = r.urlInput.value.trim();
            if (!name && !url) continue;
            if (!name || !url) {
                notify('Remote entries must include both name and URL');
                return;
            }
            if (seen.has(name)) continue;
            seen.add(name);
            remotes.push({ name, url });
        }
        const origin = remotes.find(r => r.name === 'origin')?.url;
        const nextRemotesKey = JSON.stringify(
            remotes
                .map(r => ({ name: r.name.trim(), url: r.url.trim() }))
                .filter(r => r.name && r.url)
                .sort((a, b) => a.name.localeCompare(b.name))
        );
        const remotesChanged = initialRemotesKey !== nextRemotesKey;
        const next: RepoSettings = {
            user_name: nameInput?.value || undefined,
            user_email: emailInput?.value || undefined,
            origin_url: origin || undefined,
            remotes,
        };
        try {
            await TAURI.invoke('set_repo_settings', { cfg: next });
            if (remotesChanged) {
                // Remote-tracking branches only exist after a fetch; do it once after remotes are modified.
                try { await TAURI.invoke('vcs_fetch_all', {}); } catch { /* ignore */ }
            }
            saveBtn.classList.add('saved-state');
            saveBtn.textContent = 'Saved!';
            setTimeout(() => {
                saveBtn.textContent = 'Save';
                saveBtn.classList.remove('saved-state');
            }, 2000);
        } catch {
            notify('Failed to save repository settings');
        }
    });
}
