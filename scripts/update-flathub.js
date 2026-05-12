#!/usr/bin/env node
// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Updates the Flathub manifest repo for a new release.
 *
 * Usage:
 *   node scripts/update-flathub.js <flathub-dir> <version> <commit>
 *
 *   <flathub-dir>  Path to the checked-out flathub repo
 *   <version>      Semver string, e.g. "0.5.0"
 *   <commit>       Full git commit hash of the release
 *
 * What it does:
 *   1. Bumps tag + commit in the main repo git sources in the YAML manifest.
 *   2. Adds a release entry to the AppStream metainfo XML.
 *   3. Prints a summary of changes.
 */

const fs = require('fs');
const path = require('path');

// ---- config ----

const MAIN_REPO_URL = 'https://github.com/Open-VCS/OpenVCS.git';

// ---- helpers ----

function parseArgs() {
  const [, , flathubDir, version, commit] = process.argv;
  if (!flathubDir || !version || !commit) {
    console.error('Usage: node scripts/update-flathub.js <flathub-dir> <version> <commit>');
    process.exit(1);
  }
  return { flathubDir, version, commit, tag: `openvcs-v${version}` };
}

function updateManifest(path, { tag, commit }) {
  let yaml = fs.readFileSync(path, 'utf8');

  // Track whether any replacements were made.
  let matched = false;
  yaml = yaml.replace(
    new RegExp(
      `(\\s+url: ${escapeRegex(MAIN_REPO_URL)}\\n)(\\s+)tag: .*\\n(\\s+)commit: .*\\n(\\s+)dest: \\.`,
      'g'
    ),
    (...args) => {
      matched = true;
      const [, urlLine, ws1, ws2, ws3] = args;
      return `${urlLine}${ws1}tag: ${tag}\n${ws2}commit: ${commit}\n${ws3}dest: .`;
    }
  );

  if (!matched) {
    console.error(`ERROR: no match for "${MAIN_REPO_URL}" in manifest — manifest format may have changed`);
    process.exit(1);
  }

  fs.writeFileSync(path, yaml, 'utf8');
  console.log(`  → Bumped tag → ${tag}, commit → ${commit.slice(0, 12)}…`);
}

function updateMetainfo(path, { version }) {
  const today = new Date().toISOString().slice(0, 10);
  let xml = fs.readFileSync(path, 'utf8');

  // Skip if a release for this version already exists (re-run safety).
  if (new RegExp(`release version="${escapeRegex(version)}"`).test(xml)) {
    console.log(`  → Release v${version} already in metainfo, skipping`);
    return;
  }

  const releaseEntry = [
    `    <release version="${version}" date="${today}">`,
    `      <description>`,
    `        <p>Release ${version}</p>`,
    `      </description>`,
    `    </release>`,
  ].join('\n');

  // Insert after the <releases> opening tag (newest first)
  const before = xml;
  xml = xml.replace(
    /(\s*<releases>\s*\n)/,
    `$1${releaseEntry}\n`
  );

  if (xml === before) {
    console.error('ERROR: <releases> element not found in metainfo XML — cannot insert release entry');
    process.exit(1);
  }

  fs.writeFileSync(path, xml, 'utf8');
  console.log(`  → Added metainfo release entry for v${version} (${today})`);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- main ----

const args = parseArgs();
const { flathubDir, version } = args;
const tag = `openvcs-v${version}`;

console.log(`Updating Flathub manifest in ${flathubDir}:`);

updateManifest(path.join(flathubDir, 'io.github.jordonbc.OpenVCS.yml'), { ...args, tag });
updateMetainfo(path.join(flathubDir, 'io.github.jordonbc.OpenVCS.metainfo.xml'), { version });

console.log('Done.');
