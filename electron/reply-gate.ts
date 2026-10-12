/** Transport progress can satisfy first-word timers without exposing draft assertions. */
export class ReplyGate {
  private committed = false;
  private prefix = "";
  private held = false;
  constructor(private readonly publish?: (text: string) => void, private readonly warn: (line: string) => void = () => {}) {}
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
    this.prefix = '';
    this.publish?.('\uFFFD');
  };
  commit(content: string): void {
    if (this.committed) throw new Error('reply_already_published');
    this.committed = true;
    this.release();
    if (this.prefix && !content.startsWith(this.prefix)) {
      // 3240: a published opening the final text no longer starts with (a repair, an inspector edit, the publication
      // voice) is taken back the way a discarded round is — a reset marker, then the whole reply — not a failed turn.
      this.warn(`[reply-gate] the opening was taken back (${this.prefix.length} chars); the reply is shown whole`);
      this.publish?.('�');
      this.publish?.(content);
      return;
    }
    this.publish?.(content.slice(this.prefix.length));
  }
}
