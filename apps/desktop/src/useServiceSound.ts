import {useEffect,useRef,useState} from 'react';
import type {TableServiceCall} from '@deck26/contracts';
import type {AlertKind} from './desktopAlerts.js';

const melodies:Record<AlertKind,number[]>={waiter:[784,1047],bill:[660,880,1047],order:[659,784],delivery:[523,659,784],print:[392,294,392],stock:[440,330]};

export const alertSoundLabels:Record<AlertKind,string>={waiter:'Chamados de garçom',bill:'Pedidos de conta',order:'Pedidos do salão',delivery:'Pedidos online',print:'Falhas de impressão',stock:'Alertas de estoque'};
export function useServiceSound(calls:TableServiceCall[]|undefined,session:string|undefined,ready:boolean,onCall?:(call:TableServiceCall)=>void,profile='desktop'){
  const context=useRef<AudioContext|null>(null);
  const prior=useRef<{session:string;ids:Set<string>}|null>(null);
  const [enabled,setEnabled]=useState(false);
  const [feedback,setFeedback]=useState('');
  const [volume,setVolume]=useState(65);
  const [preferences,setPreferences]=useState<Partial<Record<AlertKind,boolean>>>({});
  useEffect(()=>{
    try{setPreferences(JSON.parse(localStorage.getItem('deck26.alerts.'+profile)??'{}')??{});}catch{setPreferences({});}
  },[profile]);
  const setPreference=(kind:AlertKind,value:boolean)=>{
    const next={...preferences,[kind]:value};setPreferences(next);
    try{localStorage.setItem('deck26.alerts.'+profile,JSON.stringify(next));}catch{}
  };
  const nextAt=useRef(0);
  const callback=useRef(onCall);
  callback.current=onCall;
  const play=(audio:AudioContext,kind:AlertKind)=>{
    if(!volume)return;
    const start=Math.max(audio.currentTime,nextAt.current);
    if(start-audio.currentTime>1)return;
    const tones=melodies[kind];
    nextAt.current=start+tones.length*.17;
    tones.forEach((tone,index)=>{
      const oscillator=audio.createOscillator(),gain=audio.createGain();
      const at=start+index*.17;
      oscillator.frequency.value=tone;
      gain.gain.setValueAtTime(.001,at);
      gain.gain.exponentialRampToValueAtTime(Math.max(.002,.23*volume/100),at+.025);
      gain.gain.exponentialRampToValueAtTime(.001,at+.16);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);oscillator.stop(at+.17);
    });
  };
  const sound=(kind:AlertKind,preview=false)=>{
    if(!enabled||!preview&&preferences[kind]===false)return;
    if(context.current?.state==='running')play(context.current,kind);
    else {setEnabled(false);setFeedback('Toque em Ativar som para voltar a ouvir os chamados.');}
  };
  useEffect(()=>{
    if(!session){prior.current=null;return;}
    if(!ready)return;
    const ids=prior.current?.session===session?prior.current.ids:undefined;
    const fresh=ids?(calls??[]).filter(call=>!ids.has(call.id)):[];
    prior.current={session,ids:new Set([...(ids??[]),...(calls??[]).map(call=>call.id)])};
    fresh.forEach(call=>callback.current?.(call));
    if(fresh.some(call=>call.kind==='BILL')&&preferences.bill!==false)sound('bill');
    else if(fresh.some(call=>call.kind==='WAITER'))sound('waiter');
  },[calls,session,ready,enabled]);
  useEffect(()=>()=>{void context.current?.close().catch(()=>{});context.current=null;},[]);
  const toggle=async()=>{
    if(enabled){setEnabled(false);setFeedback('Som dos chamados desativado.');return;}
    try{
      const audio=context.current??=new AudioContext();
      await audio.resume();
      if(audio.state!=='running')throw Error();
      play(audio,'waiter');setEnabled(true);setFeedback('Sons ativados.');
    }catch{setFeedback('Não foi possível ativar o som neste dispositivo.');}
  };
  return {enabled,feedback,toggle,volume,setVolume,sound,preferences,setPreference};
}
