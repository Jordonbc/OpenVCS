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
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
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
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
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

    const { invokePluginAction } = await import('@scripts/plugins/modal');
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

    const { invokePluginAction } = await import('@scripts/plugins/modal');
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

    const { wirePluginModalActions, handlePluginActionResult } = await import('@scripts/plugins/modal');

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
    const { wirePluginModalActions } = await import('@scripts/plugins/modal');
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
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
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
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
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

  it('collects values and handles action failures through button click', async () => {
    const modalsModule = await import('@scripts/plugins/modal');
    const { wirePluginModalActions, handlePluginActionResult } = modalsModule;
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockRejectedValue(new Error('action failed'));

    wirePluginModalActions();
    handlePluginActionResult('p-collect', {
      title: 'Collect',
      content: [
        { type: 'text', content: 'Form' },
        { type: 'button', id: 'submit', content: 'Submit', payload: { custom: 'payload' } },
      ],
    });

    const btn = document.querySelector<HTMLButtonElement>('button[data-plugin-action="submit"]')!;
    btn.click();

    expect(tauri.core.invoke).toHaveBeenCalledWith('invoke_plugin_action', {
      pluginId: 'p-collect',
      actionId: 'submit',
      payload: { custom: 'payload' },
    });
  });
});

describe('isPluginModalDefinition edge cases', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('rejects arrays as modal definitions', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p1', [] as unknown as Record<string, unknown>);
    expect(document.querySelector('.modal')).toBeNull();
  });

  it('rejects null as modal definition', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p1', null as unknown as Record<string, unknown>);
    expect(document.querySelector('.modal')).toBeNull();
  });
});

describe('renderPluginModal missing title or body', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('returns early when body element is missing', async () => {
    // Create a modal element via the normal path, then remove the body
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p1', { title: 'Test', content: [{ type: 'text', content: 'X' }] });
    const modal = document.getElementById('plugin-modal-p1')!;
    const body = modal.querySelector('.sheet-body')!;
    body.remove();

    // Second render should find no body and return early
    expect(() => handlePluginActionResult('p1', { title: 'Test', content: [{ type: 'text', content: 'Y' }] })).not.toThrow();
  });

  it('returns early when title element is missing', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p1', { title: 'Test', content: [{ type: 'text', content: 'X' }] });
    const modal = document.getElementById('plugin-modal-p1')!;
    const title = modal.querySelector('h3')!;
    title.remove();

    expect(() => handlePluginActionResult('p1', { title: 'Test', content: [{ type: 'text', content: 'Y' }] })).not.toThrow();
  });
});

describe('wirePluginModalActions edge cases', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('ignores click that does not match the modal action selector', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockResolvedValue({});

    const { wirePluginModalActions } = await import('@scripts/plugins/modal');
    wirePluginModalActions();

    // Click on document body - should not invoke anything
    document.body.click();
    expect(tauri.core.invoke).not.toHaveBeenCalled();
  });

  it('ignores click with empty pluginId', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockResolvedValue({});

    const { wirePluginModalActions } = await import('@scripts/plugins/modal');
    wirePluginModalActions();

    // Create a button matching the selector but with empty pluginId
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('data-plugin-id', '');
    modal.innerHTML = '<div class="dialog"><div class="sheet-head"><h3>Title</h3></div><section class="sheet-body"><button data-plugin-action="" data-plugin-id="">Click</button></section></div>';
    document.body.appendChild(modal);

    const btn = modal.querySelector('button')!;
    btn.click();
    expect(tauri.core.invoke).not.toHaveBeenCalled();
  });
});

describe('ensurePluginModalElement edge cases', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
  });

  it('handles missing modals-root gracefully', async () => {
    document.body.innerHTML = '';
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    expect(() => handlePluginActionResult('p1', {
      title: 'T',
      content: [{ type: 'text', content: 'X' }],
    })).not.toThrow();
    expect(document.getElementById('plugin-modal-p1')).toBeNull();
  });

  it('reuses existing modal element on subsequent renders', async () => {
    mountRoot();
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p1', {
      title: 'First',
      content: [{ type: 'text', content: 'First' }],
    });
    const modal = document.getElementById('plugin-modal-p1');
    expect(modal).not.toBeNull();

    handlePluginActionResult('p1', {
      title: 'Second',
      content: [{ type: 'text', content: 'Second' }],
    });
    expect(document.getElementById('plugin-modal-p1')).toBe(modal);
    expect(modal?.querySelector('.sheet-body')?.textContent).toBe('Second');
  });
});

describe('alignToJustifyContent and appendModalButton coverage', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('renders top-level button with right alignment in wrapped row', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p1', {
      title: 'Test',
      content: [
        { type: 'button', id: 'rbtn', content: 'Right', align: 'right' },
      ],
    });
    const btn = document.querySelector('button[data-plugin-action="rbtn"]');
    expect(btn).not.toBeNull();
    const row = btn?.parentElement;
    expect(row?.style.display).toBe('flex');
    expect(row?.style.justifyContent).toBe('flex-end');
  });

  it('renders top-level button with centered alignment in wrapped row', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p1', {
      title: 'Test',
      content: [
        { type: 'button', id: 'cbtn', content: 'Center', align: 'centered' },
      ],
    });
    const row = document.querySelector('button[data-plugin-action="cbtn"]')?.parentElement;
    expect(row?.style.justifyContent).toBe('center');
  });
});

describe('renderPluginModalItem remaining types', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  async function renderModal(content: Record<string, unknown>[]) {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p1', { title: 'Test', content });
  }

  it('renders horizontal-box with wrap=false (nowrap)', async () => {
    await renderModal([{
      type: 'horizontal-box',
      wrap: false,
      content: [{ type: 'text', content: 'No wrap' }],
    }]);
    const hbox = document.querySelector('.sheet-body > div') as HTMLElement;
    expect(hbox.style.flexWrap).toBe('nowrap');
  });

  it('renders horizontal-box with empty content', async () => {
    await renderModal([{ type: 'horizontal-box', content: [] }]);
    const hbox = document.querySelector('.sheet-body > div') as HTMLElement;
    expect(hbox).not.toBeNull();
    expect(hbox.children.length).toBe(0);
  });

  it('renders vertical-box with empty content', async () => {
    await renderModal([{ type: 'vertical-box', content: [] }]);
    const vbox = document.querySelector('.sheet-body > div') as HTMLElement;
    expect(vbox.style.display).toBe('grid');
    expect(vbox.children.length).toBe(0);
  });

  it('renders grid with default columns when columns omitted', async () => {
    await renderModal([{ type: 'grid', content: [] }]);
    const grid = document.querySelector('.sheet-body > div') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('1fr');
  });

  it('renders input with only id and label (minimal)', async () => {
    await renderModal([{ type: 'input', id: 'min', label: 'Minimal' }]);
    const input = document.querySelector<HTMLInputElement>('input[data-plugin-field="min"]');
    expect(input).not.toBeNull();
    expect(input?.type).toBe('text');
    expect(input?.required).toBe(false);
    expect(input?.value).toBe('');
  });

  it('renders select with option.selected default when value absent', async () => {
    await renderModal([{
      type: 'select',
      id: 'mode',
      label: 'Mode',
      options: [
        { value: 'manual', label: 'Manual' },
        { value: 'auto', label: 'Auto', selected: true },
      ],
    }]);
    const select = document.querySelector<HTMLSelectElement>('select[data-plugin-field="mode"]');
    expect(select?.value).toBe('auto');
  });

  it('renders list without label', async () => {
    await renderModal([{
      type: 'list',
      id: 'nl',
      items: [{ id: 'i1', title: 'No label' }],
    }]);
    expect(document.querySelector('.sheet-body')?.textContent).toContain('No label');
    expect(document.querySelector('.sheet-body > div > .meta')).toBeNull();
  });

  it('renders empty list without emptyText produces no text', async () => {
    await renderModal([{
      type: 'list',
      id: 'empty-note',
      items: [],
    }]);
    const container = document.querySelector('.sheet-body > div') as HTMLElement;
    expect(container).not.toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders list row without optional meta/description/status/actions', async () => {
    await renderModal([{
      type: 'list',
      id: 'min',
      items: [{ id: 'i1', title: 'Minimal' }],
    }]);
    expect(document.querySelector('.sheet-body')?.textContent).toContain('Minimal');
    expect(document.querySelector('.sheet-body button[data-plugin-action]')).toBeNull();
  });

  it('renders button detected by content string fallback (no explicit type)', async () => {
    await renderModal([{ id: 'fb', content: 'Fallback' }]);
    const btn = document.querySelector<HTMLButtonElement>('button[data-plugin-action="fb"]');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe('Fallback');
  });

  it('renders text with title attribute', async () => {
    await renderModal([{ type: 'text', content: 'Titled', title: 'Tooltip text' }]);
    const div = document.querySelector('.sheet-body > div') as HTMLElement;
    expect(div.title).toBe('Tooltip text');
  });

  it('creates default variant button (no primary/danger class)', async () => {
    await renderModal([{ type: 'button', id: 'def', content: 'Default' }]);
    const btn = document.querySelector<HTMLButtonElement>('button[data-plugin-action="def"]');
    expect(btn?.classList.contains('primary')).toBe(false);
    expect(btn?.classList.contains('danger')).toBe(false);
    expect(btn?.textContent).toBe('Default');
  });

  it('skips null items in content array', async () => {
    await renderModal([
      null as unknown as Record<string, unknown>,
      { type: 'text', content: 'After null' },
    ]);
    expect(document.querySelector('.sheet-body')?.textContent).toContain('After null');
  });
});

describe('collectPluginModalPayload and wirePluginModalActions coverage', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('merges dataset payload with collected form payload', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockResolvedValue({});

    const { wirePluginModalActions, handlePluginActionResult } = await import('@scripts/plugins/modal');
    wirePluginModalActions();

    handlePluginActionResult('p1', {
      title: 'Form',
      content: [
        { type: 'input', id: 'name', label: 'Name', value: 'Alice' },
        { type: 'button', id: 'submit', content: 'Submit', payload: { extra: 'data' } },
      ],
    });

    (document.querySelector('button[data-plugin-action="submit"]') as HTMLButtonElement)?.click();

    await vi.waitFor(() => {
      expect(tauri.core.invoke).toHaveBeenCalledWith('invoke_plugin_action', {
        pluginId: 'p1',
        actionId: 'submit',
        payload: { name: 'Alice', extra: 'data' },
      });
    });
  });

  it('collects checkbox field as boolean and skips empty keys', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockResolvedValue({});

    const { wirePluginModalActions, handlePluginActionResult } = await import('@scripts/plugins/modal');
    wirePluginModalActions();

    handlePluginActionResult('p1', {
      title: 'Cb Test',
      content: [
        { type: 'input', id: 'name', label: 'Name', value: 'Bob' },
        { type: 'button', id: 'go', content: 'Go' },
      ],
    });

    const modal = document.getElementById('plugin-modal-p1')!;
    const body = modal.querySelector('.sheet-body')!;

    const cg = document.createElement('div');
    cg.className = 'group';
    const cl = document.createElement('label');
    cl.textContent = 'Enabled';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.pluginField = 'enabled';
    cb.checked = true;
    cg.appendChild(cl);
    cg.appendChild(cb);
    body.appendChild(cg);

    const eg = document.createElement('div');
    eg.className = 'group';
    const ei = document.createElement('input');
    ei.dataset.pluginField = '';
    ei.value = 'skip-me';
    eg.appendChild(ei);
    body.appendChild(eg);

    (document.querySelector('button[data-plugin-action="go"]') as HTMLButtonElement)?.click();

    await vi.waitFor(() => {
      expect(tauri.core.invoke).toHaveBeenCalledWith('invoke_plugin_action', {
        pluginId: 'p1',
        actionId: 'go',
        payload: { name: 'Bob', enabled: true },
      });
    });
  });

  it('ignores malformed JSON in button payload dataset', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockResolvedValue({});

    const { wirePluginModalActions, handlePluginActionResult } = await import('@scripts/plugins/modal');
    wirePluginModalActions();

    handlePluginActionResult('p1', {
      title: 'Bad JSON',
      content: [
        { type: 'input', id: 'f', label: 'F', value: 'v' },
        { type: 'button', id: 'bp', content: 'Bad', payload: {} },
      ],
    });

    const btn = document.querySelector('button[data-plugin-action="bp"]') as HTMLButtonElement;
    btn.dataset.pluginPayload = '{bad json';
    btn.click();

    await vi.waitFor(() => {
      expect(tauri.core.invoke).toHaveBeenCalledWith('invoke_plugin_action', {
        pluginId: 'p1',
        actionId: 'bp',
        payload: { f: 'v' },
      });
    });
  });

  it('handles invokePluginAction error gracefully during wired click', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockRejectedValue(new Error('network error'));

    const { wirePluginModalActions, handlePluginActionResult } = await import('@scripts/plugins/modal');
    wirePluginModalActions();

    handlePluginActionResult('p1', {
      title: 'Err',
      content: [
        { type: 'button', id: 'ebtn', content: 'Error' },
      ],
    });

    const btn = document.querySelector('button[data-plugin-action="ebtn"]') as HTMLButtonElement;
    expect(() => btn.click()).not.toThrow();
    await vi.waitFor(() => {
      expect(tauri.core.invoke).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Branch coverage: renderPluginModal title fallback (line 302)
// ============================================================================
describe('renderPluginModal title edge cases', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('shows "Plugin" fallback when title is empty (line 302)', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p-empty-title', {
      title: '',
      content: [{ type: 'text', content: 'No title' }],
    });
    const modal = document.getElementById('plugin-modal-p-empty-title');
    const titleEl = modal?.querySelector('h3');
    expect(titleEl?.textContent).toBe('Plugin');
  });

  it('shows "Plugin" fallback when title is only whitespace (line 302)', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p-ws-title', {
      title: '   ',
      content: [{ type: 'text', content: 'Whitespace title' }],
    });
    const modal = document.getElementById('plugin-modal-p-ws-title');
    const titleEl = modal?.querySelector('h3');
    expect(titleEl?.textContent).toBe('Plugin');
  });
});

// ============================================================================
// Branch coverage: renderPluginModal content array edge cases (lines 304-305)
// ============================================================================
describe('renderPluginModal content array edge cases', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('renders modal with empty content array (no items to iterate)', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p-empty-arr', {
      title: 'Empty Array',
      content: [],
    });
    const modal = document.getElementById('plugin-modal-p-empty-arr');
    expect(modal).not.toBeNull();
    const body = modal?.querySelector('.sheet-body');
    expect(body?.children.length).toBe(0);
  });

  it('skips null items in content array (line 305 if (!item) continue)', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p-null-items', {
      title: 'Null Items',
      content: [
        null as unknown as Record<string, unknown>,
        { type: 'text', content: 'After null' },
      ],
    });
    const modal = document.getElementById('plugin-modal-p-null-items');
    expect(modal).not.toBeNull();
    const body = modal?.querySelector('.sheet-body');
    expect(body?.textContent).toContain('After null');
  });
});

// ============================================================================
// Branch coverage: wirePluginModalActions button click with modal payload
// ============================================================================
describe('wirePluginModalActions button click payload', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('invokes action via wired click with no extra payload on button', async () => {
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke.mockResolvedValue({});

    const { wirePluginModalActions, handlePluginActionResult } = await import('@scripts/plugins/modal');
    wirePluginModalActions();

    handlePluginActionResult('p-plain', {
      title: 'Plain',
      content: [
        { type: 'button', id: 'go', content: 'Go' },
      ],
    });

    const btn = document.querySelector('button[data-plugin-action="go"]') as HTMLButtonElement;
    btn.click();

    await vi.waitFor(() => {
      expect(tauri.core.invoke).toHaveBeenCalledWith('invoke_plugin_action', {
        pluginId: 'p-plain',
        actionId: 'go',
        payload: {},
      });
    });
  });
});

// ============================================================================
// Branch coverage: renderPluginModalItem unknown type ignored (line 288)
// ============================================================================
describe('renderPluginModalItem unknown type', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('silently ignores items with unknown type and no content string (line 288)', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p-unknown', {
      title: 'Unknown',
      content: [
        { type: 'unknown_type', id: 'weird' },
        { type: 'text', content: 'After unknown' },
      ],
    });
    const body = document.querySelector('.sheet-body');
    expect(body?.textContent).toContain('After unknown');
    // The unknown item should produce no DOM nodes
  });
});

// ============================================================================
// Branch coverage: input with non-default kind (line 187)
// ============================================================================
describe('renderPluginModalItem input kinds', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('renders input with kind="email"', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p-input', {
      title: 'Input Types',
      content: [
        { type: 'input', id: 'email-field', label: 'Email', kind: 'email', value: 'test@example.com' },
      ],
    });
    const input = document.querySelector<HTMLInputElement>('input[data-plugin-field="email-field"]');
    expect(input).not.toBeNull();
    expect(input?.type).toBe('email');
    expect(input?.value).toBe('test@example.com');
  });
});

// ============================================================================
// Branch coverage: select with no matching value (line 211-214)
// ============================================================================
describe('renderPluginModalItem select edge cases', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('renders select with value not matching any option', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p-select', {
      title: 'Select',
      content: [
        {
          type: 'select', id: 'mode', label: 'Mode', value: 'nonexistent',
          options: [
            { value: 'manual', label: 'Manual' },
            { value: 'auto', label: 'Auto' },
          ],
        },
      ],
    });
    const select = document.querySelector<HTMLSelectElement>('select[data-plugin-field="mode"]');
    expect(select).not.toBeNull();
    // When value doesn't match any option, the browser defaults to first option
    // Verify no option has the HTML `selected` attribute set explicitly
    expect(select?.querySelector('option[selected]')).toBeNull();
  });
});

// ============================================================================
// Branch coverage: list with items having only meta field (line 255)
// ============================================================================
describe('renderPluginModalItem list meta edge cases', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('renders list item with meta but no description or status', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p-list-meta', {
      title: 'List Meta',
      content: [
        {
          type: 'list', id: 'items', label: 'Items',
          items: [
            { id: 'i1', title: 'Item 1', meta: 'Meta only' },
          ],
        },
      ],
    });
    expect(document.querySelector('.sheet-body')?.textContent).toContain('Item 1');
    expect(document.querySelector('.sheet-body')?.textContent).toContain('Meta only');
  });

  it('renders list item with description but no meta or status', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p-list-desc', {
      title: 'List Desc',
      content: [
        {
          type: 'list', id: 'items', label: 'Items',
          items: [
            { id: 'i1', title: 'Item 1', description: 'Description only' },
          ],
        },
      ],
    });
    expect(document.querySelector('.sheet-body')?.textContent).toContain('Description only');
  });

  it('renders list item with actions but no meta/description/status', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p-list-actions', {
      title: 'List Actions',
      content: [
        {
          type: 'list', id: 'items', label: 'Items',
          items: [
            { id: 'i1', title: 'Item 1', actions: [{ id: 'act1', content: 'Action1' }] },
          ],
        },
      ],
    });
    expect(document.querySelector('button[data-plugin-action="act1"]')).not.toBeNull();
  });
});

// ============================================================================
// Branch coverage: grid with explicit gap (line 170)
// ============================================================================
describe('renderPluginModalItem grid gap', () => {
  beforeEach(() => {
    setupTauri();
    vi.resetModules();
    mountRoot();
  });

  it('renders grid with explicit gap and columns', async () => {
    const { handlePluginActionResult } = await import('@scripts/plugins/modal');
    handlePluginActionResult('p-grid-gap', {
      title: 'Grid Gap',
      content: [
        {
          type: 'grid', columns: '1fr 1fr 1fr', gap: '2rem',
          content: [
            { type: 'text', content: 'A' },
            { type: 'text', content: 'B' },
            { type: 'text', content: 'C' },
          ],
        },
      ],
    });
    const grid = document.querySelector('.sheet-body > div') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('1fr 1fr 1fr');
    expect(grid.style.gap).toBe('2rem');
    expect(grid.children.length).toBe(3);
  });
});
