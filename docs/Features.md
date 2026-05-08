<!-- Copyright © 2025-2026 OpenVCS Contributors -->

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# Features

OpenVCS is plugin-first and VCS-agnostic. Features, themes, UI changes, and VCS integrations are all delivered by plugins.

## Current capability areas

<table style="width: 100%;">
  <tr>
    <th>Feature</th>
    <th>Status</th>
    <th>Notes</th>
  </tr>
  <tr><td>Clone repository</td><td align="center">✅</td><td>Available through the Git plugin</td></tr>
  <tr><td>Open existing repository</td><td align="center">✅</td><td>Includes recent repository tracking</td></tr>
  <tr><td>Reopen last repository on launch</td><td align="center">✅</td><td>Optional behaviour</td></tr>
  <tr><td>Working tree status</td><td align="center">✅</td><td>Shows repository changes</td></tr>
  <tr><td>Per-file diff</td><td align="center">✅</td><td>File-level change inspection</td></tr>
  <tr><td>Commit diff</td><td align="center">✅</td><td>Commit-level inspection</td></tr>
  <tr><td>Diff selection readability</td><td align="center">✅</td><td>Blue gutter stays continuous through each picked hunk, with a full-height hunk rail and bare per-line checkmarks keeping inclusion easy to scan</td></tr>
  <tr><td>Discard changes</td><td align="center">✅</td><td>Working tree cleanup</td></tr>
</table>

<table style="width: 100%;">
  <tr>
    <th>Feature</th>
    <th>Status</th>
    <th>Notes</th>
  </tr>
  <tr><td>Stage files</td><td align="center">✅</td><td>Standard index workflow</td></tr>
  <tr><td>Partial staging</td><td align="center">✅</td><td>Patch-based staging</td></tr>
  <tr><td>Partial commits</td><td align="center">✅</td><td>Commit selected patch content</td></tr>
  <tr><td>Restrict commit summary</td><td align="center">✅</td><td>On-by-default setting that caps the commit title box at 72 characters</td></tr>
  <tr><td>Commit from index</td><td align="center">✅</td><td>Commit staged changes</td></tr>
</table>

<table style="width: 100%;">
  <tr>
    <th>Feature</th>
    <th>Status</th>
    <th>Notes</th>
  </tr>
  <tr><td>List local branches</td><td align="center">✅</td><td>Local branch visibility</td></tr>
  <tr><td>List remote branches</td><td align="center">✅</td><td>Remote branch visibility</td></tr>
  <tr><td>Create branch</td><td align="center">✅</td><td>Create from current branch; optional checkout toggle in the Create Branch dialog; non-current base refs require backend support</td></tr>
  <tr><td>Checkout branch</td><td align="center">✅</td><td>Switch active branch</td></tr>
  <tr><td>Rename branch</td><td align="center">✅</td><td>Local branch rename</td></tr>
  <tr><td>Delete branch</td><td align="center">✅</td><td>Branch cleanup</td></tr>
  <tr><td>Set upstream tracking</td><td align="center">✅</td><td>Configure tracking</td></tr>
</table>

<table style="width: 100%;">
  <tr>
    <th>Feature</th>
    <th>Status</th>
    <th>Notes</th>
  </tr>
  <tr><td>Merge branch</td><td align="center">✅</td><td>Branch merge workflow</td></tr>
  <tr><td>Inspect conflicts</td><td align="center">✅</td><td>Conflict details surfaced in UI for unmerged status variants</td></tr>
  <tr><td>Checkout ours/theirs</td><td align="center">✅</td><td>Conflict-side selection</td></tr>
  <tr><td>Save merged result</td><td align="center">✅</td><td>Persist resolved files</td></tr>
  <tr><td>Launch external merge tool</td><td align="center">✅</td><td>Uses configured external tooling</td></tr>
  <tr><td>Abort merge</td><td align="center">✅</td><td>Cancel active merge</td></tr>
  <tr><td>Continue merge</td><td align="center">✅</td><td>Complete merge after resolution</td></tr>
</table>

<table style="width: 100%;">
  <tr>
    <th>Feature</th>
    <th>Status</th>
    <th>Notes</th>
  </tr>
  <tr><td>List stashes</td><td align="center">✅</td><td>Stash overview</td></tr>
  <tr><td>Push stash</td><td align="center">✅</td><td>Save working changes</td></tr>
  <tr><td>Apply stash</td><td align="center">✅</td><td>Apply without dropping</td></tr>
  <tr><td>Pop stash</td><td align="center">✅</td><td>Apply and remove</td></tr>
  <tr><td>Drop stash</td><td align="center">✅</td><td>Delete stash entry</td></tr>
  <tr><td>Show stash</td><td align="center">✅</td><td>Inspect stash content</td></tr>
  <tr><td>Set remote URL</td><td align="center">✅</td><td>Remote configuration</td></tr>
  <tr><td>Fetch single remote</td><td align="center">✅</td><td>Targeted fetch</td></tr>
  <tr><td>Fetch all remotes</td><td align="center">✅</td><td>Full remote update</td></tr>
  <tr><td>Pull fast-forward only</td><td align="center">✅</td><td>Conservative pull behaviour</td></tr>
  <tr><td>Push</td><td align="center">✅</td><td>Push local changes; branches already present on origin are treated as pushable, and first publish establishes upstream tracking</td></tr>
</table>

<table style="width: 100%;">
  <tr>
    <th>Feature</th>
    <th>Status</th>
    <th>Notes</th>
  </tr>
  <tr><td>LFS fetch</td><td align="center">✅</td><td>Fetch LFS objects</td></tr>
  <tr><td>LFS pull</td><td align="center">✅</td><td>Pull LFS objects</td></tr>
  <tr><td>LFS prune</td><td align="center">✅</td><td>Remove old LFS objects</td></tr>
  <tr><td>LFS track/untrack</td><td align="center">✅</td><td>Manage LFS paths</td></tr>
  <tr><td>Inspect LFS tracked paths</td><td align="center">✅</td><td>View tracked files/patterns</td></tr>
  <tr><td>Trust SSH host keys</td><td align="center">✅</td><td>Host-key trust helper</td></tr>
  <tr><td>List SSH agent keys</td><td align="center">✅</td><td>Agent key visibility</td></tr>
  <tr><td>Add SSH agent keys</td><td align="center">✅</td><td>Agent key helper</td></tr>
  <tr><td>Discover SSH keys</td><td align="center">✅</td><td>Local key discovery</td></tr>
</table>

<table style="width: 100%;">
  <tr>
    <th>Feature</th>
    <th>Status</th>
    <th>Notes</th>
  </tr>
  <tr><td>Light theme</td><td align="center">✅</td><td>Built in</td></tr>
  <tr><td>Dark theme</td><td align="center">✅</td><td>Built in</td></tr>
  <tr><td>Plugin-provided themes</td><td align="center">✅</td><td>Supported through plugins</td></tr>
  <tr><td>Standalone theme <code>.zip</code> packs</td><td align="center">❌</td><td>Not currently supported</td></tr>
  <tr><td>npm plugin loading</td><td align="center">🧪</td><td>Early support</td></tr>
  <tr><td>local-path plugin loading</td><td align="center">🧪</td><td>Early support</td></tr>
  <tr><td>Update check/install</td><td align="center">✅</td><td>Application update flow</td></tr>
  <tr><td>VCS output log</td><td align="center">✅</td><td>Dedicated output window</td></tr>
  <tr><td>App log tail/clear</td><td align="center">✅</td><td>Runtime log tooling</td></tr>
  <tr><td>Plugin/theme store</td><td align="center">🧭</td><td>Planned/exploratory</td></tr>
</table>

Legend: ✅ available · 🧪 early/experimental · 🧭 planned · ❌ not supported
