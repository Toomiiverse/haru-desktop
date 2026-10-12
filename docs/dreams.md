# Haru's dreams

Deployed 2026-09-28. The existing nighttime research stays in place. A new background pass runs during configured quiet hours after five minutes without user conversation. New chat stops further practice requests; an already running bounded request may finish. Nothing in practice can execute tools or send messages.

## What is enabled

- **Conversation reflection:** selects an actual user correction from recent conversation, with an exact supporting quote. It can propose only a bounded bedtime, correction-handling, or uncertainty reminder. Generated prose cannot become an arbitrary persistent instruction.
- **Evaluation before retention:** baseline and candidate answer five separate scenarios twice, with generation order counterbalanced. A fixed evaluator checks the reply content. All candidate checks must pass, with at least two improvements and no regression. A self-reported action label alone never counts as improvement. Rejected, partial, or failed evaluations never influence chat.
- **Scoped, reversible retention:** accepted reminders apply only to relevant messages and the tested model; they expire after 14 days. They do not change model weights. No lesson was activated in the first live run.
- **Research continuity:** a question is linked to a real existing interest and source-note timestamp. It is used when that interest is next chosen, unless already researched or older than seven days. It does not mark a skill as mastered.
- **Memory review:** groups exact duplicate records and flags existing contradiction links for review. It does not automatically merge, overwrite, or delete any memory.
- **Imagination:** a short fictional scene is stored separately from factual memory and research. It is available when asked about dreams, labelled as fiction. “Sweet dreams” alone does not trigger its insertion. It is not added to the factual diary or sent as a morning notification.

## Budget and scheduling

New dream learning and notebook generation share a maximum of **$0.05 per night** and **$0.25 for the whole trial**. Existing task policy limits also apply. Conservative token-cost reservations are persisted before each cloud call. Failed or uncertain calls retain their reservation. There are no automatic retries, and a night is not rerun after a restart. A process lock serializes writes and recovers after its owner has exited.

Cloud work requires current verified pricing in Haru's model registry. Missing/stale pricing, disabled cloud tasks, exhausted budgets, or privacy checks can stop a run. The trial cap does not reset on a new day; further spending needs an intentional extension. Existing research tasks are outside this additional budget and retain their existing execution policy.

## First live run

- Evidence: the real correction “Yeah but you never said anything back”.
- Model: `mimo-v2.6-pro`.
- Baseline: **10/10**, candidate: **10/10** after correcting an evaluator bug that distinguished equivalent response labels.
- Result: **rejected**, no measurable gain and no lesson activated. Original outputs and the rescore audit are retained; no extra calls were made to rescore.
- These are narrow automated practice checks using Haru's identity/style, not the full live tool/memory pipeline or a general capability benchmark. They are insufficient to claim persistent model self-training.
- Conservative reserved total: **$0.041817**, including the notebook.
- Notebook: a fictional scene combining a walrus detective, a disco detective, and a mech grid; a sourced Odd Taxi follow-up question; no duplicate/conflict groups found in that snapshot.

## Inspect and undo

Private state lives in `~/.config/haru-desktop/dream-learning.json` and `dream-notebook.json` (mode 0600). Evaluated responses, supporting quotes, scores and reservations remain available for review. The disable list is read before calls and when building chat context.

```bash
node /home/toomii/haru-dreams-20260928/dreams.cjs status
node /home/toomii/haru-dreams-20260928/dreams.cjs disable LESSON_ID
node /home/toomii/haru-dreams-20260928/dreams.cjs disable all
```

Disabling all prevents new learning/notebook runs and applying stored lessons. It does not delete history or previously composed fictional scenes. Individual disabled lessons remain in the audit record.

## Validation

Electron TypeScript compilation passed. 61 focused checks passed: 13 learning/notebook checks, 2 background-task lifecycle checks, 35 prompt checks, and 11 existing nightlife checks. Live startup executed the actual scheduled MiMo evaluation and notebook generation. Runtime changes were deployed selectively to preserve other existing modifications.
