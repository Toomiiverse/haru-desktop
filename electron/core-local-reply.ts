/** Core controls parsing, repair admission and messages. This adapter invokes only its caller's composer. */
import {corePolicySync} from './core-policy-sync';
import type {ChatMessage} from './provider';
import type {ReplyCharacter} from './local-reply-quality';
export const localReplyOwned=()=>process.env.HARU_CORE_LOCAL_REPLY==='on';
export function localReplyDecision<T>(operation:string,args:unknown[]):T{return corePolicySync<T>(operation,args);}
export function localReplyChecked<T>(operation:string,args:unknown[]):T{const answer=corePolicySync<{ok:boolean;value?:T;error?:string}>(operation,args);if(!answer.ok)throw Error(answer.error);return answer.value!;}
export async function coreComposeLocalReply(conversation:ChatMessage[],latest:string,evidence:unknown,compose:(messages:ChatMessage[])=>Promise<ChatMessage>,character?:ReplyCharacter,draft?:ChatMessage,finishing=false):Promise<ChatMessage>{
 let transportCause:unknown;
 let packet=corePolicySync<any>('local-reply.composeStart',[conversation,latest,evidence,character??null,draft??null,finishing]);
 // A protocol bound only: Core decides whether a second provider request is permitted.
 for(let steps=0;steps<8;steps++){
  if(packet.done){if(packet.error)throw Error(packet.error,packet.cause==='transport'?{cause:transportCause}:undefined);return packet.useOriginalDraft?draft!:packet.answer;}
  let observation:unknown;
  try{observation={answer:await compose(packet.messages)};}catch(error){transportCause=error;observation={transportError:error instanceof Error?error.message:String(error)};}
  packet=corePolicySync('local-reply.composeObserved',[packet.state,observation]);
 }
 throw Error('local_reply_protocol_bound');
}
