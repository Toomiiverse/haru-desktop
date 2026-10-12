/** Phone measurements are estimates; never substitute server send time for playback. */
export function callTelemetry(log:(value:object)=>void) {
  const expected=new Map<number,{id:string;inputMode:string}>();let reported=0;
  return {
    event(event:Record<string,unknown>) {
      if(event.type==='audio_start' && event.filler===false && Number.isSafeInteger(event.turn) && typeof event.id==='string') {
        const turn=event.turn as number;
        if(!expected.has(turn))expected.set(turn,{id:event.id,inputMode:event.inputMode==='push-to-talk'?'push-to-talk':'voice-activity'});
        while(expected.size>32)expected.delete(expected.keys().next().value!);
      }
    },
    receive(value:Record<string,unknown>) {
      if(reported>=128 || !Number.isSafeInteger(value.turn) || expected.get(value.turn as number)?.id!==value.id)return;
      const keys=['captureToRenderEstimateMs','outputLatencyMs','primeMs','underruns'] as const;
      if(keys.some(k=>typeof value[k]!=='number'||!Number.isFinite(value[k])||(value[k] as number)<0||(value[k] as number)>180000))return;
      const inputMode=expected.get(value.turn as number)!.inputMode;
      expected.delete(value.turn as number);reported++;
      log({scope:'phone_capture_to_render_estimate',inputMode,turn:value.turn,id:value.id,...Object.fromEntries(keys.map(k=>[k,value[k]]))});
    },
  };
}
