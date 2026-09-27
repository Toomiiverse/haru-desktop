// Warm, single-process matching timings. Embedding API time is excluded for all.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const [cache, output, repo = path.resolve(__dirname, '../..')] = process.argv.slice(2);
const { vectorSearch } = require(path.join(repo, 'dist-test/electron/retrieval.js'));
const meta = JSON.parse(fs.readFileSync(path.join(cache, 'hash-timing-meta.json')));
const read = (name, Type) => { const b = fs.readFileSync(path.join(cache, name)); return new Type(b.buffer, b.byteOffset, b.byteLength / Type.BYTES_PER_ELEMENT); };
const vectors = read('banking-normalised.f32', Float32Array);
const hashes = read('banking-flyhash.bits', Uint32Array);
const inputs = read('flyhash-inputs.u16', Uint16Array);
const words = meta.bits / 32;
const vector = row => vectors.subarray(row * 768, (row + 1) * 768);
const queries = Array.from({ length: 64 }, (_, i) => meta.train_rows + (i * 47) % (meta.rows - meta.train_rows));

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function encode(v) {
  const scores = new Float64Array(meta.bits);
  for (let cell = 0; cell < meta.bits; cell++) {
    for (let i = 0; i < 6; i++) scores[cell] += v[inputs[cell * 6 + i]];
  }
  const order = Array.from({ length: meta.bits }, (_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
  const bits = new Uint32Array(words);
  for (const cell of order.slice(0, meta.winners)) bits[cell >>> 5] |= 1 << (cell & 31);
  return bits;
}
function take(best, id, score) {
  if (best.length === 40 && score <= best[best.length - 1].score) return;
  let position = best.findIndex(item => item.score < score);
  if (position < 0) position = best.length;
  best.splice(position, 0, { id, score });
  if (best.length > 40) best.pop();
}
function exact(query, count) {
  const v = vector(query), best = [];
  for (let row = 0; row < count; row++) {
    let dot = 0;
    const start = row * 768;
    for (let d = 0; d < 768; d++) dot += v[d] * vectors[start + d];
    if (dot >= 0.35) take(best, row, dot);
  }
  return best;
}
function hashed(query, count) {
  const q = encode(vector(query)), best = [];
  for (let row = 0; row < count; row++) {
    let overlap = 0;
    for (let w = 0; w < words; w++) overlap += popcount(q[w] & hashes[row * words + w]);
    take(best, row, overlap);
  }
  return best;
}
function reranked(query, count) {
  const q = vector(query);
  return hashed(query, count).map(item => {
    let dot = 0;
    for (let d = 0; d < 768; d++) dot += q[d] * vectors[item.id * 768 + d];
    return { id: item.id, score: dot };
  }).filter(item => item.score >= 0.35).sort((a, b) => b.score - a.score || a.id - b.id);
}
function measure(fn) {
  for (const q of queries.slice(0, 8)) fn(q);
  const durations = [];
  let checksum = 0;
  for (let pass = 0; pass < 5; pass++) for (const q of queries) {
    const start = performance.now();
    const out = fn(q);
    durations.push(performance.now() - start);
    checksum += out[0]?.id ?? out[0]?.chunk?.id ?? 0;
  }
  durations.sort((a, b) => a - b);
  return { calls: durations.length, medianMs: durations[Math.floor(durations.length / 2)], p95Ms: durations[Math.floor(durations.length * 0.95)], checksum };
}
if (popcount(0xffffffff) !== 32 || popcount(0x80000000) !== 1 || popcount(0) !== 0) throw Error('Invalid popcount');
let disagreements = 0;
for (const row of queries) {
  const computed = encode(vector(row));
  for (let w = 0; w < words; w++) disagreements += popcount(computed[w] ^ hashes[row * words + w]);
}
if (disagreements) throw Error(`${disagreements} bits disagree with Python reference`);
const cases = [];
for (const [active, inactive] of [[98, 5075], [1000, 0], [10003, 0]]) {
  // Plain numeric arrays match Haru's persisted embedding shape.
  const chunks = Array.from({ length: active }, (_, row) => ({ id: row, status: 'active', embedding: Array.from(vector(row)) }));
  for (let i = 0; i < inactive; i++) chunks.push({ id: active + i, status: 'superseded', embedding: [] });
  const current = q => vectorSearch({ chunks }, Array.from(vector(q)), { topK: 40, threshold: 0.35 });
  let neighbourRecall = 0, rerankedRecall = 0;
  for (const q of queries) {
    const wanted = new Set(exact(q, active).slice(0, 5).map(item => item.id));
    neighbourRecall += hashed(q, active).slice(0, 5).filter(item => wanted.has(item.id)).length / Math.max(1, wanted.size);
    rerankedRecall += reranked(q, active).slice(0, 5).filter(item => wanted.has(item.id)).length / Math.max(1, wanted.size);
  }
  cases.push({ active, inactive, current_haru_vector_search: measure(current),
    exact_cached_normalised_scan: measure(q => exact(q, active)),
    flyhash_including_query_encoding: measure(q => hashed(q, active)),
    flyhash_with_exact_reranking: measure(q => reranked(q, active)),
    flyhash_exact_neighbour_recall5: neighbourRecall / queries.length,
    reranked_exact_neighbour_recall5: rerankedRecall / queries.length,
    float32_index_bytes: active * 768 * 4, packed_code_bytes: active * words * 4,
    flyhash_projection_bytes: inputs.byteLength,
  });
  console.log(`Finished ${active} active / ${inactive} inactive candidates`);
}
fs.writeFileSync(output, JSON.stringify({ node: process.version, platform: os.platform(), cpu: os.cpus()[0].model,
  queries: queries.length, repeats: 5, warmups: 8, reference_bit_disagreements: disagreements, cases,
  caveats: ['Public benchmark text, not real Haru memories', 'Only the vector candidate stage; keyword reranking omitted',
    'Embedding API and offline index-building time excluded for every method', 'Byte counts describe numeric index payloads, not total process RSS',
    'Raw FlyHash omits the cosine admission threshold; exact reranking restores it over the best 40 hash candidates',
    'Exact reranking retains the original vectors, so the combined index saves no vector-storage memory'],
}, null, 2));
