import {ShiftQueue} from './ShiftQueue.js';
import {restaurantQueue} from './shiftQueueModel.js';
import {ProductPicture} from './ProductPhotos.js';
import {OperationsHub} from './OperationsHub.js';
import {TouchKeypad} from './TouchKeypad.js';
import {productSeal,stationLabel} from './touchModels.js';
import {noteSuggestions,toggleNote} from './desktopModels.js';
import {useOperationalEvents} from './useOperationalEvents.js';
import './pos-workspace.css';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {type CatalogProduct,type DiningTableQr,type Tab,type Order,type TableServiceCall,formatBrlCents as money,hasPermission} from '@deck26/contracts';
import {LoginScreen} from './LoginScreen.js';
import {tableSignal} from './tableSignals.js';
import './waiter.css';
type SelectedModifier=Order['items'][number]['modifiers'][number];
type WaiterView='tables'|'menu'|'cart'|'calls'|'more'|'breakfast';
type Session={token:string;name:string;userId:string;role:any};
type Item={productId:string;name:string;quantity:number;notes:string;modifiers:SelectedModifier[];price:number};
const uid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
export function MobileWaiter({qrToken}:{qrToken?:string}){
  const api=window.location.origin;
  const [session,setSession]=useState<Session|null>(null),[pin,setPin]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[connected,setConnected]=useState(false);
  const [products,setProducts]=useState<CatalogProduct[]>([]),[tables,setTables]=useState<DiningTableQr[]>([]),[tabs,setTabs]=useState<Tab[]>([]),[orders,setOrders]=useState<Order[]>([]),[table,setTable]=useState<number|null>(null),[view,setView]=useState<WaiterView>('tables'),[search,setSearch]=useState(''),[cart,setCart]=useState<Item[]>([]);
  const [custom,setCustom]=useState<CatalogProduct|null>(null),[selected,setSelected]=useState<Record<string,string[]>>({}),[notes,setNotes]=useState(''),[customer,setCustomer]=useState('');
  const [guests,setGuests]=useState(2),[openKeypad,setOpenKeypad]=useState(false),[categories,setCategories]=useState<{id:string;name:string}[]>([]);
  const [paperWorkflow,setPaperWorkflow]=useState(false);useEffect(()=>{if(session)void call('/api/ops/settings').then(d=>setPaperWorkflow(d.kitchenWorkflow==='PAPER')).catch(()=>{});},[session?.token]);
  const [serviceCalls,setServiceCalls]=useState<TableServiceCall[]>([]),[billChoice,setBillChoice]=useState(false);
  const [focusedCall,setFocusedCall]=useState<string|null>(null);
  useEffect(()=>{
    if(view!=='calls'||!focusedCall)return;
    const row=document.getElementById('d26-waiter-call-'+focusedCall);
    row?.scrollIntoView({block:'center'});
    row?.focus({preventScroll:true});
    setFocusedCall(null);
  },[view,focusedCall]);
  const [category, setCategory] = useState('all');
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [nextTable, setNextTable] = useState<number|null>(null);
  const [draftTabId, setDraftTabId] = useState<string|null>(null);
  const [customError, setCustomError] = useState('');
  const [sentAt, setSentAt] = useState<string|null>(null);
  const [now, setNow] = useState(Date.now);
  const sending = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!session) return;
    let active = true;
    void call('/api/pos/favorites').then(result => {
      if (active) setFavoriteIds(result.productIds ?? []);
    }).catch(() => {});
    return () => { active = false; };
  }, [session?.token]);
  const [pending,setPending]=useState(false);const retry=useRef<any>(null);
  const currentToken=useRef<string|undefined>(session?.token);currentToken.current=session?.token;
  const headers=()=>({'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.token}:{})});
  const call=async(url:string,body?:unknown,method?:string)=>{const r=await fetch(api+url,{method:method??(body?'POST':'GET'),headers:headers(),body:body?JSON.stringify(body):undefined});if(r.status===401&&currentToken.current===session?.token){setSession(null);setCart([]);retry.current=null;setPending(false);}const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'Não foi possível concluir.'),{status:r.status});return data;};
  const refresh=async()=>{try{if(qrToken){const data=await call('/api/public/qr-table/'+encodeURIComponent(qrToken));setProducts(data.catalog.products);setCategories(data.catalog.categories??[]);setTable(data.qrTable.tableNumber);setView(current=>current==='tables'?'menu':current);}else if(session){const data=await call('/api/state');if(currentToken.current!==session?.token)return;setProducts(data.catalog.products);setCategories(data.catalog.categories??[]);setTables(data.qrTables);setTabs(data.tabs);setOrders(data.orders);setServiceCalls(data.serviceCalls??[]);}setConnected(true);}catch(e){setConnected(false);setMessage((e as Error).message);}};
  useEffect(()=>{if(!qrToken&&!session)return;let active=true;const tick=()=>{if(active)void refresh();};tick();const timer=setInterval(tick,4000);return()=>{active=false;clearInterval(timer);};},[session?.token,qrToken]);
  useOperationalEvents(api,session?.token,!!session,()=>{void refresh();});
  const pendingStorageKey=session?'deck26-pending:'+session.userId:qrToken?'deck26-pending-qr:'+qrToken:null;
  useEffect(()=>{if(!pendingStorageKey||!products.length||retry.current)return;try{const saved=sessionStorage.getItem(pendingStorageKey);if(!saved)return;const body=JSON.parse(saved);if(!Array.isArray(body.items)||!body.idempotencyKey)return;retry.current=body;setPending(true);if(body.tableNumber)setTable(body.tableNumber);setDraftTabId(body.tabId??null);if(body.customerName)setCustomer(body.customerName);setCart(body.items.map((item:any)=>{const product=products.find(p=>p.id===item.productId);return {...item,name:product?.name??item.productId,notes:item.notes??'',modifiers:item.modifiers??[],price:product?.channelPricesCents?.[qrToken?'QR_TABLE':'DINE_IN']??product?.priceCents??0};}));setView('cart');setMessage('Existe um envio aguardando confirmação. Reenvie com a mesma identificação para evitar duplicação.');}catch{}},[pendingStorageKey,products.length]);
  useEffect(() => {
    if (qrToken || !pending || sending.current || !retry.current) return;
    const confirmed = orders.find(order => order.idempotencyKey === retry.current?.idempotencyKey);
    if (!confirmed) return;
    if (pendingStorageKey) {
      try { sessionStorage.removeItem(pendingStorageKey); } catch {}
    }
    retry.current = null;
    setPending(false);
    setCart([]);
    setDraftTabId(null);
    setSentAt(new Date(confirmed.createdAt).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}));
    setMessage('Pedido já registrado na comanda. Confira o andamento na operação.');
    setView('menu');
  }, [orders, pending, busy, pendingStorageKey, qrToken]);
  const selectedTable=tables.find(item=>item.tableNumber===table),tab=tabs.find(item=>item.id===selectedTable?.activeTabId);
  const tasks=useMemo(()=>session?restaurantQueue({qrTables:tables,tabs,orders,serviceCalls},session.role,now):[],[tables,tabs,orders,serviceCalls,session?.role,now]);
  const currentTab = !!tab && tab.id === draftTabId && tab.status !== 'CLOSED' && tab.status !== 'CANCELLED';
  const itemCount = cart.reduce((count, item) => count + item.quantity, 0);
  const minutesSince = (time: string) => Math.max(0, Math.floor((now - Date.parse(time)) / 60000));
  const navigate = (next: WaiterView) => {
    setView(next);
    window.scrollTo(0, 0);
  };
  const switchTable = (number: number) => {
    setNextTable(null);
    setTable(number);
    setCategory('all');
    setSearch('');
    navigate('menu');
  };
  const chooseTable = (number: number) => {
    if (busy || pending) return;
    if (table !== number && cart.length) {
      setNextTable(number);
      return;
    }
    switchTable(number);
  };
  if(!session&&!qrToken)return <LoginScreen pin={pin} onChange={setPin} busy={busy} error={error} testMode={false} onSubmit={()=>{setBusy(true);setError('');void fetch(api+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);if(!hasPermission(data.user.role,'orders:create'))throw Error('Seu perfil não permite lançar pedidos. Use o terminal correspondente no computador.');setSession({...data.user,token:data.token});setPin('');}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}/>;
  const add = (product: CatalogProduct, personalize = false) => {
    if (busy || pending || (!qrToken && (!tab || (cart.length && !currentTab)))) return;
    if (!cart.length && tab) setDraftTabId(tab.id);
    if (qrToken || personalize || product.modifierGroups.length) {
      setCustom(product);
      setSelected({});
      setNotes('');
      setCustomError('');
      return;
    }
    setMessage('');
    const price = product.channelPricesCents?.DINE_IN ?? product.priceCents;
    setCart(items => {
      const index = items.findIndex(item => item.productId === product.id && !item.notes && !item.modifiers.length && item.quantity < 99);
      if (index !== -1) return items.map((item, i) => i === index ? {...item,quantity:item.quantity+1} : item);
      return [...items,{productId:product.id,name:product.name,quantity:1,notes:'',modifiers:[],price}];
    });
  };
  const storageKey=session?'deck26-pending:'+session.userId:qrToken?'deck26-pending-qr:'+qrToken:null;
  const total=cart.reduce((sum,item)=>sum+item.quantity*(item.price+item.modifiers.reduce((n,m)=>n+m.priceDeltaCents,0)),0);
  return <main className={'d26-waiter view-'+view+(cart.length?' has-cart':'')+(!qrToken?' staff-terminal':'')}><header><div><strong>DECK <b>26</b></strong><small>{qrToken?'Cardápio da mesa '+table:session?.name+' · Atendimento'}</small></div><span className={connected?'connected':'disconnected'}>{connected?'Conectado':'Sem conexão'}</span>{!qrToken&&<button disabled={busy||pending||cart.length>0} onClick={()=>{setSession(null);setCart([]);setDraftTabId(null);setTable(null);setView('tables');setSentAt(null);setServiceCalls([]);setFavoriteIds([]);setProducts([]);setTabs([]);setTables([]);setOrders([]);}}>Sair</button>}</header>
    <div className="d26-waiter-heading"><div><small>{qrToken?'PEDIDO PELO QR CODE':'OPERAÇÃO LOCAL'}</small><h1>{{tables:'Mapa de mesas',menu:'Lançar pedido',cart:'Conferir pedido',calls:'Chamados',more:'Mais opções',breakfast:'Café do hóspede'}[view]}</h1></div>{!qrToken&&table!==null&&<strong className="d26-waiter-active-table">Mesa {String(table).padStart(2,'0')}</strong>}</div>
    {message&&<div role="status" className="d26-waiter-message">{message}<button onClick={()=>setMessage('')} aria-label="Fechar aviso">×</button></div>}
    {qrToken&&<section className="d26-qr-service"><strong>Precisa da equipe?</strong><div><button disabled={busy} onClick={async()=>{setBusy(true);try{await call('/api/public/qr-service-call',{qrToken,kind:'WAITER'});setMessage('Garçom chamado. A equipe recebeu o aviso da sua mesa.');}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}}>🔔 Chamar Garçom</button><button disabled={busy} onClick={()=>setBillChoice(value=>!value)}>💳 Pedir a Conta</button></div>{billChoice&&<><small>Como pretende pagar? A equipe trará a conta para conferência.</small><div>{[['CARD','Trazer maquininha'],['PIX','Vou pagar por PIX']].map(([method,label])=><button key={method} disabled={busy} onClick={async()=>{setBusy(true);try{await call('/api/public/qr-service-call',{qrToken,kind:'BILL',paymentPreference:method});setBillChoice(false);setMessage('Conta solicitada. Aguarde a equipe; nenhum pagamento foi registrado.');}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}}>{label}</button>)}</div></>}</section>}
    {!qrToken&&view==='calls'&&<section className="d26-waiter-call-list">{!serviceCalls.length&&<p>Nenhum chamado pendente.</p>}{[...serviceCalls].sort((a,b)=>Number(b.kind==='BILL')-Number(a.kind==='BILL')||a.requestedAt.localeCompare(b.requestedAt)).map(item=><article key={item.id} id={'d26-waiter-call-'+item.id} tabIndex={-1}><strong>Mesa {item.tableNumber} · {item.kind==='WAITER'?'Chamou garçom':item.paymentPreference==='PIX'?'Pediu conta / PIX':'Pediu conta / maquininha'}</strong><small>Pendente · {new Date(item.requestedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} · {minutesSince(item.requestedAt)} min de espera</small>{session&&hasPermission(session.role,'tabs:manage')&&<button disabled={busy} onClick={async()=>{setBusy(true);try{await call('/api/pos/service-calls/'+item.id+'/resolve',{});await refresh();setMessage('Solicitação assumida.');}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}}>Assumir atendimento</button>}</article>)}</section>}
    {view==='tables'&&!qrToken&&<><ShiftQueue tasks={tasks} now={now} connected={connected} onOpen={target=>{
      if(target.kind!=='table')return;
      if(target.intent==='call'||target.intent==='pay'){setFocusedCall(target.callId??null);navigate('calls');return;}
      chooseTable(target.number);
    }}/><div className="d26-waiter-legend"><span>🟢 Livre</span><span>🟡 Ocupada</span><span>🔴 Conta solicitada</span></div><div className="d26-waiter-tables">{tables.map(item=>{const signal=tableSignal(item.physicalStatus??'LIVRE'),linked=tabs.find(t=>t.id===item.activeTabId);return <button className={'d26-table-'+(serviceCalls.some(call=>call.tableNumber===item.tableNumber&&call.tabId===item.activeTabId)?'payment':signal.tone)+(serviceCalls.some(call=>call.tableNumber===item.tableNumber&&call.tabId===item.activeTabId)?' service-call':'')} key={item.tableNumber} disabled={busy||pending} aria-label={'Mesa '+String(item.tableNumber).padStart(2,'0')+' · '+signal.label} onClick={()=>chooseTable(item.tableNumber)}><strong>{String(item.tableNumber).padStart(2,'0')}</strong><span>{signal.label}</span><b>{linked?money(linked.totalCents):signal.label==='Livre'?'Pronta para receber':null}</b>{linked&&<small>{minutesSince(linked.openedAt)} min aberta</small>}{serviceCalls.some(call=>call.tableNumber===item.tableNumber&&call.tabId===item.activeTabId)&&<small>Chamado pendente</small>}{orders.some(order=>order.tabId===item.activeTabId&&order.status==='PENDING_APPROVAL')&&<small>Pedido a aprovar</small>}</button>;})}</div><section className="d26-waiter-pending"><h2>Pedidos aguardando aprovação</h2>{orders.filter(order=>order.status==='PENDING_APPROVAL').map(order=><article key={order.id}><p>Mesa {order.tableNumber} · {order.items.map(item=>item.quantity+' × '+item.productName).join(', ')}</p><button disabled={busy} onClick={async()=>{setBusy(true);try{await call('/api/orders/'+order.id+'/status',{status:'RECEIVED',originNode:'WAITER_MOBILE'},'PATCH');await refresh();setMessage('Pedido aprovado.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Conferir e aprovar</button></article>)}<h2>{paperWorkflow?'Pedidos enviados · confirmar entrega':'Prontos para servir'}</h2>{orders.filter(order=>(paperWorkflow?['RECEIVED','IN_PREPARATION','READY'].includes(order.status):order.status==='READY')).map(order=><article key={order.id}><p>Mesa {order.tableNumber} · {order.items.map(item=>item.quantity+' × '+item.productName).join(', ')}</p><button disabled={busy} onClick={async()=>{setBusy(true);try{await call('/api/orders/'+order.id+'/status',{status:'DELIVERED',originNode:'WAITER_MOBILE'},'PATCH');await refresh();setMessage('Entrega na mesa confirmada.');}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}}>Confirmar entrega na mesa</button></article>)}</section></>}
    {view==='menu'&&!qrToken&&table===null&&<section className="d26-waiter-toolbar"><p>Selecione uma mesa para começar.</p><button onClick={()=>navigate('tables')}>Selecionar mesa</button></section>}{view==='menu'&&(qrToken||table!==null)&&<><div className="d26-waiter-toolbar"><input type="search" aria-label="Buscar produto" placeholder="Buscar no cardápio…" value={search} onChange={e=>setSearch(e.target.value)}/>{!qrToken&&!selectedTable?.activeTabId&&<button disabled={busy||pending||!selectedTable||selectedTable.physicalStatus==='INDISPONIVEL'||selectedTable.physicalStatus==='LIMPEZA'} onClick={()=>setOpenKeypad(true)}>Abrir mesa {table}</button>}{tab&&<button disabled={busy||pending} onClick={async()=>{setBusy(true);try{await call('/api/tabs/'+tab.id+'/request-bill',{});await refresh();setMessage('Conta solicitada ao caixa.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Solicitar conta</button>}</div><p className="d26-waiter-caption">Mesa {table} · os preços e a disponibilidade são conferidos no servidor.</p>{!qrToken&&<div className="d26-waiter-categories" aria-label="Categorias do cardápio"><button aria-pressed={category==='all'} onClick={()=>setCategory('all')}>Todos</button>{favoriteIds.length>0&&<button aria-pressed={category==='favorites'} onClick={()=>setCategory('favorites')}>Favoritos</button>}{categories.map(entry=><button key={entry.id} aria-pressed={category===entry.id} onClick={()=>setCategory(entry.id)}>{entry.name}</button>)}</div>}<div className="d26-waiter-products">{products.filter(product=>product.active&&product.availableChannels.includes(qrToken?'QR_TABLE':'DINE_IN')&&(category==='all'||category==='favorites'&&favoriteIds.includes(product.id)||category===product.categoryId)&&(product.name+' '+product.sku).toLowerCase().includes(search.toLowerCase())).map(product=>{const seal=productSeal(product,categories.find(category=>category.id===product.categoryId)?.name);return <article key={product.id} className={'d26-seal-'+seal.tone}><small className="d26-pos-seal"><span aria-hidden="true">{seal.icon}</span> {seal.label} · {stationLabel(product.prepStation)}</small><ProductPicture product={product} className="d26-waiter-product-picture" fallback={seal.icon}/><h2>{product.name}</h2><p>{product.description}</p><div><strong>{money(product.channelPricesCents?.[qrToken?'QR_TABLE':'DINE_IN']??product.priceCents)}</strong><button disabled={busy||pending||product.availableForSale===false||(!qrToken&&(!tab||(cart.length>0&&!currentTab)))} aria-label={'Adicionar '+product.name} onClick={()=>add(product)}>+</button></div>{!qrToken&&!product.modifierGroups.length&&<button className="d26-waiter-customize" disabled={busy||pending||!tab||product.availableForSale===false||(cart.length>0&&!currentTab)} onClick={()=>add(product,true)}>Personalizar</button>}</article>;})}</div></>}
    {(view==='cart'||view==='menu'&&cart.length>0)&&<section className="d26-waiter-cart"><header><div className="d26-receipt-brand">DECK 26</div><h2>Mesa {table}</h2><small>CONFERÊNCIA · SEM VALOR FISCAL</small></header>{!cart.length&&<p>Adicione produtos ao pedido.</p>}{cart.map((item,index)=><article key={index}><div><strong>{item.name}</strong><small>{item.modifiers.map(m=>m.optionName).join(', ')}</small><input placeholder="Observação para a cozinha" maxLength={280} disabled={pending} value={item.notes} onChange={e=>setCart(items=>items.map((line,i)=>i===index?{...line,notes:e.target.value}:line))}/></div><div><small className="d26-mobile-line-price">{item.quantity} × {money(item.price+item.modifiers.reduce((sum,modifier)=>sum+modifier.priceDeltaCents,0))} = <b>{money(item.quantity*(item.price+item.modifiers.reduce((sum,modifier)=>sum+modifier.priceDeltaCents,0)))}</b></small></div><div><button aria-label={'Diminuir '+item.name} disabled={pending||item.quantity===1} onClick={()=>setCart(items=>items.map((line,i)=>i===index?{...line,quantity:line.quantity-1}:line))}>−</button><b>{item.quantity}</b><button disabled={pending||item.quantity>=99} onClick={()=>setCart(items=>items.map((line,i)=>i===index?{...line,quantity:line.quantity+1}:line))}>+</button><button disabled={pending} aria-label={'Remover '+item.name} onClick={()=>setCart(items=>items.filter((_,i)=>i!==index))}>×</button>{!qrToken&&<button disabled={pending||busy||!currentTab} onClick={()=>setCart(items=>[...items,{...item,quantity:1}])}>Repetir item</button>}</div></article>)}{qrToken&&<label>Seu nome<input value={customer} minLength={2} onChange={e=>setCustomer(e.target.value)} disabled={pending}/></label>}<div className="d26-waiter-total"><span>Itens deste pedido</span><strong>{money(total)}</strong></div><small>Serviço e eventuais descontos são conferidos na conta da mesa.</small><div className="d26-waiter-submit"><button className="d26-waiter-send" disabled={busy||!cart.length||(!qrToken&&(!currentTab&&!pending||pending&&!draftTabId))||(!!qrToken&&customer.trim().length<2)} onClick={async()=>{
      if(sending.current)return;
      sending.current=true;
      setBusy(true);setPending(true);
      if(!retry.current)retry.current={idempotencyKey:'mobile-'+uid(),...(qrToken?{qrToken,customerName:customer}:{tabId:draftTabId,tableNumber:table,channel:'DINE_IN',originNode:'WAITER_MOBILE',waiterName:session!.name}),items:cart.map(({productId,quantity,notes,modifiers})=>({productId,quantity,notes,modifiers}))};
      try{if(storageKey)try{sessionStorage.setItem(storageKey,JSON.stringify(retry.current));}catch{}const result=await call(qrToken?'/api/public/qr-orders':'/api/orders',retry.current);if(storageKey)try{sessionStorage.removeItem(storageKey);}catch{}setCart([]);setDraftTabId(null);retry.current=null;setPending(false);
      setSentAt(new Date(result.order.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}));
      await refresh();
      setMessage(result.order?.status==='PENDING_APPROVAL'?'Pedido registrado. Aguarde a aprovação da equipe.':result.printJobs?.length?'Pedido registrado. Comandas de preparo disponíveis na fila de impressão.':'Pedido registrado. Confira o andamento na operação.');
      navigate('menu');}catch(e){const failure=e as Error&{status?:number};if(failure.status&&failure.status>=400&&failure.status<500&&![401,403,429].includes(failure.status)){if(storageKey)try{sessionStorage.removeItem(storageKey);}catch{}retry.current=null;setPending(false);setMessage(failure.message);}else setMessage(failure.message+' · Reenvie o mesmo pedido quando a conexão estiver disponível.');}finally{sending.current=false;setBusy(false);}
    }}>{busy?'Enviando…':pending?'Reenviar com segurança':'Enviar '+itemCount+' '+(itemCount===1?'item':'itens')+' para a cozinha'}</button></div>{!qrToken&&cart.length>0&&!currentTab&&!pending&&<p>A comanda original mudou. Remova os itens e confira a mesa antes de lançar novamente.</p>}{!qrToken&&pending&&!draftTabId&&<p>Envio de uma versão anterior. Confira a comanda com o caixa. <button disabled={busy} onClick={()=>{
      if(!window.confirm('Já conferiu esta comanda com o caixa? Remover este envio antigo da fila local?'))return;
      if(storageKey)try{sessionStorage.removeItem(storageKey);}catch{}
      retry.current=null;setPending(false);setCart([]);setDraftTabId(null);navigate('menu');
    }}>Remover envio antigo</button></p>}{!qrToken&&!selectedTable?.activeTabId&&<p>Abra a mesa no cardápio antes de enviar.</p>}</section>}
    {view==='breakfast'&&session&&<OperationsHub api={api} headers={headers} role={session.role} userId={session.userId} products={products} scope="breakfast" onRefresh={refresh}/>}{!qrToken&&view==='more'&&<section className="d26-waiter-toolbar">{session&&hasPermission(session.role,'orders:create')&&<button onClick={()=>navigate('breakfast')}>Café do hóspede</button>}{sentAt&&<p>Último envio confirmado às {sentAt}.</p>}</section>}
    {!qrToken&&view==='menu'&&itemCount>0&&<aside className="d26-waiter-draft"><button onClick={()=>navigate('cart')}>{pending?'Conferir envio pendente':'Conferir '+itemCount+(itemCount===1?' item':' itens')} · {money(total)}</button></aside>}
    <nav aria-label="Atendimento móvel">
      {qrToken?<><button onClick={()=>navigate('menu')}>Cardápio</button><button onClick={()=>navigate('cart')}>Pedido · {itemCount}</button></>:<>
        <button aria-current={view==='tables'?'page':undefined} onClick={()=>navigate('tables')}><span aria-hidden="true">▦</span>Mesas</button>
        <button aria-current={view==='menu'||view==='cart'?'page':undefined} onClick={()=>navigate('menu')}><span aria-hidden="true">＋</span>Lançar{itemCount>0&&<b>{itemCount}</b>}</button>
        <button aria-current={view==='calls'?'page':undefined} onClick={()=>navigate('calls')}><span aria-hidden="true">◷</span>Chamados{serviceCalls.length>0&&<b>{serviceCalls.length}</b>}</button>
        <button aria-current={view==='more'||view==='breakfast'?'page':undefined} onClick={()=>navigate('more')}><span aria-hidden="true">•••</span>Mais</button>
      </>}
    </nav>
    {nextTable!==null&&<div className="d26-waiter-modal"><section role="dialog" aria-modal="true" aria-labelledby="d26-waiter-switch-heading"><h2 id="d26-waiter-switch-heading">Itens pendentes na Mesa {table}</h2><p>Há {itemCount} {itemCount===1?'item pendente':'itens pendentes'}. Descartar para ir à Mesa {nextTable}?</p><div className="d26-waiter-switch-actions"><button autoFocus onClick={()=>{setNextTable(null);navigate('menu');}}>Continuar na mesa atual</button><button onClick={()=>{setCart([]);setDraftTabId(null);switchTable(nextTable);}}>Descartar e trocar de mesa</button></div></section></div>}
    {openKeypad&&<div className="d26-waiter-modal"><section role="dialog" aria-modal="true" aria-label="Abrir mesa"><button aria-label="Fechar abertura de mesa" onClick={()=>setOpenKeypad(false)}>×</button><h2>Abrir mesa {table}</h2><div className="d26-pos-guests">{[1,2,4,6].map(value=><button key={value} aria-pressed={guests===value} onClick={()=>setGuests(value)}>{value} pessoas</button>)}</div><TouchKeypad integer label="Pessoas na mesa" digits={guests?String(guests):''} onChange={digits=>setGuests(Number(digits))} disabled={busy} confirmLabel="Abrir mesa" onConfirm={async()=>{setBusy(true);try{await call('/api/tables/open',{tableNumber:table,guestsCount:guests,waiterName:session!.name});await refresh();setOpenKeypad(false);setMessage('Mesa aberta.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}/></section></div>}{custom&&<div className="d26-waiter-modal"><section role="dialog" aria-modal="true" aria-label={'Opções de '+custom.name}><button aria-label="Fechar opções" onClick={()=>setCustom(null)}>×</button><h2>{custom.name}</h2>{custom.modifierGroups.map(group=><fieldset key={group.id}><legend>{group.name} · {group.minSelect} a {group.maxSelect}</legend>{group.options.filter(option=>option.available!==false).map(option=><label key={option.id}><input type="checkbox" checked={selected[group.id]?.includes(option.id)??false} disabled={!selected[group.id]?.includes(option.id)&&(selected[group.id]?.length??0)>=group.maxSelect} onChange={e=>setSelected({...selected,[group.id]:e.target.checked?[...(selected[group.id]??[]),option.id]:(selected[group.id]??[]).filter(id=>id!==option.id)})}/>{option.name} {option.priceDeltaCents?money(option.priceDeltaCents):''}</label>)}</fieldset>)}<div className="d26-note-chips" aria-label="Observações rápidas">{noteSuggestions(custom).map(chip=><button key={chip} aria-pressed={notes.split(';').some(value=>value.trim().toLocaleLowerCase('pt-BR')===chip.toLocaleLowerCase('pt-BR'))} onClick={()=>setNotes(current=>toggleNote(current,chip))}>{chip}</button>)}</div><label>Também pode digitar</label><textarea value={notes} onChange={e=>setNotes(e.target.value)} maxLength={280} placeholder="Observação"/>{customError&&<p role="alert">{customError}</p>}<button className="d26-waiter-send" onClick={()=>{if(custom.modifierGroups.some(group=>(selected[group.id]?.length??0)<group.minSelect)){setCustomError('Selecione as opções obrigatórias.');return;}const modifiers:SelectedModifier[]=custom.modifierGroups.flatMap(group=>group.options.filter(option=>selected[group.id]?.includes(option.id)).map(option=>({groupId:group.id,groupName:group.name,optionId:option.id,optionName:option.name,priceDeltaCents:option.priceDeltaCents})));setCart(items=>[...items,{productId:custom.id,name:custom.name,quantity:1,notes,modifiers,price:custom.channelPricesCents?.[qrToken?'QR_TABLE':'DINE_IN']??custom.priceCents}]);setCustom(null);setMessage('Item adicionado ao pedido.');}}>Adicionar ao pedido</button></section></div>}
  </main>;
}
