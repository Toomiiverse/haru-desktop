// Production ships this file as a plain CommonJS script (no __esModule marker),
// so it is written without ES import/export; importers use require('./core-openmail').
const fs = require('node:fs') as typeof import('node:fs');
const { coreServiceOptions } = require('./core-service-client') as typeof import('./core-service-client');
const { coreAdapterOwner } = require('./core-policy-sync') as typeof import('./core-policy-sync');

// Authenticated transport only; Core owns configuration, drafts and send authorization.
exports.coreOpenMail = async function coreOpenMail(op: string, args: Record<string, unknown> = {}): Promise<any> {
  const options = coreServiceOptions();
  if (!options) throw Error('openmail_core_unavailable');
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw Error('core_service_loopback_required');
  if (fs.statSync(options.tokenFile).mode & 0o077) throw Error('core_service_token_must_be_private');
  const token = fs.readFileSync(options.tokenFile, 'utf8').trim();
  if (token.length < 32) throw Error('core_service_token_invalid');
  const response = await fetch(endpoint.origin + '/v1/openmail/ui', {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ owner: coreAdapterOwner(), nowMs: Date.now(), op, args }),
    signal: AbortSignal.timeout(180000),
  });
  const value = await response.json();
  if (!response.ok) throw Error(typeof value.detail === 'string' ? value.detail : 'openmail_request_failed');
  return value;
};
