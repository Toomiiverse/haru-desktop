# Haru escalation: server audit and implementation

2026-09-28. Requested by Toomii after approving the persistent-core escalation review.

## Audited server

- `haru.service` runs this Electron checkout; `haru-core-shadow.service` independently mirrors memory.
- The local brain is Qwen 3.8 27B through Ollama on port 11436. Ordinary conversation is currently configured for Kimi K2.5 through Venice; the configured escalation provider is Sonnet 5 through Venice.
- `main.ts::ollamaChat` assembles identity, memory, mood and current context. `runChatTool` owns actual actions. `TurnContext` isolates permissions per turn.
- Core is currently a memory shadow/reader, not the task controller. Its native SQLite dependency must run under Node, not Electron. Its live memory database and shadow mode are independent of this change.
- Existing escalation is initial regex/attachment routing, with no durable task state, monetary reservations or result-driven handoff. Hosted output is freely rewritten by Qwen.
- Outage spill bypasses the content gate; the gate only checks recent conversation before enrichment. Hosted timeout races retain a live stream callback. Tool calls run concurrently and are recorded as completed before their results arrive.
- Existing uploads, voice and perception already work through desktop modules. They should be extended incrementally, not replaced by a second implementation.
- Both repositories contain pre-existing work, especially the desktop world/nudge features. Preserve it.

## First implementation

Add a separate Core task database and versioned JSON worker boundary. Keep personality assembly and the established memory bridge in place. Models propose actions; the existing executor remains responsible for permissions and side effects.

The task controller owns revisions, deadlines, selected model, one capability escalation, bounded attempts, spend reservations, result checks and an operation ledger. Restart interrupts unfinished tasks and preserves uncertain action outcomes. Cancellation prevents subsequent actions and stale commits; losing model attempts cannot stream late text.

Registry roles are seeded from existing settings. Qwen is the everyday role, the existing Sonnet endpoint is the initially available specialist, and additional providers require actual configuration and capability/pricing verification. No credentials enter the registry, ledger or logs. The controller validates cloud eligibility on the actual outgoing context and checks budget before dispatch. Unknown pricing blocks automatic paid dispatch. Cloud limits require an explicit configured allowance.

Each bounded task may select a specialist initially or escalate once after failed result checks. Infrastructure retries/failover are separately counted and share the same deadline and budget. Missing information, denied permissions, exhausted limits and uncertain side effects are not reasons to buy a stronger model.

Journal mutations before dispatch; cache completed results and prevent replay of uncertain actions. Sequential tool execution preserves permission changes between calls. Do not treat tool error results as completion evidence. Preserve specialist artifacts rather than rewriting them through Qwen.

## Verification and rollout

Use deterministic fake providers and temporary databases to test local success, one specialist handoff, a second failure, deadline expiry, cancellation, restart, concurrent reservations, duplicate actions, unknown outcomes, and privacy guards. Run existing desktop and Core checks. Build the actual server only after source checks pass; verify service health on deployment. Do not migrate the memory database or enable Core memory authority as a side effect.

Attachment provenance, richer document extraction, long-running project scheduling, additional specialist adapters and learned routing remain subsequent stages. This first slice must be integrated into the live chat execution path before those additions.

## Deployment update — 2026-09-28

The persistent task controller is now integrated into the deployed chat pipeline. See `/home/toomii/haru-pipeline-fix-20260928/REPORT.md` for the shipped changes, exact validation, limits and deployment manifest. The audit findings above describe the previous runtime; the implementation outline is no longer merely a proposal. Ordinary eligible chat retains the configured Kimi route; Qwen handles local turns and fallback; observable quality failure permits one bounded specialist handoff. The user explicitly approved $0.50/task and $5/day during this implementation.
