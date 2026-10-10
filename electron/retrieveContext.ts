import {coreKnowledgeQuery} from './core-final-retrieval';
import {corePolicySync} from './core-policy-sync';
import { retrieveMemories, type MemoryRecord, type ScoredMemory } from './memory';
import { hybridSearch, keywordOnly, type RetrieveOptions, type ScoredChunk } from './retrieval';
import { buildKnowledgeContext, emptyKnowledgeContext } from './context';
import type { KnowledgeStore } from './knowledge';

export type RetrieveContextOptions = {
  knowledge: KnowledgeStore;
  embed(text: string): Promise<number[]>;
  memories?: MemoryRecord[];
  /** id → semantic similarity, precomputed with the same embedder. Absent ids
   *  fall back to keyword scoring inside retrieveMemories. */
  semantic?: Map<string, number>;
  query: string;
  now?: Date;
  limit?: number;
  threshold?: number;
  rerankTo?: number;
  filters?: RetrieveOptions['filters'];
  maxChars?: number;
};

export type RetrieveContextResult = {
  knowledge: ScoredChunk[];
  knowledgeText: string;
  memories: ScoredMemory[];
};

export async function retrieveContext(options: RetrieveContextOptions): Promise<RetrieveContextResult> {
 if(process.env.HARU_CORE_FINAL_TOOLS==='on'){
  const {embed,memories,semantic,knowledge,...rest}=options;
  const packet=corePolicySync<any>('final-retrieval.start',[{...rest,now:(options.now??new Date()).toISOString()}]);
  if(packet.command.kind!=='embed')throw Error('retrieval_command_protocol');
  let observation;
  try{observation={ok:true,embedding:await embed(packet.command.text)}}catch(error){observation={ok:false,error:error instanceof Error?error.message:String(error)}}
  const selectedQuery=corePolicySync<any>('final-retrieval.select',[packet.state,observation]);
  const rows=coreKnowledgeQuery(selectedQuery.kind,knowledge,selectedQuery.query,selectedQuery.embedding,{...selectedQuery.options,now:new Date(selectedQuery.options.now)});
  const result=corePolicySync<any>('final-retrieval.complete',[packet.state,rows]);
  if(selectedQuery.embeddingError)console.warn(`[knowledge] embeddings unavailable (${selectedQuery.embeddingError}) — keyword search only`);
  // Personal-memory selection is a separately owned Core delegate.
  const selected=memories?.length?retrieveMemories(memories,options.query,{semantic}):[];
  return {knowledge:result.knowledge,knowledgeText:result.knowledgeText,memories:selected};
 }

  const now = options.now ?? new Date();
  const topK = 20;
  const threshold = options.threshold ?? 0.35;
  const rerankTo = options.rerankTo ?? 5;
  const retrieve: RetrieveOptions = { topK, threshold, rerankTo, filters: options.filters, now };
  let knowledge: ScoredChunk[] = [];
  let embeddingError = '';
  try {
    const embedding = await options.embed(options.query);
    knowledge = hybridSearch(options.knowledge, options.query, embedding, retrieve);
  } catch (error) {
    embeddingError = error instanceof Error ? error.message : String(error);
    knowledge = keywordOnly(options.knowledge, options.query, retrieve);
  }
  const maxItems = options.limit ?? 5;
  const maxChars = options.maxChars ?? 2400;
  const knowledgeText = knowledge.length
    ? buildKnowledgeContext(knowledge, { maxItems, maxChars })
    : emptyKnowledgeContext();
  if (embeddingError) console.warn(`[knowledge] embeddings unavailable (${embeddingError}) — keyword search only`);
  const memories = options.memories?.length ? retrieveMemories(options.memories, options.query, { semantic: options.semantic }) : [];
  return { knowledge, knowledgeText, memories };
}
