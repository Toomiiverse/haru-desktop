/** Prepared PCM and pure Core decision transport. No local cadence/word choice. */
import {readFileSync, lstatSync} from 'node:fs';
import {join, dirname, isAbsolute, basename} from 'node:path';
import {createHash} from 'node:crypto';
import {corePolicySync} from './core-policy-sync';

export type ReactionCommand = {id:number;clip:string;text:string;emotion:string;trigger:string;issuedAtMs:number;expiresAtMs:number;maxMs:number};
export type ReactionPlan = {state:unknown;command:ReactionCommand|null;afterMs:number|null;inputMode?:'open'|'addressed'};
export type ReactionClip = {pcm:Uint8Array;sampleRate:number};
export type CallEngagement = {
  plan(state:unknown,event:string,facts:Record<string,unknown>):ReactionPlan;
  clip(command:ReactionCommand):ReactionClip|null;
  available():boolean;
};

const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)]));
  return value;
}
export function voiceFingerprint(voice:Record<string,unknown>):string {
  return sha(JSON.stringify(canonical(['engine','endpoint','voiceId','voice','referenceText','language','speed','volume','deliveryInstruction','emotionVoices'].map(key=>voice[key]??null))));
}

export function loadCallEngagement(readVoice:()=>Record<string,unknown>):CallEngagement|undefined {
  const file=process.env.HARU_CALL_REACTION_BANK;
  if(!file)return undefined;
  if(!isAbsolute(file)||lstatSync(file).isSymbolicLink())throw Error('reaction_bank_path');
  const bank=JSON.parse(readFileSync(file,'utf8'));
  if(bank.version!==1)throw Error('reaction_bank_version');
  if(bank.voiceFingerprint!==voiceFingerprint(readVoice()))return undefined;
  const clips=new Map<string,ReactionClip>();
  const specs=new Map<string,{text:string;emotion:string}>();
  for(const [id,raw] of Object.entries(bank.clips)) {
    const row=raw as any;
    if(typeof row.file!=='string'||basename(row.file)!==row.file||row.sampleRate!==24000)throw Error('reaction_clip_path');
    const path=join(dirname(file),row.file);
    if(lstatSync(path).isSymbolicLink())throw Error('reaction_clip_symlink');
    const pcm=readFileSync(path);
    if(!pcm.length||pcm.length%2||pcm.length>144000||sha(pcm)!==row.sha256)throw Error('reaction_clip_integrity');
    clips.set(id,{pcm,sampleRate:row.sampleRate});specs.set(id,{text:row.text,emotion:row.emotion});
  }
  return {
    available:()=>{
      const voice=readVoice();
      return voice.webEnabled===true&&voice.engine!=='off'&&voiceFingerprint(voice)===bank.voiceFingerprint;
    },
    plan:(state,event,facts)=>corePolicySync<ReactionPlan>('speech-boundary.engagement',[state,event,facts]),
    clip:command=>{
      const spec=specs.get(command.clip),clip=clips.get(command.clip);
      if(!spec||!clip||spec.text!==command.text||spec.emotion!==command.emotion||clip.pcm.length/(clip.sampleRate*2)*1000>command.maxMs)return null;
      return clip;
    },
  };
}
