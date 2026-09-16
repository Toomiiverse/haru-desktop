#!/usr/bin/env node
// Uses the compiled production algorithms on synthetic, equally recent memories.
const fs = require('node:fs');
const path = require('node:path');
const { hybridSearch, keywordOverlap } = require('../../dist-test/electron/retrieval.js');
const { echoesAside } = require('../../dist-test/electron/asides.js');
const fixtures = require('./fixtures.json');
const cache = process.argv[2];
const data = JSON.parse(fs.readFileSync(path.join(cache, 'embeddings.json'), 'utf8'));
const byText = new Map(data.texts.map((text, i) => [text, data.vectors[i]]));
const now = new Date('2026-09-16T00:00:00Z');
const chunks = fixtures.topics.flatMap((topic, topicIndex) => topic.facts.map(([content], factIndex) => ({
  id: `${topicIndex}-${factIndex}`, content, embedding: byText.get(content),
  category: 'personal', source: 'research', status: 'active', confidence: 1,
  createdAt: now.toISOString(), updatedAt: now.toISOString(), metadata: {},
})));
const queries = fixtures.topics.flatMap((topic, topicIndex) => topic.facts.flatMap(([_, ...texts], factIndex) => texts.map(text => ({
  text, expected: `${topicIndex}-${factIndex}`, split: topicIndex % 2 ? 'heldout' : 'development',
}))));
const ranks = queries.map(query => hybridSearch({ chunks }, query.text, byText.get(query.text), {
  topK: 20, threshold: 0.35, rerankTo: 5, now,
}).map(item => chunks.findIndex(chunk => chunk.id === item.chunk.id)));
const keywordScores = queries.map(query => chunks.map(chunk => keywordOverlap(query.text, chunk.content).score));
const echoPredictions = fixtures.nudge_pairs.map(([a, b]) => echoesAside(b, [{
  id: 'synthetic', text: a, at: new Date(now.getTime() - 60_000).toISOString(), day: '2026-09-16', source: 'idle',
}], now.getTime()));
fs.writeFileSync(path.join(cache, 'haru-baselines.json'), JSON.stringify({
  description: 'Current compiled hybridSearch defaults; all records equally recent/confident. No production stores loaded.',
  ranks, keywordScores, echoPredictions,
}, null, 2));
console.log(`Exported ${queries.length} hybrid retrieval cases and ${echoPredictions.length} echo cases`);
