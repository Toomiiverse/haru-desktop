#!/usr/bin/env node
// A sequential public/synthetic benchmark job. Does not touch Haru's stores.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

async function main() {
  const [input, output, endpoint = 'http://127.0.0.1:11436'] = process.argv.slice(2);
  if (!input || !output) throw Error('Expected job.json and vectors.f32');
  const source = fs.readFileSync(input);
  const job = JSON.parse(source);
  if (!Array.isArray(job.texts) || !job.texts.every(x => typeof x === 'string')) throw Error('Invalid job');
  const model = 'nomic-embed-text:latest';
  const tagsResponse = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!tagsResponse.ok) throw Error(`Inventory failed: ${tagsResponse.status}`);
  const installed = (await tagsResponse.json()).models.find(item => item.name === model);
  if (!installed) throw Error('Embedding model missing');
  const descriptor = fs.openSync(output, 'wx');
  const batches = [];
  let completed = 0;
  try {
    for (let start = 0; start < job.texts.length; start += 32) {
      const batch = job.texts.slice(start, start + 32);
      const at = performance.now();
      const response = await fetch(`${endpoint}/api/embed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: batch }), signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw Error(`Embedding failed: ${response.status}`);
      const body = await response.json();
      if (body.embeddings?.length !== batch.length || !body.embeddings.every(v => v.length === 768 && v.every(Number.isFinite))) throw Error('Invalid embedding shape');
      const buffer = Buffer.alloc(batch.length * 768 * 4);
      body.embeddings.forEach((vector, row) => vector.forEach((number, col) => buffer.writeFloatLE(number, (row * 768 + col) * 4)));
      fs.writeSync(descriptor, buffer);
      completed += batch.length;
      batches.push({ count: batch.length, elapsedMs: performance.now() - at });
      if (batches.length % 10 === 0 || completed === job.texts.length) console.log(`Embedded ${completed}/${job.texts.length}`);
    }
  } finally {
    fs.closeSync(descriptor);
    fs.writeFileSync(`${output}.json`, JSON.stringify({
      model, modelDigest: installed.digest, sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
      dimensions: 768, dtype: 'little-endian float32', completed, expected: job.texts.length,
      createdAt: new Date().toISOString(), batches,
    }, null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
