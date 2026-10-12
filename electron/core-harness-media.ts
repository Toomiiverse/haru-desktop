// Image bytes stay in the provider/device adapter. Core controls rounds using
// unguessable session references; these never reach the model or survive a turn.
import {randomUUID} from 'node:crypto';
import type {ChatMessage} from './provider';
export class HarnessMedia {
  private readonly images=new Map<string,string>();
  private readonly references=new Map<string,string>();
  toCore(messages:readonly ChatMessage[]):ChatMessage[]{
    return messages.map(message=>({...message,...(message.images?{images:message.images.map(bytes=>{
      if(typeof bytes!=='string')throw Error('core_harness_media_invalid');
      let reference=this.references.get(bytes);
      if(!reference){reference='haru-session-image:'+randomUUID();this.images.set(reference,bytes);this.references.set(bytes,reference);}
      return reference;
    })}:{})}));
  }
  fromCore(messages:readonly ChatMessage[]):ChatMessage[]{
    return messages.map(message=>({...message,...(message.images?{images:message.images.map(reference=>{
      const bytes=this.images.get(reference);if(bytes===undefined)throw Error('core_harness_media_unbound');return bytes;
    })}:{})}));
  }
}
