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

// Where the built app will look for its next version, and where --publish sends
// this one. The two have to be the same place or the laptop checks an address
// nothing was ever uploaded to, which fails silently — hence one setting for
// both, and a line printed saying which was used. A build cut for the wrong feed
// is otherwise indistinguishable from a good one until it will not update.
//
// GitHub by default because the repository is public, which makes it the least
// machinery: HTTPS, integrity and hosting already exist and nothing has to stay
// reachable at home. Set HARU_UPDATE_URL to serve the feed yourself instead —
// it wants the directory holding latest.yml, the installer and its blockmap.
const feed = (process.env.HARU_UPDATE_URL ?? '').trim();
console.log(feed
  ? `  updates from ${feed}`
  : '  updates from GitHub releases (set HARU_UPDATE_URL to host them yourself)');

module.exports = {
  appId: 'com.haru.desktop',
  productName: 'Haru',
  directories: { output: 'release' },
  // Also what puts app-update.yml inside the packaged app. Without a publish
  // block there is no such file, and an installed build cannot check for
  // anything however well the rest of it is wired.
  publish: feed
    ? [{ provider: 'generic', url: feed }]
    // releaseType matters more than it looks. electron-builder defaults GitHub
    // releases to *draft*, and a draft is invisible to the public API, creates
    // no tag, and cannot be seen by the updater — so a publish that worked
    // perfectly leaves every machine reporting it is up to date, and the only
    // way to tell that apart from a publish that never ran is to look at the
    // releases page while signed in. Published outright instead.
    : [{ provider: 'github', owner: 'Toomiiverse', repo: 'haru-desktop', releaseType: 'release' }],
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
