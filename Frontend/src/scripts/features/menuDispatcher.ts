// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// src/scripts/features/menuDispatcher.ts
// Dispatches named menu actions (title-bar, menubar, and Tauri 'menu' events).
// Extracted from main.ts (single-responsibility module).

import { TAURI } from '../lib/tauri';
import { qs } from '../lib/dom';
import { notify } from '../lib/notify';
import { openSheet } from './commandSheet';
import { openSwitchDrawer } from './repoSwitchDrawer';
import { defaultFetchAction, pushChanges } from './fetchActions';
import { openAbout } from './about';
import { openSettings } from './settings';
import { openRepoSettings } from './repoSettings';
import { invokePluginAction, runPluginAction } from '../plugins';

const WIKI_URL = 'https://github.com/jordonbc/OpenVCS/wiki';

// BLOCKED-CROSS-REPO VCS-07: IDs owned by Git plugin until cross-repo rename.
const REPO_DOTFILE_ACTION_ALIASES: Readonly<Record<string, string>> = {
    'repo-edit-gitignore': '.gitignore',
    'repo-edit-gitattributes': '.gitattributes',
};

const commitBtn = qs<HTMLButtonElement>('#commit-btn');

/** Opens the project documentation, falling back to the wiki page in a new window. */
async function openDocs() {
    try { await TAURI.invoke('open_docs', {}); } catch { /* fall back */ }
    try { window.open(WIKI_URL, '_blank', 'noopener'); } catch (e) { console.error('Unable to open docs:', e); notify('Unable to open docs'); }
}

/** Runs a named menu action (repo dotfiles, core actions, and plugin menu actions). */
async function runMenuAction(id?: string | null, payload?: { pluginId?: string; actionId?: string } | null) {
    const dotfileName = id ? REPO_DOTFILE_ACTION_ALIASES[id] : undefined;
    if (dotfileName) {
        console.log('Action:', id);
        try { await TAURI.invoke('open_repo_dotfile', { name: dotfileName }); }
        catch (e) { console.error(`Could not open ${dotfileName}:`, e); notify(`Could not open ${dotfileName}`); }
        return;
    }
    switch (id) {
        case 'clone_repo': console.log('Action: clone_repo'); openSheet('clone'); break;
        case 'add_repo':   console.log('Action: add_repo'); openSheet('add'); break;
        case 'open_repo':  console.log('Action: open_repo'); openSwitchDrawer(); break;
        case 'fetch': console.log('Action: fetch'); await defaultFetchAction(); break;
        case 'push':  console.log('Action: push'); await pushChanges();  break;
        case 'commit': console.log('Action: commit'); commitBtn?.click(); break;
        case 'docs': console.log('Action: docs'); await openDocs(); break;
        case 'show-output-log':
            console.log('Action: show-output-log');
            try { await TAURI.invoke('open_output_log_window', {}); }
            catch (e) { console.error('Failed to open Output Log:', e); notify('Failed to open Output Log'); }
            break;
        case 'about': console.log('Action: about'); openAbout(); break;
        case 'settings': console.log('Action: settings'); openSettings(); break;
        case 'repo-settings': console.log('Action: repo-settings'); openRepoSettings(); break;
        case 'check_updates':
            try {
                const hasUpdate = await TAURI.invoke<boolean>('check_for_updates', {});
                if (!hasUpdate) notify('Already up to date');
            } catch (e) { console.error('Update check failed:', e); notify('Update check failed'); }
            break;
        case '__plugin_menu_action__': {
            const pluginId = typeof payload?.pluginId === 'string' ? payload.pluginId.trim() : '';
            const actionId = typeof payload?.actionId === 'string' ? payload.actionId.trim() : '';
            if (!pluginId || !actionId) {
                console.warn(`Plugin menu action skipped: missing pluginId (${!!pluginId}) or actionId (${!!actionId})`);
                notify(!pluginId && !actionId
                    ? 'Plugin action is missing plugin and action IDs'
                    : !pluginId
                        ? 'Plugin action missing plugin ID'
                        : `Plugin action missing action for "${pluginId}"`);
                break;
            }
            try {
                await invokePluginAction(pluginId, actionId);
            } catch (e) {
                console.error(`Plugin menu action failed: ${pluginId}/${actionId}`, e);
                notify(`Plugin action for "${pluginId}" failed`);
            }
            break;
        }
        case 'exit': TAURI.invoke('exit_app', {}).catch((err) => console.error('Failed to exit app:', err)); break;
        default: {
            if (!id) break;
            const handled = await runPluginAction(id);
            if (!handled) break;
        }
    }
}

export { openDocs, runMenuAction };
