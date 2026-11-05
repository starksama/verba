// One persistent local identity keeps macOS permissions valid across rebuilds.
// For public distribution, use an Apple Developer ID via APPLE_SIGNING_IDENTITY.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('Signing setup requires macOS.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(readFileSync(join(root, 'app.config.json'), 'utf8'));
const name = `${config.displayName} Local Development`;
function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
  } catch (error) {
    // Do not include arguments: the import command contains a temporary password.
    throw new Error(`${command} failed: ${error.stderr?.toString().trim() || 'operation failed'}`);
  }
}
let existing = '';
try { existing = execFileSync('security', ['find-certificate', '-c', name, '-Z'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }); } catch {}
if (existing) {
  console.log(`${name} already exists. Keeping its identity unchanged.`);
  process.exit(0);
}

const temp = mkdtempSync(join(tmpdir(), 'verba-signing-'));
try {
  const key = join(temp, 'key.pem');
  const cert = join(temp, 'certificate.pem');
  const p12 = join(temp, 'identity.p12');
  const password = randomBytes(32).toString('hex');
  const passwordFile = join(temp, 'password');
  writeFileSync(passwordFile, password, { mode: 0o600 });
  const request = join(temp, 'openssl.cnf');
  writeFileSync(request, `[req]\nprompt = no\ndistinguished_name = subject\nx509_extensions = signing\n[subject]\nCN = ${name}\n[signing]\nbasicConstraints = critical,CA:false\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = critical,codeSigning\n`);
  run('/usr/bin/openssl', ['req', '-new', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '3650', '-config', request, '-keyout', key, '-out', cert]);
  run('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', key, '-in', cert, '-name', name, '-out', p12, '-passout', `file:${passwordFile}`]);
  const keychain = run('security', ['default-keychain', '-d', 'user']).trim().replace(/^"|"$/g, '');
  run('security', ['import', p12, '-k', keychain, '-P', password, '-x', '-T', '/usr/bin/codesign']);
  console.log(`Created ${name} in your login keychain. Future builds reuse this certificate.`);
  console.log('No Accessibility or Microphone permissions were changed.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
