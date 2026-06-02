// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';

import { handlePluginActionResult, initPlugins } from '@scripts/plugins';

describe('plugin modal rendering', () => {
  beforeEach(async () => {
    document.body.innerHTML = '<div id="modals-root"></div>';
    document.body.style.overflow = '';
    document.body.insertAdjacentHTML('beforeend', '<div class="menubar"></div>');
    await initPlugins();
  });

  it('renders nested layout containers', () => {
    handlePluginActionResult('git', {
      title: 'Manage Submodules',
      content: [
        {
          type: 'vertical-box',
          gap: '1rem',
          content: [
            {
              type: 'input',
              id: 'path',
              label: 'Submodule Path',
              placeholder: 'libs/example',
            },
            {
              type: 'grid',
              columns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: '.75rem',
              content: [
                {
                  type: 'input',
                  id: 'name',
                  label: 'Submodule Name',
                  placeholder: 'example',
                },
                {
                  type: 'input',
                  id: 'branch',
                  label: 'Branch (optional)',
                  placeholder: 'main',
                },
              ],
            },
          ],
        },
        {
          type: 'horizontal-box',
          align: 'centered',
          wrap: true,
          content: [
            { type: 'button', id: 'submodules-add', content: 'Add Submodule' },
            { type: 'button', id: 'repo-submodules', content: 'Refresh' },
          ],
        },
      ],
    });

    const modal = document.getElementById('plugin-modal-git') as HTMLElement | null;
    expect(modal).not.toBeNull();
    expect(modal?.getAttribute('aria-hidden')).toBe('false');

    const body = modal?.querySelector<HTMLElement>('.sheet-body');
    expect(body).not.toBeNull();
    expect(body?.children.length).toBe(2);

    const vertical = body?.children[0] as HTMLElement | undefined;
    expect(vertical?.style.display).toBe('grid');
    expect(vertical?.children.length).toBe(2);

    const grid = vertical?.children[1] as HTMLElement | undefined;
    expect(grid?.style.display).toBe('grid');
    expect(grid?.style.gridTemplateColumns).toBe('minmax(0, 1fr) minmax(0, 1fr)');

    const horizontal = body?.children[1] as HTMLElement | undefined;
    expect(horizontal?.style.display).toBe('flex');
    expect(horizontal?.querySelectorAll('button').length).toBe(2);
  });

  it('sanitizes plugin menubar markup', () => {
    document.body.innerHTML = '<div class="menubar"></div>';

    window.OpenVCS?.registerPlugin({
      id: 'test-plugin',
      menubarMenus: [
        {
          id: 'repository',
          html: '<div class="menu" data-menu="repository" onclick="window.__bad = 1"><button class="item" onclick="window.__bad = 2">Open</button><script>window.__bad = 3</script></div>',
        },
      ],
    });

    const menu = document.querySelector<HTMLElement>('.menubar .menu[data-menu="repository"]');
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute('onclick')).toBeNull();
    expect(menu?.querySelector('script')).toBeNull();
    expect(menu?.querySelector('button')?.getAttribute('onclick')).toBeNull();
  });

  it('sanitizes plugin settings sections', () => {
    document.body.innerHTML = `
      <div id="settings-modal">
        <ul id="settings-nav"></ul>
        <div id="settings-panels-scroll"></div>
      </div>
    `;

    window.OpenVCS?.registerPlugin({
      id: 'test-plugin',
      settingsSections: [
        {
          id: 'advanced',
          label: 'Advanced',
          html: '<section class="panel-form" data-panel="advanced" onmouseenter="window.__bad = 1"><button onclick="window.__bad = 2">Enable</button><iframe src="javascript:alert(1)"></iframe></section>',
        },
      ],
    });

    const panel = document.querySelector<HTMLElement>('#settings-modal .panel-form[data-panel="advanced"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('onmouseenter')).toBeNull();
    expect(panel?.querySelector('button')?.getAttribute('onclick')).toBeNull();
    expect(panel?.querySelector('iframe')).toBeNull();

    const navButton = document.querySelector<HTMLElement>('#settings-modal #settings-nav [data-section="advanced"]');
    expect(navButton).not.toBeNull();
  });
});
