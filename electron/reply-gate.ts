/** Transport progress can satisfy first-word timers without exposing draft assertions. */
export class ReplyGate {
  private committed = false;
  constructor(private readonly publish?: (text: string) => void) {}
  chunk = (_text: string): void => {};
  reset = (): void => {};
  commit(content: string): void {
    if (this.committed) throw new Error('reply_already_published');
    this.committed = true;
    this.publish?.(content);
  }
}
