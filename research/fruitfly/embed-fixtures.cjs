#!/usr/bin/env node
// Synthetic text only. Run on the server with its already-loaded Ollama embedder.
// node embed-fixtures.cjs fixtures.json output.json [endpoint]
const fs = require('node:fs');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

async function main() {
  const [input, output, endpoint = 'http://127.0.0.1:11436'] = process.argv.slice(2);
  if (!input || !output) throw Error('Expected fixtures.json and output.json');
  const source = fs.readFileSync(input, 'utf8');
  const fixtures = JSON.parse(source);
  const texts = [...new Set([
    ...fixtures.topics.flatMap(topic => topic.facts.flat()),
    ...fixtures.nudge_pairs.flatMap(([a, b]) => [a, b]),
  ])];
  const model = 'nomic-embed-text:latest';
  const tagsResponse = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!tagsResponse.ok) throw Error(`Model inventory failed: ${tagsResponse.status}`);
  const installed = (await tagsResponse.json()).models.find(item => item.name === model);
  if (!installed) throw Error('Expected installed embedding model');
  const vectors = [];
  const batches = [];
  for (let start = 0; start < texts.length; start += 16) {
    const batch = texts.slice(start, start + 16);
    const at = performance.now();
    const response = await fetch(`${endpoint}/api/embed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: batch }), signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw Error(`Embedding batch failed: ${response.status}`);
    const body = await response.json();
    if (body.embeddings?.length !== batch.length) throw Error('Missing embedding vectors');
    if (!body.embeddings.every(v => v.length === 768 && v.every(Number.isFinite))) throw Error('Invalid vectors');
    vectors.push(...body.embeddings);
    batches.push({ count: batch.length, elapsedMs: performance.now() - at });
    console.log(`Embedded ${vectors.length}/${texts.length} synthetic texts`);
  }
  fs.writeFileSync(output, JSON.stringify({
    createdAt: new Date().toISOString(), fixturesSha256: crypto.createHash('sha256').update(source).digest('hex'),
    model, modelDigest: installed.digest, dimensions: 768, prefix: 'none (matches current Haru)',
    batches, texts, vectors,
  }));
  console.log(`Saved ${vectors.length} vectors to ${output}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
