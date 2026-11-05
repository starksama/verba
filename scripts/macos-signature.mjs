import { execFileSync, spawnSync } from 'node:child_process';

export function signatureInfo(path) {
  // codesign writes its display output to stderr.
  const result = spawnSync('/usr/bin/codesign', ['-d', '-r-', '--verbose=2', path], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Could not read signature: ${path}`);
  const output = result.stdout + result.stderr;
  return {
    adhoc: output.includes('Signature=adhoc'),
    requirement: output.match(/^designated => (.+)$/m)?.[1],
    authority: output.match(/^Authority=(.+)$/m)?.[1]
  };
}

export function verifyStableSignature(path) {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', path], { stdio: 'pipe' });
  const signature = signatureInfo(path);
  if (signature.adhoc || !signature.requirement || !signature.authority || /\bcdhash\b/.test(signature.requirement)) {
    throw new Error('This build has no persistent signing identity. Run npm run setup:macos-signing and rebuild; otherwise macOS permissions break after updates.');
  }
  return signature;
}

export function verifySigningContinuity(previous, next) {
  const newSignature = verifyStableSignature(next);
  const oldSignature = signatureInfo(previous);
  if (oldSignature.adhoc) {
    console.log('Migrating from temporary signing. macOS may require granting access once for the new identity.');
    return;
  }
  for (const [path, requirement] of [[next, oldSignature.requirement], [previous, newSignature.requirement]]) {
    if (!requirement) throw new Error('Previous signing identity cannot be verified.');
    const result = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '-R', requirement, path], { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      throw new Error('The update uses a different signing identity. Keep the original certificate to preserve macOS permissions.');
    }
  }
}
