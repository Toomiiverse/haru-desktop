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
  /** 3810: the bytes behind a reference this instance made; any other string is already bytes. */
  bytes(image:string):string{
    if(!image.startsWith('haru-session-image:'))return image;
    const bytes=this.images.get(image);if(bytes===undefined)throw Error('core_harness_media_unbound');return bytes;
  }
  fromCore(messages:readonly ChatMessage[]):ChatMessage[]{
    return messages.map(message=>({...message,...(message.images?{images:message.images.map(reference=>{
      const bytes=this.images.get(reference);if(bytes===undefined)throw Error('core_harness_media_unbound');return bytes;
    })}:{})}));
  }
}
// 3810: a chat turn's pictures cross the Core's preparation calls as references (a 390 KB screenshot went over the
// 256 KB call cap on 2026-10-14); the provider boundary and the harness 'media' answer put the bytes back.
// shortcut: holds every picture attached since the brain started (~0.5 MB each); bound it if pictures become frequent.
export const turnImages=new HarnessMedia();
export function withImageBytes<T extends {images?:string[]}>(messages:readonly T[]):T[]{
  return messages.some(m=>m.images?.some(i=>i.startsWith('haru-session-image:')))?messages.map(m=>m.images?{...m,images:m.images.map(i=>turnImages.bytes(i))}:m):messages as T[];
}
