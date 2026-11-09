import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { arch } from 'node:process';
import { verifyStableSignature } from './macos-signature.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
// Release credentials (Developer ID, notary key) live in an untracked .env, never in the repo.
const envFile = join(rootDir, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const appConfig = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(join(rootDir, 'app.config.json'), 'utf8')));
const packageJson = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(join(rootDir, 'package.json'), 'utf8')));

const displayName = appConfig.displayName;
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
  cwd: join(rootDir, 'src-tauri'), encoding: 'utf8'
}));
const cargoTargetDir = join(metadata.target_directory, 'release');
const appPath = join(cargoTargetDir, 'bundle', 'macos', `${displayName}.app`);
const dmgDir = join(cargoTargetDir, 'bundle', 'dmg');
const dmgStageDir = join(dmgDir, `${displayName}-install`);
const macArch = arch === 'arm64' ? 'aarch64' : arch;
const dmgPath = join(dmgDir, `${displayName}_${packageJson.version}_${macArch}.dmg`);

if (process.platform !== 'darwin') {
  throw new Error('macOS DMG creation requires macOS.');
}

if (!existsSync(appPath)) {
  throw new Error(`Missing app bundle: ${appPath}`);
}
verifyStableSignature(appPath);

mkdirSync(dmgDir, { recursive: true });
rmSync(dmgPath, { force: true });
rmSync(dmgStageDir, { recursive: true, force: true });
mkdirSync(dmgStageDir, { recursive: true });

execFileSync('ditto', [appPath, join(dmgStageDir, `${displayName}.app`)], { stdio: 'inherit' });
symlinkSync('/Applications', join(dmgStageDir, 'Applications'));
writeFileSync(
  join(dmgStageDir, 'Install.txt'),
  `Install ${displayName}\n\n1. Drag ${displayName}.app onto Applications.\n2. Eject this disk image.\n3. Open ${displayName} from Applications.\n\nDo not run ${displayName} directly from this disk image when setting macOS permissions.\n`
);

execFileSync('hdiutil', [
  'create',
  '-volname', displayName,
  '-srcfolder', dmgStageDir,
  '-ov',
  '-format', 'UDZO',
  dmgPath
], { stdio: 'inherit' });

rmSync(dmgStageDir, { recursive: true, force: true });

// Sign the disk image itself so Gatekeeper can check it before it is opened.
// Same identity Tauri used for the app: APPLE_SIGNING_IDENTITY overrides the config default.
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY || appConfig.macOSSigningIdentity;
// Apple's timestamp service only accepts Apple-issued certificates.
const timestamp = signingIdentity.startsWith('Developer ID Application: ') ? '--timestamp' : '--timestamp=none';
execFileSync('codesign', ['--force', timestamp, '--sign', signingIdentity, dmgPath], { stdio: 'inherit' });

// Notarize with an App Store Connect API key. Without one the DMG is signed but other Macs still warn.
const { APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH } = process.env;
if (APPLE_API_KEY && APPLE_API_ISSUER && APPLE_API_KEY_PATH) {
  execFileSync('xcrun', [
    'notarytool', 'submit', dmgPath,
    '--key', APPLE_API_KEY_PATH, '--key-id', APPLE_API_KEY, '--issuer', APPLE_API_ISSUER,
    '--wait'
  ], { stdio: 'inherit' });
  execFileSync('xcrun', ['stapler', 'staple', dmgPath], { stdio: 'inherit' });
  execFileSync('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '-vv', dmgPath], { stdio: 'inherit' });
  console.log(`Created notarized ${dmgPath}`);
} else {
  console.log(`Created ${dmgPath}`);
  console.log('Not notarized: set APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_PATH to notarize.');
}
