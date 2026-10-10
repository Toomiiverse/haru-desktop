// Summarise monitoring snapshots without summing cumulative event counters.
const fs = require('node:fs');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Expected observations.jsonl and output.json');
const rows = fs.readFileSync(input, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
if (!rows.length) throw Error('Empty observation log');
const successful = rows.filter(row => !row.error);
const final = successful.at(-1);
if (!final) throw Error('No successful observations');
const gaps = rows.slice(1).map((row, index) => (Date.parse(row.at) - Date.parse(rows[index].at)) / 60000);
if (gaps.some(gap => !Number.isFinite(gap) || gap < 0)) throw Error('Invalid observation ordering');
const result = { firstAt: rows[0].at, lastAt: rows.at(-1).at,
  observations: rows.length, successfulObservations: successful.length,
  failures: rows.filter(row => row.error).map(row => ({ at: row.at, error: row.error })),
  maximumGapMinutes: gaps.length ? Math.max(...gaps) : 0,
  httpStatuses: [...new Set(successful.map(row => row.httpStatus))],
  serviceStates: [...new Set(successful.map(row => row.service.ActiveState))],
  distinctMainPids: [...new Set(successful.map(row => row.service.MainPID))].length,
  finalRestartCounter: final.service.NRestarts,
  finalReport: final.report, latestEnvironment: final.latestEnvironment,
  latestSampleAt: final.latestSampleAt,
  limitations: ['Point-in-time health checks; faults between observations are not directly observed',
    'Final report counters are cumulative; snapshots have not been summed',
    'Idle and focus refer to the server OS, not the user desktop or phone'] };
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
