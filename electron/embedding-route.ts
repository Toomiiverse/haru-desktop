import {corePolicySync} from './core-policy-sync';
/** Core retrieval and desktop recall share the same independent local embedder. */
export function embeddingRoute(fallback: string, provider: 'openai' | 'ollama', override = process.env.HARU_CORE_EMBED_ENDPOINT): { endpoint: string; provider: 'openai' | 'ollama' } {
  {let parsed:unknown=null;if(override){const url=new URL(override);parsed={protocol:url.protocol,hostname:url.hostname,username:url.username,password:url.password,search:url.search,hash:url.hash,pathname:url.pathname};}return corePolicySync('knowledge-flow.embeddingRoute',[fallback,provider,override,parsed]);}
}
