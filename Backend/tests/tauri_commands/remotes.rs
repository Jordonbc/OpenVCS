// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::looks_like_ff_only_divergence;

#[test]
fn detects_fast_forward_only_divergence() {
    assert!(looks_like_ff_only_divergence(
        "fatal: Not possible to fast-forward, aborting."
    ));
    assert!(looks_like_ff_only_divergence(
        "hint: Diverging branches can't be fast-forwarded, you need to either:"
    ));
}

#[test]
fn ignores_unrelated_pull_failures() {
    assert!(!looks_like_ff_only_divergence(
        "permission denied (publickey)"
    ));
    assert!(!looks_like_ff_only_divergence(
        "could not resolve hostname origin"
    ));
}
