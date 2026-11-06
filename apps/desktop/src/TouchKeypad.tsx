import React,{useState} from 'react';
import {formatTouchMoney,touchDigits} from './touchModels.js';

export function TouchKeypad({label,digits,onChange,onConfirm,integer=false,disabled=false,confirmLabel='Confirmar valor'}:{label:string;digits:string;onChange:(digits:string)=>void;onConfirm:()=>void;integer?:boolean;disabled?:boolean;confirmLabel?:string}) {
  const [replace,setReplace]=useState(true);
  const press=(key:string)=>{const next=touchDigits(digits,key,replace,integer?2:9);onChange(next);setReplace(false);};
  return <section className="d26-touch-keypad" aria-label={'Teclado numérico · '+label}>
    <header><span>{label}</span><output aria-live="polite">{integer?digits||'0':'R$ '+(formatTouchMoney(digits)||'0,00')}</output></header>
    {!integer&&<small>Digite os centavos: 1 0 0 0 = R$ 10,00</small>}
    <div className="d26-touch-keys">{['1','2','3','4','5','6','7','8','9','00','0','BACKSPACE'].map(key=><button type="button" key={key} disabled={disabled} aria-label={key==='BACKSPACE'?'Apagar último dígito':key} onClick={()=>press(key)}>{key==='BACKSPACE'?'⌫':key}</button>)}</div>
    <div className="d26-touch-key-actions"><button type="button" disabled={disabled} onClick={()=>{onChange('');setReplace(false);}}>Limpar</button><button type="button" className="d26-pos-primary" disabled={disabled||!digits||Number(digits)<=0} onClick={()=>{onConfirm();setReplace(true);}}>{confirmLabel}</button></div>
  </section>;
}
