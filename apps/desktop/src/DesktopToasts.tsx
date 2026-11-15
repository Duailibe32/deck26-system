import React, {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {DesktopAlert} from './desktopAlerts.js';
import {MenuIcon} from './MenuIcon.js';
import './desktop-toasts.css';

type Toast=DesktopAlert&{id:number};

export function useDesktopToasts(){
  const [toasts,setToasts]=useState<Toast[]>([]);
  const next=useRef(0);
  const dismiss=(id:number)=>setToasts(items=>items.filter(item=>item.id!==id));
  const push=(alert:DesktopAlert)=>{
    const toast={...alert,id:++next.current};
    setToasts(items=>items.some(item=>alert.key&&item.key===alert.key)?items:[...items.slice(-2),toast]);
  };
  return {toasts,dismiss,push};
}

function ToastCard({toast,dismiss}:{toast:Toast;dismiss:(id:number)=>void}){
  const onDismiss=useRef(dismiss);
  onDismiss.current=dismiss;
  const [paused,setPaused]=useState(false);
  useEffect(()=>{
    if(paused)return;
    const timer=setTimeout(()=>onDismiss.current(toast.id),toast.tone==='info'?6500:11000);
    return ()=>clearTimeout(timer);
  },[toast.id,toast.tone,paused]);
  const icons={waiter:'bell',bill:'receipt',order:'dish',delivery:'delivery',print:'print',stock:'stock'} as const;
  return <article className="d26-toast" data-tone={toast.tone} data-kind={toast.kind}
    onMouseEnter={()=>setPaused(true)} onMouseLeave={event=>setPaused(event.currentTarget.contains(document.activeElement))}
    onFocus={()=>setPaused(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget)&&!event.currentTarget.matches(':hover'))setPaused(false);}}>
    <span className="d26-toast-icon"><MenuIcon name={toast.kind?icons[toast.kind]:toast.tone==='info'?'check':'warning'}/></span>
    <div><div role={toast.tone==='error'?'alert':'status'}><strong>{toast.title}</strong>{toast.detail&&<p>{toast.detail}</p>}</div>
      {toast.action&&<button type="button" className="d26-toast-action" onClick={()=>{toast.action?.run();dismiss(toast.id);}}>
        {toast.action.label}<MenuIcon name="arrow"/></button>}</div>
    <button type="button" aria-label={'Fechar aviso: '+toast.title} onClick={()=>dismiss(toast.id)}><MenuIcon name="close"/></button>
  </article>;
}

export function DesktopToasts({toasts,dismiss,mobile=false}:{toasts:Toast[];dismiss:(id:number)=>void;mobile?:boolean}){
  return createPortal(<section className={'d26-toast-stack'+(mobile?' d26-toast-mobile':'')} aria-label="Avisos da operação">
    {toasts.map(toast=><ToastCard key={toast.id} toast={toast} dismiss={dismiss}/>)}
  </section>,document.body);
}
