import React,{useEffect,useRef,useState} from 'react';
import {hasPermission,type UserRole} from '@deck26/contracts';
import {MenuIcon} from './MenuIcon.js';
import {useOperationalEvents} from './useOperationalEvents.js';
import './service-board.css';

type Call={id:string;tableNumber:number;kind:'WAITER'|'BILL';paymentPreference?:'PIX'|'CARD';requestedAt:string;
  assignedAt:string|null;resolvedAt:string|null;assignee:string|null;assigneeId:string|null;completedBy:string|null;
  status:'WAITING'|'ASSIGNED'|'DONE'|'ENDED';waitSeconds:number};
type History={total:number;completed:number;withoutHandling:number;averageSeconds:number|null;
  hours:{hour:number;count:number}[];tables:{tableNumber:number;calls:number;longestSeconds:number}[];recent:Call[]};
const duration=(seconds:number)=>Math.floor(seconds/60)+' min '+String(seconds%60).padStart(2,'0')+' s';
const time=(value:string)=>new Date(value).toLocaleString('pt-BR',{timeZone:'America/Fortaleza',dateStyle:'short',timeStyle:'short'});
const kind=(call:Call)=>call.kind==='WAITER'?'Chamou o garçom':'Pediu a conta'+(call.paymentPreference==='PIX'?' · PIX':call.paymentPreference==='CARD'?' · maquininha':'');
export function ServiceBoard({api,token,userId,role,focusedId}:{api:string;token:string;userId:string;role:UserRole;focusedId?:string|null}){
  const [days,setDays]=useState('7'),[showHistory,setShowHistory]=useState(false);
  const [data,setData]=useState<{pending:Call[];history:History|null}>();
  const [message,setMessage]=useState(''),[busy,setBusy]=useState('');
  const [now,setNow]=useState(Date.now);
  const sequence=useRef(0);
  const canReport=hasPermission(role,'reports:view');
  const request=async(url:string,post=false)=>{
    const response=await fetch(api+url,{method:post?'POST':'GET',headers:{Authorization:'Bearer '+token}});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Não foi possível atualizar os chamados.');
    return result;
  };
  const refresh=async()=>{
    const id=++sequence.current;
    try{
      const result=await request('/api/pos/service-board?days='+days+(showHistory?'&history=1':''));
      if(id===sequence.current){setData(result);setNow(Date.now());}
    }catch(error){if(id===sequence.current)setMessage((error as Error).message);}
  };
  useEffect(()=>{
    void refresh();
    const timer=setInterval(()=>void refresh(),4000);
    const clock=setInterval(()=>setNow(Date.now()),1000);
    return()=>{clearInterval(timer);clearInterval(clock);sequence.current++;};
  },[api,token,days,showHistory]);
  useOperationalEvents(api,token,true,()=>void refresh());
  const pending=data?.pending??[];
  useEffect(()=>{
    if(!focusedId)return;
    const target=document.getElementById('d26-service-'+focusedId);
    if(target){target.scrollIntoView({block:'nearest'});target.focus({preventScroll:true});}
  },[focusedId,pending.some(call=>call.id===focusedId)]);
  const wait=(call:Call)=>call.status==='WAITING'?Math.max(0,Math.floor((now-Date.parse(call.requestedAt))/1000)):call.waitSeconds;
  const overdue=pending.filter(call=>call.status==='WAITING'&&wait(call)>=120).length;
  const change=async(call:Call,action:'assign'|'complete')=>{
    setBusy(call.id);setMessage('');
    try{await request('/api/pos/service-board/'+call.id+'/'+action,true);await refresh();}
    catch(error){await refresh();setMessage((error as Error).message);}
    finally{setBusy('');}
  };
  return <section className="d26-service-board" aria-label="Painel de chamados">
    <header><div><h2>Chamados do salão</h2><small>{data?pending.length+' em aberto':'Atualizando chamados'}</small></div>
      {!!overdue&&<strong className="d26-service-overdue" role="status">{overdue} há 2 min ou mais sem responsável</strong>}
      {canReport&&<button className="d26-btn d26-btn-secondary" aria-expanded={showHistory} onClick={()=>setShowHistory(!showHistory)}>{showHistory?'Fechar histórico':'Histórico'}</button>}
    </header>
    {message&&<p role="status">{message}</p>}
    {data&&!pending.length&&<p>Nenhum chamado em aberto.</p>}
    {pending.map(call=><article key={call.id} id={'d26-service-'+call.id} tabIndex={-1}
      data-overdue={call.status==='WAITING'&&wait(call)>=120}>
      <div><strong><MenuIcon name={call.kind==='BILL'?'receipt':'bell'}/> Mesa {String(call.tableNumber).padStart(2,'0')}</strong>
        <p>{kind(call)}</p><small>{call.assignee?'Com '+call.assignee+' · assumido em '+duration(wait(call)):'Aguardando há '+duration(wait(call))}</small></div>
      {call.status==='WAITING'?<button className="d26-btn d26-btn-primary" disabled={!!busy} onClick={()=>void change(call,'assign')}>Assumir</button>:
        (call.assigneeId===userId||canReport)&&<button className="d26-btn d26-btn-secondary" disabled={!!busy} onClick={()=>void change(call,'complete')}>Concluir</button>}
    </article>)}
    {canReport&&showHistory&&<div className="d26-service-history">
      <label>Período <select className="d26-input" value={days} onChange={event=>setDays(event.target.value)}>
        <option value="1">Últimas 24 horas</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option>
      </select></label>
      {data?.history?<><p><strong>{data.history.total}</strong> chamados · <strong>{data.history.completed}</strong> concluídos · <strong>{data.history.withoutHandling}</strong> encerrados sem responsável</p>
        <p>Espera média até assumir <strong>{data.history.averageSeconds===null?'—':duration(data.history.averageSeconds)}</strong></p>
        <div className="d26-service-history-grid">
          <div><h3>Horários mais movimentados</h3>{data.history.hours.map(item=><p key={item.hour}>{String(item.hour).padStart(2,'0')}h · {item.count} chamados</p>)}</div>
          <div><h3>Maiores esperas até assumir</h3>{data.history.tables.map(item=><p key={item.tableNumber}>Mesa {item.tableNumber} · {duration(item.longestSeconds)} · {item.calls} assumidos</p>)}</div>
        </div><h3>Atendimentos encerrados</h3>
        {data.history.recent.map(call=><article key={call.id}><div><strong>Mesa {call.tableNumber} · {kind(call)}</strong>
          <small>{time(call.requestedAt)} · {call.assignee?'Assumido por '+call.assignee+' em '+duration(call.waitSeconds):'Sem responsável'} · {call.status==='DONE'?'Concluído'+(call.completedBy?' por '+call.completedBy:''):'Comanda encerrada'}</small></div></article>)}
      </>:<p>Carregando histórico…</p>}
    </div>}
  </section>;
}
