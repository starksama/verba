import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyStableSignature, verifySigningContinuity } from './macos-signature.mjs';

if (process.platform !== 'darwin') throw new Error('App installation requires macOS.');
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(readFileSync(join(rootDir, 'app.config.json'), 'utf8'));
const identity = process.argv.includes('--dev-app') ? config.development : config;
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
  cwd: join(rootDir, 'src-tauri'), encoding: 'utf8'
}));
const source = join(metadata.target_directory, 'release/bundle/macos', `${identity.displayName}.app`);
const destination = join('/Applications', `${identity.displayName}.app`);
const staging = join('/Applications', `.${identity.displayName}-${process.pid}.app`);
const executable = join(destination, 'Contents/MacOS', config.packageName);
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

if (!existsSync(source)) throw new Error(`Build ${identity.displayName} before installing it.`);
const bundleIdentifier = execFileSync('/usr/libexec/PlistBuddy', [
  '-c', 'Print :CFBundleIdentifier', join(source, 'Contents/Info.plist')
], { encoding: 'utf8' }).trim();
if (bundleIdentifier !== identity.bundleIdentifier) throw new Error('Build identity does not match the app being installed.');
verifyStableSignature(source);
if (existsSync(destination)) verifySigningContinuity(destination, source);
const processes = execFileSync('ps', ['-axo', 'comm='], { encoding: 'utf8' });
if (processes.split('\n').some((command) => command.trim() === executable)) {
  throw new Error(`Quit ${identity.displayName}, then run this install command again.`);
}

const backupDir = join(rootDir, 'src-tauri/target.noindex/installed-backups', new Date().toISOString().replaceAll(':', '-'));
const backup = join(backupDir, `${identity.displayName}.app`);
let previousMoved = false;
try {
  execFileSync('ditto', [source, staging], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', staging], { stdio: 'inherit' });
  if (existsSync(destination)) {
    mkdirSync(backupDir, { recursive: true });
    renameSync(destination, backup);
    previousMoved = true;
  }
  renameSync(staging, destination);
} catch (error) {
  if (previousMoved && !existsSync(destination)) renameSync(backup, destination);
  throw error;
} finally {
  rmSync(staging, { recursive: true, force: true });
}
execFileSync(lsregister, ['-f', destination]);
console.log(`Installed ${destination}`);
if (previousMoved) console.log(`Previous app saved at ${backup}`);
