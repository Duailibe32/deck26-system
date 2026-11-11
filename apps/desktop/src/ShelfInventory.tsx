import React,{useEffect,useRef,useState} from 'react';
import type {CatalogProduct} from '@deck26/contracts';
import {randomBrowserId} from './browserIds.js';

type Line={productId:string;shelf:string;quantity:number;expectedQuantity:number};
type Inventory={idempotencyKey:string;lines:Line[]};
const display=(value:number)=>value.toLocaleString('pt-BR',{maximumFractionDigits:3});
const normalized=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');

export function ShelfInventory({api,headers,userId,products,balance,refresh}:{
  api:string;headers:()=>Record<string,string>;userId:string;products:CatalogProduct[];
  balance:(id:string)=>number;refresh:()=>Promise<void>;
}){
  const storageKey='deck26:shelf-inventory:'+userId;
  const [saved]=useState<{lines?:Line[];pending?:Inventory|null}>(()=>{
    try{return JSON.parse(sessionStorage.getItem(storageKey)||'{}')??{};}catch{return {};}
  });
  const [lines,setLines]=useState(saved.pending?.lines??saved.lines??[]);
  const [pending,setPending]=useState<Inventory|null>(saved.pending??null);
  const [review,setReview]=useState(!!saved.pending);
  const [shelf,setShelf]=useState(''),[search,setSearch]=useState('');
  const [selected,setSelected]=useState(''),[amount,setAmount]=useState('');
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [allShelves,setAllShelves]=useState(false);
  const sending=useRef(false);
  useEffect(()=>{
    try{
      if(lines.length||pending)sessionStorage.setItem(storageKey,JSON.stringify({lines,pending}));
      else sessionStorage.removeItem(storageKey);
    }catch{}
  },[lines,pending,storageKey]);

  const query=normalized(search.trim());
  const results=query?products.filter(product=>normalized([product.name,product.sku,product.barcode??''].join(' ')).includes(query)).slice(0,8):[];
  const product=products.find(item=>item.id===selected);
  const totals=new Map<string,{count:number;expected:number;name:string}>();
  for(const line of lines){
    const total=totals.get(line.productId)??{
      count:0,expected:line.expectedQuantity,name:products.find(item=>item.id===line.productId)?.name??line.productId
    };
    total.count+=Math.round(line.quantity*1000);
    totals.set(line.productId,total);
  }
  const stale=[...totals].filter(([id,total])=>Math.abs(balance(id)-total.expected)>0.000001);
  const differences=[...totals].filter(([,total])=>Math.round(total.expected*1000)!==total.count);
  const record=(event:React.FormEvent)=>{
    event.preventDefault();
    const raw=amount.trim();
    const quantity=Number(raw.replace(',','.'));
    const shelfName=shelf.trim();
    if(!product||!shelfName||!/^\d+(?:[.,]\d{1,3})?$/.test(raw)||quantity>1000000)return;
    const previous=totals.get(product.id);
    const remaining=lines.filter(line=>line.productId!==product.id||normalized(line.shelf)!==normalized(shelfName));
    if(remaining.length>=600){setMessage('Este inventário já atingiu o limite de 600 contagens.');return;}
    setLines([...remaining,{productId:product.id,shelf:shelfName,quantity,expectedQuantity:previous?.expected??balance(product.id)}]);
    setAmount('');setSelected('');setSearch('');setMessage('Contagem guardada na prateleira '+shelfName+'.');
  };
  const submit=async()=>{
    if(sending.current||!pending&&(!allShelves||stale.length>0||!lines.length))return;
    sending.current=true;setBusy(true);setMessage('');
    const body=pending??{idempotencyKey:'inventory-'+randomBrowserId(),lines};
    setPending(body);
    try{sessionStorage.setItem(storageKey,JSON.stringify({lines,pending:body}));}catch{}
    try{
      const response=await fetch(api+'/api/ops/shelf-inventory',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok){
        if(response.status===400){setPending(null);setAllShelves(false);await refresh().catch(()=>{});}
        throw Error(result.error||'Não foi possível confirmar o inventário.');
      }
      setPending(null);setLines([]);setReview(false);setAllShelves(false);
      setMessage(result.products+' produtos conferidos. '+result.adjusted+' saldos ajustados.');
      await refresh().catch(()=>{});
    }catch(error){setMessage((error as Error).message);}
    finally{sending.current=false;setBusy(false);}
  };
  return <section className="d26-shelf-inventory">
    <h3>Inventário por prateleira</h3>
    {message&&<p role="status" className="d26-stock-message">{message}</p>}
    {!review?<><form onSubmit={record}>
      <label>Prateleira ou local<input required maxLength={60} value={shelf} onChange={event=>setShelf(event.target.value)} placeholder="Ex. Bebidas · Prateleira 2"/></label>
      <label>Nome, SKU ou código de barras<input value={search} onChange={event=>{
        const value=event.target.value;
        setSearch(value);
        const exact=products.filter(item=>item.barcode&&item.barcode===value.trim());
        setSelected(exact.length===1?exact[0]!.id:'');
      }}/></label>
      {!!results.length&&<div className="d26-stock-actions">{results.map(item=><button type="button" key={item.id} aria-pressed={selected===item.id} onClick={()=>{setSelected(item.id);setSearch(item.name);}}>{item.name}</button>)}</div>}
      {product&&<label>Quantidade encontrada ({product.unitOfMeasure??'UN'})<input required inputMode="decimal" maxLength={11} value={amount} onChange={event=>setAmount(event.target.value)}/></label>}
      <button className="primary" disabled={!product}>Guardar contagem</button>
    </form>
    <ul>{lines.map(line=><li key={JSON.stringify([line.productId,line.shelf])}>
      <span>{line.shelf} · {totals.get(line.productId)?.name} · {display(line.quantity)}</span>
      <button onClick={()=>setLines(items=>items.filter(item=>item!==line))}>Remover</button>
    </li>)}</ul>
    <button className="primary" disabled={!lines.length} onClick={()=>{setReview(true);setAllShelves(false);}}>Revisar divergências</button></>:<>
      <p>{totals.size} produtos contados. {differences.length} com diferença.</p>
      {!!stale.length&&!pending&&<div className="d26-stock-message" role="alert"><strong>O saldo mudou durante a contagem.</strong><ul>{stale.map(([id,total])=><li key={id}>
        <span>{total.name} · saldo atual {display(balance(id))}</span>
        <button onClick={()=>{setLines(items=>items.filter(item=>item.productId!==id));setReview(false);setSearch(total.name);}}>Recontar produto</button>
      </li>)}</ul></div>}
      <ul>{differences.map(([id,total])=><li key={id}><strong>{total.name}</strong><span>Saldo {display(total.expected)} · contado {display(total.count/1000)}</span></li>)}</ul>
      {!pending&&<label className="d26-shelf-confirm"><input type="checkbox" checked={allShelves} onChange={event=>setAllShelves(event.target.checked)}/> Conferi todos os locais dos produtos contados.</label>}
      {pending&&<p>Envio aguardando confirmação. Reenvie a mesma contagem para recuperar o resultado.</p>}
      <div className="d26-stock-actions">
        <button disabled={busy||!!pending} onClick={()=>setReview(false)}>Voltar à contagem</button>
        <button className="primary" disabled={busy||!pending&&(!allShelves||!!stale.length||!lines.length)} onClick={()=>void submit()}>
          {busy?'Conferindo…':pending?'Reenviar inventário original':'Confirmar inventário'}
        </button>
      </div>
    </>}
  </section>;
}
