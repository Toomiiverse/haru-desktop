/** Transport progress can satisfy first-word timers without exposing draft assertions. */
export class ReplyGate {
  private committed = false;
  private prefix = "";
  private held = false;
  constructor(private readonly publish?: (text: string) => void, private readonly log: (line: string) => void = () => {}) {}
  /** 3320 speak-first: her line while a tool runs, shown at once and never part of the reply \u2014 the first real text
   *  (an opening, the commit, a reset) takes it back with the reset marker. One a turn; a later tool keeps the first. */
  hold = (text: string): void => {
    if (this.committed || this.prefix || this.held || !text) return;
    this.held = true;
    this.publish?.(text);
  };
  private release(): void {
    if (!this.held) return;
    this.held = false;
    this.publish?.('\uFFFD');
  }
  opening = (text: string): void => {
    if (this.committed || this.prefix) throw new Error('reply_opening_already_published');
    this.release();
    this.prefix = text;
    this.publish?.(text);
  };
  chunk = (_text: string): void => {};
  /** A round taken back takes its published opening with it: the reset marker clears the phone's bubble, and the
   *  next round may open again (3300; a retried round re-opened on 2026-10-12 and the turn failed). */
  reset = (): void => {
    if (this.committed) return;
    this.release();
    if (!this.prefix) return;
    this.log('[reply-gate] ' + JSON.stringify({ opening: 'reset', chars: this.prefix.length }));
    this.prefix = '';
    this.publish?.('\uFFFD');
  };
  commit(content: string): void {
    if (this.committed) throw new Error('reply_already_published');
    this.committed = true;
    this.release();
    // 3340: the opening carries the space that ended it in the stream; a reply a later filter cut back to exactly that
    // sentence (a dropped closing question) still keeps it. Logged from the one place that knows whether it survived.
    const kept = content.startsWith(this.prefix) || content === this.prefix.trimEnd();
    if (this.prefix) this.log('[reply-gate] ' + JSON.stringify({ opening: kept ? 'kept' : 'replaced', chars: this.prefix.length }));
    if (this.prefix && !kept) {
      // 3240: a published opening the final text no longer starts with (a repair, an inspector edit, the publication
      // voice) is taken back the way a discarded round is — a reset marker, then the whole reply — not a failed turn.
      this.publish?.('\uFFFD');
      this.publish?.(content);
      return;
    }
    this.publish?.(content.slice(this.prefix.length));
  }
}
