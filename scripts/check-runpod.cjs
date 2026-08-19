// Does the RunPod serverless endpoint answer, in the shape she speaks, and how
// long does it take when it has been asleep?
//
// Run this BEFORE pointing her at it. Wiring her up first means debugging a
// cold-start timeout through her prompt chain, her fallback logic and her
// escalation rules all at once, when the question is only ever "does this URL
// return a chat completion".
//
// The key is read from the environment and never printed, stored or sent
// anywhere but RunPod:
//   RUNPOD_API_KEY       your RunPod API key
//   RUNPOD_ENDPOINT_ID   the serverless endpoint id, from its page
//   RUNPOD_MODEL         the model the worker serves, exactly as named there
//
// Cold start is the number that matters. A worker scaled to zero has to fetch
// and load the weights before it can answer, and that is the difference between
// a companion who replies and one who appears to have hung.

const key = (process.env.RUNPOD_API_KEY ?? '').trim();
const id = (process.env.RUNPOD_ENDPOINT_ID ?? '').trim();
const model = (process.env.RUNPOD_MODEL ?? '').trim();

const missing = [['RUNPOD_API_KEY', key], ['RUNPOD_ENDPOINT_ID', id], ['RUNPOD_MODEL', model]]
  .filter(([, value]) => !value).map(([name]) => name);
if (missing.length) {
  console.error(`  not set: ${missing.join(', ')}`);
  console.error('  Set all three and run again. The key is only ever sent to RunPod.');
  process.exit(1);
}

// The same URL she would use: her endpoint plus /chat/completions.
const BASE = `https://api.runpod.ai/v2/${id}/openai/v1`;

async function ask(label, prompt, timeoutMs) {
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 60, temperature: 0.7 }),
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      console.log(`  ${label.padEnd(22)} HTTP ${response.status} after ${seconds}s`);
      console.log(`      ${text}`);
      return null;
    }
    const body = await response.json();
    const said = body.choices?.[0]?.message?.content ?? '';
    console.log(`  ${label.padEnd(22)} ${seconds}s — ${JSON.stringify(String(said).replace(/\s+/g, ' ').slice(0, 72))}`);
    return Number(seconds);
  } catch (error) {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  ${label.padEnd(22)} failed after ${seconds}s — ${error.name === 'TimeoutError' ? 'timed out' : error.message}`);
    return null;
  }
}

(async () => {
  console.log(`  endpoint: ${BASE}`);
  console.log(`  model:    ${model}\n`);

  // First call after idle carries the load. Given a long leash on purpose.
  const cold = await ask('cold (first call)', 'Say the single word: ready', 300_000);
  if (cold === null) {
    console.log('\n  Nothing came back. Usual causes, in order:');
    console.log('   - the endpoint id is wrong, or the endpoint is not deployed yet');
    console.log('   - RUNPOD_MODEL does not match what the worker actually serves');
    console.log('   - no workers available, or out of credit');
    console.log('   - the worker is still building its image — check its log on RunPod');
    process.exit(1);
  }

  const warm = await ask('warm (second call)', 'Say the single word: still', 120_000);
  const third = await ask('warm (third call)', 'Name one colour, one word.', 120_000);

  console.log('\n  what that means for her');
  if (cold > 45) {
    console.log(`   Cold start is ${cold}s. She will look hung on the first hard question after a quiet`);
    console.log('   spell. Either keep one worker active (billed continuously) or accept the wait —');
    console.log('   escalation is rare enough that it may be fine, but you should know it is there.');
  } else {
    console.log(`   Cold start ${cold}s, which is liveable for an escalated question.`);
  }
  const warmTimes = [warm, third].filter(n => n !== null);
  if (warmTimes.length) {
    const average = (warmTimes.reduce((a, b) => a + b, 0) / warmTimes.length).toFixed(1);
    console.log(`   Warm replies average ${average}s. Compare that to her local model before deciding`);
    console.log('   how hard a question has to be before it is worth sending here.');
  }
})();
