// Run on Haru's server. Reads only provider routing; uses research job text.
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

async function main() {
  const [jobPath, output] = process.argv.slice(2);
  const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  const variants = job.variants ?? ['baseline', 'complete'];
  const config = JSON.parse(fs.readFileSync('/home/toomii/.config/haru-desktop/config.json', 'utf8')).ai.config;
  const endpoint = config.endpoint.replace(/\/+$/, '');
  if (config.provider !== 'ollama' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(endpoint)) throw Error('Expected existing local Ollama provider');
  const tags = await (await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(10_000) })).json();
  const model = tags.models.find(item => item.name === config.model);
  if (!model) throw Error('Configured model not installed');
  const fd = fs.openSync(output, 'wx');
  fs.writeSync(fd, JSON.stringify({ kind: 'metadata', model: config.model, digest: model.digest, temperature: 0.1, num_ctx: 8192, createdAt: new Date().toISOString() }) + '\n');
  let completed = 0;
  try {
    for (const seed of job.seeds) for (const prompt of job.prompts) for (const item of job.cases) {
      // Alternate which prompt runs first; neither condition always gets a cold cache.
      const order = (completed / variants.length) % 2 === 0 ? variants : [...variants].reverse();
      for (const variant of order) {
        const at = performance.now();
        const response = await fetch(`${endpoint}/api/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.model,
            messages: [{ role: 'system', content: prompt[variant] }, { role: 'user', content: `The line she just said: "${item.text.slice(0, 600)}"` }],
            think: false, stream: false, format: job.schema,
            options: { temperature: 0.1, num_ctx: 8192, num_predict: 120, seed },
          }), signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw Error(`Classification request failed: ${response.status}`);
        const result = await response.json();
        let parsed = null;
        try { parsed = JSON.parse(result.message.content); } catch { /* Record format failure. */ }
        fs.writeSync(fd, JSON.stringify({ kind: 'result', id: item.id, split: item.split, expected: item.expected,
          mood: prompt.mood, seed, variant, parsed, elapsedMs: performance.now() - at,
          evalCount: result.eval_count, evalDuration: result.eval_duration, doneReason: result.done_reason,
        }) + '\n');
        completed++;
        if (completed % 20 === 0) console.log(`Classified ${completed}/${job.cases.length * job.prompts.length * job.seeds.length * variants.length}`);
      }
    }
  } finally { fs.closeSync(fd); }
  console.log(`Completed ${completed} classification calls`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
