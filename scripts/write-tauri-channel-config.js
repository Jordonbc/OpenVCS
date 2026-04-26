// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

const fs = require('fs');
const path = require('path');

const CHANNEL_METADATA_PATH = path.resolve(__dirname, '../channel-metadata.json');

function loadChannelMetadata() {
  const data = fs.readFileSync(CHANNEL_METADATA_PATH, 'utf8');
  return JSON.parse(data);
}

function resolveChannelConfig(raw) {
  const metadata = loadChannelMetadata();
  const slug = (raw || 'stable').trim().toLowerCase();

  let entry = metadata.channels[slug];
  if (!entry) {
    if (raw && raw.trim()) {
      console.warn(`Warning: Unknown channel '${raw}', defaulting to stable`);
    }
    entry = metadata.channels.stable;
  }

  return {
    mainBinaryName: entry.mainBinaryName,
    productName: entry.productName,
    identifier: entry.identifier,
    windowTitle: entry.windowTitle,
    updaterEndpoints: entry.updaterEndpoints,
  };
}

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
  resolveChannelConfig,
  loadChannelMetadata,
};

if (require.main === module) {
  main();
}
