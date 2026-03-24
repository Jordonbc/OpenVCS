// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

const fs = require('fs');
const path = require('path');

/**
 * Returns normalized desktop channel metadata for Tauri CLI config overrides.
 *
 * @param {string | undefined} raw
 * @returns {{mainBinaryName: string, productName: string, identifier: string, windowTitle: string, updaterEndpoints: string[]}}
 */
function resolveChannelConfig(raw) {
  const slug = (raw || 'stable').trim().toLowerCase();
  const repo = process.env.OPENVCS_REPO || 'https://github.com/Jordonbc/OpenVCS';
  const stableEndpoint = `${repo}/releases/latest/download/latest.json`;
  const betaEndpoint = `${repo}/releases/download/openvcs-beta/latest.json`;
  const nightlyEndpoint = `${repo}/releases/download/openvcs-nightly/latest.json`;

  if (slug === 'beta') {
    return {
      mainBinaryName: 'openvcs-beta',
      productName: 'OpenVCS Beta',
      identifier: 'dev.jordon.openvcs.beta',
      windowTitle: 'OpenVCS Beta',
      updaterEndpoints: [betaEndpoint, stableEndpoint],
    };
  }

  if (slug === 'nightly') {
    return {
      mainBinaryName: 'openvcs-nightly',
      productName: 'OpenVCS Nightly',
      identifier: 'dev.jordon.openvcs.nightly',
      windowTitle: 'OpenVCS Nightly',
      updaterEndpoints: [nightlyEndpoint, stableEndpoint],
    };
  }

  return {
    mainBinaryName: 'openvcs',
    productName: 'OpenVCS',
    identifier: 'dev.jordon.openvcs',
    windowTitle: 'OpenVCS',
    updaterEndpoints: [stableEndpoint],
  };
}

/**
 * Writes a Tauri merge config matching the requested channel.
 *
 * @param {string} outputPath
 * @returns {void}
 */
function writeChannelConfig(outputPath) {
  const channel = resolveChannelConfig(process.env.OPENVCS_UPDATE_CHANNEL);
  const override = {
    mainBinaryName: channel.mainBinaryName,
    productName: channel.productName,
    identifier: channel.identifier,
    app: {
      windows: [
        {
          title: channel.windowTitle,
        },
      ],
    },
    plugins: {
      updater: {
        endpoints: channel.updaterEndpoints,
      },
    },
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(override, null, 2));
}

/**
 * CLI entry point.
 *
 * @returns {void}
 */
function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    console.error('Usage: node scripts/write-tauri-channel-config.js <output-path>');
    process.exit(2);
  }

  writeChannelConfig(path.resolve(outputPath));
}

module.exports = {
  writeChannelConfig,
};

if (require.main === module) {
  main();
}
