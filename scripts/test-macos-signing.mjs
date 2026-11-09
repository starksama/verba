import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signatureInfo, verifyStableSignature, verifySigningContinuity } from './macos-signature.mjs';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const config = JSON.parse(readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
const identity = process.env.APPLE_SIGNING_IDENTITY || config.macOSSigningIdentity;
const directory = mkdtempSync(join(tmpdir(), 'verba-signing-test-'));
try {
  const paths = ['first', 'updated', 'adhoc', 'other-app'].map(name => join(directory, name));
  paths.forEach((path, index) => {
    execFileSync('clang', ['-x', 'c', '-', '-o', path], { input: `int main(void) { return ${index}; }` });
    execFileSync('codesign', ['--force', '--sign', index === 2 ? '-' : identity, '--timestamp=none',
      '--identifier', index === 3 ? 'com.verba.other-test' : 'com.verba.signing-test', path], { stdio: 'pipe', timeout: 120000 });
  });
  assert.equal(signatureInfo(paths[0]).requirement, signatureInfo(paths[1]).requirement);
  verifyStableSignature(paths[0]);
  verifySigningContinuity(paths[0], paths[1]);
  assert.throws(() => verifyStableSignature(paths[2]), /persistent signing identity/);
  assert.throws(() => verifySigningContinuity(paths[0], paths[2]), /persistent signing identity/);
  assert.throws(() => verifySigningContinuity(paths[0], paths[3]), /different signing identity/);
  console.log('PASS: changed code retains identity; temporary signatures and unrelated identities are rejected.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
