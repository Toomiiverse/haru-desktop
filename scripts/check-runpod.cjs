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

const missing = [['RUNPOD_API_KEY', key], ['RUNPOD_ENDPOINT_ID', id]]
  .filter(([, value]) => !value).map(([name]) => name);
if (missing.length) {
  console.error(`  not set: ${missing.join(', ')}`);
  console.error('  Set them and run again. The key is only ever sent to RunPod.');
  console.error('  RUNPOD_MODEL is optional — without it, the endpoint is asked what it serves.');
  process.exit(1);
}

// The same URL she would use: her endpoint plus /chat/completions.
const BASE = `https://api.runpod.ai/v2/${id}/openai/v1`;

/**
 * What is this endpoint actually serving?
 *
 * The model string has to match exactly, and it is not always what was typed
 * into the deploy form — a name can be normalised, or a revision appended. A
 * mismatch comes back as a 400 that reads like an auth problem, so it is worth
 * asking rather than assuming. This route answers without waking a worker.
 */
// Failures here are reported rather than swallowed. A bare "could not ask" sends
// you round three possibilities with no way to tell them apart; the status code
// separates them immediately — 401 is the key, 404 is the route, a timeout is a
// worker still waking. Given a long leash for the same reason: this may have to
// start a worker before anything can answer.
async function servedModel() {
  try {
    const response = await fetch(`${BASE}/models`, {
      signal: AbortSignal.timeout(300_000),
      headers: { authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 200).replace(/\s+/g, ' ');
      console.log(`  /models:  HTTP ${response.status} — ${text || '(no body)'}`);
      if (response.status === 401 || response.status === 403) console.log('            That is the key. Check it was pasted whole and is not the revoked one.');
      if (response.status === 404) console.log('            That is the route. This endpoint may not have been deployed with the vLLM worker.');
      return null;
    }
    const body = await response.json();
    const names = (body.data ?? []).map(entry => entry.id).filter(Boolean);
    if (!names.length) console.log(`  /models:  answered, but listed nothing — ${JSON.stringify(body).slice(0, 200)}`);
    return names[0] ?? null;
  } catch (error) {
    console.log(`  /models:  ${error.name === 'TimeoutError' ? 'timed out waiting for a worker' : error.message}`);
    return null;
  }
}

async function ask(label, prompt, timeoutMs) {
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: serving, messages: [{ role: 'user', content: prompt }], max_tokens: 60, temperature: 0.7 }),
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

/**
 * What the endpoint itself says about its workers.
 *
 * A timeout on /models is not a diagnosis — it could be a worker downloading
 * twenty gigabytes of weights for the first time, or one crash-looping on an
 * image that never built, and those need opposite responses. This route answers
 * immediately without waking anything, and tells the two apart.
 */
async function health() {
  try {
    const response = await fetch(`https://api.runpod.ai/v2/${id}/health`, {
      signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${key}` },
    });
    if (!response.ok) { console.log(`  health:   HTTP ${response.status}`); return null; }
    return await response.json();
  } catch (error) {
    console.log(`  health:   ${error.message}`);
    return null;
  }
}

let serving = model;

(async () => {
  console.log(`  endpoint: ${BASE}`);

  const state = await health();
  if (state) {
    const w = state.workers ?? {};
    const j = state.jobs ?? {};
    console.log(`  workers:  ready ${w.ready ?? 0}, running ${w.running ?? 0}, initialising ${w.initializing ?? 0}, idle ${w.idle ?? 0}, throttled ${w.throttled ?? 0}, unhealthy ${w.unhealthy ?? 0}`);
    console.log(`  jobs:     in queue ${j.inQueue ?? 0}, in progress ${j.inProgress ?? 0}, failed ${j.failed ?? 0}, completed ${j.completed ?? 0}`);
    if ((w.unhealthy ?? 0) > 0) console.log('            Workers are unhealthy — the image or the model is failing to start. Read the Logs tab; nothing here will fix it.');
    else if ((w.throttled ?? 0) > 0) console.log('            Workers are throttled — no GPU free in that tier. Pick a different GPU or wait.');
    else if ((j.failed ?? 0) > 0) console.log('            Jobs have failed. The Logs tab will say why.');
    else if ((w.initializing ?? 0) > 0) console.log('            A worker is starting. On a first run this includes downloading the weights, which for a 32B is tens of gigabytes.');
  }
  console.log();
  const found = await servedModel();
  if (found) {
    console.log(`  serving:  ${found}`);
    if (model && model !== found) {
      console.log(`  NOTE:     you set RUNPOD_MODEL to ${model}, which is not what it serves.`);
      console.log('            Using the served name — put that one in her config too.');
    }
    serving = found;
  } else if (model) {
    console.log(`  serving:  could not ask; using RUNPOD_MODEL (${model})`);
  } else {
    console.error('  serving:  could not ask what it serves, and RUNPOD_MODEL is not set.');
    console.error('            Either the endpoint id is wrong, the key is wrong, or this');
    console.error('            endpoint has no OpenAI-compatible route. Set RUNPOD_MODEL to try anyway.');
    process.exit(1);
  }
  console.log();

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
