# Haru adapter boundary

Python Core decides domain policy. Node executes supervised adapters, reports facts
and returns receipts; Python owns authoritative state. No new policy additions in
electron/, scripts/ or other Node entry points. Existing specialist decisions are
migration debt and must be migrated or explicitly bounded by an adapter contract.

Policy includes eligibility, ranking, cooldowns, semantic interpretation, prompt
instructions, model selection, budgets, retries and state-transition decisions.
Adapters may validate transport, report device capabilities/permission revocation
and reject stale execution atomically. They may not pick a substitute action, silently
fall back to local policy, replay an uncertain effect or claim completion from an
accepted/queued response. Existing disabled-mode compatibility is frozen debt.

Read ../haru-core/docs/architecture/single-authority.md. Run the pinned authority
check documented there before shipping Node changes. Every Node change requires
exact-hash review tied to a contract and evidence; do not refresh the baseline to
bypass it. Shared frontend decision policy also belongs in Core; presentation-only
UI work does not transfer authoritative state ownership.

Do not overwrite deployed dist-electron or frozen proof files while building an
isolated candidate. The user-deferred world/privacy defects remain on hold.

Reporting preferences in /home/toomii/AGENTS.md also apply.
