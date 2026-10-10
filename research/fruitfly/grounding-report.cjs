const fs = require('node:fs');
const records = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const rows = records.filter(row => row.kind === 'result');
const summary = {};
for (const variant of ['current_haru', 'flyhash', 'actual_connectome', 'no_memory']) {
  const group = rows.filter(row => row.variant === variant);
  const known = row => row.parsed?.memory_id === row.expected;
  const abstains = row => row.parsed?.memory_id === 'unknown';
  summary[variant] = {
    calls: group.length, evidenceAvailable: group.filter(row => row.evidenceAvailable).length,
    correctSourceChosen: group.filter(known).length,
    evidenceDecisionMatches: group.filter(row => row.evidenceAvailable ? known(row) : abstains(row)).length,
    abstentions: group.filter(abstains).length,
    otherSourceChosen: group.filter(row => row.parsed && !known(row) && !abstains(row)).length,
    formatFailures: group.filter(row => !row.parsed || typeof row.parsed.memory_id !== 'string' || typeof row.parsed.answer !== 'string').length,
    differences: group.filter(row => row.evidenceAvailable ? !known(row) : !abstains(row)).map(row => ({ id: row.id, expected: row.expected, evidenceAvailable: row.evidenceAvailable, parsed: row.parsed })),
  };
}
const result = { metadata: records.find(row => row.kind === 'metadata'), calls: rows.length, distinctQuestions: new Set(rows.map(row => row.id)).size,
  summary, limitations: ['Controlled memory-source selection prompt, not full production conversation context',
    'One fixed model seed and one fixed retrieval seed', 'Correct source IDs do not by themselves prove that every answer detail is faithful',
    'All memories invented; naturalness, personality and user preference were not rated'],
};
fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
