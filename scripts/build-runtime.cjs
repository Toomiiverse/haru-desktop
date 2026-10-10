// Build the brain runtime (the JS haru-core-python's Node brain runs) from electron/*.ts.
//
//   node scripts/build-runtime.cjs <outDir> --assets-from <previous runtime dir> --esbuild <esbuild 0.28.2 dir>
//
// Production used to be compiled once and then patched as JS; that is how it drifted
// from source. Build every deploy's runtime with this instead, and change the
// TypeScript, never the output.
//
// Most files are tsc output (electron/tsconfig.json). Six were built with esbuild in
// production and stay that way so they reproduce byte-for-byte (esbuild 0.28.2,
// loader ts, format cjs, target node22; see build-attestation.json in
// haru-one-second-20261010 and haru-speaker-awareness-20261010).
// Non-JS runtime files (mail.html) have no source here and are copied from the
// previous runtime, as is the node_modules symlink.
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const out = args[0] && path.resolve(args[0]);
const assets = args.includes('--assets-from') && path.resolve(args[args.indexOf('--assets-from') + 1]);
if (!out || !assets) {
  console.error('usage: node scripts/build-runtime.cjs <outDir> --assets-from <previous runtime dir> --esbuild <esbuild 0.28.2 dir>');
  process.exit(2);
}
if (fs.existsSync(out) && fs.readdirSync(out).length) throw Error(`refusing to build into non-empty ${out}`);
const ESBUILT = ['core-speaker', 'speaker-setup', 'core-router', 'provider-availability', 'core-policy-sync', 'core-policy-worker'];

// typescript's package exports hide bin/; find it from package.json instead.
const tsc = path.join(path.dirname(require.resolve('typescript/package.json', { paths: [root] })), 'bin/tsc');
execFileSync(process.execPath, [tsc, '-p', path.join(root, 'electron/tsconfig.json'), '--outDir', out], { stdio: 'inherit' });

// haru-desktop does not depend on esbuild; pass the 0.28.2 package production used,
// e.g. --esbuild /mnt/secondary/haru-speaker-awareness-20261010/gate-view/haru-core/node_modules/esbuild
const esbuildDir = args.includes('--esbuild') ? path.resolve(args[args.indexOf('--esbuild') + 1]) : path.dirname(require.resolve('esbuild/package.json', { paths: [root] }));
const esbuildVersion = JSON.parse(fs.readFileSync(path.join(esbuildDir, 'package.json'), 'utf8')).version;
if (esbuildVersion !== '0.28.2') throw Error(`esbuild ${esbuildVersion} at ${esbuildDir}; production's six esbuild files need 0.28.2 to reproduce`);
const esbuild = require(esbuildDir);
for (const name of ESBUILT) {
  const source = fs.readFileSync(path.join(root, 'electron', name + '.ts'), 'utf8');
  fs.writeFileSync(path.join(out, name + '.js'), esbuild.transformSync(source, { loader: 'ts', format: 'cjs', target: 'node22' }).code);
}

for (const name of fs.readdirSync(assets)) {
  const from = path.join(assets, name), to = path.join(out, name);
  if (name.endsWith('.js') || fs.existsSync(to)) continue;
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
  else if (stat.isFile()) fs.copyFileSync(from, to);
}
console.log(`built ${fs.readdirSync(out).filter(f => f.endsWith('.js')).length} runtime files into ${out}`);
