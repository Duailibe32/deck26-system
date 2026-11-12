import React,{useEffect,useRef,useState} from 'react';
import {formatBrlCents as money,type CatalogProduct,type Order,type Tab} from '@deck26/contracts';
import {randomBrowserId} from './browserIds.js';
import './order-corrections.css';

type Action='REMOVE'|'NOTE'|'REPLACE';
type Outcome='STOPPED'|'ALREADY_PREPARED'|'NOTED';
type Correction={
  id:string;tabCode:string;orderId:string;itemName:string;action:Action;quantity:number;remaining:number;
  reason:string;operator:string;at:string;notes?:string;replacementName?:string;requiresKitchenConfirmation:boolean;
  acknowledgment:null|{operator:string;outcome:Outcome};
};
type Input={tabId:string;itemId:string;reason:string;change:
  {action:'REMOVE';quantity:number}|{action:'NOTE';notes:string}|
  {action:'REPLACE';quantity:number;notes:string;productId:string;options:{groupId:string;optionId:string}[]}};
type Quote={currentTotalCents:number;expectedTotalCents:number;tabVersion:number;orderVersion:number};
type Pending={orderId:string;body:Input&{requestId:string;tabVersion:number;orderVersion:number;expectedTotalCents:number}};
type Headers=()=>Record<string,string>;
const outcomes:Record<Outcome,string>={STOPPED:'Preparo interrompido',ALREADY_PREPARED:'Já preparado',NOTED:'Observação recebida'};
const time=(at:string)=>new Date(at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

async function request<T>(api:string,headers:Headers,url:string,body?:unknown):Promise<T>{
  const response=await fetch(api+url,{headers:headers(),method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.error||'Não foi possível concluir.'),{status:response.status});
  return data;
}

function CorrectionDescription({correction}:{correction:Correction}){
  const {action,quantity,itemName,remaining,notes,replacementName}=correction;
  return <>
    <strong>{correction.tabCode} · Pedido {correction.orderId.slice(0,8).toUpperCase()}</strong>
    <p>{action==='NOTE'?<>Nova observação para <b>{quantity} × {itemName}</b><br/>{notes||'Retirar observação anterior'}</>:
      <>Cancelar <b>{quantity} × {itemName}</b>{remaining>0&&<> · Manter {remaining}</>}{replacementName&&<><br/>Substituir por {replacementName}</>}</>}</p>
    <small>{time(correction.at)} · {correction.operator} · {correction.reason}</small>
  </>;
}

export function KitchenCorrections({api,headers}:{api:string;headers:Headers}){
  const [corrections,setCorrections]=useState<Correction[]>([]);
  const [busy,setBusy]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{
    let active=true;
    const load=()=>void request<Correction[]>(api,headers,'/api/order-corrections').then(data=>{if(active)setCorrections(data);}).catch(()=>{});
    load();
    const timer=setInterval(load,4000);
    return()=>{active=false;clearInterval(timer);};
  },[api]);
  const confirm=async(id:string,outcome:Outcome)=>{
    setBusy(id);setMessage('');
    try{
      await request(api,headers,'/api/order-corrections/'+id+'/acknowledge',{outcome});
      setCorrections(items=>items.filter(item=>item.id!==id));
      setMessage('Correção confirmada.');
    }catch(error){setMessage((error as Error).message);}
    finally{setBusy('');}
  };
  if(!corrections.length&&!message)return null;
  return <section className="d26-correction-alert" aria-label="Correções da cozinha">
    <h3>Correções a conferir</h3>
    {corrections.map(correction=><article key={correction.id}>
      <CorrectionDescription correction={correction}/>
      <div className="d26-correction-actions">{(correction.action==='NOTE'?['NOTED']:['STOPPED','ALREADY_PREPARED'] as Outcome[]).map(value=>{
        const outcome=value as Outcome;
        return <button key={outcome} className="d26-btn d26-btn-secondary" disabled={!!busy} onClick={()=>void confirm(correction.id,outcome)}>{outcomes[outcome]}</button>;
      })}</div>
    </article>)}
    {message&&<p role="status">{message}</p>}
  </section>;
}

export function OrderCorrectionPanel({api,headers,tab,orders,products,canCorrect,userId,refresh}:{
  api:string;headers:Headers;tab:Tab;orders:Order[];products:CatalogProduct[];canCorrect:boolean;userId:string;refresh:()=>Promise<void>;
}){
  const key='deck26:correction:'+userId+':'+tab.id;
  const [pending,setPending]=useState<Pending|null>(()=>{
    try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}
  });
  const [history,setHistory]=useState<Correction[]>([]),[itemId,setItemId]=useState('');
  const [action,setAction]=useState<Action>('REMOVE'),[quantity,setQuantity]=useState('1');
  const [reason,setReason]=useState(''),[notes,setNotes]=useState(''),[productId,setProductId]=useState('');
  const [options,setOptions]=useState<Record<string,string[]>>({}),[query,setQuery]=useState('');
  const [preview,setPreview]=useState<{orderId:string;input:Input;quote:Quote}|null>(null);
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const sending=useRef(false);
  const historyUrl='/api/order-corrections?tabId='+encodeURIComponent(tab.id);
  useEffect(()=>{
    let active=true;
    const load=()=>void request<Correction[]>(api,headers,historyUrl).then(data=>{if(active)setHistory(data);}).catch(()=>{});
    load();
    const timer=setInterval(load,4000);
    return()=>{active=false;clearInterval(timer);};
  },[api,historyUrl]);
  const choices=orders.filter(order=>['RECEIVED','IN_PREPARATION','READY'].includes(order.status))
    .flatMap(order=>order.items.filter(item=>item.status!=='CANCELLED'&&!item.paidQuantity&&!item.transferredAt).map(item=>({order,item})));
  const selected=choices.find(choice=>choice.item.id===itemId);
  const replacement=products.find(product=>product.id===productId);
  const filtered=products.filter(product=>selected&&product.active&&product.id!==selected.item.productId&&
    product.availableChannels.includes(selected.order.channel)&&product.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const change=()=>{
    if(action==='NOTE')return {action,notes} as const;
    if(action==='REMOVE')return {action,quantity:Number(quantity)} as const;
    return {action,quantity:Number(quantity),productId,notes,options:Object.entries(options).flatMap(([groupId,ids])=>ids.map(optionId=>({groupId,optionId})))} as const;
  };
  const calculate=async(event:React.FormEvent)=>{
    event.preventDefault();if(!selected||busy)return;
    const input:Input={tabId:tab.id,itemId,reason:reason.trim(),change:change()};
    setBusy(true);setMessage('');
    try{
      const quote=await request<Quote>(api,headers,'/api/orders/'+selected.order.id+'/corrections/preview',input);
      setPreview({orderId:selected.order.id,input,quote});
    }catch(error){setMessage((error as Error).message);}
    finally{setBusy(false);}
  };
  const confirm=async()=>{
    if(sending.current||(!pending&&!preview))return;
    const attempt=pending??{orderId:preview!.orderId,body:{...preview!.input,requestId:randomBrowserId(),
      tabVersion:preview!.quote.tabVersion,orderVersion:preview!.quote.orderVersion,expectedTotalCents:preview!.quote.expectedTotalCents}};
    sending.current=true;setBusy(true);setPending(attempt);setMessage('');
    try{sessionStorage.setItem(key,JSON.stringify(attempt));}catch{}
    const clearPending=()=>{setPending(null);try{sessionStorage.removeItem(key);}catch{}};
    try{
      const result=await request<{printJobIds:string[]}>(api,headers,'/api/orders/'+attempt.orderId+'/corrections',attempt.body);
      clearPending();setPreview(null);setItemId('');setReason('');
      setMessage(result.printJobIds.length?'Correção registrada. A via entrou na fila da cozinha.':'Correção registrada na comanda.');
      await Promise.allSettled([refresh(),request<Correction[]>(api,headers,historyUrl).then(setHistory)]);
    }catch(error){
      const failure=error as Error&{status?:number};
      if(failure.status===400||failure.status===409){clearPending();setPreview(null);await refresh().catch(()=>{});}
      setMessage(failure.message);
    }finally{sending.current=false;setBusy(false);}
  };
  return <section className="d26-pos-detail d26-order-corrections">
    <h3>Corrigir pedido enviado</h3>
    {message&&<p role="status">{message}</p>}
    {canCorrect&&(pending||preview)?<div className="d26-correction-alert">
      {preview&&<p>Comanda atual <strong>{money(preview.quote.currentTotalCents)}</strong> · Após a correção <strong>{money(preview.quote.expectedTotalCents)}</strong></p>}
      {pending&&<p>Envio aguardando confirmação. Reenvie a correção original.</p>}
      <div className="d26-correction-actions">
        {!pending&&<button className="d26-btn d26-btn-secondary" disabled={busy} onClick={()=>setPreview(null)}>Voltar</button>}
        <button className="d26-pos-primary" disabled={busy} onClick={()=>void confirm()}>{busy?'Registrando…':pending?'Reenviar correção original':'Confirmar correção'}</button>
      </div>
    </div>:canCorrect&&!tab.paidCents&&choices.length>0?<form onSubmit={calculate}>
      <label>Item do pedido<select className="d26-input" required value={itemId} onChange={event=>{
        const choice=choices.find(row=>row.item.id===event.target.value);
        setItemId(event.target.value);setAction('REMOVE');setQuantity('1');setNotes(choice?.item.notes??'');setProductId('');setOptions({});setQuery('');
      }}><option value="">Selecione um item</option>{choices.map(({order,item})=><option key={item.id} value={item.id}>{item.quantity} × {item.productName} · #{order.id.slice(0,8)}</option>)}</select></label>
      {selected&&<>
        <label>O que mudou?<select className="d26-input" value={action} onChange={event=>{
          const next=event.target.value as Action;
          setAction(next);setNotes(next==='NOTE'?selected.item.notes??'':'');
        }}>
          <option value="REMOVE">Cancelar ou reduzir quantidade</option>{selected.item.prepStation!=='NONE'&&<option value="NOTE">Alterar observação</option>}<option value="REPLACE">Trocar por outro produto</option>
        </select></label>
        {action!=='NOTE'&&<label>Quantidade a {action==='REPLACE'?'trocar':'cancelar'}<input className="d26-input" type="number" inputMode="numeric" min={1} max={selected.item.quantity} required value={quantity} onChange={event=>setQuantity(event.target.value)}/></label>}
        {action==='REPLACE'&&<>
          <label>Buscar substituto<input className="d26-input" value={query} onChange={event=>setQuery(event.target.value)}/></label>
          <label>Novo produto<select className="d26-input" required value={productId} onChange={event=>{setProductId(event.target.value);setOptions({});}}>
            <option value="">Selecione o substituto</option>{filtered.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}
          </select></label>
          {replacement?.modifierGroups.map(group=><fieldset key={group.id}><legend>{group.name} · {group.minSelect} a {group.maxSelect}</legend>
            {group.options.filter(option=>option.available!==false).map(option=><label className="d26-correction-option" key={option.id}>
              <input type="checkbox" checked={options[group.id]?.includes(option.id)??false} onChange={event=>{
                const current=options[group.id]??[];
                if(event.target.checked&&group.maxSelect!==1&&current.length>=group.maxSelect)return;
                setOptions({...options,[group.id]:event.target.checked?(group.maxSelect===1?[option.id]:[...current,option.id]):current.filter(id=>id!==option.id)});
              }}/>{option.name}
            </label>)}
          </fieldset>)}
        </>}
        {action!=='REMOVE'&&<label>{action==='NOTE'?'Nova observação':'Observação do substituto'}<textarea className="d26-input" maxLength={280} value={notes} onChange={event=>setNotes(event.target.value)}/></label>}
        <label>Motivo da correção<input className="d26-input" required minLength={3} maxLength={280} value={reason} onChange={event=>setReason(event.target.value)}/></label>
        <small>Confirme com a cozinha o que já foi preparado antes de ajustar o estoque.</small>
        <button className="d26-pos-primary" disabled={busy}>Conferir novo total</button>
      </>}
    </form>:<p>{canCorrect?'As correções exigem um item enviado e uma comanda aberta sem pagamentos.':'Peça ao gerente ou proprietário para corrigir um item.'}</p>}
    {history.map(correction=><article key={correction.id}>
      <CorrectionDescription correction={correction}/>
      <small>{correction.acknowledgment?outcomes[correction.acknowledgment.outcome]+' · '+correction.acknowledgment.operator:
        correction.requiresKitchenConfirmation?'Aguardando conferência da cozinha':'Registrado na comanda'}</small>
    </article>)}
  </section>;
}
