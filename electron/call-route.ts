import type {ModelEntry,ModelRole,RouteRequest} from './model-registry';
import {coreSelectTaskModel} from './core-router';

export const CALL_ROUTE_ID = 'call-conversation';

/** Reference a registered, priced model; an absent setting preserves routing. */
export function callRegistry(entries: ModelEntry[], setting: unknown, call: boolean): ModelEntry[] {
  if (!call || !setting || typeof setting !== 'object') return entries;
  const config = setting as {enabled?: unknown; modelId?: unknown};
  if (config.enabled !== true || typeof config.modelId !== 'string' || config.modelId === 'local-planner') return entries;
  const selected = entries.find(entry => entry.id === config.modelId && entry.enabled);
  if (!selected || selected.id === CALL_ROUTE_ID) return entries;
  return [...entries.filter(entry => entry.id !== CALL_ROUTE_ID), {...selected, id: CALL_ROUTE_ID, role: 'conversation'}];
}

/** Preference never bypasses privacy, context, tools, credentials or budget. */
export async function selectCallModel(entries: ModelEntry[], role: ModelRole, request: RouteRequest): Promise<ModelEntry | undefined> {
  if (role !== 'conversation') return;
  const preferred = entries.find(entry => entry.id === CALL_ROUTE_ID);
  return preferred ? coreSelectTaskModel([preferred], role, request) : undefined;
}
