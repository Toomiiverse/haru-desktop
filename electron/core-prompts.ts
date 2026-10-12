import {CoreServiceClient,coreServiceOptions} from './core-service-client';
import {promptObservations,chatSystemPrompt,chatDynamicContext,LENGTH_RULE_LOCAL,LENGTH_RULE_HOSTED,type PromptState} from './prompt';
import {deliveryRule} from './delivery';
import {naturalPromptObservations,naturalConversationTurns,type NaturalConversationSources} from './natural-conversation';
import type {ChatMessage} from './provider';

function client(){const options=coreServiceOptions();if(!options)throw Error('core_prompt_service_required');return new CoreServiceClient(options);}
function checked(result:any){if(typeof result.system!=='string'||typeof result.dynamic!=='string')throw Error('core_prompt_protocol_error');return result as {system:string;dynamic:string};}
export async function coreChatPrompt(state:PromptState,hosted=false,away=false,answering=''){
  if(process.env.HARU_CORE_PROMPT_ASSEMBLY!=='on'){
    const system=chatSystemPrompt(state,hosted,away);
    return {system:(hosted?`${system.replace(LENGTH_RULE_LOCAL,LENGTH_RULE_HOSTED)}\n\n${deliveryRule()}`:system)+(hosted?'':answering?' '+answering:''),dynamic:chatDynamicContext(state,away)};
  }
  return checked(await client().assemblePrompt({version:1,policy:process.env.HARU_CORE_PROMPT_POLICY??'source-reference',mode:'full',character:state.character,observations:promptObservations(state),
    hosted,away,about_her:!!state.aboutHer,delivery_rule:deliveryRule(),answering}));
}
export async function corePrepareNaturalConversation(messages:ChatMessage[],latest:string,character:{identity:string;style:string},context:Record<string,unknown>,cache?:{revision?:string;hit?:boolean}):Promise<{messages:ChatMessage[];sources:NaturalConversationSources}>{
  const observed=naturalPromptObservations(messages,latest,character,context,cache);
  if(process.env.HARU_CORE_PROMPT_ASSEMBLY!=='on')return {messages:naturalConversationTurns(messages,latest,character,context,cache),sources:observed.sources};
  const result=checked(await client().assemblePrompt({version:1,policy:process.env.HARU_CORE_PROMPT_POLICY??'source-reference',mode:'natural',character,transcript_context:observed.transcript_context,guidance:observed.guidance}));
  // Core does not cache request context or claim a desktop cache hit.
  if(cache)cache.hit=false;
  return {messages:[{role:'system',content:result.system},{role:'system',content:result.dynamic},observed.latest],sources:observed.sources};
}
