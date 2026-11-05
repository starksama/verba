import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(rootDir, 'app.config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

function requiredString(key) {
  const value = config[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`app.config.json: ${key} must be a non-empty string`);
  }
  return value.trim();
}

const app = {
  displayName: requiredString('displayName'),
  legalName: requiredString('legalName'),
  packageName: requiredString('packageName'),
  bundleIdentifier: requiredString('bundleIdentifier'),
  storagePrefix: requiredString('storagePrefix'),
  logPrefix: requiredString('logPrefix'),
  tempFilePrefix: requiredString('tempFilePrefix'),
  macOSSigningIdentity: typeof config.macOSSigningIdentity === 'string' ? config.macOSSigningIdentity.trim() : '',
  microphoneUsageDescription: renderTemplate(requiredString('microphoneUsageDescription'))
};

function renderTemplate(value) {
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    if (typeof config[key] !== 'string') {
      throw new Error(`app.config.json: unknown template key ${key}`);
    }
    return config[key];
  });
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(rootDir, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  writeFileSync(join(rootDir, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function syncPackageJson() {
  const packageJson = readJson('package.json');
  packageJson.name = app.packageName;
  writeJson('package.json', packageJson);
}

function syncTauriConfig() {
  const tauriConfig = readJson('src-tauri/tauri.conf.json');
  tauriConfig.productName = app.displayName;
  tauriConfig.identifier = app.bundleIdentifier;
  if (Array.isArray(tauriConfig.app?.windows)) {
    tauriConfig.app.windows = tauriConfig.app.windows.map((windowConfig) => ({
      ...windowConfig,
      title: app.displayName
    }));
  }
  tauriConfig.bundle = tauriConfig.bundle || {};
  if (app.macOSSigningIdentity) {
    tauriConfig.bundle.macOS = {
      ...(tauriConfig.bundle.macOS || {}),
      signingIdentity: app.macOSSigningIdentity
    };
  }
  writeJson('src-tauri/tauri.conf.json', tauriConfig);

  const development = config.development;
  for (const key of ['displayName', 'bundleIdentifier', 'storagePrefix', 'logPrefix', 'tempFilePrefix']) {
    if (typeof development?.[key] !== 'string' || !development[key].trim()) {
      throw new Error(`app.config.json: development.${key} must be a non-empty string`);
    }
    if (development[key] === app[key]) {
      throw new Error(`app.config.json: development.${key} must differ from production`);
    }
  }
  writeJson('src-tauri/tauri.dev.conf.json', {
    $schema: tauriConfig.$schema,
    productName: development.displayName,
    identifier: development.bundleIdentifier,
    app: {
      windows: tauriConfig.app.windows.map((windowConfig) => ({
        ...windowConfig,
        title: development.displayName
      }))
    },
    bundle: { macOS: { infoPlist: './Info.dev.plist' } }
  });
}

function syncCargoManifest() {
  const cargoPath = join(rootDir, 'src-tauri/Cargo.toml');
  const cargoToml = readFileSync(cargoPath, 'utf8').replace(
    /^name = ".*"$/m,
    `name = "${app.packageName}"`
  );
  writeFileSync(cargoPath, cargoToml);
}

function syncInfoPlist() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSMicrophoneUsageDescription</key>
  <string>${xmlEscape(app.microphoneUsageDescription)}</string>
</dict>
</plist>
`;
  writeFileSync(join(rootDir, 'src-tauri/Info.plist'), plist);
  writeFileSync(
    join(rootDir, 'src-tauri/Info.dev.plist'),
    plist.replaceAll(xmlEscape(app.displayName), xmlEscape(config.development.displayName))
  );
}

syncPackageJson();
syncTauriConfig();
syncCargoManifest();
syncInfoPlist();
