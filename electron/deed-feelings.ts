import type { FeelingEvent } from './feelings';

/** Separate keeping a deed from enjoying it. Runtime-only recovery evidence:
 * an unrelated success must not erase a failure, and retries are not downtime. */
export class DeedFeelings {
  private failedTools = new Set<string>();
  private ownTimeAt = -Infinity;

  events(tool: string, args: Record<string, unknown>, result: string, now: number): FeelingEvent[] {
    let outcome: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(result);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
      outcome = parsed as Record<string, unknown>;
    } catch { return []; }
    // Asking permission is neither failure nor accomplishment.
    if (outcome.confirm === false) return [];
    if (typeof outcome.error === 'string' || outcome.ok === false || outcome.created === false) {
      this.failedTools.add(tool);
      return ['broke'];
    }
    if (outcome.started === false || outcome.read === false) return [];
    const events: FeelingEvent[] = [];
    if (this.failedTools.delete(tool)) events.push('worked');
    const recreation = tool === 'read_manga' || (tool === 'play_pokemon' && args.action === 'start');
    if (recreation && now - this.ownTimeAt >= 30 * 60_000) {
      this.ownTimeAt = now;
      events.push('own-time');
    }
    return events;
  }
}
