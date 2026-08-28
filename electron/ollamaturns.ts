// The conversation, in the shape a chat template will render.
//
// Ollama does not render a conversation itself; it hands it to the model's own
// Jinja template, and templates differ in what they will refuse. qwen2.5's took
// anything. Qwen3.5's raises on three things the app produces in the ordinary
// course of talking — and a raise is a 500 with no reply, which capacitySpill
// then quietly hands to the hosted model. Every local request failing that
// way, and every reply coming from OpenAI, was noticed as "no personality".
//
// Each rule here was confirmed against the live template, not read off a page:
//
//  - A system message anywhere but first. markTimeGaps puts one after every
//    long silence ("[Time passed here …]"). Merged into the user turn that
//    follows it, so it keeps its place in the story, or stands in as a user
//    turn of its own when nothing of theirs follows.
//  - Tool-call arguments as a string. Ollama's own replies carry an object;
//    OpenAI's carry JSON text, and a tool loop that spilled to the hosted model
//    for one round comes back to Ollama holding the string. Parsed here.
//  - No user turn at all. When she speaks first the conversation is a system
//    message alone. An empty user turn satisfies the template and, measured,
//    changes nothing about what she says.
//
// Pure, and done in one place: the composers upstream do not know which model
// is answering, and should not have to.

export type Turn = {
  role: string;
  content?: string;
  tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
  [extra: string]: unknown;
};

/** Text arguments become the object they spell, or nothing when they spell nothing. */
function objectArguments(args: unknown): unknown {
  if (typeof args !== 'string') return args;
  try {
    const parsed: unknown = JSON.parse(args);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function forOllama<T extends Turn>(conversation: T[]): T[] {
  const out: T[] = [];
  let pending: string[] = [];
  const flush = () => {
    if (!pending.length) return;
    out.push({ role: 'user', content: pending.join('\n\n') } as T);
    pending = [];
  };
  for (const [index, message] of conversation.entries()) {
    if (message.role === 'system' && index > 0) {
      if (message.content) pending.push(message.content);
      continue;
    }
    if (pending.length && message.role === 'user') {
      out.push({ ...message, content: [...pending, message.content ?? ''].join('\n\n') });
      pending = [];
      continue;
    }
    flush();
    if (message.tool_calls?.some(call => typeof call.function?.arguments === 'string')) {
      out.push({
        ...message,
        tool_calls: message.tool_calls.map(call => (
          typeof call.function?.arguments === 'string'
            ? { ...call, function: { ...call.function, arguments: objectArguments(call.function.arguments) } }
            : call
        )),
      });
      continue;
    }
    out.push(message);
  }
  flush();
  if (!out.some(message => message.role === 'user')) out.push({ role: 'user', content: '' } as T);
  return out;
}

/**
 * The same conversation with its oldest half gone, for a prompt that did not fit.
 *
 * The runner behind some models refuses a prompt longer than its window rather
 * than truncating it as Ollama's own runner does, and nothing upstream bounds
 * the day's history, so a long day arrives whole. The leading system messages
 * stay; of the rest, the older half is dropped — and then whatever follows up
 * to the next user turn, so the history never opens on a tool result whose
 * call is gone, or on her answering nobody. Returns the input unchanged when
 * there is nothing left worth dropping, which the caller reads as "give up".
 */
export function withoutOldest<T extends Turn>(conversation: T[], fraction = 0.5): T[] {
  let lead = 0;
  while (lead < conversation.length && conversation[lead].role === 'system') lead++;
  const rest = conversation.slice(lead);
  if (rest.length < 2) return conversation;
  let from = Math.max(1, Math.floor(rest.length * fraction));
  while (from < rest.length && rest[from].role !== 'user') from++;
  if (from >= rest.length) return conversation;
  return [...conversation.slice(0, lead), ...rest.slice(from)];
}
