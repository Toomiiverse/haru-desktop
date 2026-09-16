// Server-only aggregate snapshot. Never prints private message or memory text.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const directory = '/home/toomii/.config/haru-desktop';
async function main() {
  const knowledge = JSON.parse(fs.readFileSync(`${directory}/knowledge.json`, 'utf8'));
  const feedback = fs.readFileSync(`${directory}/feedback.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const latest = new Map(feedback.map(row => [row.id, row]));
  const current = [...latest.values()];
  const config = JSON.parse(fs.readFileSync(`${directory}/config.json`, 'utf8')).ai.config;
  const reference = require('./emotion-results.json').metadata;
  const service = Object.fromEntries(execFileSync('systemctl', ['--user', 'show', 'haru.service',
    '-p', 'ActiveState', '-p', 'MainPID', '-p', 'NRestarts', '-p', 'ExecMainStartTimestamp'],
  { encoding: 'utf8', timeout: 5000 }).trim().split('\n').map(line => {
    const position = line.indexOf('='); return [line.slice(0, position), line.slice(position + 1)];
  }));
  const response = await fetch('http://127.0.0.1:8787/', { signal: AbortSignal.timeout(5000) });
  await response.body?.cancel();
  const output = { at: new Date().toISOString(), service, httpStatus: response.status,
    knowledge: { bytes: fs.statSync(`${directory}/knowledge.json`).size,
      documents: knowledge.documents.length, chunks: knowledge.chunks.length,
      activeChunks: knowledge.chunks.filter(row => row.status === 'active').length },
    feedback: { rows: feedback.length, distinctReplyIds: latest.size,
      latestValidRatings: current.filter(row => ['up', 'down'].includes(row.reaction)).length,
      latestUp: current.filter(row => row.reaction === 'up').length,
      latestDown: current.filter(row => row.reaction === 'down').length,
      modelConfigurationsInLog: new Set(feedback.map(row => row.model).filter(Boolean)).size },
    provider: config.provider, modelMatchesEmotionExperiment: config.model === reference.model,
    limitations: ['Counts only; no private text leaves this process',
      'Feedback concerns existing chat replies, not shadow proposals',
      'Service health and data inventory are a point-in-time snapshot'] };
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
