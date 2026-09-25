// Bounded overnight observation. Reads metadata; never drives Haru or a model.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const [output, until] = process.argv.slice(2);
const deadline = Date.parse(until);
if (!output || !Number.isFinite(deadline) || deadline < Date.now() || deadline - Date.now() > 8 * 3_600_000) throw Error('Expected output.jsonl and an end time within eight hours');
const fd = fs.openSync(output, 'wx', 0o600);
const file = '/home/toomii/.config/haru-desktop/attention-shadow.jsonl';

async function sample() {
  const at = new Date().toISOString();
  try {
    const report = JSON.parse(execFileSync(process.execPath, ['/home/toomii/haru-desktop/scripts/attention-report.cjs', file], { encoding: 'utf8', timeout: 10_000 }));
    const service = Object.fromEntries(execFileSync('systemctl', ['--user', 'show', 'haru.service', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'NRestarts'], { encoding: 'utf8', timeout: 5_000 }).trim().split('\n').map(line => line.split('=')));
    const response = await fetch('http://127.0.0.1:8787/', { signal: AbortSignal.timeout(5_000) });
    await response.body?.cancel();
    const latest = fs.readFileSync(file, 'utf8').trim().split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).filter(row => row.kind === 'sample' && row.policy === 2).at(-1);
    const row = { at, service, httpStatus: response.status, report,
      latestEnvironment: latest?.inputs?.environment ?? null,
      latestSampleAt: latest?.at ?? null,
      meaning: 'Cumulative policy-2 counters; do not sum snapshots. Presence readings belong to the server OS.' };
    fs.writeSync(fd, JSON.stringify(row) + '\n');
    console.log(`${at}: ${report.samples} samples, ${report.shadowSpeak} speech proposals, service ${service.ActiveState}, HTTP ${response.status}`);
  } catch (error) {
    fs.writeSync(fd, JSON.stringify({ at, error: error.message }) + '\n');
    console.error(`${at}: observation failed: ${error.message}`);
  }
}

(async () => {
  try {
    while (true) {
      await sample();
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(10 * 60_000, remaining)));
    }
  } finally { fs.closeSync(fd); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
