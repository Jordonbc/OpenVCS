// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { notify } from '../lib/notify';
import { TAURI } from '../lib/tauri';
import { closeModal, openModal } from '../ui/modals';

/** Payload returned by backend permission lookup command. */
interface PluginPermissionsPayload {
  plugin_id: string;
  version?: string;
  approval_state: 'pending' | 'approved' | 'denied' | string;
  requested_capabilities: string[];
  approved_capabilities: string[];
}

/** Option for one permission row selection. */
interface PermissionChoice {
  id: string;
  label: string;
  approvedCapabilities: string[];
}

/** Renderable permission row model. */
interface PermissionRow {
  key: string;
  label: string;
  detail: string;
  choices: PermissionChoice[];
}

/** In-memory modal state stored on the modal element. */
interface PluginPermissionsModalState {
  pluginId: string;
  rows: PermissionRow[];
  selectedChoiceByRow: Map<string, string>;
}

const MODAL_ID = 'plugin-permissions-modal';

/** Converts raw capability ids to trimmed lowercase unique values. */
function normalizeCapabilities(values: string[]): string[] {
  const out = new Set<string>();
  for (const value of values || []) {
    const id = String(value || '').trim().toLowerCase();
    if (id) out.add(id);
  }
  return [...out].sort();
}

/** Picks the best matching choice id from approved capabilities. */
function defaultChoiceIdForRow(row: PermissionRow, approved: Set<string>): string {
  const choices = [...row.choices].sort(
    (a, b) => b.approvedCapabilities.length - a.approvedCapabilities.length,
  );
  for (const choice of choices) {
    const requested = choice.approvedCapabilities;
    if (requested.length && requested.every((capability) => approved.has(capability))) {
      return choice.id;
    }
    if (!requested.length && !row.choices.some((c) => c.approvedCapabilities.some((cap) => approved.has(cap)))) {
      return choice.id;
    }
  }
  return row.choices[0]?.id || '';
}

/** Builds structured permission rows from requested capability ids. */
function buildPermissionRows(requestedCapabilities: string[]): PermissionRow[] {
  const requested = normalizeCapabilities(requestedCapabilities);
  const used = new Set<string>();
  const rows: PermissionRow[] = [];

  const status = requested.filter((capability) => capability.startsWith('status.'));
  if (status.length) {
    for (const capability of status) used.add(capability);
    const hasGet = status.includes('status.get');
    const hasSet = status.includes('status.set');
    if (hasGet && hasSet) {
      rows.push({
        key: 'status',
        label: 'Status',
        detail: 'Lets the plugin read and update the footer status text.',
        choices: [
          { id: 'deny', label: 'Deny', approvedCapabilities: [] },
          { id: 'read', label: 'Read only', approvedCapabilities: ['status.get'] },
          { id: 'read-set', label: 'Read & Set', approvedCapabilities: ['status.get', 'status.set'] },
        ],
      });
    } else {
      const statusDetail = hasGet
        ? 'Lets the plugin read the footer status text.'
        : 'Lets the plugin update the footer status text.';
      rows.push({
        key: 'status',
        label: 'Status',
        detail: statusDetail,
        choices: [
          { id: 'deny', label: 'Deny', approvedCapabilities: [] },
          { id: 'allow', label: 'Allow', approvedCapabilities: status },
        ],
      });
    }
  }

  const workspace = requested.filter((capability) => capability.startsWith('workspace.'));
  if (workspace.length) {
    for (const capability of workspace) used.add(capability);
    const hasRead = workspace.includes('workspace.read');
    const hasWrite = workspace.includes('workspace.write');
    if (hasRead && hasWrite) {
      rows.push({
        key: 'workspace',
        label: 'Workspace',
        detail: 'Lets the plugin read and write files inside the active workspace.',
        choices: [
          { id: 'deny', label: 'Deny', approvedCapabilities: [] },
          { id: 'read', label: 'Read only', approvedCapabilities: ['workspace.read'] },
          {
            id: 'read-write',
            label: 'Read & Write',
            approvedCapabilities: ['workspace.read', 'workspace.write'],
          },
        ],
      });
    } else {
      const workspaceDetail = hasRead
        ? 'Lets the plugin read files inside the active workspace.'
        : 'Lets the plugin write files inside the active workspace.';
      rows.push({
        key: 'workspace',
        label: 'Workspace',
        detail: workspaceDetail,
        choices: [
          { id: 'deny', label: 'Deny', approvedCapabilities: [] },
          { id: 'allow', label: 'Allow', approvedCapabilities: workspace },
        ],
      });
    }
  }

  const execution = requested.filter((capability) => capability.startsWith('process.'));
  if (execution.length) {
    for (const capability of execution) used.add(capability);
    rows.push({
      key: 'execution',
      label: 'Execution',
      detail: 'Lets the plugin run Git commands through the host in your workspace context.',
      choices: [
        { id: 'deny', label: 'Deny', approvedCapabilities: [] },
        { id: 'allow', label: 'Allow', approvedCapabilities: execution },
      ],
    });
  }

  const ui = requested.filter((capability) => capability.startsWith('ui.'));
  if (ui.length) {
    for (const capability of ui) used.add(capability);
    rows.push({
      key: 'ui',
      label: 'UI',
      detail: 'Lets the plugin trigger user-facing interface actions such as notifications.',
      choices: [
        { id: 'deny', label: 'Deny', approvedCapabilities: [] },
        { id: 'allow', label: 'Allow', approvedCapabilities: ui },
      ],
    });
  }

  const other = requested.filter((capability) => !used.has(capability));
  if (other.length) {
    rows.push({
      key: 'other',
      label: 'Something else',
      detail: `Lets the plugin use additional host features requested by its manifest (${other.join(', ')}).`,
      choices: [
        { id: 'deny', label: 'Deny', approvedCapabilities: [] },
        { id: 'allow', label: 'Allow', approvedCapabilities: other },
      ],
    });
  }

  return rows;
}

/** Builds approved capability ids from current row selections. */
function selectedCapabilities(rows: PermissionRow[], selectedChoiceByRow: Map<string, string>): string[] {
  const approved = new Set<string>();
  for (const row of rows) {
    const selectedId = selectedChoiceByRow.get(row.key) || row.choices[0]?.id;
    const selected = row.choices.find((choice) => choice.id === selectedId) || row.choices[0];
    for (const capability of selected?.approvedCapabilities || []) {
      approved.add(capability);
    }
  }
  return [...approved].sort();
}

/** Moves the animated highlight under the active choice button. */
function positionChoiceIndicator(toggle: HTMLElement): void {
  const indicator = toggle.querySelector<HTMLElement>('.plugin-permissions-toggle-indicator');
  const active = toggle.querySelector<HTMLButtonElement>('.plugin-permissions-toggle-item.is-active');
  if (!indicator || !active) return;
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.transform = `translateX(${active.offsetLeft}px)`;
}

/** Applies selected state for one choice row and updates highlight animation. */
function applyChoiceSelection(
  toggle: HTMLElement,
  rowKey: string,
  choiceId: string,
  selectedChoiceByRow: Map<string, string>,
): void {
  const options = toggle.querySelectorAll<HTMLButtonElement>('.plugin-permissions-toggle-item');
  for (const option of options) {
    const selected = option.dataset.choiceId === choiceId;
    option.classList.toggle('is-active', selected);
    option.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }
  selectedChoiceByRow.set(rowKey, choiceId);
  positionChoiceIndicator(toggle);
}

/** Builds a segmented choice control for one permission row. */
function buildChoiceToggle(
  row: PermissionRow,
  defaultChoice: string,
  selectedChoiceByRow: Map<string, string>,
): HTMLElement {
  const toggle = document.createElement('div');
  toggle.className = 'plugin-permissions-toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', `${row.label} permission`);

  const indicator = document.createElement('span');
  indicator.className = 'plugin-permissions-toggle-indicator';
  toggle.appendChild(indicator);

  for (const choice of row.choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plugin-permissions-toggle-item';
    button.dataset.choiceId = choice.id;
    button.textContent = choice.label;
    button.addEventListener('click', () => {
      applyChoiceSelection(toggle, row.key, choice.id, selectedChoiceByRow);
    });
    toggle.appendChild(button);
  }

  selectedChoiceByRow.set(row.key, defaultChoice);
  requestAnimationFrame(() => {
    applyChoiceSelection(toggle, row.key, defaultChoice, selectedChoiceByRow);
  });

  return toggle;
}

/** Opens and populates plugin permissions modal for the selected plugin. */
export async function openPluginPermissionsModal(pluginId: string, pluginName: string): Promise<void> {
  openModal(MODAL_ID);

  const modal = document.getElementById(MODAL_ID);
  if (!(modal instanceof HTMLElement)) return;

  const title = modal.querySelector<HTMLElement>('#plugin-permissions-title');
  const rowsEl = modal.querySelector<HTMLElement>('#plugin-permissions-rows');
  const emptyEl = modal.querySelector<HTMLElement>('#plugin-permissions-empty');
  const applyBtn = modal.querySelector<HTMLButtonElement>('#plugin-permissions-apply');
  if (!title || !rowsEl || !emptyEl || !applyBtn) return;

  const safePluginId = String(pluginId || '').trim();
  const safePluginName = String(pluginName || '').trim() || safePluginId || 'plugin';
  title.textContent = `Permissions for ${safePluginName}`;
  rowsEl.replaceChildren();
  emptyEl.classList.add('hidden');
  emptyEl.textContent = 'Loading permissions…';
  emptyEl.classList.remove('hidden');
  applyBtn.disabled = true;

  if (!TAURI.has) {
    emptyEl.textContent = 'The plugin does not request permissions';
    return;
  }

  let payload: PluginPermissionsPayload;
  try {
    payload = await TAURI.invoke<PluginPermissionsPayload>('get_plugin_permissions', {
      pluginId: safePluginId,
    });
  } catch (error) {
    const message = String(error || '').trim();
    emptyEl.textContent = message || 'Failed to load plugin permissions';
    return;
  }

  const requested = normalizeCapabilities(payload.requested_capabilities || []);
  const approved = new Set<string>(normalizeCapabilities(payload.approved_capabilities || []));
  const rows = buildPermissionRows(requested);
  const selectedChoiceByRow = new Map<string, string>();

  if (!rows.length) {
    emptyEl.textContent = 'The plugin does not request permissions';
    applyBtn.disabled = true;
    (modal as unknown as { __pluginPermissionsState?: PluginPermissionsModalState }).__pluginPermissionsState = {
      pluginId: safePluginId,
      rows,
      selectedChoiceByRow,
    };
    return;
  }

  rowsEl.replaceChildren();
  emptyEl.classList.add('hidden');

  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'plugin-permissions-row';

    const labelWrap = document.createElement('div');
    labelWrap.className = 'plugin-permissions-label';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = row.label;
    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.textContent = row.detail;
    labelWrap.appendChild(name);
    labelWrap.appendChild(detail);

    const defaultChoice = defaultChoiceIdForRow(row, approved);
    const toggle = buildChoiceToggle(row, defaultChoice, selectedChoiceByRow);

    rowEl.appendChild(labelWrap);
    rowEl.appendChild(toggle);
    rowsEl.appendChild(rowEl);
  }

  applyBtn.disabled = false;
  (modal as unknown as { __pluginPermissionsState?: PluginPermissionsModalState }).__pluginPermissionsState = {
    pluginId: safePluginId,
    rows,
    selectedChoiceByRow,
  };

  if (!(applyBtn as unknown as { __bound?: boolean }).__bound) {
    (applyBtn as unknown as { __bound?: boolean }).__bound = true;
    applyBtn.addEventListener('click', async () => {
      const state =
        (modal as unknown as { __pluginPermissionsState?: PluginPermissionsModalState })
          .__pluginPermissionsState;
      if (!state || !state.pluginId) return;

      try {
        applyBtn.disabled = true;
        const approvedCapabilities = selectedCapabilities(state.rows, state.selectedChoiceByRow);
        await TAURI.invoke('set_plugin_permissions', {
          pluginId: state.pluginId,
          approvedCapabilities,
        });
        notify('Plugin permissions updated');
        closeModal(MODAL_ID);
      } catch (error) {
        const message = String(error || '').trim();
        notify(message ? `Apply failed: ${message}` : 'Apply failed');
      } finally {
        applyBtn.disabled = false;
      }
    });
  }
}
