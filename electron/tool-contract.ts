import type { ChatMessage, ChatTool, ToolCall } from './provider';

// Transport-owned metadata, never read from model text or persisted history.
const offered = new WeakMap<ChatMessage, ChatTool[]>();
export function withToolContract<T extends ChatMessage>(message: T, tools: ChatTool[]): T {
  offered.set(message, structuredClone(tools));
  return message;
}
export function toolContract(message: ChatMessage): ChatTool[] | undefined { return offered.get(message); }

function schemaProblem(value: unknown, schema: any, root = false): string | null {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.enum && !schema.enum.some((x: unknown) => JSON.stringify(x) === JSON.stringify(value))) return 'Value is outside the offered enum.';
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type: string) => type === 'null' ? value === null
    : type === 'array' ? Array.isArray(value)
    : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value)
    : type === 'integer' ? Number.isInteger(value)
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type)) return 'Argument type does not match the offered schema.';
  if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) return 'Argument is outside the offered range.';
  if (Array.isArray(value) && schema.items) for (const item of value) { const error = schemaProblem(item, schema.items); if (error) return error; }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ((schema.required ?? []).some((key: string) => !Object.hasOwn(obj, key))) return 'A required argument is missing.';
    for (const [key, item] of Object.entries(obj)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return 'Unsafe argument key.';
      const child = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties[key] : undefined;
      if (!child && (schema.additionalProperties === false || root && schema.properties)) return 'An argument was not offered in this tool schema.';
      const error = schemaProblem(item, child ?? schema.additionalProperties); if (error) return error;
    }
  }
  return null;
}

/** Validate before dispatch, including textual calls recovered by the tool loop. */
export function toolCallProblem(call: ToolCall, table?: ChatTool[]): string | null {
  const name = call?.function?.name;
  if (typeof name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(name)) return 'Malformed tool name.';
  const schema = table?.find(t => t.function.name === name)?.function.parameters;
  if (table && !schema) return 'Tool was not offered on this request.';
  let args = call.function?.arguments ?? {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return 'Tool arguments are not valid JSON.'; } }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Tool arguments must be an object.';
  return schemaProblem(args, schema, true);
}
