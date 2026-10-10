/** Transport progress can satisfy first-word timers without exposing draft assertions. */
export class ReplyGate {
  private committed = false;
  private prefix = "";
  constructor(private readonly publish?: (text: string) => void) {}
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
    if (this.prefix && !content.startsWith(this.prefix)) throw new Error('reply_opening_mismatch');
    this.publish?.(content.slice(this.prefix.length));
  }
}
