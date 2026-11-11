import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Deck26Logo } from '@deck26/ui';
import { formatBrlCents as money, resolveChannelPriceCents, type CatalogProduct, type CatalogCategory, type Order } from '@deck26/contracts';
import { noteSuggestions, toggleNote } from './desktopModels.js';
import { productSeal } from './touchModels.js';
import './customer-menu.css';
import './delivery-experience.css';
import {ProductPicture} from './ProductPhotos.js';
import './stock-workspace.css';
import {CustomerDeliveryTimeline} from './CustomerDeliveryTimeline.js';
type Modifier = Order['items'][number]['modifiers'][number];
type Line = {
  id: string;
  productId: string;
  quantity: number;
  notes: string;
  modifiers: Modifier[];
};
const endpointFor=(qr?:string)=>qr?'/api/public/menu/'+encodeURIComponent(qr):'/api/public/delivery/catalog';
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function CustomerMenu({
  qrToken
}: {
  qrToken?: string;
}) {
  const draftKey = 'deck26:customer:draft:' + (qrToken ?? 'delivery');
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [view, setView] = useState<'menu' | 'cart' | 'status' | 'service'>('menu'),
    [category, setCategory] = useState('ALL'),
    [search, setSearch] = useState(''),
    [cart, setCart] = useState<Line[]>(() => {
      try {
        const value = JSON.parse(sessionStorage.getItem(draftKey) || '[]');
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    }),
    [custom, setCustom] = useState<CatalogProduct | null>(null),
    [notes, setNotes] = useState(''),
    [mods, setMods] = useState<Record<string, string[]>>({});
  const [name, setName] = useState(''),
    [phone, setPhone] = useState(''),
    [kind, setKind] = useState('DELIVERY'),
    [zone, setZone] = useState(''),
    [address, setAddress] = useState({
      street: '',
      number: '',
      neighborhood: '',
      city: '',
      complement: '',
      reference: ''
    }),
    [method, setMethod] = useState('PIX'),
    [cash, setCash] = useState(''),
    [status, setStatus] = useState<any>(null),
    [billChoice, setBillChoice] = useState(false);
  const [cep,setCep]=useState(''),[cepMessage,setCepMessage]=useState(''),[cepBusy,setCepBusy]=useState(false);
  const [lastItems, setLastItems] = useState<Line[]>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey + ':last-items') ?? '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const rememberItems = (items: Line[]) => {
    const copy = items.map(item => ({...item, notes: ''}));
    setLastItems(copy);
    try { sessionStorage.setItem(draftKey + ':last-items', JSON.stringify(copy)); } catch {}
  };
  const [trackingKey,setTrackingKey]=useState<string|null>(()=>{try{return sessionStorage.getItem('deck26:customer:last:'+endpointFor(qrToken));}catch{return null;}});
  const pending = useRef<any>(null);
  const submitting = useRef(false);
  const menuPosition = useRef(0);
  const previousView = useRef(view);
  const navigate = (next: typeof view) => {
    if (view === 'menu' && next !== 'menu') menuPosition.current = window.scrollY;
    setView(next);
  };
  useLayoutEffect(() => {
    if (view === previousView.current) return;
    window.scrollTo(0, view === 'menu' ? menuPosition.current : 0);
    previousView.current = view;
  }, [view]);
  const [customQuantity, setCustomQuantity] = useState(1);
  const [customError, setCustomError] = useState('');
  const [removed, setRemoved] = useState<Line | null>(null);
  const [pendingFlag, setPendingFlag] = useState(false);
  const endpoint = qrToken ? '/api/public/menu/' + encodeURIComponent(qrToken) : '/api/public/delivery/catalog';
  const call = async (url: string, body?: unknown) => {
    const r = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const d = await r.json();
    if (!r.ok) throw Object.assign(Error(d.error || 'Não foi possível concluir.'), {
      status: r.status
    });
    return d;
  };
  useEffect(() => {
    let active = true;
    const refresh = () => call(endpoint).then(d => {
      if (active) {
        setData(d);
        setError('');
      }
    }).catch(e => {
      if (active) setError(e.message);
    });
    void refresh();
    const timer = setInterval(refresh, 30000);
    try {
      const stored = JSON.parse(sessionStorage.getItem('deck26:customer:pending:' + endpoint) || 'null');
      if (stored) {
        pending.current = stored;
        if(!qrToken)setTrackingKey(stored.idempotencyKey);
        setPendingFlag(true);
        setView(qrToken ? 'cart' : 'status');
        setMessage('Existe um envio sem confirmação. Consulte ou reenvie o mesmo pedido.');
      }
    } catch {}
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [endpoint]);
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(cart));
    } catch {}
  }, [cart, draftKey]);
  const storeOpen=!!qrToken||data?.service?.open!==false;
  const channel = qrToken ? 'QR_TABLE' : kind === 'PICKUP' ? 'PICKUP' : 'DELIVERY';
  const products: CatalogProduct[] = data?.catalog.products ?? [],
    categories: CatalogCategory[] = data?.catalog.categories ?? [];
  const price = (line: Line) => {
      const p = products.find(item => item.id === line.productId);
      return line.quantity * ((p ? resolveChannelPriceCents(p, channel) : 0) + line.modifiers.reduce((sum, m) => sum + m.priceDeltaCents, 0));
    },
    subtotal = cart.reduce((sum, line) => sum + price(line), 0),
    selectedZone = data?.zones.find((z: any) => z.id === zone),
    fee = !qrToken && cart.length > 0 && kind === 'DELIVERY' ? selectedZone?.feeCents ?? 0 : 0,
    total = subtotal + fee;
  const etaMin = Math.max(data?.eta.min ?? 30, !qrToken && kind === 'DELIVERY' && selectedZone ? selectedZone.estimatedMinutes + (data?.eta.extraMinutes ?? 0) : 0),
    etaMax = etaMin + ((data?.eta.max ?? 45) - (data?.eta.min ?? 30));
  useEffect(() => {
    if (qrToken || !trackingKey) return;
    let active = true;
    const refresh = () => call('/api/public/delivery/status/' + trackingKey).then(result => {
      if (active) {
        setStatus(result);
        if (pending.current?.idempotencyKey === trackingKey) {
          rememberItems(pending.current.items);
          pending.current = null;
          setCart([]);
          setRemoved(null);
          setMessage('');
          sessionStorage.setItem('deck26:customer:last:' + endpoint, trackingKey);
          setPendingFlag(false);
          sessionStorage.removeItem('deck26:customer:pending:' + endpoint);
        }
      }
    }).catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [view, pendingFlag, trackingKey]);
  const lookupAddress=async()=>{if(cepBusy||pendingFlag)return;setCepBusy(true);setCepMessage('');try{const next=await call('/api/public/delivery/cep/'+cep.replace(/\D/g,''));setAddress(current=>({...current,street:next.street||current.street,neighborhood:next.neighborhood||current.neighborhood,city:next.city||current.city}));setCepMessage('Confira os dados e informe o número. A área de entrega continua sendo escolhida separadamente.');}catch(e){setCepMessage((e as Error).message);}finally{setCepBusy(false);}};
  const personalize = (p: CatalogProduct) => {
    setCustom(p);
    setCustomQuantity(1);
    setCustomError('');
    setMods({});
    setNotes('');
  };
  const add = (product: CatalogProduct) => {
    if (product.modifierGroups.length) {
      personalize(product);
      return;
    }
    const line: Line = {id: uid(), productId: product.id, quantity: 1, notes: '', modifiers: []};
    setCart(lines => {
      const match = lines.find(item => item.productId === product.id && !item.notes && !item.modifiers.length && item.quantity < 99);
      return match ? lines.map(item => item.id === match.id ? {...item, quantity: item.quantity + 1} : item) : [...lines, line];
    });
    setMessage(product.name + ' na sacola.');
  };
  const repeatOrder = async () => {
    if (busy || submitting.current || pendingFlag || cart.length) return;
    submitting.current = true;
    setBusy(true);
    try {
      const latest = await call(endpoint);
      setData(latest);
      if (latest.service?.open === false) throw Error(latest.service.message);
      const lines = lastItems.map(item => {
        const product: CatalogProduct | undefined = latest.catalog.products.find((p: CatalogProduct) => p.id === item.productId);
        if (!product?.active || product.availableForSale === false || !product.availableChannels.includes(channel)) {
          throw Error('Um produto do pedido anterior está indisponível. Confira o cardápio.');
        }
        const modifiers = product.modifierGroups.flatMap(group => {
          const selected = item.modifiers.filter(mod => mod.groupId === group.id);
          if (selected.length < group.minSelect || selected.length > group.maxSelect) {
            throw Error('As opções de ' + product.name + ' mudaram. Personalize o item novamente.');
          }
          return selected.map(mod => {
            const option = group.options.find(entry => entry.id === mod.optionId && entry.available !== false);
            if (!option) throw Error('Uma opção de ' + product.name + ' está indisponível.');
            return {groupId: group.id, groupName: group.name, optionId: option.id, optionName: option.name, priceDeltaCents: option.priceDeltaCents};
          });
        });
        if (modifiers.length !== item.modifiers.length) throw Error('As opções de ' + product.name + ' mudaram.');
        return {...item, id: uid(), modifiers};
      });
      setCart(lines);
      setMessage('Itens adicionados com os preços atuais. Confira os dados de entrega ou retirada antes de enviar.');
      navigate('cart');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const send = async () => {
    if (busy || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (!pending.current) {
        if (!storeOpen) throw Error(data?.service?.message||'Pedidos online indisponíveis no momento.');
        if (!cart.length) throw Error('Adicione produtos ao pedido.');
        if (name.trim().length < 2) throw Error('Informe seu nome.');
        const items = cart.map(({
          productId,
          quantity,
          notes,
          modifiers
        }) => ({
          productId,
          quantity,
          notes,
          modifiers
        }));
        if (qrToken) pending.current = {
          idempotencyKey: 'qr-client-' + uid(),
          qrToken,
          customerName: name.trim(),
          items
        };else {
          const quote = await call('/api/public/delivery/quote', {
            items,
            deliveryType: kind,
            deliveryZoneId: kind === 'DELIVERY' ? zone : undefined,
            deliveryAddress: kind === 'DELIVERY' ? address : undefined
          });
          if (quote.totalCents !== total) {
            setData(await call(endpoint));
            throw Error('O preço mudou. Confira o total atualizado antes de enviar novamente.');
          }
          pending.current = {
            idempotencyKey: 'delivery-' + uid(),
            customerName: name.trim(),
            customerPhone: phone,
            deliveryType: kind,
            deliveryZoneId: kind === 'DELIVERY' ? zone : undefined,
            deliveryAddress: kind === 'DELIVERY' ? address : undefined,
            items,
            paymentMethodDeclared: method,
            changeForCents: method === 'CASH' && cash ? Math.round(Number(cash.replace(',', '.')) * 100) : undefined,
            quotedTotalCents: quote.totalCents
          };
        }
        sessionStorage.setItem('deck26:customer:pending:' + endpoint, JSON.stringify(pending.current));
        setPendingFlag(true);
      }
      const result = await call(qrToken ? '/api/public/qr-orders' : '/api/public/delivery/requests', pending.current);
      if(!qrToken){setTrackingKey(pending.current.idempotencyKey);sessionStorage.setItem('deck26:customer:last:'+endpoint,pending.current.idempotencyKey);}
      setCart([]);
      setRemoved(null);
      if (qrToken) {
        setPendingFlag(false);
        pending.current = null;
        sessionStorage.removeItem('deck26:customer:pending:' + endpoint);
        setMessage('Pedido enviado à equipe. Aguarde a aprovação para entrar na conta da mesa.');
        setView('menu');
      } else {
        rememberItems(pending.current.items);
        setStatus(result);
        pending.current = null;
        setPendingFlag(false);
        sessionStorage.removeItem('deck26:customer:pending:' + endpoint);
        setView('status');
      }
    } catch (e) {
      const failure = e as Error & {
        status?: number;
      };
      if (failure.status && failure.status >= 400 && failure.status < 500 && failure.status !== 429) {
        pending.current = null;
        setPendingFlag(false);
        sessionStorage.removeItem('deck26:customer:pending:' + endpoint);
      }
      if (!qrToken && pending.current) {
        setTrackingKey(pending.current.idempotencyKey);
        setStatus(null);
        setView('status');
      }
      setMessage(failure.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const service = async (kind: 'WAITER' | 'BILL', paymentPreference?: 'PIX' | 'CARD') => {
    setBusy(true);
    try {
      await call('/api/public/qr-service-call', {
        qrToken,
        kind,
        paymentPreference
      });
      setMessage(kind === 'WAITER' ? 'A equipe recebeu sua chamada.' : 'A equipe recebeu seu pedido de conta.');
      setBillChoice(false);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <main className="d26-customer"><Deck26Logo /><p role="status">{error || 'Preparando o cardápio…'}</p><button onClick={() => location.reload()}>Tentar novamente</button></main>;
  const highlights = (c: CatalogCategory) => data.highlights.some((word: string) => normalize(c.name).includes(word));
  const ordered = [...categories].sort((a, b) => Number(highlights(b)) - Number(highlights(a)) || a.sortOrder - b.sortOrder);
  return <main className="d26-customer"><header><Deck26Logo showHotelSubtitle /><span>{qrToken ? 'Mesa ' + data.table.tableNumber + ' · DECK 26' : 'Peça do seu jeito'}</span><button aria-label="Atualizar cardápio" onClick={() => void call(endpoint).then(setData).catch(e => setMessage(e.message))}>↻</button></header>{view==='menu'&&<section className="d26-customer-hero"><small>FEITO NA HORA · DO NOSSO JEITO</small><h1>Seu próximo<br /><em>favorito está aqui.</em></h1><p>{qrToken ? 'Escolha, personalize e envie seu pedido direto para nossa equipe.' : 'Do Deck 26 até você. Comida de verdade, sabor de casa.'}</p>{!qrToken && <span className="d26-customer-eta">◷ Previsão atual: {etaMin}–{etaMax} min{data.eta.busy ? ' · cozinha movimentada' : ''}</span>}</section>}
 {qrToken && view === 'service' && <section className="d26-customer-service"><h1>Atendimento</h1><button disabled={busy || !data.table.open} onClick={() => void service('WAITER')}>🔔 Chamar garçom</button><button disabled={busy || !data.table.open} onClick={() => setBillChoice(!billChoice)}>💳 Pedir a conta</button>{billChoice && <div><button onClick={() => void service('BILL', 'CARD')}>Trazer maquininha</button><button onClick={() => void service('BILL', 'PIX')}>Pagar com PIX</button></div>}{!data.table.open && <p>Aguarde a equipe abrir sua mesa para enviar pedidos.</p>}</section>}
 {!qrToken&&data.service&&<div className={'d26-customer-store '+(storeOpen?'':'closed')} role="status"><strong>{storeOpen?'● ':''}{data.service.message}</strong>{data.service.notice&&<small>{data.service.notice}</small>}{!storeOpen&&<small>Você pode consultar o cardápio. Novos envios voltam a ser aceitos quando o atendimento reabrir.</small>}</div>}
 {qrToken && data.coverNotice && <p className="d26-customer-notice">🎵 {data.coverNotice.notice} · {money(data.coverNotice.unitCents)} por pessoa.</p>}{(message || error) && <p role="status" className="d26-customer-notice">{message || error}</p>}
 {view === 'menu' && <><div className="d26-customer-search"><input type="search" aria-label="Buscar produto" value={search} placeholder="Buscar no cardápio" onChange={e => setSearch(e.target.value)} /></div><nav className="d26-customer-categories"><button aria-pressed={category === 'ALL'} onClick={() => setCategory('ALL')}>Todo o cardápio</button>{ordered.map(c => <button key={c.id} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{highlights(c) ? '★ ' : ''}{c.name}</button>)}</nav>{ordered.filter(c => category === 'ALL' || c.id === category).map(c => {
        const list = products.filter(p => p.active && p.availableChannels.includes(channel) && p.categoryId === c.id && normalize(p.name + ' ' + p.description).includes(normalize(search)));
        if (!list.length) return null;
        return <section className="d26-customer-category" key={c.id}><header><div><small>{highlights(c) ? 'DESTAQUE PARA AGORA' : 'PREPARADO COM CUIDADO'}</small><h2>{c.name}</h2></div><span>{list.length} opções</span></header><div className="d26-customer-grid">{list.map(p => {
              const seal = productSeal(p, c.name);
              return <article className={'d26-seal-' + seal.tone} key={p.id}><ProductPicture product={p} className="d26-customer-dish" fallback={seal.icon}/><div><h3>{p.name}</h3><p>{p.description}</p><footer><strong>{money(resolveChannelPriceCents(p, channel))}</strong><button disabled={!storeOpen || busy || pendingFlag || p.availableForSale === false || !!qrToken && !data.table.open} aria-label={(p.modifierGroups.length ? 'Personalizar ' : 'Adicionar ') + p.name} onClick={() => add(p)}>{p.availableForSale === false ? 'Indisponível agora' : p.modifierGroups.length ? 'Personalizar' : 'Adicionar ＋'}</button>{!p.modifierGroups.length && p.availableForSale !== false && <button disabled={!storeOpen || busy || pendingFlag || !!qrToken && !data.table.open} aria-label={'Personalizar ' + p.name} onClick={() => personalize(p)}>Personalizar</button>}</footer></div></article>;
            })}</div></section>;
      })}</>}
 {view === 'cart' && <section className="d26-customer-checkout"><h2>Sacola</h2>{!cart.length && !pendingFlag && <p>Sua sacola está vazia. <button onClick={() => navigate('menu')}>Ver cardápio</button></p>}{removed && !pendingFlag && <p>Item removido. <button disabled={busy} onClick={() => {setCart(lines => [...lines, removed]); setRemoved(null);}}>Desfazer</button></p>}{cart.map(line => <article key={line.id}><div><strong>{products.find(p => p.id === line.productId)?.name}</strong><small>{line.modifiers.map(m => m.optionName).join(' · ')}{line.notes ? ' · ' + line.notes : ''}</small><b>{money(price(line))}</b><label>Observação do item<textarea maxLength={280} value={line.notes} disabled={pendingFlag || busy} onChange={event => setCart(lines => lines.map(item => item.id === line.id ? {...item, notes: event.target.value} : item))}/></label></div><div className="d26-customer-qty"><button aria-label="Diminuir quantidade" disabled={pendingFlag || busy} onClick={() => {if (line.quantity === 1) setRemoved(line); setCart(lines => lines.flatMap(l => l.id !== line.id ? [l] : l.quantity > 1 ? [{
            ...l,
            quantity: l.quantity - 1
          }] : []));}}>−</button><span>{line.quantity}</span><button aria-label="Aumentar quantidade" disabled={pendingFlag || busy || line.quantity >= 99} onClick={() => setCart(lines => lines.map(l => l.id === line.id ? {
            ...l,
            quantity: l.quantity + 1
          } : l))}>+</button></div></article>)}{!pendingFlag&&storeOpen&&(data.suggestionIds??[]).some((id:string)=>products.some(p=>p.id===id&&!cart.some(l=>l.productId===id)&&p.active&&p.availableForSale!==false&&p.availableChannels.includes(channel)))&&<aside className="d26-customer-suggestions"><h3>Combina com o seu pedido</h3><small>Escolha se quiser · o total só muda após adicionar.</small><div>{products.filter(p=>(data.suggestionIds??[]).includes(p.id)&&p.active&&p.availableForSale!==false&&p.availableChannels.includes(channel)&&!cart.some(l=>l.productId===p.id)).slice(0,4).map(p=><button key={p.id} onClick={()=>add(p)}>{p.name}<b>＋ {money(resolveChannelPriceCents(p,channel))}</b></button>)}</div></aside>}<label>Seu nome<input value={name} onChange={e => setName(e.target.value)} maxLength={80} disabled={pendingFlag} /></label>{!qrToken && <><label>WhatsApp com DDD<input inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} maxLength={20} disabled={pendingFlag} /></label><fieldset className="d26-customer-fulfillment"><legend>Como deseja receber?</legend><button type="button" aria-pressed={kind==='DELIVERY'} disabled={pendingFlag} onClick={()=>setKind('DELIVERY')}>🛵 Entrega<small>Taxa conforme sua área</small></button><button type="button" aria-pressed={kind==='PICKUP'} disabled={pendingFlag} onClick={()=>setKind('PICKUP')}>🛍 Retirar no Deck 26<small>Sem taxa de entrega</small></button></fieldset>{kind === 'DELIVERY' && <><label>Área de entrega<select value={zone} onChange={e => setZone(e.target.value)} disabled={pendingFlag}><option value="">Selecione sua área</option>{data.zones.map((z: any) => <option key={z.id} value={z.id}>{z.name} · taxa {money(z.feeCents)}</option>)}</select></label><div className="d26-customer-cep"><label>CEP (opcional)<div><input inputMode="numeric" maxLength={9} value={cep} onChange={e=>setCep(e.target.value)} disabled={pendingFlag||cepBusy}/><button type="button" disabled={pendingFlag||cepBusy||cep.replace(/\D/g,'').length!==8} onClick={()=>void lookupAddress()}>{cepBusy?'Consultando…':'Consultar CEP'}</button></div></label><small>Consulta ViaCEP pela internet. Só o CEP é enviado; você pode preencher tudo manualmente.</small>{cepMessage&&<small role="status">{cepMessage}</small>}</div>{Object.entries({
            street: 'Rua',
            number: 'Número',
            neighborhood: 'Bairro',
            city: 'Cidade',
            complement: 'Complemento (opcional)',
            reference: 'Referência (opcional)'
          }).map(([field, label]) => <label key={field}>{label}<input value={(address as any)[field]} disabled={pendingFlag} onChange={e => setAddress(current => ({
              ...current,
              [field]: e.target.value
            }))} maxLength={150} /></label>)}</>}<label>Forma de pagamento<select value={method} onChange={e => setMethod(e.target.value)} disabled={pendingFlag}><option value="PIX">PIX na entrega/retirada</option><option value="CREDIT_CARD">Cartão de crédito</option><option value="DEBIT_CARD">Cartão de débito</option><option value="CASH">Dinheiro</option></select></label>{method === 'CASH' && <label>Precisa de troco para quanto? (opcional)<input value={cash} inputMode="decimal" disabled={pendingFlag} onChange={e => setCash(e.target.value)} /></label>}</>}<div className="d26-customer-totals"><p>Produtos <b>{money(subtotal)}</b></p>{!qrToken && kind==='DELIVERY' && <p>Entrega <b>{money(fee)}</b></p>}<p>Total dos itens{!qrToken && kind==='DELIVERY' ? ' e entrega' : ''}<strong>{money(total)}</strong></p></div><small>{qrToken ? 'Serviço, couvert e descontos são conferidos na conta da mesa.' : 'A equipe confirma a disponibilidade. Nenhum pagamento é cobrado automaticamente.'}</small><button className="d26-customer-primary" disabled={busy || !pendingFlag && (!storeOpen || !cart.length)} onClick={() => void send()}>{busy ? 'Enviando…' : pendingFlag ? 'Reenviar o mesmo pedido' : 'Enviar pedido à equipe'}</button></section>}
 {view === 'status' && <section className="d26-customer-status">{!status ? <><h2>Meu pedido</h2><p>{pendingFlag ? 'Aguardando confirmação do servidor.' : trackingKey ? 'Consultando o andamento do pedido…' : 'O acompanhamento aparece depois que você envia um pedido.'}</p><button disabled={busy} onClick={() => pendingFlag ? void send() : navigate('menu')}>{pendingFlag ? 'Reenviar o mesmo pedido' : 'Ver cardápio'}</button></> : <><span aria-hidden="true">{status.status === 'REJECTED' || status.deliveryStatus === 'CANCELADO' ? '!' : '✓'}</span><h2>{status?.deliveryStatus==='CANCELADO'?'Pedido cancelado':status?.deliveryStatus==='ENTREGUE'?'Pedido concluído':status?.status === 'ACCEPTED' ? 'Pedido confirmado!' : status?.status === 'REJECTED' ? 'Pedido não confirmado' : 'Pedido recebido pela equipe'}</h2><p>{status?.deliveryStatus==='CANCELADO'?'Converse com a equipe se precisar de ajuda.':status?.deliveryStatus==='ENTREGUE'?'Obrigado por escolher o Deck 26!':status?.status === 'PENDING' ? 'Aguarde a confirmação da disponibilidade.' : status?.status === 'ACCEPTED' ? 'Seu pedido está em andamento.' : 'Entre em contato com a equipe se precisar de ajuda.'}</p>{status && <><strong>{status.orderNumber ? 'Pedido #' + status.orderNumber : 'Solicitação ' + status.id.slice(0, 8)}</strong><p>{money(status.totalCents)}{!['ENTREGUE','CANCELADO'].includes(status.deliveryStatus)&&status.status!=='REJECTED'&&<> · previsão {status.eta.min}–{status.eta.max} min</>}</p><p>{({
            NOVO: 'Confirmado pela equipe',
            CONFIRMADO: 'Confirmado',
            EM_PREPARO: 'Em preparo',
            PRONTO: 'Pronto',
            SAIU_PARA_ENTREGA: 'Saiu para entrega',
            EM_ROTA: 'Em rota',
            ENTREGUE: 'Entregue',
            CANCELADO: 'Cancelado'
          } as Record<string, string>)[status.deliveryStatus] ?? 'Aguardando aprovação'}</p></>}{status?.timeline&&<CustomerDeliveryTimeline events={status.timeline}/>}<p>Pagamento e emissão fiscal são conferidos pela equipe; esta tela mostra o andamento do pedido.</p>{pendingFlag && <button disabled={busy} onClick={() => void send()}>Consultar / reenviar com segurança</button>}{!pendingFlag && <button onClick={() => {
        pending.current = null;
        navigate('menu');
      }}>Fazer outro pedido</button>}{!pendingFlag && !cart.length && lastItems.length > 0 && <button disabled={busy} onClick={() => void repeatOrder()}>Pedir novamente</button>}</>}</section>}
 <nav className="d26-customer-bottom" aria-label="Navegação do cliente">
   <button aria-current={view === 'menu' ? 'page' : undefined} onClick={() => navigate('menu')}><span aria-hidden="true">☷</span>Cardápio</button>
   <button aria-current={view === 'cart' ? 'page' : undefined} onClick={() => navigate('cart')}><span aria-hidden="true">▣</span>Sacola{cart.length > 0 && <b>{cart.reduce((sum, line) => sum + line.quantity, 0)}</b>}</button>
   <button aria-current={view === (qrToken ? 'service' : 'status') ? 'page' : undefined} onClick={() => navigate(qrToken ? 'service' : 'status')}><span aria-hidden="true">{qrToken ? '♧' : '◷'}</span>{qrToken ? 'Atendimento' : 'Meu pedido'}</button>
 </nav>
 {custom && <div className="d26-customer-modal"><section role="dialog" aria-modal="true" aria-label={'Personalizar ' + custom.name}><button className="d26-customer-close" aria-label="Fechar personalização" onClick={() => setCustom(null)}>×</button><small>DO SEU JEITO</small><h2>{custom.name}</h2>{custom.imageUrl&&<ProductPicture product={custom} className="d26-customer-product-photo"/>}<p>{custom.description}</p>{custom.modifierGroups.map(g => <fieldset key={g.id}><legend>{g.name} · {g.minSelect ? `escolha ${g.minSelect} a ${g.maxSelect}` : 'opcional'}</legend>{g.options.filter(o => o.available !== false).map(o => <label key={o.id}><input type="checkbox" checked={mods[g.id]?.includes(o.id) ?? false} disabled={!mods[g.id]?.includes(o.id) && (mods[g.id]?.length ?? 0) >= g.maxSelect} onChange={e => setMods(current => ({
              ...current,
              [g.id]: e.target.checked ? [...(current[g.id] ?? []), o.id] : (current[g.id] ?? []).filter(v => v !== o.id)
            }))} />{o.name}{o.priceDeltaCents ? ' · ' + money(o.priceDeltaCents) : ''}</label>)}</fieldset>)}<div className="d26-customer-chips">{noteSuggestions(custom).map(chip => <button key={chip} aria-pressed={notes.split(';').some(text => text.trim() === chip)} onClick={() => setNotes(current => toggleNote(current, chip))}>{chip}</button>)}</div><label>Alguma observação?<textarea value={notes} maxLength={280} onChange={e => setNotes(e.target.value)} placeholder="Pode escrever também…" /></label><div className="d26-customer-qty"><button aria-label="Diminuir quantidade" disabled={customQuantity <= 1} onClick={() => setCustomQuantity(q => q - 1)}>−</button><span>{customQuantity}</span><button aria-label="Aumentar quantidade" disabled={customQuantity >= 99} onClick={() => setCustomQuantity(q => q + 1)}>+</button></div>{customError && <p role="alert">{customError}</p>}<button className="d26-customer-primary" onClick={() => {
          if (custom.modifierGroups.some(g => (mods[g.id]?.length ?? 0) < g.minSelect)) {
            setCustomError('Escolha as opções obrigatórias.');
            return;
          }
          const modifiers = custom.modifierGroups.flatMap(g => g.options.filter(o => mods[g.id]?.includes(o.id)).map(o => ({
            groupId: g.id,
            groupName: g.name,
            optionId: o.id,
            optionName: o.name,
            priceDeltaCents: o.priceDeltaCents
          })));
          setCart(lines => [...lines, {
            id: uid(),
            productId: custom.id,
            quantity: customQuantity,
            notes,
            modifiers
          }]);
          setCustom(null);
          setMessage('Adicionado ao seu pedido.');
        }}>Adicionar · {money(customQuantity * (resolveChannelPriceCents(custom, channel) + custom.modifierGroups.flatMap(group => group.options).filter(option => Object.values(mods).some(selected => selected.includes(option.id))).reduce((sum, option) => sum + option.priceDeltaCents, 0)))}</button></section></div>}
 </main>;
}
