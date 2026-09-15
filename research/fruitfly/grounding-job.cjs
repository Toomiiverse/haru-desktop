const fs = require('node:fs');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

async function main() {
  const [input, output] = process.argv.slice(2);
  const source = fs.readFileSync(input);
  const job = JSON.parse(source);
  const config = JSON.parse(fs.readFileSync('/home/toomii/.config/haru-desktop/config.json', 'utf8')).ai.config;
  const endpoint = config.endpoint.replace(/\/+$/, '');
  if (config.provider !== 'ollama' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(endpoint)) throw Error('Expected existing local Ollama provider');
  const fd = fs.openSync(output, 'wx');
  fs.writeSync(fd, JSON.stringify({ kind: 'metadata', model: config.model, seed: job.seed,
    sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), createdAt: new Date().toISOString() }) + '\n');
  try {
    for (let i = 0; i < job.cases.length; i++) {
      const item = job.cases[i];
      const at = performance.now();
      const response = await fetch(`${endpoint}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, think: false, stream: false, format: job.schema,
          messages: [{ role: 'system', content: job.system }, { role: 'user', content: `Memory notes: ${JSON.stringify(item.notes)}\nQuestion: ${item.question}` }],
          options: { temperature: 0.1, num_ctx: 8192, num_predict: 160, seed: job.seed },
        }), signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw Error(`Model request failed: ${response.status}`);
      const result = await response.json();
      let parsed = null;
      try { parsed = JSON.parse(result.message.content); } catch { /* Record format failure. */ }
      fs.writeSync(fd, JSON.stringify({ kind: 'result', id: item.id, variant: item.variant, expected: item.expected,
        evidenceAvailable: item.evidenceAvailable, parsed, elapsedMs: performance.now() - at,
        evalCount: result.eval_count, doneReason: result.done_reason,
      }) + '\n');
      if ((i + 1) % 16 === 0) console.log(`Answered ${i + 1}/${job.cases.length}`);
    }
  } finally { fs.closeSync(fd); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
