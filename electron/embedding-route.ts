import {corePolicySync} from './core-policy-sync';
/** Core retrieval and desktop recall share the same independent local embedder. */
export function embeddingRoute(fallback: string, provider: 'openai' | 'ollama', override = process.env.HARU_CORE_EMBED_ENDPOINT): { endpoint: string; provider: 'openai' | 'ollama' } {
  if((true as boolean)){let parsed:unknown=null;if(override){const url=new URL(override);parsed={protocol:url.protocol,hostname:url.hostname,username:url.username,password:url.password,search:url.search,hash:url.hash,pathname:url.pathname};}return corePolicySync('knowledge-flow.embeddingRoute',[fallback,provider,override,parsed]);}
  if (!override) return { endpoint: fallback, provider };
  const url = new URL(override);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('embedding_override_must_be_loopback');
  }
  return { endpoint: override.replace(/\/+$/, ''), provider: 'ollama' };
}
