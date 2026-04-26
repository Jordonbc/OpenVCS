// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';

import { handlePluginActionResult } from './plugins';

describe('plugin modal rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="modals-root"></div>';
    document.body.style.overflow = '';
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
});
