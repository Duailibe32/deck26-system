import {useEffect,useRef,useState} from 'react';
import type {TableServiceCall} from '@deck26/contracts';

export function useServiceSound(calls:TableServiceCall[]|undefined,session:string|undefined,ready:boolean){
  const context=useRef<AudioContext|null>(null);
  const prior=useRef<{session:string;ids:Set<string>}|null>(null);
  const [enabled,setEnabled]=useState(false);
  const [feedback,setFeedback]=useState('');
  const play=(audio:AudioContext,bill:boolean)=>{
    const start=audio.currentTime;
    (bill?[660,880,1047]:[784,1047]).forEach((tone,index)=>{
      const oscillator=audio.createOscillator(),gain=audio.createGain();
      const at=start+index*.17;
      oscillator.frequency.value=tone;
      gain.gain.setValueAtTime(.001,at);
      gain.gain.exponentialRampToValueAtTime(.16,at+.025);
      gain.gain.exponentialRampToValueAtTime(.001,at+.16);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);oscillator.stop(at+.17);
    });
  };
  useEffect(()=>{
    if(!session){prior.current=null;return;}
    if(!ready)return;
    const ids=prior.current?.session===session?prior.current.ids:undefined;
    const fresh=ids?(calls??[]).filter(call=>!ids.has(call.id)):[];
    prior.current={session,ids:new Set([...(ids??[]),...(calls??[]).map(call=>call.id)])};
    if(!enabled||!fresh.length)return;
    if(context.current?.state==='running')play(context.current,fresh.some(call=>call.kind==='BILL'));
    else {setEnabled(false);setFeedback('Toque em Ativar som para voltar a ouvir os chamados.');}
  },[calls,session,ready,enabled]);
  useEffect(()=>()=>{void context.current?.close().catch(()=>{});context.current=null;},[]);
  const toggle=async()=>{
    if(enabled){setEnabled(false);setFeedback('Som dos chamados desativado.');return;}
    try{
      const audio=context.current??=new AudioContext();
      await audio.resume();
      if(audio.state!=='running')throw Error();
      play(audio,false);setEnabled(true);setFeedback('Som dos chamados ativado.');
    }catch{setFeedback('Não foi possível ativar o som neste dispositivo.');}
  };
  return {enabled,feedback,toggle};
}
