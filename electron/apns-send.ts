// One push to one device, in a plain Node process — see sendApnsFromNode in
// apns.ts for why the app cannot do this itself. Reads one ApnsJob as JSON on
// stdin, writes the ApnsResult as JSON on stdout, and exits 0 either way.
import { sendApns, type ApnsJob, type ApnsResult } from './apns';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const done = (result: ApnsResult) => { process.stdout.write(JSON.stringify(result)); process.exit(0); };
  let job: ApnsJob;
  try { job = JSON.parse(input) as ApnsJob; } catch (error) { done({ status: 0, reason: `bad job: ${error instanceof Error ? error.message : String(error)}`, gone: false }); return; }
  sendApns(job.device, job.payload, job.config, job.jwt, job.collapseId)
    .then(done, error => done({ status: 0, reason: error instanceof Error ? error.message : String(error), gone: false }));
});
