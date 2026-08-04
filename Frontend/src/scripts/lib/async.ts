// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Run several refresh tasks concurrently and wait for all of them to settle,
 * tolerating individual failures.
 *
 * Each task is a zero-argument function returning a promise. Tasks are started
 * eagerly, in array order, and the returned promise resolves once every task
 * has settled (fulfilled or rejected) — mirroring `Promise.allSettled`.
 *
 * @example
 * await refreshAll([hydrateStatus, hydrateCommits]);
 */
export async function refreshAll(tasks: ReadonlyArray<() => unknown>): Promise<void> {
    await Promise.allSettled(tasks.map((task) => Promise.resolve(task())));
}
