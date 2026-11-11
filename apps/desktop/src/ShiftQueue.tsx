import React, { useEffect, useState } from 'react';
import type { ShiftGroup, ShiftTarget, ShiftTask } from './shiftQueueModel.js';
import './shift-queue.css';

const groupLabels: Record<ShiftGroup, { label: string; icon: string }> = {
  service:{label:'Salão',icon:'◷'}, payment:{label:'Contas',icon:'$'},
  delivery:{label:'Pedidos online',icon:'↗'}, printing:{label:'Impressão',icon:'▤'},
  departure:{label:'Saídas',icon:'→'}, rooms:{label:'Quartos',icon:'▦'}
};

export function useShiftClock(enabled: boolean) {
  const [now,setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

export function ShiftQueue({tasks,connected,now,onOpen,title='Pendências do turno'}:{
  tasks: ShiftTask[]; connected: boolean; now: number; onOpen: (target: ShiftTarget) => void; title?: string;
}) {
  const [expanded,setExpanded] = useState(false);
  const [group,setGroup] = useState<ShiftGroup | null>(null);
  const counts = new Map<ShiftGroup,number>();
  let total=0;
  for (const task of tasks) {
    const count=task.count??1;
    counts.set(task.group,(counts.get(task.group)??0)+count);
    total+=count;
  }
  const activeGroup = group && counts.has(group) ? group : null;
  const selected = activeGroup ? tasks.filter(task => task.group === activeGroup) : tasks;
  return <section className="d26-shift-queue" aria-label={title}>
    <header>
      <div><h2>{title}</h2><p>{tasks.length ? 'Abra uma pendência para continuar o atendimento.' : connected ? 'Nenhuma pendência no momento.' : 'Aguardando atualização do servidor.'}</p></div>
      <span className="d26-shift-queue-status" data-connected={connected}>{connected?'Operação conectada':'Sem atualização'}</span>
    </header>
    {counts.size>0&&<div className="d26-shift-queue-filters" aria-label="Filtrar pendências">
      <button type="button" aria-pressed={activeGroup===null} onClick={()=>setGroup(null)}>Todas <b>{total}</b></button>
      {[...counts].map(([key,count])=><button type="button" key={key} aria-pressed={activeGroup===key} onClick={()=>setGroup(key)}>
        {groupLabels[key].label} <b>{count}</b>
      </button>)}
    </div>}
    {selected.length>0&&<ul>
      {(expanded?selected:selected.slice(0,4)).map(task=>{
        const elapsed=task.since?Math.max(0,Math.floor((now-Date.parse(task.since))/60_000)):NaN;
        return <li key={task.id}><button type="button" onClick={()=>onOpen(task.target)}>
          <span className="d26-shift-queue-icon" data-priority={task.priority} aria-hidden="true">{groupLabels[task.group].icon}</span>
          <span className="d26-shift-queue-task"><strong>{task.title}</strong><small>{task.detail}{Number.isFinite(elapsed)?' · '+elapsed+' min':''}</small></span>
          <span aria-hidden="true">›</span>
        </button></li>;
      })}
    </ul>}
    {selected.length>4&&<button type="button" className="d26-shift-queue-more" onClick={()=>setExpanded(value=>!value)}>
      {expanded?'Mostrar menos':'Ver mais pendências'}
    </button>}
  </section>;
}
