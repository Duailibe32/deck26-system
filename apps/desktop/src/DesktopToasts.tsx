import React, {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {DesktopAlert} from './desktopAlerts.js';
import './desktop-toasts.css';

type Toast=DesktopAlert&{id:number};

export function useDesktopToasts(){
  const [toasts,setToasts]=useState<Toast[]>([]);
  const next=useRef(0);
  const dismiss=(id:number)=>setToasts(items=>items.filter(item=>item.id!==id));
  const push=(alert:DesktopAlert)=>{
    const toast={...alert,id:++next.current};
    setToasts(items=>[...items.slice(-3),toast]);
  };
  return {toasts,dismiss,push};
}

function ToastCard({toast,dismiss}:{toast:Toast;dismiss:(id:number)=>void}){
  const onDismiss=useRef(dismiss);
  onDismiss.current=dismiss;
  useEffect(()=>{
    const timer=setTimeout(()=>onDismiss.current(toast.id),toast.tone==='info'?6500:11000);
    return ()=>clearTimeout(timer);
  },[toast.id,toast.tone]);
  return <article className="d26-toast" data-tone={toast.tone} role={toast.tone==='error'?'alert':'status'}>
    <span className="d26-toast-icon" aria-hidden="true">{toast.tone==='info'?'✓':'!'}</span>
    <div><strong>{toast.title}</strong>{toast.detail&&<p>{toast.detail}</p>}</div>
    <button type="button" aria-label={'Fechar aviso: '+toast.title} onClick={()=>dismiss(toast.id)}>×</button>
  </article>;
}

export function DesktopToasts({toasts,dismiss}:{toasts:Toast[];dismiss:(id:number)=>void}){
  return createPortal(<section className="d26-toast-stack" aria-label="Avisos da operação">
    {toasts.map(toast=><ToastCard key={toast.id} toast={toast} dismiss={dismiss}/>)}
  </section>,document.body);
}
