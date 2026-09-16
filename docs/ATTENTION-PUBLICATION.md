# Attention integration publication

Prepared 17 September 2026 on `codex/attention-publish`, based on published
`companion-features` commit `4ab90e4`.

This branch combines the attention runtime, fresh client activity observations,
unknown-input mood handling, native desktop reporter, comparison tools, tests
and research reports. The controller remains in shadow mode. The work has not
established improved conversation quality or a benefit from anatomical connectome
weights; see the [integration plan](HARU-ATTENTION-INTEGRATION-PLAN.md).

The research archive matches the earlier public `feat/attention-shadow` branch,
with the subsequent integration reports, probe, observed-input comparison and
replay update added. Deployment commit IDs in those reports document earlier
local branches; they are historical provenance, not ancestors of this publication.
The [desktop report](../research/fruitfly/DESKTOP-INTEGRATION.md) records what was
running at its verification cutoff.

The published base contained misplaced blocks in `electron/main.ts`. This branch
restores the hosted reply guard, example-copy guard, journal request and guard,
follow-up guard, hosted voice instruction and agenda callback to their intended
scopes, matching their placement in the working server source.

## Validation of this branch

- Linux: all **1,451 tests pass**, zero failed or skipped; production build passes.
- Windows: production build passes; **1,450/1,451 tests pass**. The unchanged
  vault-memory fixture assumes Linux path separators and fails on Windows.
- Existing Vite/font CSS warnings remain.
- Linux validation used a separate temporary directory with the server's
  installed dependencies. It did not replace or restart the running service.

The larger test counts in deployment reports belong to the effective server and
desktop checkouts at those times, which contain additional unrelated work.
