// Signs the Electron binary in node_modules, so she can be run from source.
//
// Packaging her and signing the result gives a Haru that starts, but not a Haru
// that can be worked on: npm start and npm run dev both launch
// node_modules/electron/dist/electron.exe, which is unsigned, and Smart App
// Control blocks it. Repackaging for every change is minutes per edit, which is
// no way to fix a bug.
//
// So the same certificate is applied to that binary too. Electron is MIT
// licensed and this signature says only what it truthfully says — that this
// machine's owner vouches for the copy they are running. It is not redistributed.
//
// npm install replaces the binary and strips the signature with it, so this is
// safe to run repeatedly and needs running again after any install that touches
// electron. It reports what it did rather than assuming.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NEEDED = ['HARU_SIGN_ENDPOINT', 'HARU_SIGN_ACCOUNT', 'HARU_SIGN_PROFILE'];
const missing = NEEDED.filter(name => !(process.env[name] ?? '').trim());
if (missing.length) {
  console.error(`  cannot sign: ${missing.join(', ')} not set.`);
  console.error('  These are the same variables electron-builder.config.cjs uses. Set them and run this again.');
  process.exit(1);
}

const target = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(target)) {
  console.error(`  cannot sign: ${target} is not there. Run npm install first.`);
  process.exit(1);
}

// signtool ships with the Windows SDK and is not on PATH by default. Newest
// first, because an older one predates the /dlib flag this depends on.
function findSigntool() {
  if ((process.env.HARU_SIGNTOOL ?? '').trim()) return process.env.HARU_SIGNTOOL.trim();
  const roots = [
    'C:/Program Files (x86)/Windows Kits/10/bin',
    'C:/Program Files/Windows Kits/10/bin',
  ];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const version of fs.readdirSync(root)) {
      const candidate = path.join(root, version, 'x64', 'signtool.exe');
      if (fs.existsSync(candidate)) found.push(candidate);
    }
  }
  return found.sort().pop() ?? null;
}

// The Trusted Signing dlib comes from the Microsoft.Trusted.Signing.Client
// package; signtool loads it to talk to the service.
function findDlib() {
  if ((process.env.HARU_SIGN_DLIB ?? '').trim()) return process.env.HARU_SIGN_DLIB.trim();
  const guesses = [
    path.join(os.homedir(), '.trustedsigning', 'bin', 'x64', 'Azure.CodeSigning.Dlib.dll'),
    path.join(os.homedir(), '.azuresigningclient', 'bin', 'x64', 'Azure.CodeSigning.Dlib.dll'),
  ];
  return guesses.find(fs.existsSync) ?? null;
}

const signtool = findSigntool();
const dlib = findDlib();
if (!signtool) {
  console.error('  cannot sign: signtool.exe not found. Install the Windows SDK, or set HARU_SIGNTOOL to its full path.');
  process.exit(1);
}
if (!dlib) {
  console.error('  cannot sign: the Trusted Signing dlib not found. Install Microsoft.Trusted.Signing.Client, or set HARU_SIGN_DLIB to Azure.CodeSigning.Dlib.dll.');
  process.exit(1);
}

const metadata = path.join(os.tmpdir(), 'haru-trusted-signing.json');
fs.writeFileSync(metadata, JSON.stringify({
  Endpoint: process.env.HARU_SIGN_ENDPOINT,
  CodeSigningAccountName: process.env.HARU_SIGN_ACCOUNT,
  CertificateProfileName: process.env.HARU_SIGN_PROFILE,
}, null, 2));

console.log(`  signtool: ${signtool}`);
console.log(`  dlib:     ${dlib}`);
console.log(`  target:   ${target}\n`);

try {
  const out = execFileSync(signtool, [
    'sign', '/v', '/fd', 'SHA256',
    '/tr', 'http://timestamp.acs.microsoft.com', '/td', 'SHA256',
    '/dlib', dlib, '/dmdf', metadata,
    target,
  ], { encoding: 'utf8' });
  console.log(out.trim().split('\n').slice(-4).join('\n'));
} catch (error) {
  console.error('  signing failed:');
  console.error((error.stdout || '') + (error.stderr || error.message));
  process.exit(1);
} finally {
  fs.rmSync(metadata, { force: true });
}

// Claiming it worked is not the same as it having worked.
try {
  execFileSync(signtool, ['verify', '/pa', '/v', target], { encoding: 'utf8' });
  console.log('\n  verified: the binary is signed and the chain is trusted.');
  console.log('  Try `npm start`. If Smart App Control still blocks it, the signature is valid but');
  console.log('  the certificate has no reputation yet — tell me and we will look at that rather than guess.');
} catch (error) {
  console.error('\n  signed, but verification failed — do not assume this will run:');
  console.error((error.stdout || '') + (error.stderr || error.message));
  process.exit(1);
}
