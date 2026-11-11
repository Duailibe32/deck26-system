import React, { useEffect, useState } from 'react';
import type { CatalogProduct, CatalogCategory, StockMovement, UserRole } from '@deck26/contracts';
import { hasPermission } from '@deck26/contracts';
import { randomBrowserId } from './browserIds.js';
import { parseMoney } from './desktopModels.js';
import { ProductPhotoManager } from './ProductPhotos.js';
import { ShelfInventory } from './ShelfInventory.js';
import './stock-workspace.css';
type Balance = {
  productId: string;
  currentQuantity: number;
  minStockQuantity?: number;
  lowStockAlert?: boolean;
};
type Mode = 'ENTRY' | 'LOSS' | 'INTERNAL' | 'COUNT';
const labels: Record<string, string> = {
  ENTRY: 'Entrada',
  LOSS: 'Perda / quebra',
  INTERNAL: 'Consumo interno',
  COUNT: 'Contagem física',
  PURCHASE_ENTRY: 'Compra / entrada',
  SALE_DEDUCTION: 'Baixa de venda',
  WASTE_OR_LOSS: 'Perda / quebra',
  INVENTORY_ADJUST: 'Contagem / ajuste',
  INTERNAL_USE: 'Consumo interno',
  RETURN_ENTRY: 'Devolução',
  REVERSAL_ENTRY: 'Estorno'
};
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const number = (n: number) => n.toLocaleString('pt-BR', {
  maximumFractionDigits: 3
});
export const parseStockQuantity = (v: string) => /^\d+(?:[.,]\d{1,3})?$/.test(v.trim()) ? Number(v.trim().replace(',', '.')) : null;
export function StockWorkspace({
  api,
  headers,
  role,
  userId,
  products,
  categories,
  balances,
  movements,
  refresh
}: {
  api: string;
  headers: () => Record<string, string>;
  role: UserRole;
  userId: string;
  products: CatalogProduct[];
  categories: CatalogCategory[];
  balances: Balance[];
  movements: StockMovement[];
  refresh: () => Promise<void>;
}) {
  const key = 'deck26:stock-quick:' + userId;
  const [pane, setPane] = useState<'BALANCES' | 'HISTORY' | 'PHOTOS' | 'INVENTORY'>(()=>new URLSearchParams(window.location.search).get('terminal')==='estoque'?'INVENTORY':'BALANCES'),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState('ALL'),
    [filter, setFilter] = useState('ALL'),
    [selected, setSelected] = useState<CatalogProduct | null>(null),
    [mode, setMode] = useState<Mode>('ENTRY'),
    [qty, setQty] = useState('1'),
    [reason, setReason] = useState(''),
    [cost, setCost] = useState(''),
    [baseline, setBaseline] = useState(0),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [pending, setPending] = useState<any>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  });
  const tracked = products.filter(p => p.active && p.trackStock),
    balance = (id: string) => balances.find(b => b.productId === id)?.currentQuantity ?? 0;
  const low = (p: CatalogProduct) => balance(p.id) <= (p.minStockQuantity ?? 5),
    zero = tracked.filter(p => balance(p.id) <= 0),
    minimum = tracked.filter(low);
  const shown = tracked.filter(p => (category === 'ALL' || p.categoryId === category) && normalize(p.name + ' ' + p.sku + ' ' + (p.barcode ?? '')).includes(normalize(query)) && (filter === 'ALL' || filter === 'ZERO' && balance(p.id) <= 0 || filter === 'LOW' && low(p))).sort((a, b) => Number(low(b)) - Number(low(a)) || a.name.localeCompare(b.name, 'pt-BR'));
  useEffect(() => {
    try {
      if (pending) sessionStorage.setItem(key, JSON.stringify(pending));else sessionStorage.removeItem(key);
    } catch {}
  }, [pending, key]);
  const open = (p: CatalogProduct, m: Mode) => {
    if (pending) {
      setMessage('Existe um envio sem confirmação. Use Reenviar operação original antes de iniciar outro.');
      return;
    }
    setSelected(p);
    setBaseline(balance(p.id));
    setMode(m);
    setQty(m === 'COUNT' ? String(balance(p.id)).replace('.', ',') : '1');
    setReason(m === 'COUNT' ? 'Contagem física' : m === 'ENTRY' ? 'Entrada de mercadoria' : m === 'LOSS' ? 'Perda / quebra' : 'Consumo interno');
    setCost('');
    setReview(false);
    setMessage('');
  };
  const quantity = parseStockQuantity(qty),
    before = selected ? baseline : 0,
    delta = quantity === null ? 0 : Math.round((mode === 'COUNT' ? quantity - before : mode === 'LOSS' || mode === 'INTERNAL' ? -quantity : quantity) * 1000) / 1000,
    after = Math.round((before + delta) * 1000) / 1000;
  const submit = async () => {
    if (busy) return;
    let body = pending;
    try {
      if (!body) {
        if (!selected || quantity === null || quantity > 1000000 || mode !== 'COUNT' && quantity <= 0 || reason.trim().length < 3 || after < 0) throw Error('Confira quantidade, motivo e saldo final.');
        const unitCostCents = mode === 'ENTRY' && cost.trim() ? parseMoney(cost) : undefined;
        if (unitCostCents !== undefined && unitCostCents === null) throw Error('Informe um custo válido.');
        body = {
          idempotencyKey: 'stock-ui-' + randomBrowserId(),
          productId: selected.id,
          mode,
          quantity,
          expectedQuantity: before,
          reason: reason.trim(),
          ...(unitCostCents !== undefined ? {
            unitCostCents
          } : {})
        };
        setPending(body);
        try {
          sessionStorage.setItem(key, JSON.stringify(body));
        } catch {}
      }
      setBusy(true);
      const response = await fetch(api + '/api/ops/stock-quick', {
        method: 'POST',
        headers: {
          ...headers(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 400) {
          setPending(null);
          setReview(false);
          setSelected(null);
          await refresh();
        }
        throw Error(result.error || 'Não foi possível registrar.');
      }
      setPending(null);
      setSelected(null);
      setReview(false);
      setMessage((result.idempotentReplay ? 'Operação original recuperada. ' : 'Movimento registrado. ') + 'Saldo: ' + number(result.currentQuantity) + ' ' + (products.find(p => p.id === body.productId)?.unitOfMeasure ?? 'UN'));
      await refresh().catch(() => setMessage('Lançamento confirmado. Atualize os saldos para continuar.'));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <section className="d26-stock-workspace"><header className="d26-stock-hero"><div><small>DECK 26 · ESTOQUE SEM COMPLICAÇÃO</small><h2>Encontre. Confira. Movimente.</h2><p>Quantidade e unidade sempre à vista. Toda alteração mantém seu histórico.</p></div><button disabled={busy} onClick={() => void refresh().catch(() => setMessage('Não foi possível atualizar.'))}>↻ Atualizar saldos</button></header>
 <nav aria-label="Áreas do estoque"><button aria-pressed={pane === 'BALANCES'} onClick={() => setPane('BALANCES')}>Saldos & movimentos</button><button aria-pressed={pane === 'INVENTORY'} onClick={() => setPane('INVENTORY')}>Inventário por prateleira</button><button aria-pressed={pane === 'HISTORY'} onClick={() => setPane('HISTORY')}>Histórico recente</button>{hasPermission(role, 'catalog:manage') && <button aria-pressed={pane === 'PHOTOS'} onClick={() => setPane('PHOTOS')}>Fotos do cardápio</button>}</nav>
 {pane==='INVENTORY'&&<ShelfInventory key={userId} api={api} headers={headers} userId={userId} products={tracked} balance={balance} refresh={refresh}/>}
 {message && <p role="status" className="d26-stock-message">{message}</p>}{pending && <aside className="d26-stock-message">Envio sem confirmação. Os dados originais estão guardados para evitar duplicação. <button disabled={busy} onClick={() => void submit()}>Reenviar operação original</button></aside>}
 {pane === 'INVENTORY' ? null : pane === 'PHOTOS' ? <ProductPhotoManager api={api} headers={headers} products={products} refresh={refresh} /> : <><div className="d26-stock-stats"><button aria-pressed={filter === 'ALL'} onClick={() => {
          setFilter('ALL');
          setPane('BALANCES');
        }}><span>Produtos controlados</span><b>{tracked.length}</b></button><button aria-pressed={filter === 'LOW'} onClick={() => {
          setFilter('LOW');
          setPane('BALANCES');
        }}><span>Precisam de reposição</span><b>{minimum.length}</b></button><button aria-pressed={filter === 'ZERO'} onClick={() => {
          setFilter('ZERO');
          setPane('BALANCES');
        }}><span>Sem saldo disponível</span><b>{zero.length}</b></button></div><div className="d26-stock-search"><label>Buscar produto ou código de barras<input type="search" placeholder="Ex.: cerveja, carne, código…" value={query} onChange={e => setQuery(e.target.value)} /></label><label>Categoria<select value={category} onChange={e => setCategory(e.target.value)}><option value="ALL">Todas as categorias</option>{categories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
 {pane === 'BALANCES' ? <><p className="d26-stock-hint">Entrada soma mercadoria. Saída registra perda ou consumo interno. Na contagem, informe o total encontrado, sem calcular a diferença. Produtos com ficha técnica podem baixar seus insumos; confira as unidades e receitas em Rotinas de compras.</p><div className="d26-stock-products">{shown.map(p => <article key={p.id} className={balance(p.id) <= 0 ? 'empty' : low(p) ? 'low' : ''}><header><div><small>{p.sku}</small><h3>{p.name}</h3><span>{categories.find(c => c.id === p.categoryId)?.name}</span></div><div className="d26-stock-balance"><b>{number(balance(p.id))}</b><span>{p.unitOfMeasure ?? 'UN'}</span></div></header><p>Mínimo: {number(p.minStockQuantity ?? 5)} {p.unitOfMeasure ?? 'UN'} <strong>{balance(p.id) <= 0 ? 'Sem saldo' : low(p) ? 'Repor estoque' : 'Saldo disponível'}</strong></p><div className="d26-stock-actions"><button disabled={busy || !!pending} onClick={() => open(p, 'ENTRY')}>＋ Entrada</button><button disabled={busy || !!pending} onClick={() => open(p, 'LOSS')}>− Saída</button><button disabled={busy || !!pending} onClick={() => open(p, 'COUNT')}>✓ Contar</button></div></article>)}</div>{!shown.length && <p>Nenhum produto encontrado com estes filtros.</p>}</> : <div className="d26-stock-history">{movements.filter(m => {
          const p = products.find(p => p.id === m.productId);
          return normalize(m.productName + ' ' + (p?.sku ?? '') + ' ' + m.reason).includes(normalize(query)) && (category === 'ALL' || p?.categoryId === category);
        }).map(m => <article key={m.id}><div><strong>{m.productName}</strong><small>{labels[m.movementType] ?? m.movementType} · {new Date(m.createdAt).toLocaleString('pt-BR', {
                timeZone: 'America/Fortaleza'
              })}</small><p>{m.reason}</p></div><div><b className={m.quantityDelta < 0 ? 'negative' : 'positive'}>{m.quantityDelta > 0 ? '+' : ''}{number(m.quantityDelta)} {products.find(p => p.id === m.productId)?.unitOfMeasure ?? 'UN'}</b><small>Saldo após: {number(m.balanceAfter)}</small></div></article>)}{!movements.length && <p>Ainda não há movimentos registrados.</p>}</div>}</>}
 {selected && <div className="d26-stock-overlay" role="dialog" aria-modal="true" aria-label="Movimentar estoque"><section><button className="d26-stock-close" disabled={busy} onClick={() => setSelected(null)}>Fechar ×</button><small>{labels[mode]} · {selected.unitOfMeasure ?? 'UN'}</small><h2>{selected.name}</h2><p>Saldo atual: <b>{number(before)} {selected.unitOfMeasure ?? 'UN'}</b></p>{!review ? <form onSubmit={e => {
          e.preventDefault();
          if (quantity === null || after < 0 || mode !== 'COUNT' && quantity === 0) {
            setMessage('Confira a quantidade e o saldo disponível.');
            return;
          }
          setReview(true);
        }}><label>Operação<select value={mode} disabled={!!pending} onChange={e => {
              const next = e.target.value as Mode;
              setMode(next);
              setCost('');
              setQty(next === 'COUNT' ? String(before).replace('.', ',') : '1');
              setReason(next === 'COUNT' ? 'Contagem física' : next === 'ENTRY' ? 'Entrada de mercadoria' : next === 'LOSS' ? 'Perda / quebra' : 'Consumo interno');
            }}><option value="ENTRY">Entrada de mercadoria</option><option value="LOSS">Perda / quebra / vencimento</option><option value="INTERNAL">Consumo interno</option><option value="COUNT">Contagem física (total encontrado)</option></select></label><label>{mode === 'COUNT' ? 'Quantidade encontrada no estoque' : 'Quantidade para movimentar'} ({selected.unitOfMeasure ?? 'UN'})<input autoFocus required inputMode="decimal" value={qty} disabled={!!pending} onChange={e => setQty(e.target.value)} /></label><div className="d26-stock-actions">{[1, 5, 10].map(n => <button type="button" key={n} disabled={!!pending} onClick={() => setQty(String(n))}>{n} {selected.unitOfMeasure ?? 'UN'}</button>)}</div>{mode === 'ENTRY' && <label>Custo por {selected.unitOfMeasure ?? 'UN'} em R$ (opcional)<input inputMode="decimal" value={cost} disabled={!!pending} onChange={e => setCost(e.target.value)} /></label>}<label>Motivo da conferência<input required minLength={3} maxLength={280} value={reason} disabled={!!pending} onChange={e => setReason(e.target.value)} /></label><p className="d26-stock-hint">Entrada avulsa não gera uma conta a pagar. Para compras com fornecedor e faturamento, utilize o módulo financeiro.</p><button className="primary">Conferir movimento</button></form> : <><div className="d26-stock-preview"><span>Antes<b>{number(before)}</b></span><span>{mode === 'COUNT' ? 'Diferença' : 'Movimento'}<b>{delta > 0 ? '+' : ''}{number(delta)}</b></span><span>Depois<b>{number(after)}</b></span></div><p>{labels[mode]} · {reason}</p><p>{selected.unitOfMeasure ?? 'UN'} · O lançamento será registrado no histórico do operador.</p><div className="d26-stock-actions"><button disabled={busy || !!pending} onClick={() => setReview(false)}>Voltar e revisar</button><button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Registrando…' : pending ? 'Reenviar operação original' : 'Confirmar lançamento'}</button></div></>}{message && <p role="alert" className="d26-stock-message">{message}</p>}</section></div>}
 </section>;
}
