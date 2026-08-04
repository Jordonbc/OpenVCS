// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { notify } from './notify';

/** Optional notification messages for a clipboard copy. */
export type CopyOptions = {
    /** Success message shown when the copy succeeds. */
    success?: string;
    /** Failure message shown when the clipboard API rejects. */
    failure?: string;
};

/**
 * Copy text to the system clipboard, optionally notifying the user.
 * @param text - Text to copy
 * @param opts - Optional success/failure notification messages
 * @returns True when the clipboard write succeeded
 */
export async function copyText(text: string, opts: CopyOptions = {}): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        if (opts.success) notify(opts.success);
        return true;
    } catch {
        if (opts.failure) notify(opts.failure);
        return false;
    }
}
