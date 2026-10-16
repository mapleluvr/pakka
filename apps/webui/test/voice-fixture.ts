// Controlled Web Speech boundary for synthetic browser tests; it never requests a microphone or sends audio.
export const controlledSpeech = `(()=>{
 const state=globalThis.__voiceTest={instances:[]};
 class ControlledRecognition {
  constructor(){this.starts=0;this.stops=0;this.aborts=0;state.instances.push(this);}
  start(){this.starts++;this.savedResult=this.onresult;}
  stop(){this.stops++;this.onend?.();}
  abort(){this.aborts++;this.onend?.();}
  emit(rows,late=false){
   const results=rows.map(([transcript,isFinal])=>Object.assign([{transcript}],{isFinal}));
   (late?this.savedResult:this.onresult)?.({results});
  }
 }
 globalThis.SpeechRecognition=ControlledRecognition;
})()`;
