// Backend persistence for the phone adapter. The renderer is not an authority.
export type PhoneTurn = {text:string;reply:string;ignored:boolean;retry?:boolean;attachments?:unknown[];replyTo?:unknown};
export function appendPhoneTurn(history:any[],turn:PhoneTurn,id:string,at:string):any[] {
  if(history.some(row=>row.id===id+'-u'||row.id===id+'-a'))return history;
  if(turn.retry&&history.at(-1)?.role==='assistant'){
    return [...history.slice(0,-1),...(turn.ignored?[]:[{id:id+'-a',role:'assistant',content:turn.reply,time:'now',at}])];
  }
  return [...history,{id:id+'-u',role:'user',content:turn.text,time:'now',at,
    ...(turn.attachments?.length?{attachments:turn.attachments}:{}),...(turn.replyTo?{replyTo:turn.replyTo}:{})},
    ...(turn.ignored?[]:[{id:id+'-a',role:'assistant',content:turn.reply,time:'now',at}])];
}
