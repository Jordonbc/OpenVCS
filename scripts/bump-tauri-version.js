// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Bumps the Tauri package version for CI prerelease builds.
 * 
 * Uses cargo metadata to read the current version from Backend/Cargo.toml,
 * increments the patch component, appends a prerelease suffix with the GitHub
 * run number, and writes back to the manifest.
 * 
 * Usage: node scripts/bump-tauri-version.js <channel>
 *   channel: 'alpha' for nightly, 'beta' for beta releases
 * 
 * Environment:
 *   GITHUB_RUN_NUMBER - used for monotonic versioning (set by GitHub Actions)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CARGO_PATH = path.resolve(__dirname, '../Backend/Cargo.toml');

/**
 * Read the package version using cargo metadata (TOML-aware).
 * @returns {string} Current version string (e.g., "0.3.0")
 */
function readVersion() {
  const metadata = JSON.parse(
    execFileSync('cargo', [
      'metadata',
      '--no-deps',
      '--format-version',
      '1',
      '--manifest-path',
      CARGO_PATH,
    ], { encoding: 'utf8' })
  );

  const version = metadata.packages?.find((pkg) => {
    return path.resolve(pkg.manifest_path) === CARGO_PATH;
  })?.version;
  if (!version) {
    throw new Error('Could not read package version from cargo metadata');
  }
  return version;
}

/**
 * Compute the new prerelease version.
 * @param {string} currentVersion - Current semver (e.g., "0.3.0")
 * @param {string} channel - Prerelease channel ('alpha' or 'beta')
 * @returns {string} New version (e.g., "0.3.1-alpha.1234")
 */
function computeNewVersion(currentVersion, channel) {
  // Strip any existing prerelease suffix (e.g., "0.3.0-alpha.1" -> "0.3.0")
  const baseVersion = currentVersion.split('-')[0];
  const parts = baseVersion.split('.');
  
  if (parts.length !== 3) {
    throw new Error(`Invalid semver format: ${currentVersion}`);
  }
  
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parseInt(parts[2], 10) + 1; // bump patch for next release
  
  // Use GITHUB_RUN_NUMBER for monotonic versioning
  // Reruns of the same workflow keep the same version to avoid mixed artifacts
  const runNumber = process.env.GITHUB_RUN_NUMBER || '0';
  
  return `${major}.${minor}.${patch}-${channel}.${runNumber}`;
}

/**
 * Write the new version back to the `[package]` section in Cargo.toml.
 * @param {string} newVersion - New version string to write
 */
function writeVersion(newVersion) {
  const content = fs.readFileSync(CARGO_PATH, 'utf8');
  const lines = content.split(/\r?\n/);
  let inPackageSection = false;
  let replaced = false;

  const newContent = lines.map((line) => {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      inPackageSection = sectionMatch[1].trim() === 'package';
      return line;
    }

    if (inPackageSection && /^\s*version\s*=\s*".*"\s*$/.test(line)) {
      if (replaced) {
        throw new Error('Found multiple package version entries in Cargo.toml');
      }
      replaced = true;
      return `version = "${newVersion}"`;
    }

    return line;
  }).join('\n');

  if (!replaced) {
    throw new Error('Could not find package version in Cargo.toml');
  }

  fs.writeFileSync(CARGO_PATH, newContent);
}

function main() {
  const channel = process.argv[2];
  
  if (!channel || !['alpha', 'beta'].includes(channel)) {
    console.error('Usage: node bump-tauri-version.js <alpha|beta>');
    process.exit(1);
  }
  
  const currentVersion = readVersion();
  console.log('Current version:', currentVersion);
  
  const newVersion = computeNewVersion(currentVersion, channel);
  console.log('New version:', newVersion);
  
  writeVersion(newVersion);
  console.log('Updated Backend/Cargo.toml');
}

main();
