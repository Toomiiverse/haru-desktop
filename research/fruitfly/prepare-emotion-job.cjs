const fs = require('node:fs');
const { classificationPrompt, EMOTION_SCHEMA } = require('../../dist-test/electron/emotion.js');
const fixtures = require('./emotion-fixtures.json');
const cases = Object.entries(fixtures.labels).flatMap(([expected, texts]) => texts.map((text, index) => ({
  id: `${expected}-${index}`, text, expected, split: index < 2 ? 'development' : 'heldout',
})));
fixtures.reported_emotions.forEach(([text, expected], index) => cases.push({ id: `reported-${index}`, text, expected, split: 'challenge' }));
const moods = [{ name: 'calm', irritation: 0, ego: 2 }, { name: 'irritated', irritation: 6, ego: 6 }];
const additions = 'determined: resolute, committed to acting or persisting through difficulty; worried: concerned, anxious that something may be wrong;';
const prompts = moods.map(mood => {
  // Reproduce the pre-fix prompt even after the definitions have been shipped.
  const baseline = classificationPrompt(mood).replace(`${additions} `, '');
  return { mood: mood.name, baseline, complete: baseline.replace('The labels mean:',
    `The labels mean: ${additions}`) };
});
fs.writeFileSync(process.argv[2], JSON.stringify({ cases, prompts, schema: EMOTION_SCHEMA, seeds: [17, 43] }, null, 2));
console.log(`Prepared ${cases.length * prompts.length * 2 * 2} isolated classification calls`);
