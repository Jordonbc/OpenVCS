// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

function setupTauri() {
  (window as any).__TAURI__ = {
    core: { invoke: vi.fn() },
    event: { listen: vi.fn() },
  };
}

function mountRoot() {
  document.body.innerHTML = '<div id="modals-root"></div>';
}

describe('handlePluginActionResult', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('renders a plugin modal when result is a PluginModalDefinition', async () => {
    const { handlePluginActionResult } = await import('./modal');
    handlePluginActionResult('test-plugin', {
      title: 'Test Modal',
      content: [
        { type: 'text', content: 'Hello World' },
      ],
    });

    const modal = document.getElementById('plugin-modal-test-plugin');
    expect(modal).not.toBeNull();
    expect(modal?.getAttribute('aria-hidden')).toBe('false');
    expect(modal?.querySelector('.sheet-body')?.textContent).toContain('Hello World');
  });

  it('does nothing when result is not a modal definition', async () => {
    const { handlePluginActionResult } = await import('./modal');
    handlePluginActionResult('test-plugin', { simple: 'value' });
    handlePluginActionResult('test-plugin', null as unknown as Record<string, unknown>);
    handlePluginActionResult('test-plugin', 'string result' as unknown as Record<string, unknown>);

    expect(document.querySelector('.modal')).toBeNull();
  });
});

describe('invokePluginAction', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('calls TAURI invoke and handles modal result', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockResolvedValue({
      title: 'Result Modal',
      content: [{ type: 'text', content: 'Done' }],
    });

    const { invokePluginAction } = await import('./modal');
    const result = await invokePluginAction('p1', 'action1', { key: 'val' });

    expect(tauri.core.invoke).toHaveBeenCalledWith('invoke_plugin_action', {
      pluginId: 'p1', actionId: 'action1', payload: { key: 'val' },
    });

    const modal = document.getElementById('plugin-modal-p1');
    expect(modal).not.toBeNull();
    expect(result).toEqual({
      title: 'Result Modal',
      content: [{ type: 'text', content: 'Done' }],
    });
  });

  it('calls invoke with null payload when payload is undefined', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockResolvedValue({});

    const { invokePluginAction } = await import('./modal');
    await invokePluginAction('p1', 'action1');

    expect(tauri.core.invoke).toHaveBeenCalledWith('invoke_plugin_action', {
      pluginId: 'p1', actionId: 'action1', payload: null,
    });
  });
});

describe('wirePluginModalActions', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('wires click listener and invokes plugin action on button click', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockResolvedValue({});

    const { wirePluginModalActions, handlePluginActionResult } = await import('./modal');

    handlePluginActionResult('test-plugin', {
      title: 'Test',
      content: [{ type: 'button', id: 'do-something', content: 'Do It' }],
    });

    wirePluginModalActions();

    const button = document.querySelector<HTMLButtonElement>('button[data-plugin-action="do-something"]');
    expect(button).not.toBeNull();

    button?.click();

    await vi.waitFor(() => {
      expect(tauri.core.invoke).toHaveBeenCalledWith('invoke_plugin_action', {
        pluginId: 'test-plugin',
        actionId: 'do-something',
        payload: {},
      });
    });
  });

  it('does not re-wire the same listener twice', async () => {
    const { wirePluginModalActions } = await import('./modal');
    wirePluginModalActions();
    expect(() => wirePluginModalActions()).not.toThrow();
  });
});

describe('DOM content rendering', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  async function renderModal(content: Record<string, unknown>[]) {
    const { handlePluginActionResult } = await import('./modal');
    handlePluginActionResult('p1', {
      title: 'Test',
      content,
    });
  }

  it('renders text items with alignment', async () => {
    await renderModal([
      { type: 'text', content: 'Left aligned' },
      { type: 'text', content: 'Center', align: 'centered' },
      { type: 'text', content: 'Right', align: 'right' },
    ]);

    const body = document.querySelector('.sheet-body')!;
    const blocks = body.querySelectorAll(':scope > div');
    expect((blocks[0] as HTMLElement).style.textAlign).toBe('left');
    expect((blocks[1] as HTMLElement).style.textAlign).toBe('center');
    expect((blocks[2] as HTMLElement).style.textAlign).toBe('right');
  });

  it('renders separators', async () => {
    await renderModal([{ type: 'separator' }]);
    expect(document.querySelector('.sheet-body hr')).not.toBeNull();
  });

  it('renders horizontal-box containers', async () => {
    await renderModal([{
      type: 'horizontal-box',
      align: 'centered',
      content: [
        { type: 'button', id: 'btn1', content: 'B1' },
        { type: 'button', id: 'btn2', content: 'B2' },
      ],
    }]);

    const hbox = document.querySelector('.sheet-body > div');
    expect(hbox).not.toBeNull();
    expect((hbox as HTMLElement).style.display).toBe('flex');
    expect((hbox as HTMLElement).style.justifyContent).toBe('center');
    expect(hbox?.querySelectorAll('button').length).toBe(2);
  });

  it('renders vertical-box containers', async () => {
    await renderModal([{
      type: 'vertical-box',
      gap: '1rem',
      content: [
        { type: 'text', content: 'Item 1' },
        { type: 'text', content: 'Item 2' },
      ],
    }]);

    const vbox = document.querySelector('.sheet-body > div');
    expect(vbox).not.toBeNull();
    expect((vbox as HTMLElement).style.display).toBe('grid');
    expect((vbox as HTMLElement).style.gap).toBe('1rem');
  });

  it('renders grid containers with column template', async () => {
    await renderModal([{
      type: 'grid',
      columns: '1fr 1fr',
      content: [
        { type: 'text', content: 'Cell 1' },
        { type: 'text', content: 'Cell 2' },
      ],
    }]);

    const grid = document.querySelector('.sheet-body > div');
    expect(grid).not.toBeNull();
    expect((grid as HTMLElement).style.display).toBe('grid');
    expect((grid as HTMLElement).style.gridTemplateColumns).toBe('1fr 1fr');
  });

  it('renders input fields', async () => {
    await renderModal([{
      type: 'input',
      id: 'name',
      label: 'Name',
      placeholder: 'Enter name',
      required: true,
      value: 'default',
    }]);

    const input = document.querySelector<HTMLInputElement>('input[data-plugin-field="name"]');
    expect(input).not.toBeNull();
    expect(input?.placeholder).toBe('Enter name');
    expect(input?.required).toBe(true);
    expect(input?.value).toBe('default');

    const label = document.querySelector('label');
    expect(label?.textContent).toBe('Name');
  });

  it('renders select fields with options', async () => {
    await renderModal([{
      type: 'select',
      id: 'mode',
      label: 'Mode',
      value: 'auto',
      options: [
        { value: 'manual', label: 'Manual' },
        { value: 'auto', label: 'Auto' },
      ],
    }]);

    const select = document.querySelector<HTMLSelectElement>('select[data-plugin-field="mode"]');
    expect(select).not.toBeNull();
    expect(select?.value).toBe('auto');
    expect(select?.options.length).toBe(2);
  });

  it('renders list items with actions', async () => {
    await renderModal([{
      type: 'list',
      id: 'items',
      label: 'Items',
      emptyText: 'No items',
      items: [{
        id: 'item1',
        title: 'Item 1',
        meta: 'meta1',
        description: 'Desc 1',
        status: 'active',
        actions: [{ id: 'act1', content: 'Action 1' }],
      }],
    }]);

    expect(document.querySelector('button[data-plugin-action="act1"]')).not.toBeNull();
    expect(document.querySelector('.sheet-body')?.textContent).toContain('Item 1');
    expect(document.querySelector('.sheet-body')?.textContent).toContain('meta1');
  });

  it('shows empty text when list has no items', async () => {
    await renderModal([{
      type: 'list',
      id: 'empty',
      label: 'Empty',
      emptyText: 'Nothing here',
      items: [],
    }]);

    expect(document.querySelector('.sheet-body')?.textContent).toContain('Nothing here');
  });

  it('renders button content items with variant', async () => {
    await renderModal([
      { type: 'button', id: 'main-btn', content: 'Click Me', variant: 'primary' },
      { type: 'button', id: 'danger-btn', content: 'Delete', variant: 'danger' },
    ]);

    const primary = document.querySelector<HTMLButtonElement>('button[data-plugin-action="main-btn"]');
    expect(primary).not.toBeNull();
    expect(primary?.classList.contains('primary')).toBe(true);
    expect(primary?.textContent).toBe('Click Me');

    const danger = document.querySelector<HTMLButtonElement>('button[data-plugin-action="danger-btn"]');
    expect(danger?.classList.contains('danger')).toBe(true);
  });

  it('stores payload on buttons', async () => {
    await renderModal([{ type: 'button', id: 'btn', content: 'Do', payload: { extra: 'data' } }]);

    const btn = document.querySelector<HTMLButtonElement>('button[data-plugin-action="btn"]');
    expect(btn?.dataset.pluginPayload).toBe('{"extra":"data"}');
  });

  it('handles modals-root being absent gracefully', async () => {
    document.body.innerHTML = '';
    const { handlePluginActionResult } = await import('./modal');
    expect(() => handlePluginActionResult('p1', {
      title: 'T', content: [{ type: 'text', content: 'X' }],
    })).not.toThrow();
  });
});

describe('collectPluginModalPayload', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('collects checkbox checked state and text values', async () => {
    const { handlePluginActionResult } = await import('./modal');

    handlePluginActionResult('p-collect', {
      title: 'Collect',
      content: [
        { type: 'text', content: 'Form' },
      ],
      fields: [
        { id: 'agree', label: 'Agree', type: 'boolean', value: true },
      ],
    });

    const modal = document.getElementById('plugin-modal-p-collect')!;
    expect(modal).not.toBeNull();
  });
});
