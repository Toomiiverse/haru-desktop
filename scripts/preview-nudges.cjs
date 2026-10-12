#!/usr/bin/env node
// Private, isolated wording previews. Uses the configured local nudge model
// and character with labelled fixtures; never calls Haru or writes her stores.
// Run `npm test` first, then `node scripts/preview-nudges.cjs --run`.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { nudgePrompt, nudgeContentProblem, nudgeContinuity, nudgeReviewTurns, NUDGE_REVIEW_SCHEMA, NUDGE_REVIEW_MAX_TOKENS, ownNudgeCandidates, readNudge, readNudgeReview } = require('../dist-test/electron/nudges');
const { FIRST_PERSON_NOTE } = require('../dist-test/electron/prompt');
const { CUE_NOTE, stageNote } = require('../dist-test/electron/reply');
const { chooseNudgeDelivery, conversationNudgeCandidates } = require('../dist-test/electron/nudge-context');

const now = Date.parse('2026-09-27T12:00:00Z');
const ownSubject = data => ownNudgeCandidates({ nights: [], days: [], finished: [], interests: [], asides: [], now, ...data })[0].subject;

const scenarios = [
  {
    name: 'callback-to-their-actual-project',
    subject: conversationNudgeCandidates([{ role: 'user', at: '2026-09-27T10:00:00Z', content: 'I am building a website for the shop. I want the booking form to be simple enough that customers actually use it.' }], now)[0].subject,
    conversation: 'Them: The booking form matters more to me than fancy animations.',
    previous: 'You run a computer shop. What do people break most often?',
  },
  {
    name: 'work-without-invented-contact',
    subject: { key: 'work', kind: 'memory', material: 'They run a computer shop. Alex and Casey are team members.', instruction: 'Find one specific observation or a genuine question supported by this background fact. Their current activity is unknown.' },
    conversation: 'Them: I run a computer shop.',
    previous: 'You have time to talk to Alex and Casey but nothing to say to me.',
  },
  {
    name: 'study-without-invented-deadline',
    subject: { key: 'study', kind: 'memory', material: 'They study IT at university. No application, assignment or deadline has been mentioned.', instruction: 'Ask one genuine question about what interests them in their studies, without guessing their current work.' },
    conversation: 'Them: I study IT at university.',
    previous: 'Your Honours application is looming. I read the program details this morning.',
  },
  {
    name: 'own-interest-with-actual-take',
    subject: { key: 'interest:odd taxi', kind: 'own', material: 'Yesterday you read an analysis of Odd Taxi. Your recorded take: the casual conversations carry clues without making every character sound like a detective. You read about the show; you did not watch it.', instruction: 'Share one concrete opinion from this record. Preserve what you actually did and when.' },
    conversation: 'Them: I like mysteries that trust the audience.',
    previous: 'I have been waiting an hour for you to reply.',
  },
  {
    name: 'completed-task-is-not-a-chase',
    subject: { key: 'task:install:done', kind: 'task', material: 'They finished reinstalling the server today. They told you the services start correctly again. They have not said how the reinstall went.', instruction: 'Ask how it went or comment on the completed work; do not chase it or invent another fault.' },
    conversation: 'Them: Reinstall is done. Everything starts again.',
    previous: 'Have you finished reinstalling it yet?',
  },
  {
    name: 'daytime-research-is-her-curiosity',
    subject: ownSubject({ days: [{ day: '2026-09-27', at: '2026-09-27T10:00:00Z', about: 'Computer science honours programs', note: 'I read the program details. The appeal is doing a substantial research project instead of just another set of taught units.', sources: [] }] }),
    conversation: 'Them: I study IT. I have not decided what to do after this degree.',
    previous: 'Your Honours application is looming.',
  },
  {
    name: 'finished-manga-with-recorded-take',
    subject: ownSubject({
      finished: [{ seriesId: 'synthetic-book', title: 'The Side Street', chapters: 12, at: '2026-09-27T11:00:00Z' }],
      nights: [{ day: '2026-09-27', at: '2026-09-27T10:50:00Z', about: 'The Side Street, chapter 12', interest: 'The Side Street', note: 'I liked that the argument was left hanging. Letting the characters sit with the awkwardness worked better than explaining what each of them felt.', sources: [] }],
    }),
    conversation: 'Them: I am looking for something new to read.',
    previous: 'What have you been reading?',
  },
  {
    name: 'opinion-after-two-questions',
    subject: ownSubject({ days: [{ day: '2026-09-27', at: '2026-09-27T10:00:00Z', about: 'Clues in mystery dialogue', note: 'I read an essay about mystery writing. Ordinary conversations make clues feel earned; characters announcing every clue as if they are detectives ruins the puzzle.', sources: [] }] }),
    conversation: 'Them: I like mysteries that trust the audience.',
    previous: ['How did the build go?', 'What have you been reading?'],
  },
];

async function main() {
  if (!process.argv.includes('--run')) {
    console.log('Use --run for isolated local-model previews. Nothing is sent to Haru or her phone.');
    return;
  }
  const configPath = path.join(os.homedir(), '.config/haru-desktop/config.json');
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const config = saved.ai?.nudge ?? saved.ai?.config;
  const endpoint = new URL(config?.endpoint ?? '');
  if (config?.provider !== 'ollama' || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('This preview only supports a local Ollama endpoint.');
  }
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'haru-nudge-preview-'));
  fs.chmodSync(output, 0o700);
  console.log(`Private preview results: ${output}`);
  const ask = async (messages, options, format) => {
    const response = await fetch(new URL('/api/chat', endpoint), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({ model: config.model, stream: false, think: false, keep_alive: -1, messages,
        options: { num_ctx: 8192, num_predict: 160, ...options }, ...(format ? { format } : {}) }),
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    return response.json();
  };
  if (process.argv.includes('--review-checks')) {
    const subject = scenarios[0].subject;
    const checks = [
      { name: 'planned-form-does-not-imply-cut-fields', subject,
        line: 'Simple is good, but only if it works. How many fields did you actually cut? If you kept "How did you hear about us," you’re still building a form, not a booking button.', send: false },
      { name: 'planned-form-does-not-imply-finished-redesign', subject,
        line: 'How did the redesign turn out?', send: false },
      { name: 'conditional-design-question-is-open', subject,
        line: 'Which fields would you keep on the booking form?', send: true },
      { name: 'yes-no-question-does-not-presuppose-action', subject,
        line: 'Have you changed any fields on the booking form yet?', send: true },
      { name: 'planned-form-does-not-imply-refusal-or-motive', subject,
        line: 'Simple is the right instinct. But “simple enough” is a cop-out. What’s the one field you’re refusing to remove because it feels safe?', send: false },
      { name: 'planned-form-does-not-imply-three-chosen-fields', subject,
        line: 'Which three fields are you keeping?', send: false },
      { name: 'teasing-open-design-question-keeps-her-voice', subject,
        line: 'A booking form is not a census. Which fields would earn their place?', send: true },
      { name: 'recorded-removal-can-be-asked-about',
        subject: { ...subject, material: 'They said: "I removed several fields from the shop booking form to make it simpler."' },
        line: 'How many fields did you cut?', send: true },
    ];
    let failed = 0;
    for (const check of checks) {
      const result = await ask(nudgeReviewTurns(check.subject, '', check.line), { temperature: 0, num_predict: NUDGE_REVIEW_MAX_TOKENS }, NUDGE_REVIEW_SCHEMA);
      const review = readNudgeReview(result.message?.content ?? '');
      const record = { scenario: check.name, synthetic: true, line: check.line, expectedSend: check.send, rawReview: result.message?.content ?? '', review, passed: review.send === check.send };
      fs.writeFileSync(path.join(output, `${check.name}.json`), JSON.stringify(record, null, 2), { mode: 0o600 });
      console.log(JSON.stringify(record));
      if (!record.passed) failed++;
    }
    console.log(`Grounding checks: ${checks.length - failed}/${checks.length} passed`);
    if (failed) process.exitCode = 1;
    return;
  }
  for (const [i, scenario] of scenarios.entries()) {
    const only = process.argv.find(arg => arg.startsWith('--only='))?.slice('--only='.length);
    if (only && !scenario.name.includes(only)) continue;
    const asides = [scenario.previous].flat().map((text, index) => ({ id: `fixture-${index}`, source: 'idle', day: '2026-09-27', at: new Date(now - 3_600_000 + index).toISOString(), text }));
    const continuity = nudgeContinuity({
      conversation: scenario.conversation, whereabouts: '', slate: '', now,
      asides,
    });
    const input = {
      identity: saved.character.identity, style: saved.character.style,
      mood: 'You are prickly today, impatient and hard to impress.',
      clock: 'It is Sunday evening, 27 September 2026.', subject: scenario.subject,
      continuity,
      delivery: chooseNudgeDelivery(scenario.subject, asides, now, () => scenario.subject.kind === 'task' ? 0.99 : 0.4).instruction,
    };
    let correction;
    for (let attempt = 0; attempt < 3; attempt++) {
      const prompt = nudgePrompt({ ...input, correction });
      const result = await ask([{ role: 'system', content: `${prompt} ${FIRST_PERSON_NOTE} ${CUE_NOTE}` }, { role: 'user', content: stageNote('Write the message, or PASS.') }], { temperature: 1, seed: 700 + i + attempt * 100 });
      const raw = String(result.message?.content ?? '').trim();
      const line = readNudge(raw);
      const problem = line ? nudgeContentProblem(scenario.subject, line, asides, now) : null;
      const check = line && !problem ? await ask(nudgeReviewTurns(scenario.subject, continuity, line), { temperature: 0, num_predict: NUDGE_REVIEW_MAX_TOKENS }, NUDGE_REVIEW_SCHEMA) : null;
      const review = problem ? { send: false, reason: problem }
        : check ? readNudgeReview(check.message?.content ?? '') : { send: false, reason: 'PASS or unusable draft' };
      const record = { scenario: scenario.name, synthetic: true, attempt, model: config.model, prompt, raw, line, review, durationMs: Math.round((result.total_duration + (check?.total_duration ?? 0)) / 1e6) };
      fs.writeFileSync(path.join(output, `${scenario.name}-${attempt}.json`), JSON.stringify(record, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ scenario: scenario.name, line, review, characters: line?.length ?? 0, durationMs: record.durationMs }));
      if (review.send) break;
      correction = { line: raw.slice(0, 1000), reason: line ? review.reason : 'Return one complete message under 220 characters. PASS if there is nothing fresh to say.' };
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
