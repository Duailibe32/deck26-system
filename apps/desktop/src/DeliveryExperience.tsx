import React, { useEffect, useState, useRef } from 'react';
import { formatBrlCents as money, type DeliveryOrder, type DeliveryCourier, type DeliveryOrderStatus } from '@deck26/contracts';
import './delivery-experience.css';
type Config = {
  enabled: boolean;
  mode: 'AUTO' | 'CLOSED';
  pausedUntil: string | null;
  notice: string;
  hours: Array<{
    day: number;
    open: number;
    close: number;
  }>;
  closedDates: string[];
  suggestionIds: string[];
  slaMinutes: number;
};
const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const labels: Record<string, string> = {
  NOVO: 'Novos',
  CONFIRMADO: 'Confirmados',
  EM_PREPARO: 'Em preparo',
  PRONTO: 'Prontos',
  SAIU_PARA_ENTREGA: 'Em rota',
  ENTREGUE: 'Entregues',
  CANCELADO: 'Cancelados'
};
const clock = (v: number) => String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
const minute = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
export function DeliveryExperience({
  base,
  headers,
  orders,
  couriers,
  refresh,
  notify
}: {
  base: string;
  headers: () => Record<string, string>;
  orders: DeliveryOrder[];
  couriers: DeliveryCourier[];
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const labelFrame = useRef<HTMLIFrameElement>(null);
  const [config, setConfig] = useState<Config | null>(null),
    [canConfigure, setCanConfigure] = useState(false),
    [products, setProducts] = useState<any[]>([]),
    [inbox, setInbox] = useState<any[]>([]),
    [tick, setTick] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [search, setSearch] = useState(''),
    [showFinal, setShowFinal] = useState(false),
    [modal, setModal] = useState<{
      html?: string;
      text?: string;
      order?: DeliveryOrder;
    } | null>(null),
    [dispatch, setDispatch] = useState<Record<string, string>>({});
  const call = async (url: string, body?: unknown) => {
    const r = await fetch(base + url, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...headers(),
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || 'Não foi possível concluir.');
    return d;
  };
  useEffect(() => {
    let alive = true;
    void Promise.all([call('/api/ops/delivery-service'), call('/api/public/delivery/catalog')]).then(([s, c]) => {
      if (alive) {
        setConfig(s.config);
        setCanConfigure(s.canConfigure);
        setProducts(c.catalog.products);
      }
    }).catch(e => setMessage(e.message));
    const update = () => call('/api/ops/delivery-inbox').then(d => {
      if (alive) setInbox(d);
    }).catch(e => {
      if (alive) setMessage(e.message);
    });
    void update();
    const timer = setInterval(() => {
      setTick(Date.now());
      void update();
    }, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [base]);
  const mutate = async (id: string, verb: string, body: unknown = {}, method = 'POST') => {
    const r = await fetch(base + '/api/delivery/orders/' + encodeURIComponent(id) + '/' + verb, {
      method,
      headers: {
        ...headers(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || 'Não foi possível atualizar o pedido.');
    return d;
  };
  const onAdvance = (id: string, status: DeliveryOrderStatus) => mutate(id, 'status', {
    status
  }, 'PATCH');
  const onDispatch = (id: string, courierId: string) => mutate(id, 'dispatch', {
    courierId
  });
  const onDeliver = (id: string) => mutate(id, 'deliver');
  const onCancel = (id: string) => confirm('Cancelar este pedido e registrar o estorno operacional?') ? mutate(id, 'cancel', {
    cancelReason: 'Cancelamento confirmado na expedição'
  }) : Promise.resolve();
  const action = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await work();
      await refresh();
      setInbox(await call('/api/ops/delivery-inbox'));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (next: Config) => {
    await call('/api/ops/delivery-service', next);
    setConfig(next);
    notify('Disponibilidade do delivery salva e auditada.');
  };
  const filtered = orders.filter(o => (showFinal || !['ENTREGUE', 'CANCELADO'].includes(o.status)) && [o.customerName, o.customerPhone, String(o.orderNumber)].join(' ').toLowerCase().includes(search.toLowerCase()));
  const age = (o: DeliveryOrder) => Math.max(0, Math.floor((tick - Date.parse(o.updatedAt || o.createdAt)) / 60000));
  const preview = async (o: DeliveryOrder) => {
    const d = await call('/api/ops/delivery-label/' + encodeURIComponent(o.id));
    setModal({
      html: d.html,
      text: d.text,
      order: o
    });
  };
  const isPaused = config?.pausedUntil && Date.parse(config.pausedUntil) > tick;
  return <section className="d26-delivery-experience"><header className="d26-delivery-banner"><div><small>DECK 26 · DO PEDIDO À ENTREGA</small><h2>Expedição em movimento</h2><p>Confira, prepare e entregue. Cada etapa tem seu lugar.</p></div><span className={'d26-delivery-state ' + (config?.mode === 'CLOSED' || isPaused ? 'closed' : '')} aria-live="polite">{config?.mode === 'CLOSED' ? '● Encerrado manualmente' : isPaused ? '◷ Pedidos pausados' : config?.enabled ? '◷ Agenda ativa' : '● Recebimento habilitado'}</span></header>
 {message && <p role="alert" className="d26-delivery-notice">{message}</p>}
 {config && canConfigure && <details className="d26-delivery-settings"><summary>Horários, pausas e sugestões do carrinho</summary><div className="d26-delivery-actions">{[15, 30, 60].map(m => <button disabled={busy} key={m} onClick={() => void action(() => save({
          ...config,
          pausedUntil: new Date(Date.now() + m * 60000).toISOString()
        }))}>Pausar {m} min</button>)}<button disabled={busy} onClick={() => void action(() => save({
          ...config,
          mode: 'AUTO',
          pausedUntil: null
        }))}>Retomar agenda</button><button disabled={busy} onClick={() => void action(() => save({
          ...config,
          mode: 'CLOSED',
          pausedUntil: null
        }))}>Encerrar pedidos online</button></div><p>Retomar respeita horários e datas fechadas. Pedidos já enviados continuam na fila para conferência.</p><form onSubmit={e => {
        e.preventDefault();
        void action(() => save(config));
      }}><label className="d26-delivery-inline"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({
            ...config,
            enabled: e.target.checked
          })} /> Usar agenda semanal</label><div className="d26-delivery-week">{days.map((day, index) => {
            const slot = config.hours.find(h => h.day === index);
            return <div key={day}><label><input type="checkbox" checked={!!slot} onChange={e => setConfig({
                  ...config,
                  hours: e.target.checked ? [...config.hours, {
                    day: index,
                    open: 1080,
                    close: 1380
                  }] : config.hours.filter(h => h.day !== index)
                })} />{day}</label><input type="time" aria-label={'Abertura ' + day} disabled={!slot} value={clock(slot?.open ?? 1080)} onChange={e => setConfig({
                ...config,
                hours: config.hours.map(h => h.day === index ? {
                  ...h,
                  open: minute(e.target.value)
                } : h)
              })} /><span>até</span><input type="time" aria-label={'Fechamento ' + day} disabled={!slot} value={clock(slot?.close ?? 1380)} onChange={e => setConfig({
                ...config,
                hours: config.hours.map(h => h.day === index ? {
                  ...h,
                  close: minute(e.target.value)
                } : h)
              })} /></div>;
          })}</div><label>Datas sem atendimento (AAAA-MM-DD, separadas por vírgula)<input defaultValue={config.closedDates.join(', ')} onBlur={e => setConfig({
            ...config,
            closedDates: e.target.value.split(',').map(v => v.trim()).filter(Boolean)
          })} /></label><label>Aviso para o cliente<input maxLength={200} value={config.notice} onChange={e => setConfig({
            ...config,
            notice: e.target.value
          })} /></label><label>Meta por etapa em minutos<input type="number" min={5} max={240} value={config.slaMinutes} onChange={e => setConfig({
            ...config,
            slaMinutes: Number(e.target.value)
          })} /></label><label>Sugestões opcionais no carrinho (até 8)<select multiple aria-label="Produtos sugeridos no carrinho" value={config.suggestionIds} onChange={e => setConfig({
            ...config,
            suggestionIds: Array.from(e.target.selectedOptions).map(o => o.value)
          })}>{products.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="d26-delivery-primary" disabled={busy}>Salvar configuração</button></form></details>}
 <div className="d26-delivery-toolbar"><label>Buscar pedido<input placeholder="Número, nome ou telefone" value={search} onChange={e => setSearch(e.target.value)} /></label><label className="d26-delivery-inline"><input type="checkbox" checked={showFinal} onChange={e => setShowFinal(e.target.checked)} />Mostrar encerrados</label><span>{orders.filter(o => !['ENTREGUE', 'CANCELADO'].includes(o.status)).length} ativos · {inbox.length} aguardando aceite</span></div>
 {inbox.length > 0 && <section className="d26-delivery-inbox"><h3>Primeiro, confira os pedidos dos clientes <b>{inbox.length}</b></h3><div>{inbox.map(r => <article key={r.id}><small>AGUARDANDO ACEITE</small><h4>{r.customerName}</h4><p>{r.deliveryType === 'PICKUP' ? 'Retirada' : 'Entrega'} · {money(r.quotedTotalCents)} · {r.customerPhone}</p><ul>{r.items.map((i: any, index: number) => <li key={index}>{i.quantity}× {products.find(p => p.id === i.productId)?.name ?? 'Produto'}{i.notes ? ' · ' + i.notes : ''}{i.modifiers?.length ? ' · ' + i.modifiers.map((m: any) => m.optionName).join(', ') : ''}</li>)}</ul>{r.deliveryAddress && <p>{r.deliveryAddress.street}, {r.deliveryAddress.number} · {r.deliveryAddress.neighborhood}</p>}<div className="d26-delivery-actions"><button disabled={busy} onClick={() => void action(() => call('/api/ops/delivery-decision', {
              id: r.id,
              accept: true
            }))}>Conferido · aceitar</button><button disabled={busy} onClick={() => void action(() => call('/api/ops/delivery-decision', {
              id: r.id,
              accept: false
            }))}>Recusar</button></div></article>)}</div></section>}
 <div className="d26-delivery-board">{Object.entries(labels).filter(([status]) => showFinal || !['ENTREGUE', 'CANCELADO'].includes(status)).map(([stage, label]) => {
        const list = filtered.filter(o => o.status === stage);
        return <section className={'d26-delivery-column stage-' + stage} key={stage}><header><h3>{label}</h3><span>{list.length}</span></header>{!list.length && <p className="d26-delivery-empty">Nenhum pedido nesta etapa</p>}{list.map(o => {
            const elapsed = age(o),
              late = !['ENTREGUE', 'CANCELADO'].includes(o.status) && elapsed >= (config?.slaMinutes ?? 30),
              next: Partial<Record<DeliveryOrderStatus, DeliveryOrderStatus>> = {
                NOVO: 'CONFIRMADO',
                CONFIRMADO: 'EM_PREPARO',
                EM_PREPARO: 'PRONTO'
              };
            return <article className={late ? 'late' : ''} key={o.id}><div className="d26-delivery-card-top"><strong>#{o.orderNumber}</strong><span>{o.deliveryType === 'TAKEOUT' ? 'Retirada' : 'Entrega'}</span></div><h4>{o.customerName}</h4><small className={late ? 'd26-delivery-late' : ''}>◷ {elapsed} min nesta etapa{late ? ' · atenção ao prazo' : ''}</small><p>{money(o.totalCents)} · {o.paymentMethodDeclared}</p>{o.deliveryAddress && <p>{o.deliveryAddress.street}, {o.deliveryAddress.number}<br />{o.deliveryAddress.neighborhood}</p>}{o.notes && <p>Obs: {o.notes}</p>}<div className="d26-delivery-card-actions">{next[o.status] && <button disabled={busy} className="d26-delivery-primary" onClick={() => void action(() => onAdvance(o.id, next[o.status]!))}>Avançar · {labels[next[o.status]!]}</button>}{o.status === 'PRONTO' && o.deliveryType === 'DELIVERY' && <><select aria-label={'Entregador do pedido ' + o.orderNumber} value={dispatch[o.id] ?? ''} onChange={e => setDispatch({
                    ...dispatch,
                    [o.id]: e.target.value
                  })}><option value="">Escolha o entregador</option>{couriers.filter(c => c.active && c.status === 'DISPONIVEL').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button disabled={busy || !dispatch[o.id]} onClick={() => void action(() => onDispatch(o.id, dispatch[o.id]!))}>Despachar</button></>}{(o.status === 'SAIU_PARA_ENTREGA' || o.status === 'PRONTO' && o.deliveryType === 'TAKEOUT') && <button disabled={busy} onClick={() => setModal({
                  order: o
                })}>Concluir e conferir recebimento</button>}<button disabled={busy} onClick={() => void action(() => preview(o))}>Conferência & etiqueta</button><a className="d26-delivery-whatsapp" href={'https://wa.me/' + o.customerPhone.replace(/\D/g, '') + '?text=' + encodeURIComponent('Olá, ' + o.customerName + '! Aqui é do Deck 26. Seu pedido #' + o.orderNumber + ' está na etapa: ' + labels[o.status] + '.')} target="_blank" rel="noopener noreferrer">Revisar mensagem no WhatsApp ↗</a>{!['ENTREGUE', 'CANCELADO'].includes(o.status) && <button disabled={busy} onClick={() => void action(() => onCancel(o.id))}>Cancelar pedido</button>}</div></article>;
          })}</section>;
      })}</div>
 {modal && <div className="d26-delivery-overlay" role="dialog" aria-modal="true" aria-label="Conferência do pedido"><section><button className="d26-delivery-close" onClick={() => setModal(null)}>Fechar ×</button><h3>Pedido #{modal.order?.orderNumber}</h3>{modal.html ? <><p>Via simulada de expedição · 80 mm · sem impressão física.</p><iframe title="Etiqueta de expedição" ref={labelFrame} srcDoc={modal.html} sandbox="allow-same-origin allow-modals" /><div className="d26-delivery-actions"><button onClick={() => labelFrame.current?.contentWindow?.print()}>Imprimir / salvar PDF</button><button onClick={() => void navigator.clipboard.writeText(modal.text ?? '').then(() => setMessage('Texto da etiqueta copiado.')).catch(() => setMessage('Não foi possível copiar neste navegador.'))}>Copiar conferência</button></div><textarea readOnly value={modal.text} aria-label="Texto da conferência para copiar ou imprimir" /></> : <><p>Confirme que o pedido foi entregue/retirado e que o pagamento foi recebido. Esta ação registra a baixa no sistema.</p><strong>{money(modal.order!.totalCents)} · {modal.order!.paymentMethodDeclared}</strong><button disabled={busy} className="d26-delivery-primary" onClick={() => void action(async () => {
            await onDeliver(modal.order!.id);
            setModal(null);
          })}>Confirmar entrega e recebimento</button></>}</section></div>}
 </section>;
}
