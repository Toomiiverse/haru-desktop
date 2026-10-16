import {corePolicySync} from './core-policy-sync';
// Pictures from Venice.
//
// She is asked for one, and this makes it: a POST to Venice's image endpoint
// with her key, the bytes written beside her other files, and a name back. The
// caller decides who sees it ? the tool that offers this is only offered in
// Explicit mode.
//
// Venice returns base64 in JSON. `return_binary` would save the decode, but the
// JSON shape is the one that carries a request id, and knowing which request
// made a picture is worth more than the decode costs.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const VENICE_IMAGE_ENDPOINT = 'https://api.venice.ai/api/v1/image/generate';
/** Venice's anime model, the one labelled "Anime (WAI)": Illustrious-based and
 *  built for exactly the pictures she is asked for. Marked private, like SD35 ?
 *  it is Venice's own rather than another vendor's, so what comes back is
 *  governed by Venice's policy and not a third party's. */
export const DEFAULT_IMAGE_MODEL = 'wai-Illustrious';

export type MadePicture = {
  id: string;
  file: string;
  bytes: number;
  model: string;
  prompt: string;
  at: string;
};

/** What Venice says when it will not make the picture. */
export class PictureRefused extends Error {}

type VeniceReply = { images?: string[]; request_id?: string; error?: string | { message?: string } };

/**
 * Make one picture and write it to `folder`.
 *
 * `safeMode` is passed through rather than assumed: Venice's own filter is the
 * only thing between a prompt and a refusal here, and a caller that has decided
 * the request is allowed should be able to say so plainly instead of guessing
 * what the default was.
 */
export async function makePicture(options: {
  key: string;
  prompt: string;
  folder: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  safeMode?: boolean;
}): Promise<MadePicture> {
  {
    const {key,folder,...facts}=options;
    const prepared=corePolicySync<any>('final-picture.prepare',[facts,Boolean(key)]);
    if(prepared.error)throw new PictureRefused(prepared.error);
    const response=await fetch(prepared.endpoint,{method:prepared.method,headers:{...(key?{Authorization:`Bearer ${key}`}:{}),'Content-Type':'application/json'},body:JSON.stringify(prepared.body)});
    const text=await response.text();let reply:VeniceReply;try{reply=JSON.parse(text)}catch{reply={}}
    const chosen=corePolicySync<any>('final-picture.response',[response.status,response.ok,typeof reply.error==='string'?reply.error:reply.error?.message??null,Boolean(reply.images?.[0])]);
    if(chosen.error)throw new PictureRefused(chosen.error);
    const bytes=Buffer.from(reply.images![chosen.index],'base64'),decoded=corePolicySync<any>('final-picture.decoded',[bytes.length]);
    if(decoded.error)throw new PictureRefused(decoded.error);
    if(decoded.write!==true)throw Error('picture_write_protocol');
    mkdirSync(folder,{recursive:true});const id=randomUUID(),file=path.join(folder,`${id}.png`);writeFileSync(file,bytes,{flag:'wx'});
    return {id,file,bytes:bytes.length,model:prepared.body.model,prompt:prepared.body.prompt,at:new Date().toISOString()};
  }
}

