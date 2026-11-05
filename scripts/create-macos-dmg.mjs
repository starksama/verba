import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { arch } from 'node:process';
import { verifyStableSignature } from './macos-signature.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
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

console.log(`Created ${dmgPath}`);
