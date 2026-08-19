// The packaging config, in JavaScript rather than in package.json, for one
// reason: signing has to be conditional.
//
// Smart App Control began enforcing on the development machine and blocks the
// unsigned Electron binary outright, so from here on a build that nobody can run
// is not much of a build. But the certificate lives in an Azure account that is
// not always configured — on a fresh clone, on the server, in a checkout made
// only to read the code — and a build that fails because a signing account is
// missing is worse than an unsigned one. So the signing block is added when the
// environment can actually sign, and left out when it cannot.
//
// Set these to sign (all four, or none of them):
//   HARU_SIGN_ENDPOINT   the Trusted Signing account endpoint for its region,
//                        e.g. https://wus2.codesigning.azure.net
//   HARU_SIGN_ACCOUNT    the Trusted Signing account name
//   HARU_SIGN_PROFILE    the certificate profile name
//   HARU_SIGN_PUBLISHER  the publisher name, exactly as it reads on the
//                        certificate — a mismatch here is accepted at signing
//                        time and only fails later, when an update is verified
//
// Microsoft Entra authentication is read from the environment by the Azure
// libraries themselves, so AZURE_TENANT_ID, AZURE_CLIENT_ID and
// AZURE_CLIENT_SECRET are not named here — they are never passed through this
// file and never printed by it.

const SIGNING = ['HARU_SIGN_ENDPOINT', 'HARU_SIGN_ACCOUNT', 'HARU_SIGN_PROFILE', 'HARU_SIGN_PUBLISHER'];
const configured = SIGNING.filter(name => (process.env[name] ?? '').trim());

if (configured.length && configured.length !== SIGNING.length) {
  const missing = SIGNING.filter(name => !configured.includes(name));
  throw new Error(`Signing is half configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. Set all four or none — a partial setup silently produces an unsigned build that Smart App Control will block.`);
}

const signing = configured.length === SIGNING.length;
console.log(signing
  ? `  signing through Trusted Signing as "${process.env.HARU_SIGN_PUBLISHER}"`
  : '  building unsigned — Smart App Control will block this on a machine that enforces it');

module.exports = {
  appId: 'com.haru.desktop',
  productName: 'Haru',
  directories: { output: 'release' },
  files: [
    'dist/**',
    'dist-electron/**',
    'electron/windows-helper.ps1',
    'package.json',
    'build/icon.ico',
    'build/lib/**',
    'build/icon.png',
  ],
  win: {
    icon: 'build/icon.ico',
    ...(signing
      ? {
          azureSignOptions: {
            publisherName: process.env.HARU_SIGN_PUBLISHER,
            endpoint: process.env.HARU_SIGN_ENDPOINT,
            codeSigningAccountName: process.env.HARU_SIGN_ACCOUNT,
            certificateProfileName: process.env.HARU_SIGN_PROFILE,
          },
        }
      : {}),
  },
};
