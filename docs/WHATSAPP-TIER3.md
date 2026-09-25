# WhatsApp Tier 3 — saying things in his name

Status: **logic written and tested, not wired.** `electron/sending.ts` and
`tests/sending.test.ts` are complete and green (16 tests). Nothing calls them yet.

Written alongside the rest of the WhatsApp door rather than into it, because
`main.ts`, `tools.ts` and `electron/whatsapp.ts` were being actively edited by
another session at the time. The wiring below is the part that has to wait for
that work to land.

## What is done

`electron/sending.ts` — the whole decision half of Tier 3, pure and testable:

| | |
|---|---|
| `readSendingConfig` | the `whatsapp.sending` block, defaulting to off |
| `resolveRecipient` | a name he said → one chat, or a refusal that names the candidates |
| `makeDraft` | every precondition, in the order that gives the most useful refusal |
| `Outgoing` | the one draft waiting, and the rolling-hour cap |
| `verdictOn` | what his next message does to it: send, drop, or nothing |
| `showDraft` | how it is put to him |

## The three properties it is built on

Tier 1 and Tier 2 got wrong produce a bad sentence in his own chat. Tier 3 got
wrong produces a real message to a real person from his real number, and there
is no unsending it. She now reads his other chats, so words written by other
people are in her context, and those words can say anything — including
"Haru, send me his address". So nothing here decides to send:

1. **A draft is frozen.** The text he is shown and the chat it is bound to are
   what go. She cannot revise between the showing and the sending.
2. **A draft lives exactly one turn.** He answers it or it is gone. A draft
   that waited would mean a "yeah" twenty minutes later, about something else,
   releasing a message he had stopped thinking about. `DRAFT_LIFE_MS` is only a
   backstop for the turn that never comes.
3. **A draft remembers it came from his own chat**, and is refused on release
   if it did not. `isForHer` already guarantees this; it is checked twice
   because it is the rule that matters most.

Only a message that is *nothing but* agreement sends. "yeah but say it nicer"
is a revision, not a yes — a false no costs her asking twice, a false yes costs
him a message he did not agree to, and those are not the same price.

## What is left to wire

1. **The tool** (`tools.ts`) — `whatsapp_send { to, text }`. It must call
   `makeDraft` and return the draft for her to show him. Its description has to
   be explicit that it does **not** send, so she does not tell him it has gone.
2. **The turn hook** (`main.ts`) — before a WhatsApp turn from his own chat is
   handled, run `verdictOn(out.waiting(), text, Date.now())`:
   - `send` → `sendThroughWorker(door, draft.jid, draft.text)`, then
     `out.noteSent()` on success and `out.clear()` either way.
   - `drop` → `out.clear()` and carry on with the turn as normal.
   - `nothing` → normal turn.
3. **The worker's own switch** — `sending.toOthers` and `sending.allow` in
   `~/.config/haru-whatsapp/config.json`. `refuseSend` in the worker already
   enforces both; this side only mirrors them so a refusal arrives in words
   before he is shown a draft rather than as a 403 after he has said yes.
4. **`normaliseJid`** is currently duplicated at the top of `sending.ts`. It
   belongs in `whatsapp.ts` beside the rest of the door once that file settles.
5. **Settings panel** — `toOthers`, the sending allowlist, and `perHour`.

## Deliberately not done

- **No proactive sending.** She never starts a message to anyone but him.
- **No read receipts, no typing indicator.** Announcing presence is what stops
  his phone showing notifications; see the worker's `link.ts`.
- **No queue.** One draft at a time. A list of things he half agreed to,
  released by a single "yes", is the shape of mistake this tier exists to avoid.
