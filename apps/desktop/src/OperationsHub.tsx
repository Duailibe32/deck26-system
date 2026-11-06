import {randomBrowserId} from './browserIds.js';
import { HotelCalendar } from './HotelCalendar.js';
import React, { useEffect, useRef, useState } from 'react';
import { hasPermission, formatBrlCents as money, type UserRole, type CatalogProduct, type Permission } from '@deck26/contracts';
import './operations-hub.css';
const today = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date()),
  uid = () => randomBrowserId(),
  cash = (v: any) => Math.round(Number(String(v).replace(',', '.')) * 100),
  mins = (t: any) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)),
  clock = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
type Field = {
  key: string;
  label: string;
  type?: string;
  value?: any;
  options?: {
    id: string;
    name: string;
  }[];
  optional?: boolean;
};
export function ActionForm({
  title,
  fields,
  onSubmit,
  busy = false,
  button = 'Salvar'
}: {
  title: string;
  fields: Field[];
  onSubmit: (values: any) => Promise<any>;
  busy?: boolean;
  button?: string;
}) {
  const [error, setError] = useState('');
  return <form className="d26-ops-action" onSubmit={async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget),
      values: any = {};
    for (const f of fields) {
      values[f.key] = f.type === 'multi' ? fd.getAll(f.key) : f.type === 'checkbox' ? fd.has(f.key) : fd.get(f.key);
      if (f.optional && !values[f.key]) values[f.key] = undefined;
    }
    try {
      setError('');
      await onSubmit(values);
    } catch (e) {
      setError((e as Error).message);
    }
  }}><h3>{title}</h3><div className="d26-ops-form">{fields.map(f => <label key={f.key}>{f.label}{f.options ? <select aria-label={f.label} name={f.key} multiple={f.type === 'multi'} size={f.type === 'multi' ? 5 : undefined} defaultValue={f.value ?? (f.type === 'multi' ? [] : '')} required={!f.optional}><option value="" disabled={f.type === 'multi'}>Selecione</option>{f.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select> : f.type === 'textarea' ? <textarea name={f.key} defaultValue={f.value ?? ''} required={!f.optional} /> : <input name={f.key} type={f.type ?? 'text'} defaultValue={f.type === 'checkbox' ? undefined : f.value ?? ''} defaultChecked={f.type === 'checkbox' ? !!f.value : undefined} required={f.type === 'checkbox' ? false : !f.optional} step={f.type === 'number' ? 'any' : undefined} />}</label>)}</div>{error && <p role="alert">{error}</p>}<button className="d26-btn d26-btn-primary" disabled={busy}>{busy ? 'Aguarde…' : button}</button></form>;
}
export function ShiftSummary({
  api,
  headers
}: {
  api: string;
  headers: () => Record<string, string>;
}) {
  const [text, setText] = useState(''),
    [message, setMessage] = useState('');
  return <section className="d26-ops-summary"><ActionForm title="Resumo do turno para WhatsApp" fields={[{
      key: 'day',
      label: 'Dia do fechamento',
      type: 'date',
      value: today()
    }]} button="Gerar resumo para o proprietário" onSubmit={async v => {
      const r = await fetch(api + '/api/ops/shift-summary?day=' + v.day, {
          headers: headers()
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setText(d.text);
    }} />{text && <><textarea rows={16} aria-label="Resumo do turno" readOnly value={text} /><button className="d26-btn d26-btn-primary" onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setMessage('Copiado. Revise e cole no WhatsApp.');
        } catch {
          setMessage('Selecione o texto e copie manualmente.');
        }
      }}>Copiar resumo</button></>}<p>{message || 'O texto é preparado para copiar. Nenhuma mensagem é enviada pelo sistema.'}</p></section>;
}
export function OrderBuilder({
  products,
  items,
  setItems
}: {
  products: CatalogProduct[];
  items: any[];
  setItems: (items: any[]) => void;
}) {
  const [productId, setProduct] = useState(''),
    [quantity, setQuantity] = useState(1),
    [mods, setMods] = useState<Record<string, string[]>>({}),
    [notes, setNotes] = useState(''),
    [error, setError] = useState('');
  const product = products.find(p => p.id === productId);
  return <section className="d26-order-builder"><label>Produto<select aria-label="Produto" value={productId} onChange={e => {
        setProduct(e.target.value);
        setMods({});
      }}><option value="">Escolha</option>{products.filter(p => p.active).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>Quantidade<input type="number" min={1} max={100} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label>{product?.modifierGroups.map(g => <fieldset key={g.id}><legend>{g.name} · {g.minSelect} a {g.maxSelect}</legend>{g.options.filter(o => o.available !== false).map(o => <label className="d26-ops-check" key={o.id}><input type="checkbox" checked={mods[g.id]?.includes(o.id) ?? false} onChange={e => setMods(v => ({
          ...v,
          [g.id]: e.target.checked ? [...(v[g.id] ?? []), o.id] : (v[g.id] ?? []).filter(id => id !== o.id)
        }))} />{o.name}</label>)}</fieldset>)}<label>Observação<input value={notes} maxLength={280} onChange={e => setNotes(e.target.value)} /></label><button type="button" className="d26-btn d26-btn-secondary" onClick={() => {
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        setError('Confira produto e quantidade.');
        return;
      }
      if (product.modifierGroups.some(g => (mods[g.id]?.length ?? 0) < g.minSelect || (mods[g.id]?.length ?? 0) > g.maxSelect)) {
        setError('Confira as escolhas obrigatórias.');
        return;
      }
      setItems([...items, {
        productId,
        quantity,
        notes,
        modifiers: product.modifierGroups.flatMap(g => g.options.filter(o => mods[g.id]?.includes(o.id)).map(o => ({
          groupId: g.id,
          groupName: g.name,
          optionId: o.id,
          optionName: o.name,
          priceDeltaCents: o.priceDeltaCents
        })))
      }]);
      setError('');
    }}>Adicionar item</button>{error && <p role="status">{error}</p>}<ul>{items.map((i, index) => <li key={index}>{i.quantity} × {products.find(p => p.id === i.productId)?.name} · {i.modifiers?.map((m: any) => m.optionName).join(', ')}<button aria-label="Remover item" onClick={() => setItems(items.filter((_, n) => n !== index))}>×</button></li>)}</ul></section>;
}
type Props = {
  api: string;
  headers: () => Record<string, string>;
  role: UserRole;
  products: CatalogProduct[];
  scope: 'hotel' | 'stock' | 'restaurant' | 'delivery' | 'finance' | 'breakfast';
  mode?: string;
  userId?: string;
  onRefresh?: () => Promise<void>;
};
function OperationsHubContent({
  api,
  headers,
  role,
  products,
  scope,
  mode,
  userId,
  onRefresh
}: Props) {
  const can = (p: Permission) => hasPermission(role, p);
  const pages: Record<string, [string, string, Permission][]> = {
    hotel: [['calendar', 'Calendário', 'hotel:manage_rooms'], ['breakfast', 'Café & pátio', 'hotel:manage_rooms'], ['maintenance', 'Manutenção', 'hotel:maintenance'], ['corporate', 'Convênios', 'hotel:post_charges']],
    stock: [['shopping', 'Compras', 'stock:adjust'], ['margins', 'Margens', 'catalog:manage'], ['production', 'Produção & desossa', 'stock:adjust'], ['combos', 'Combos', 'catalog:manage']],
    restaurant: [['promotions', 'Happy hour', 'staff:manage'], ['cover', 'Couvert & cozinha', 'staff:manage'], ['meals', 'Refeições da equipe', 'tabs:discount_or_void'], ['voucher', 'Café do hóspede', 'orders:create']],
    delivery: [['inbox', 'Pedidos dos clientes', 'delivery:manage_orders'], ['repeat', 'Repetir pedido', 'delivery:manage_orders']],
    finance: [['corporate', 'Empresas & faturas', 'finance:manage_receivables']],
    breakfast: [['voucher', 'Café do hóspede', 'orders:create']]
  };
  const allowed = pages[scope]!.filter(p => can(p[2])),
    [page, setPage] = useState(mode ?? allowed[0]?.[0] ?? ''),
    [loadedData, setLoadedData] = useState<{page:string;value:any}|null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [items, setItems] = useState<any[]>([]),
    [week, setWeek] = useState(today()),
    [inputs, setInputs] = useState<any[]>([{
      productId: '',
      quantity: 1,
      gramsPerUnit: 1000
    }]),
    [outputs, setOutputs] = useState<any[]>([{
      productId: '',
      quantity: 1,
      gramsPerUnit: 220
    }]),
    [waste, setWaste] = useState(0),
    [voucher, setVoucher] = useState(''),
    [repeat, setRepeat] = useState<any>(null),
    [phone, setPhone] = useState(''),
    [exportText, setExportText] = useState('');
  const data=loadedData?.page===page?loadedData.value:null;
  const currentPage=useRef(page);currentPage.current=page;
  const storageKey = 'deck26:ops:pending:' + scope + ':' + (userId ?? role);
  const pending = useRef<any>((() => {
      try {
        return JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      } catch {
        return null;
      }
    })()),
    running = useRef(false);
  const call = async (url: string, body?: unknown) => {
    const r = await fetch(api + url, {
        method: body ? 'POST' : 'GET',
        headers: headers(),
        body: body ? JSON.stringify(body) : undefined
      }),
      d = await r.json();
    if (!r.ok) throw Object.assign(Error(d.error || 'Não foi possível concluir.'), {
      status: r.status
    });
    return d;
  };
  const refresh = async () => {
    let d: any = {};
    if (['calendar', 'breakfast', 'maintenance'].includes(page)) d = await call('/api/ops/hotel');
    if (['promotions', 'cover'].includes(page)) d = await call('/api/ops/config');
    if (['shopping', 'margins', 'production', 'combos'].includes(page)) d = await call('/api/ops/stock');
    if (page === 'voucher') d = await call('/api/ops/breakfast');
    if (page === 'inbox') d = await call('/api/ops/delivery-inbox');
    if (page === 'corporate') {
      d = can('finance:manage_receivables') ? await call('/api/ops/company-finance') : {
        companies: await call('/api/ops/companies')
      };
      if (can('hotel:manage_rooms')) d.hotel = await call('/api/ops/hotel');
    }
    if(currentPage.current===page)setLoadedData({page,value:d});
  };
  useEffect(() => setPage(mode ?? allowed[0]?.[0] ?? ''), [scope, mode]);
  useEffect(() => {
    setLoadedData(null);
    setItems([]);
    setMessage('');
    if (!page) return;
    void refresh().catch(e => setMessage(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [page]);
  const send = async (url: string, body: any, reliable = false) => {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    try {
      if (reliable && !pending.current) pending.current = {
        url,
        body: {
          ...body,
          idempotencyKey: body.idempotencyKey ?? 'ops-' + uid()
        }
      };
      if (pending.current && pending.current.url !== url) throw Error('Reenvie primeiro a operação pendente.');
      const command = pending.current ?? {
        url,
        body
      };
      if (pending.current) sessionStorage.setItem(storageKey, JSON.stringify(pending.current));
      const d = await call(command.url, command.body);
      pending.current = null;
      sessionStorage.removeItem(storageKey);
      setMessage(d.empty ? 'Nenhum lançamento novo no período.' : 'Operação concluída.');
      await refresh();
      await onRefresh?.();
      return d;
    } catch (e) {
      const error = e as Error & {
        status?: number;
      };
      if (error.status && error.status >= 400 && error.status < 500) {
        pending.current = null;
        sessionStorage.removeItem(storageKey);
      }
      setMessage(error.message + (pending.current ? ' Reenvie sem alterar os dados.' : ''));
      throw error;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const options = products.map(p => ({
      id: p.id,
      name: p.name
    })),
    field = (key: string, label: string, type = 'text', value?: any, optional = false): Field => ({
      key,
      label,
      type,
      value,
      optional
    }),
    select = (key: string, label: string, options: any[], optional = false): Field => ({
      key,
      label,
      options,
      optional
    });
  const form = (title: string, fields: Field[], url: string, body: (v: any) => any, button = 'Salvar') => <ActionForm title={title} fields={fields} busy={busy} button={button} onSubmit={v => send(url, body(v))} />;
  const button = (label: string, fn: () => Promise<any>) => <button className="d26-btn d26-btn-primary" disabled={busy} onClick={() => void fn().catch(e => setMessage(e.message))}>{busy ? 'Aguarde…' : label}</button>;
  const copy = async (text: string) => {
    setExportText(text);
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Texto copiado. Revise antes de enviar no WhatsApp.');
    } catch {
      setMessage('Selecione e copie o texto abaixo.');
    }
  };
  if (!allowed.length) return null;
  return <section className="d26-ops-hub"><header><div><small>OPERAÇÃO CONECTADA</small><h2>{scope === 'stock' ? 'Planejamento & produção' : scope === 'hotel' ? 'Rotinas da recepção' : scope === 'delivery' ? 'Delivery do cliente' : scope === 'finance' ? 'Faturamento corporativo' : 'Rotinas do Deck 26'}</h2></div><button className="d26-btn d26-btn-secondary" onClick={() => void refresh().catch(e => setMessage(e.message))}>Atualizar</button></header>{!mode && <nav>{allowed.map(([id, label]) => <button key={id} disabled={!!pending.current} className={'d26-btn ' + (page === id ? 'd26-btn-primary' : 'd26-btn-secondary')} onClick={() => setPage(id)}>{label}</button>)}</nav>}{message && <p className="d26-ops-notice" role="status">{message}</p>}{pending.current && <p className="d26-ops-notice">Há um envio sem confirmação. {button('Reenviar operação original', () => send(pending.current.url, pending.current.body, true))}</p>}
 {page === 'calendar' && data && <><label>Semana a partir de<input type="date" value={week} onChange={e => setWeek(e.target.value)} /></label><p>Verde: livre · Rosa: entrada · Roxo: hospedagem/reserva · Laranja: saída · Cinza: bloqueio.</p><HotelCalendar data={data} start={week} /><p>São exibidas as unidades operacionais do cadastro real, preservando sua numeração.</p></>}
 {page === 'breakfast' && data && <><div className="d26-ops-stats"><article><small>CAFÉ INCLUSO HOJE</small><strong>{data.breakfast.length} pessoas</strong></article><article><small>UTILIZADOS</small><strong>{data.breakfast.filter((v: any) => v.redeemed_at).length}</strong></article></div><div className="d26-ops-cards">{data.stays.map((s: any) => <article key={s.id}><h3>Apto {s.roomNumber} · {s.guestName.split(' ')[0]}</h3><p>{({
              DAILY: 'Diária',
              NIGHT: 'Pernoite',
              DAY_USE_4H: 'Descanso 4h',
              DAY_USE_6H: 'Descanso 6h'
            } as any)[s.options.plan]}</p><p>{s.options.breakfastIncluded ? '☕ Café incluso · ' + s.options.breakfastGuests + ' pessoa(s)' : 'Café não incluso'}</p><p>🚗 {s.options.vehiclePlate || 'Sem veículo'} {s.options.vehicleModel}</p><p>Saída: {new Date(s.checkOutScheduledAt).toLocaleString('pt-BR')}</p>{s.dayUseAlert && <b className="d26-ops-warning">{s.minutesRemaining < 0 ? 'Pacote vencido há ' + Math.abs(s.minutesRemaining) : 'Vence em ' + s.minutesRemaining} min</b>}</article>)}</div><button className="d26-btn d26-btn-secondary" onClick={() => window.print()}>Imprimir lista / salvar PDF</button><p>A lista do café entra automaticamente na fila da cozinha uma vez ao dia no horário configurado.</p></>}
 {page === 'maintenance' && data && <>{form('Agendar manutenção', [select('roomNumber', 'Apartamento', data.rooms.map((r: any) => ({
        id: r.number,
        name: r.number
      }))), field('name', 'Serviço'), field('lastDone', 'Última execução', 'date', today()), field('nextDue', 'Próxima execução', 'date', today()), field('intervalDays', 'Intervalo (dias)', 'number', 90), field('blockStart', 'Bloquear reservas de (opcional)', 'date', '', true), field('blockEnd', 'Até (exclusivo)', 'date', '', true)], '/api/ops/maintenance', v => ({
        ...v,
        intervalDays: Number(v.intervalDays),
        active: true
      }))}<div className="d26-ops-cards">{data.maintenance.map((p: any) => <article key={p.id}><h3>Apto {p.roomNumber} · {p.name}</h3><p>Próxima: {p.nextDue} · intervalo {p.intervalDays} dias</p>{p.blockStart && <p>Bloqueio: {p.blockStart} a {p.blockEnd}</p>}{p.due && <b className="d26-ops-warning">Manutenção pendente</b>}{button('Concluir e reagendar', () => send('/api/ops/maintenance/complete', {
            id: p.id
          }))}</article>)}</div></>}
 {page === 'voucher' && data && <><p>O crédito cobre o café até o valor cadastrado por pessoa/dia. Somente o excedente é lançado no apartamento.</p><label>Voucher<select aria-label="Voucher" value={voucher} onChange={e => setVoucher(e.target.value)}><option value="">Selecione apartamento e pessoa</option>{data.filter((v: any) => !v.redeemed_at).map((v: any) => <option key={v.id} value={v.id}>Apto {v.room_number} · pessoa {v.guest_index} · {money(v.allowance_cents)}</option>)}</select></label><OrderBuilder products={products.filter(p => p.availableChannels.includes('HOTEL_ROOM'))} items={items} setItems={setItems} />{button('Validar voucher e lançar café', async () => {
        const r = await send('/api/ops/breakfast/redeem', {
          voucherId: voucher,
          items
        }, true);
        if (r) {
          setItems([]);
          setMessage('Crédito: ' + money(r.creditedCents) + ' · Excedente no quarto: ' + money(r.excessCents));
        }
      })}</>}
 {page === 'meals' && <><p>Consumo interno com baixa de ingredientes. Não gera venda ou recebimento.</p><OrderBuilder products={products} items={items} setItems={setItems} /><ActionForm title="Refeição da equipe" fields={[field('staffName', 'Funcionário / equipe'), select('center', 'Centro de custo', [{
        id: 'REST',
        name: 'Restaurante'
      }, {
        id: 'HOTEL',
        name: 'Hotel'
      }])]} busy={busy} button="Registrar consumo interno" onSubmit={async v => {
        if (await send('/api/ops/staff-meal', {
          ...v,
          items
        }, true)) setItems([]);
      }} /></>}
 {page === 'shopping' && data && <>{form('Vincular produto ao fornecedor', [select('productId', 'Produto', options), select('supplierId', 'Fornecedor', data.suppliers)], '/api/ops/supplier-link', v => v)}<div className="d26-ops-cards">{Array.from(new Set<string>(data.shopping.map((r: any) => r.supplierName))).map(supplier => <article key={supplier}><h3>{supplier}</h3>{data.shopping.filter((r: any) => r.supplierName === supplier).map((r: any) => <p key={r.productId}><b>{r.quantity} {r.unit}</b> · {r.name}<small>Saldo {r.current} · mínimo {r.minimum} · semana estimada {r.weeklyForecast}</small></p>)}</article>)}</div>{!data.shopping.length && <p>Nenhum produto abaixo do mínimo.</p>}{button('Copiar cotação para WhatsApp', () => copy('*DECK 26 — LISTA DE COTAÇÃO*\n' + Array.from(new Set<string>(data.shopping.map((r: any) => r.supplierName))).map(supplier => '\n*' + supplier + '*\n' + data.shopping.filter((r: any) => r.supplierName === supplier).map((r: any) => r.quantity + ' ' + r.unit + ' — ' + r.name).join('\n')).join('\n')))}<button className="d26-btn d26-btn-secondary" onClick={() => window.print()}>Imprimir / PDF</button><p>Reposição semanal estimada pelos últimos 28 dias; sem histórico, usa o estoque mínimo.</p>{exportText && <textarea value={exportText} readOnly rows={12} />}</>}
 {page === 'margins' && data && <>{form('Monitorar margem', [select('productId', 'Produto', options), field('target', 'Meta de margem bruta (%)', 'number', 65)], '/api/ops/margin', v => ({
        productId: v.productId,
        targetBps: Math.round(Number(v.target) * 100)
      }))}<p>O custo vem da ficha técnica. Sugestões não incluem impostos e despesas fixas e só são aplicadas após sua confirmação.</p><div className="d26-ops-cards">{data.margins.map((r: any) => <article key={r.productId}><h3>{r.name}</h3><p>Custo {money(r.baselineCostCents)} → {money(r.costCents)}</p><p>Preço {money(r.priceCents)} · margem {(r.marginBps / 100).toFixed(1)}%</p>{r.alert && <b className="d26-ops-warning">Margem abaixo da meta</b>}<p>Sugestão: <strong>{money(r.suggestedPriceCents)}</strong></p>{button('Aplicar sugestão', () => send('/api/ops/margin/apply', {
            productId: r.productId,
            expectedPriceCents: r.suggestedPriceCents
          }))}</article>)}</div></>}
 {page === 'combos' && <>{form('Escolhas obrigatórias de executivo', [select('productId', 'Prato executivo', options)], '/api/ops/executive-choices', v => v, 'Ativar ponto, arroz, feijão e guarnição')}<p>As escolhas passam a ser exigidas no PDV, celular e cardápio do cliente.</p>{form('Composição do balde / combo', [select('productId', 'Produto combo já cadastrado', options), select('ingredientId', 'Cerveja / unidade', products.filter(p => p.trackStock).map(p => ({
        id: p.id,
        name: p.name
      }))), field('quantity', 'Unidades por combo', 'number', 5)], '/api/ops/bucket', v => ({
        ...v,
        quantity: Number(v.quantity)
      }))}<p>O preço fechado vem do cadastro do combo. A ficha técnica baixa as unidades individuais e substitui a receita ativa desse produto.</p></>}
 {page === 'production' && data && <><p>Use pesos em gramas por unidade do cadastro. Ex.: para insumo em kg, informe 1.000 g/unidade. Aparas aproveitáveis devem ser cadastradas entre as saídas.</p>{[['Entradas', inputs, setInputs], ['Saídas: porções e aparas', outputs, setOutputs]].map(([title, lines, setLines]: any) => <fieldset key={title}><legend>{title}</legend>{lines.map((l: any, index: number) => <div className="d26-ops-production-line" key={index}><label>Produto<select aria-label="Produto" value={l.productId} onChange={e => setLines(lines.map((r: any, i: number) => i === index ? {
              ...r,
              productId: e.target.value
            } : r))}><option value="">Selecione</option>{products.filter(p => p.trackStock).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{[['quantity', 'Quantidade'], ['gramsPerUnit', 'Gramas/unidade']].map(([key, label]) => <label key={key}>{label}<input type="number" step="any" value={l[key!]} onChange={e => setLines(lines.map((r: any, i: number) => i === index ? {
              ...r,
              [key!]: Number(e.target.value)
            } : r))} /></label>)}<button className="d26-btn d26-btn-secondary" onClick={() => setLines(lines.filter((_: any, i: number) => i !== index))}>Remover</button></div>)}<button className="d26-btn d26-btn-secondary" onClick={() => setLines([...lines, {
          productId: '',
          quantity: 1,
          gramsPerUnit: 1
        }])}>Adicionar linha</button></fieldset>)}<label>Perda não aproveitável (g)<input type="number" value={waste} onChange={e => setWaste(Number(e.target.value))} /></label><p>Entrada {inputs.reduce((s, l) => s + l.quantity * l.gramsPerUnit, 0)} g · Saída {outputs.reduce((s, l) => s + l.quantity * l.gramsPerUnit, 0)} g · perda {waste} g</p>{button('Confirmar lote', () => send('/api/ops/production', {
        inputs,
        outputs,
        wasteGrams: waste
      }, true))}<h3>Últimos lotes</h3>{data.production.map((p: any) => <p key={p.id}>{new Date(p.created_at).toLocaleString('pt-BR')} · {p.id.slice(0, 8)} · perda {p.waste_grams} g</p>)}</>}
 {page === 'promotions' && data && <>{form('Promoção por horário', [field('name', 'Nome'), field('start', 'Início', 'time', '17:00'), field('end', 'Fim inclusive', 'time', '20:00'), field('discount', 'Desconto (%)', 'number', 15), {
        ...select('weekdays', 'Dias (Ctrl para vários)', ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((name, i) => ({
          id: String(i),
          name
        }))),
        type: 'multi',
        value: ['2', '3', '4']
      }, {
        ...select('productIds', 'Produtos (Ctrl para vários)', options),
        type: 'multi'
      }], '/api/ops/promotions', v => ({
        name: v.name,
        active: true,
        weekdays: v.weekdays.map(Number),
        startMinute: mins(v.start),
        endMinute: mins(v.end),
        discountBps: Math.round(Number(v.discount) * 100),
        productIds: v.productIds,
        channels: ['DINE_IN', 'COUNTER_PDV', 'QR_TABLE', 'DELIVERY', 'PICKUP', 'HOTEL_ROOM']
      }))}<p>Promoções simultâneas usam o maior desconto, sem acumular. Horários seguem Fortaleza.</p><div className="d26-ops-cards">{data.promotions.map((p: any) => <article key={p.id}><h3>{p.name}</h3><p>{p.discountBps / 100}% · {clock(p.startMinute)}–{clock(p.endMinute)}</p>{button(p.active ? 'Desativar' : 'Ativar', () => send('/api/ops/promotions', {
            ...p,
            active: !p.active
          }))}</article>)}</div></>}
 {page === 'cover' && data && <><p>Couvert só é ativado com valor e aviso prévio. Aplica-se a novas mesas, sem taxa de serviço sobre o couvert. No modo Papel, o garçom confirma a entrega sem uma tela na cozinha.</p><ActionForm title="Couvert, cozinha, café e previsão de entrega" busy={busy} fields={[{
        ...select('kitchenWorkflow', 'Fluxo da cozinha', [{
          id: 'PAPER',
          name: 'Papel / impressora'
        }, {
          id: 'KDS',
          name: 'Tela KDS'
        }]),
        value: data.settings.kitchenWorkflow
      }, field('enabled', 'Ativar couvert', 'checkbox', data.settings.cover.enabled), field('price', 'Valor por pessoa (R$)', 'text', data.settings.cover.unitCents / 100), field('notice', 'Aviso ao cliente', 'textarea', data.settings.cover.notice, true), field('start', 'Início do couvert', 'time', clock(data.settings.cover.startMinute)), field('end', 'Fim do couvert', 'time', clock(data.settings.cover.endMinute)), {
        ...select('weekdays', 'Dias de música (Ctrl para vários)', ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((name, i) => ({
          id: String(i),
          name
        }))),
        type: 'multi',
        value: data.settings.cover.weekdays.map(String)
      }, field('deliveryBaseMin', 'Previsão mínima (min)', 'number', data.settings.deliveryBaseMin), field('deliveryBaseMax', 'Previsão máxima (min)', 'number', data.settings.deliveryBaseMax), field('deliveryBusyThreshold', 'Fila que ativa prazo maior', 'number', data.settings.deliveryBusyThreshold), field('deliveryBusyExtra', 'Minutos adicionais', 'number', data.settings.deliveryBusyExtra), field('breakfastStart', 'Início do café / impressão da lista', 'time', clock(data.settings.breakfastPrintMinute)), field('breakfastEnd', 'Fim do café', 'time', clock(data.settings.breakfastServiceEnd))]} onSubmit={v => send('/api/ops/settings', {
        ...data.settings,
        kitchenWorkflow: v.kitchenWorkflow,
        deliveryBaseMin: Number(v.deliveryBaseMin),
        deliveryBaseMax: Number(v.deliveryBaseMax),
        deliveryBusyThreshold: Number(v.deliveryBusyThreshold),
        deliveryBusyExtra: Number(v.deliveryBusyExtra),
        breakfastPrintMinute: mins(v.breakfastStart),
        breakfastServiceEnd: mins(v.breakfastEnd),
        cover: {
          enabled: v.enabled,
          unitCents: cash(v.price),
          notice: v.notice ?? '',
          startMinute: mins(v.start),
          endMinute: mins(v.end),
          weekdays: v.weekdays.map(Number)
        }
      })} /></>}
 {page === 'corporate' && data && <>{can('finance:manage_accounts') && <details><summary>Cadastrar empresa conveniada</summary>{form('Nova empresa', [field('name', 'Empresa'), field('document', 'CNPJ'), field('credit', 'Limite de crédito (R$)', 'text', '0'), select('cycle', 'Fechamento', [{
          id: 'FORTNIGHT',
          name: 'Quinzenal'
        }, {
          id: 'MONTH',
          name: 'Mensal'
        }]), field('dueDays', 'Dias para vencimento', 'number', 7)], '/api/ops/companies', v => ({
          name: v.name,
          document: v.document,
          creditLimitCents: cash(v.credit),
          cycle: v.cycle,
          dueDays: Number(v.dueDays),
          active: true,
          autoInvoice: true
        }))}</details>}<div className="d26-ops-cards">{data.companies.map((c: any) => <article key={c.id}><h3>{c.name}</h3><p>Utilizado {money(c.exposureCents)} / limite {money(c.creditLimitCents)}</p><p>{c.cycle === 'MONTH' ? 'Mensal' : 'Quinzenal'} · vence em {c.dueDays} dias</p></article>)}</div>{data.hotel && form('Faturar hospedagem para empresa', [select('companyId', 'Empresa', data.companies), select('stayId', 'Hospedagem', data.hotel.stays.map((s: any) => ({
        id: s.id,
        name: 'Apto ' + s.roomNumber + ' · ' + s.guestName
      }))), field('signedBy', 'Nome de quem assinou / confirmou a comanda')], '/api/ops/company-charge', v => v, 'Lançar saldo no convênio')}<p>Confirme a assinatura da comanda. O nome acima registra sua conferência e não é assinatura digital. Faturar não gera entrada de dinheiro.</p>{can('finance:manage_receivables') && form('Fatura consolidada', [select('companyId', 'Empresa', data.companies), field('start', 'Período inicial', 'date', today().slice(0, 8) + '01'), field('end', 'Período final', 'date', today())], '/api/ops/company-invoice', v => v, 'Gerar no Contas a Receber')}<p>Fechamento automático no dia 1 e também no dia 16 para quinzenais, com o servidor ligado.</p>{data.invoices?.map((i: any) => <p key={i.id}>{i.description} · saldo {money(i.remaining_amount_cents)} · vence {i.due_date} · {i.status}</p>)}</>}
 {page === 'inbox' && data && <><p>Confira preço, endereço e disponibilidade antes de aceitar. <a href="/?delivery=1" target="_blank" rel="noreferrer">Abrir cardápio do cliente</a></p>{!data.length && <p>Nenhum pedido aguardando.</p>}<div className="d26-ops-cards">{data.map((r: any) => <article key={r.id}><h3>{r.customerName} · {r.deliveryType === 'PICKUP' ? 'Retirada' : 'Entrega'}</h3><p>{r.customerPhone}</p>{r.deliveryAddress && <p>{r.deliveryAddress.street}, {r.deliveryAddress.number} — {r.deliveryAddress.neighborhood} / {r.deliveryAddress.city}</p>}{r.items.map((i: any, index: number) => <p key={index}>{i.quantity} × {products.find(p => p.id === i.productId)?.name}<small>{i.notes} · {i.modifiers?.map((m: any) => m.optionName).join(', ')}</small></p>)}<strong>{money(r.quotedTotalCents)} · {r.paymentMethodDeclared}</strong><div className="d26-ops-row">{button('Aceitar pedido', () => send('/api/ops/delivery-decision', {
              id: r.id,
              accept: true
            }))}{button('Não confirmar', () => send('/api/ops/delivery-decision', {
              id: r.id,
              accept: false
            }))}</div></article>)}</div></>}
 {page === 'repeat' && <><ActionForm title="Último pedido por telefone" fields={[field('phone', 'WhatsApp com DDD')]} button="Buscar último pedido" onSubmit={async v => {
        const d = await call('/api/ops/delivery-repeat?phone=' + encodeURIComponent(v.phone));
        setPhone(v.phone);
        setRepeat(d);
        setMessage(d ? 'Pedido localizado. Revise os itens antes de repetir.' : 'Nenhum pedido anterior.');
      }} />{repeat && <><h3>Último pedido de {repeat.customerName} · {new Date(repeat.createdAt).toLocaleDateString('pt-BR')}</h3><button className="d26-btn d26-btn-secondary" onClick={() => setItems(repeat.items ?? [])}>Repetir itens para revisão</button><OrderBuilder products={products} items={items} setItems={setItems} /><ActionForm title="Repetir pedido" fields={[select('payment', 'Pagamento', [{
          id: 'PIX',
          name: 'PIX'
        }, {
          id: 'CASH',
          name: 'Dinheiro sem troco'
        }, {
          id: 'CREDIT_CARD',
          name: 'Crédito'
        }, {
          id: 'DEBIT_CARD',
          name: 'Débito'
        }])]} button="Criar pedido para conferência" busy={busy} onSubmit={async v => {
          const deliveryType = repeat.deliveryType === 'TAKEOUT' ? 'PICKUP' : 'DELIVERY',
            address = repeat.address ? {
              street: repeat.address.street,
              number: repeat.address.number,
              neighborhood: repeat.address.neighborhood,
              city: repeat.address.city,
              complement: repeat.address.complement ?? undefined,
              reference: repeat.address.reference ?? undefined
            } : undefined,
            quote = await call('/api/public/delivery/quote', {
              items,
              deliveryType,
              deliveryZoneId: repeat.deliveryZoneId ?? undefined,
              deliveryAddress: address
            });
          await send('/api/public/delivery/requests', {
            idempotencyKey: 'delivery-' + uid().replaceAll('-', ''),
            customerName: repeat.customerName,
            customerPhone: phone,
            deliveryType,
            deliveryZoneId: repeat.deliveryZoneId ?? undefined,
            deliveryAddress: address,
            items,
            paymentMethodDeclared: v.payment,
            quotedTotalCents: quote.totalCents
          }, true);
          setItems([]);
          setMessage('Pedido em Pedidos dos clientes. Confira e aceite para enviar à produção.');
        }} /></>}</>}
 </section>;
}

class OperationalBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<section className="d26-ops-hub"><p role="alert">Não foi possível mostrar esta rotina. Os lançamentos confirmados continuam salvos.</p><button className="d26-btn d26-btn-secondary" onClick={()=>this.setState({failed:false})}>Reabrir rotinas</button></section>:this.props.children;}
}
export function OperationsHub(props:Props){return <OperationalBoundary key={props.scope+':'+(props.mode??'')+':'+(props.userId??props.role)}><OperationsHubContent {...props}/></OperationalBoundary>;}
