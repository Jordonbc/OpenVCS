// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::tool_args;
use crate::settings::ExternalTool;

#[test]
fn splits_tool_path_and_arguments() {
    let tool = ExternalTool {
        enabled: true,
        path: "/usr/bin/meld".into(),
        args: "--auto-merge {path} --label \"My Repo\"".into(),
    };

    let (path, args) = tool_args(&tool);
    assert_eq!(path, "/usr/bin/meld");
    assert_eq!(args, vec!["--auto-merge", "{path}", "--label", "My Repo"]);
}

#[test]
fn returns_empty_arguments_when_tool_has_no_args() {
    let tool = ExternalTool {
        enabled: true,
        path: "meld".into(),
        args: "   ".into(),
    };

    let (path, args) = tool_args(&tool);
    assert_eq!(path, "meld");
    assert!(args.is_empty());
}
