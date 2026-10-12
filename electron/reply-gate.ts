/** Transport progress can satisfy first-word timers without exposing draft assertions. */
export class ReplyGate {
  private committed = false;
  private prefix = "";
  constructor(private readonly publish?: (text: string) => void, private readonly warn: (line: string) => void = () => {}) {}
  opening = (text: string): void => {
    if (this.committed || this.prefix) throw new Error('reply_opening_already_published');
    this.prefix = text;
    this.publish?.(text);
  };
  chunk = (_text: string): void => {};
  reset = (): void => {};
  commit(content: string): void {
    if (this.committed) throw new Error('reply_already_published');
    this.committed = true;
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
