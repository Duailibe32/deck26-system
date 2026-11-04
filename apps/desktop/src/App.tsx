import React, { useEffect, useMemo, useState } from 'react';
import {
  CatalogCategory,
  CatalogProduct,
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  HotelRoom,
  Order,
  OrderStatus,
  Payment,
  PaymentMethod,
  PrintJob,
  SYSTEM_MODULES,
  StockMovement,
  SyncOutboxEvent,
  SystemModuleId,
  Tab,
  UserRole,
  formatBrlCents,
  hasPermission
} from '@deck26/contracts';
import { Deck26Logo, MenuPriceBadge } from '@deck26/ui';

interface ServerStateSnapshot {
  lanAddresses: string[];
  cloudSyncState: {
    online: boolean;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  };
  catalog: { categories: CatalogCategory[]; products: CatalogProduct[] };
  tabs: Tab[];
  orders: Order[];
  payments: Payment[];
  printJobs: PrintJob[];
  stock: {
    balances: Array<{ productId: string; productName: string; sku: string; currentQuantity: number; updatedAt: string }>;
    recentMovements: StockMovement[];
  };
  hotelRooms: HotelRoom[];
  syncEvents: SyncOutboxEvent[];
}

const GROUP_LABELS: Record<string, string> = {
  OPERACIONAL: '1. Atendimento & Operação Local',
  CATALOGO_ESTOQUE: '2. Cardápio & Estoque',
  HOTELARIA: '3. Hotel Auto Posto Milla',
  GESTAO_RETAGUARDA: '4. Retaguarda & Gestão',
  INFRA_FISCAL: '5. Hardware, Fiscal & Sync'
};

export const DesktopApp: React.FC = () => {
  const localApiBase = useMemo(() => {
    const host = window.location.hostname || '127.0.0.1';
    return `http://${host}:4000`;
  }, []);

  const [activeModule, setActiveModule] = useState<SystemModuleId>(() => {
    const params = new URLSearchParams(window.location.search);
    const terminal = params.get('terminal');
    if (terminal === 'garcom') return 'garcons';
    if (terminal === 'cozinha') return 'cozinha';
    return 'dashboard';
  });

  const [activeRole, setActiveRole] = useState<UserRole>('OWNER');
  const [serverConnected, setServerConnected] = useState<boolean>(false);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const [snapshot, setSnapshot] = useState<ServerStateSnapshot>({
    lanAddresses: ['127.0.0.1'],
    cloudSyncState: { online: false, lastAttemptAt: null, lastSuccessAt: null, lastError: null },
    catalog: { categories: DECK26_INITIAL_CATEGORIES, products: DECK26_INITIAL_PRODUCTS },
    tabs: [],
    orders: [],
    payments: [],
    printJobs: [],
    stock: { balances: [], recentMovements: [] },
    hotelRooms: [],
    syncEvents: []
  });

  // Estados de formulário reais para os módulos operacionais
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [selectedTableNumber, setSelectedTableNumber] = useState<number>(1);
  const [waiterName, setWaiterName] = useState<string>('Garçom 01 (Wi-Fi)');
  const [cart, setCart] = useState<Array<{ product: CatalogProduct; quantity: number; notes: string }>>([]);
  const [paymentTabId, setPaymentTabId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PIX');

  async function refreshState() {
    try {
      const res = await fetch(`${localApiBase}/api/state`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ServerStateSnapshot;
      setSnapshot(data);
      setServerConnected(true);
    } catch {
      setServerConnected(false);
    }
  }

  useEffect(() => {
    refreshState();
    const timer = setInterval(refreshState, 4000);
    return () => clearInterval(timer);
  }, [localApiBase]);

  // Atalhos de teclado F1..F12 para operação ágil no computador Windows do Caixa
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const matched = SYSTEM_MODULES.find((m) => m.shortcut === e.key);
      if (matched && hasPermission(activeRole, matched.requiredPermission)) {
        e.preventDefault();
        setActiveModule(matched.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeRole]);

  function notify(msg: string) {
    setFeedbackBanner(msg);
    setTimeout(() => setFeedbackBanner(null), 5000);
  }

  function addToCart(product: CatalogProduct) {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { product, quantity: 1, notes: '' }];
    });
  }

  async function submitOrder(originNode: 'WINDOWS_PDV' | 'WAITER_MOBILE') {
    if (cart.length === 0) return;
    const idempotencyKey = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const res = await fetch(`${localApiBase}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          tableNumber: selectedTableNumber,
          channel: 'DINE_IN',
          originNode,
          waiterName,
          items: cart.map((c) => ({
            productId: c.product.id,
            quantity: c.quantity,
            notes: c.notes || undefined
          }))
        })
      });

      if (!res.ok) throw new Error('Falha ao gravar pedido no servidor local');
      const created = await res.json();
      setCart([]);
      await refreshState();
      notify(
        `Pedido #${created.order.id.slice(0, 8)} gravado na MESA ${selectedTableNumber} | ${created.printJobs.length} via(s) ESC/POS enfileirada(s) | ${created.stockMovements.length} baixa(s) de estoque.`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao enviar pedido');
    }
  }

  async function handleAdvanceOrder(orderId: string, status: OrderStatus) {
    await fetch(`${localApiBase}/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, originNode: 'KITCHEN_KDS' })
    });
    await refreshState();
    notify(`Pedido #${orderId.slice(0, 8)} atualizado para ${status}.`);
  }

  async function handleSettleTab(tab: Tab) {
    const remaining = Math.max(0, tab.totalCents - tab.paidCents);
    if (remaining <= 0) return;
    const res = await fetch(`${localApiBase}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: `pay-${tab.id}-${Date.now()}`,
        tabId: tab.id,
        method: paymentMethod,
        amountCents: remaining,
        receivedCashCents: remaining
      })
    });
    if (res.ok) {
      await refreshState();
      notify(`Pagamento de ${formatBrlCents(remaining)} (${paymentMethod}) confirmado para ${tab.code}.`);
    }
  }

  async function handleTriggerCloudSync() {
    const res = await fetch(`${localApiBase}/api/sync/trigger`, { method: 'POST' });
    const data = await res.json();
    await refreshState();
    if (data.synced) {
      notify(
        `Sincronização VPS concluída: ${data.ackedCount} enviados, ${data.pulledFromCloudCount} recebidos da nuvem.`
      );
    } else {
      notify(
        `Operação local garantida (Modo Offline). ${data.pendingLocalEvents} evento(s) aguardando conexão com a VPS.`
      );
    }
  }

  const currentModuleDef = SYSTEM_MODULES.find((m) => m.id === activeModule) ?? SYSTEM_MODULES[0]!;
  const openTabs = snapshot.tabs.filter((t) => t.status !== 'CLOSED' && t.status !== 'CANCELLED');
  const activeKitchenOrders = snapshot.orders.filter(
    (o) => o.status === 'RECEIVED' || o.status === 'IN_PREPARATION'
  );
  const pendingOutboxCount = snapshot.syncEvents.filter((e) => e.status === 'PENDING').length;

  return (
    <div className="d26-shell">
      {/* BARRA SUPERIOR DO APLICATIVO WINDOWS TAURI 2 */}
      <header className="d26-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Deck26Logo size={42} showHotelSubtitle />
          <span className="d26-badge d26-badge-outline-pink">Estação Windows Principal • Tauri 2</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className={`d26-badge ${serverConnected ? 'd26-badge-success' : 'd26-badge-warning'}`}>
            ● {serverConnected ? `Servidor Local Wi-Fi Ativo (${snapshot.lanAddresses[0]}:4000)` : 'Iniciando Servidor Local...'}
          </span>

          <span className={`d26-badge ${snapshot.cloudSyncState.online ? 'd26-badge-success' : 'd26-badge-outline-pink'}`}>
            ⇄ VPS Hostinger: {snapshot.cloudSyncState.online ? 'Sincronizado' : `Offline-First (${pendingOutboxCount} na Outbox)`}
          </span>

          <select
            aria-label="Perfil de Acesso RBAC"
            className="d26-select"
            style={{ width: '195px', padding: '6px 10px', fontSize: '0.78rem' }}
            value={activeRole}
            onChange={(e) => setActiveRole(e.target.value as UserRole)}
          >
            <option value="OWNER">Perfil: Proprietário (Total)</option>
            <option value="MANAGER">Perfil: Gerente</option>
            <option value="CASHIER">Perfil: Caixa / PDV</option>
            <option value="WAITER">Perfil: Garçom (Wi-Fi)</option>
            <option value="KITCHEN">Perfil: Cozinha (KDS)</option>
            <option value="RECEPTIONIST">Perfil: Recepção Hotel</option>
          </select>
        </div>
      </header>

      {/* NAVEGAÇÃO LATERAL COM OS 16 MÓDULOS OFICIAIS E CONTROLE RBAC */}
      <aside className="d26-sidebar">
        {(['OPERACIONAL', 'CATALOGO_ESTOQUE', 'HOTELARIA', 'GESTAO_RETAGUARDA', 'INFRA_FISCAL'] as const).map(
          (groupKey) => {
            const groupModules = SYSTEM_MODULES.filter((m) => m.group === groupKey);
            return (
              <div key={groupKey}>
                <div className="d26-nav-group-title">{GROUP_LABELS[groupKey]}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {groupModules.map((mod) => {
                    const permitted = hasPermission(activeRole, mod.requiredPermission);
                    return (
                      <button
                        key={mod.id}
                        className={`d26-nav-item ${activeModule === mod.id ? 'active' : ''}`}
                        onClick={() => permitted && setActiveModule(mod.id)}
                        disabled={!permitted}
                        title={mod.description}
                        style={{ opacity: permitted ? 1 : 0.38 }}
                      >
                        <span>{mod.shortTitle}</span>
                        {mod.shortcut && <span className="d26-shortcut">{mod.shortcut}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }
        )}
      </aside>

      {/* ÁREA DE TRABALHO PRINCIPAL */}
      <main className="d26-workspace">
        {feedbackBanner && (
          <div
            style={{
              background: 'rgba(230, 0, 92, 0.18)',
              border: '1px solid #FF1F78',
              padding: '10px 16px',
              borderRadius: '10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.86rem',
              fontWeight: 600
            }}
          >
            <span>{feedbackBanner}</span>
            <button className="d26-btn d26-btn-secondary" style={{ padding: '4px 10px' }} onClick={() => setFeedbackBanner(null)}>
              Fechar
            </button>
          </div>
        )}

        {/* CABEÇALHO DO MÓDULO ATIVO */}
        <div
          className="d26-card"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderLeft: '4px solid #E6005C'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '1.35rem', fontWeight: 800 }}>{currentModuleDef.title}</h1>
              <span className="d26-badge d26-badge-pink">100% Offline-First</span>
            </div>
            <p style={{ color: 'var(--d26-gray-300)', fontSize: '0.86rem', marginTop: '4px' }}>
              {currentModuleDef.description}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="d26-btn d26-btn-secondary" onClick={refreshState}>
              ↻ Atualizar Estado Local
            </button>
            <button className="d26-btn d26-btn-primary" onClick={handleTriggerCloudSync}>
              ⇄ Sincronizar com VPS Agora
            </button>
          </div>
        </div>

        {/* RENDERIZAÇÃO DO MÓDULO SELECIONADO */}
        {activeModule === 'dashboard' && (
          <>
            <div className="d26-grid-kpi">
              <div className="d26-card">
                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.78rem' }}>COMANDAS / MESAS ABERTAS</span>
                <div className="d26-kpi-value">{openTabs.length}</div>
                <span style={{ fontSize: '0.76rem', color: '#34D399' }}>Entidade Tab separada de Order</span>
              </div>
              <div className="d26-card">
                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.78rem' }}>FILA NA COZINHA / CHAPA (KDS)</span>
                <div className="d26-kpi-value">{activeKitchenOrders.length}</div>
                <span style={{ fontSize: '0.76rem', color: '#FF5C9E' }}>Tempo real via Wi-Fi Local</span>
              </div>
              <div className="d26-card">
                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.78rem' }}>FATURAMENTO RECEBIDO (TURNO)</span>
                <div className="d26-kpi-value">
                  {formatBrlCents(snapshot.payments.reduce((acc, p) => acc + p.amountCents, 0))}
                </div>
                <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-300)' }}>
                  {snapshot.payments.length} pagamento(s) liquidado(s)
                </span>
              </div>
              <div className="d26-card">
                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.78rem' }}>ITENS NO CATÁLOGO OFICIAL DECK 26</span>
                <div className="d26-kpi-value">{snapshot.catalog.products.length}</div>
                <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-300)' }}>
                  {snapshot.catalog.categories.length} categorias compartilhadas
                </span>
              </div>
            </div>

            <div className="d26-split-2">
              <div className="d26-card">
                <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>
                  Topologia Operacional Local (Dimensionamento 1 PC + 5 Garçons + 1 Cozinha)
                </h2>
                <table className="d26-table">
                  <thead>
                    <tr>
                      <th>Nó / Dispositivo</th>
                      <th>Canal de Rede</th>
                      <th>Dependência de Internet</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>1. Computador Windows (PDV/Caixa/Hotel)</strong></td>
                      <td>Localhost / Loopback (`127.0.0.1:4000`)</td>
                      <td>Zero (SQLite WAL Local)</td>
                      <td><span className="d26-badge d26-badge-success">Operacional</span></td>
                    </tr>
                    <tr>
                      <td><strong>2. 5 Celulares de Garçons (PWA LAN)</strong></td>
                      <td>Wi-Fi Local (`{snapshot.lanAddresses[0]}:5173/?terminal=garcom`)</td>
                      <td>Zero (Idempotência por Pedido)</td>
                      <td><span className="d26-badge d26-badge-success">Pronto na LAN</span></td>
                    </tr>
                    <tr>
                      <td><strong>3. 1 Dispositivo Cozinha KDS</strong></td>
                      <td>Wi-Fi Local (`{snapshot.lanAddresses[0]}:5173/?terminal=cozinha`)</td>
                      <td>Zero (Fila Local por Praça)</td>
                      <td><span className="d26-badge d26-badge-success">Pronto na LAN</span></td>
                    </tr>
                    <tr>
                      <td><strong>4. VPS Hostinger (QR Code / Delivery / Dono)</strong></td>
                      <td>HTTPS / Outbox Bidirecional</td>
                      <td>Sincroniza quando houver link</td>
                      <td>
                        <span className="d26-badge d26-badge-outline-pink">
                          {pendingOutboxCount} evento(s) pendente(s)
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="d26-card">
                <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>Acesso Rápido aos Módulos</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button className="d26-btn d26-btn-primary" onClick={() => setActiveModule('caixa-pdv')}>
                    Abrir Caixa & PDV (F2)
                  </button>
                  <button className="d26-btn d26-btn-secondary" onClick={() => setActiveModule('mesas-comandas')}>
                    Mesas e Comandas (F3)
                  </button>
                  <button className="d26-btn d26-btn-secondary" onClick={() => setActiveModule('garcons')}>
                    Terminal Garçons Wi-Fi (F5)
                  </button>
                  <button className="d26-btn d26-btn-secondary" onClick={() => setActiveModule('cozinha')}>
                    KDS Cozinha & Chapa (F6)
                  </button>
                  <button className="d26-btn d26-btn-secondary" onClick={() => setActiveModule('hotel-reservas')}>
                    Hotel Milla & Quartos (F8)
                  </button>
                  <button className="d26-btn d26-btn-secondary" onClick={() => setActiveModule('sincronizacao')}>
                    Outbox & Sync VPS (F12)
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* MÓDULOS DE LANÇAMENTO DE PEDIDOS E CAIXA (PDV, GARÇONS, PRODUTOS) */}
        {(activeModule === 'caixa-pdv' || activeModule === 'garcons' || activeModule === 'produtos-cardapio') && (
          <div className="d26-split-2">
            <div className="d26-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <h2 style={{ fontSize: '1.05rem' }}>Catálogo Oficial Compartilhado — Deck 26</h2>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    className={`d26-btn ${selectedCategoryId === 'ALL' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                    style={{ padding: '5px 10px', fontSize: '0.76rem' }}
                    onClick={() => setSelectedCategoryId('ALL')}
                  >
                    Todos ({snapshot.catalog.products.length})
                  </button>
                  {snapshot.catalog.categories.map((cat) => (
                    <button
                      key={cat.id}
                      className={`d26-btn ${selectedCategoryId === cat.id ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                      style={{ padding: '5px 10px', fontSize: '0.76rem' }}
                      onClick={() => setSelectedCategoryId(cat.id)}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="d26-product-grid">
                {snapshot.catalog.products
                  .filter((p) => selectedCategoryId === 'ALL' || p.categoryId === selectedCategoryId)
                  .map((product) => (
                    <div key={product.id} className="d26-product-card">
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                          <strong style={{ fontSize: '0.92rem' }}>{product.name}</strong>
                          <MenuPriceBadge cents={product.priceCents} />
                        </div>
                        <p style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)', marginTop: '4px' }}>
                          {product.description}
                        </p>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                        <span style={{ fontSize: '0.68rem', color: 'var(--d26-gray-400)' }}>
                          Praça: {product.prepStation === 'KITCHEN_HOT' ? 'Cozinha Quente' : 'Chapa / Tapioca'}
                        </span>
                        <button
                          className="d26-btn d26-btn-primary"
                          style={{ padding: '5px 12px', fontSize: '0.78rem' }}
                          onClick={() => addToCart(product)}
                        >
                          + Adicionar
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* COLUNA DIREITA: DISPARO DE PEDIDO SEPARADO DE COMANDA E PAGAMENTO */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="d26-card">
                <h2 style={{ fontSize: '1.05rem', marginBottom: '12px' }}>
                  Novo Pedido Local ({activeModule === 'garcons' ? 'Terminal Garçom Wi-Fi' : 'Caixa / PDV Windows'})
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--d26-gray-300)' }}>Mesa Destino</label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      className="d26-input"
                      value={selectedTableNumber}
                      onChange={(e) => setSelectedTableNumber(Number(e.target.value) || 1)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--d26-gray-300)' }}>Garçom / Operador</label>
                    <select
                      className="d26-select"
                      value={waiterName}
                      onChange={(e) => setWaiterName(e.target.value)}
                    >
                      <option value="Garçom 01 (Celular Wi-Fi)">Garçom 01 (Celular Wi-Fi)</option>
                      <option value="Garçom 02 (Celular Wi-Fi)">Garçom 02 (Celular Wi-Fi)</option>
                      <option value="Garçom 03 (Celular Wi-Fi)">Garçom 03 (Celular Wi-Fi)</option>
                      <option value="Garçom 04 (Celular Wi-Fi)">Garçom 04 (Celular Wi-Fi)</option>
                      <option value="Garçom 05 (Celular Wi-Fi)">Garçom 05 (Celular Wi-Fi)</option>
                      <option value="Operador Caixa Windows">Operador Caixa Windows</option>
                    </select>
                  </div>
                </div>

                {cart.length === 0 ? (
                  <p style={{ color: 'var(--d26-gray-400)', fontSize: '0.84rem', padding: '16px 0' }}>
                    Selecione itens do cardápio ao lado para compor o pedido da Mesa {selectedTableNumber}.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                    {cart.map((item) => (
                      <div
                        key={item.product.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: 'var(--d26-black-900)',
                          padding: '8px 12px',
                          borderRadius: '8px'
                        }}
                      >
                        <div>
                          <strong>{item.quantity}x {item.product.name}</strong>
                          <div style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>
                            {formatBrlCents(item.product.priceCents * item.quantity)}
                          </div>
                        </div>
                        <button
                          className="d26-btn d26-btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                          onClick={() => setCart((prev) => prev.filter((p) => p.product.id !== item.product.id))}
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: 'var(--d26-border-subtle)', paddingTop: '12px' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>Total deste Pedido:</span>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#FF1F78' }}>
                      {formatBrlCents(cart.reduce((acc, c) => acc + c.product.priceCents * c.quantity, 0))}
                    </div>
                  </div>
                  <button
                    className="d26-btn d26-btn-primary"
                    disabled={cart.length === 0}
                    onClick={() => submitOrder(activeModule === 'garcons' ? 'WAITER_MOBILE' : 'WINDOWS_PDV')}
                  >
                    Disparar Pedido p/ Cozinha & Comanda
                  </button>
                </div>
              </div>

              {/* LIQUIDAÇÃO DE COMANDAS ABERTAS NO CAIXA */}
              <div className="d26-card">
                <h3 style={{ fontSize: '0.96rem', marginBottom: '10px' }}>
                  Liquidação de Comandas Abertas (Entidade Payment Separada)
                </h3>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                  <select
                    className="d26-select"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  >
                    <option value="PIX">PIX</option>
                    <option value="CASH">Dinheiro em Espécie</option>
                    <option value="DEBIT_CARD">Cartão de Débito</option>
                    <option value="CREDIT_CARD">Cartão de Crédito</option>
                    <option value="ROOM_CHARGE">Transferir p/ Quarto Hotel Milla</option>
                  </select>
                </div>
                {openTabs.length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--d26-gray-400)' }}>Nenhuma comanda pendente de pagamento.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {openTabs.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px',
                          background: 'var(--d26-black-900)',
                          borderRadius: '8px'
                        }}
                      >
                        <div>
                          <strong>{t.code}</strong> ({t.status})
                          <div style={{ fontSize: '0.76rem', color: 'var(--d26-gray-300)' }}>
                            Subtotal: {formatBrlCents(t.subtotalCents)} + 10% ({formatBrlCents(t.serviceFeeCents)}) ={' '}
                            <strong style={{ color: '#FF5C9E' }}>{formatBrlCents(t.totalCents)}</strong>
                          </div>
                        </div>
                        <button className="d26-btn d26-btn-primary" onClick={() => handleSettleTab(t)}>
                          Receber {formatBrlCents(t.totalCents - t.paidCents)}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MÓDULO: COZINHA E BAR (KDS) */}
        {activeModule === 'cozinha' && (
          <div className="d26-card">
            <h2 style={{ fontSize: '1.05rem', marginBottom: '12px' }}>
              Fila de Produção KDS (Cozinha Quente, Chapa de Tapiocas/Cuscuz e Bar)
            </h2>
            {snapshot.orders.length === 0 ? (
              <p style={{ color: 'var(--d26-gray-400)' }}>Nenhum pedido na fila da cozinha no momento.</p>
            ) : (
              <div className="d26-product-grid">
                {snapshot.orders.map((ord) => (
                  <div key={ord.id} className="d26-product-card">
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span className="d26-badge d26-badge-pink">
                          {ord.tableNumber ? `MESA ${ord.tableNumber}` : ord.channel}
                        </span>
                        <span className="d26-badge d26-badge-outline-pink">{ord.status}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)', marginBottom: '8px' }}>
                        Pedido #{ord.id.slice(0, 8)} • Origem: {ord.originNode}
                      </div>
                      <ul style={{ paddingLeft: '16px', fontSize: '0.86rem', marginBottom: '10px' }}>
                        {ord.items.map((it) => (
                          <li key={it.id}>
                            <strong>{it.quantity}x {it.productName}</strong>{' '}
                            <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.73rem' }}>[{it.prepStation}]</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {ord.status === 'RECEIVED' && (
                        <button
                          className="d26-btn d26-btn-primary"
                          style={{ flex: 1 }}
                          onClick={() => handleAdvanceOrder(ord.id, 'IN_PREPARATION')}
                        >
                          Iniciar Preparo
                        </button>
                      )}
                      {ord.status === 'IN_PREPARATION' && (
                        <button
                          className="d26-btn d26-btn-primary"
                          style={{ flex: 1 }}
                          onClick={() => handleAdvanceOrder(ord.id, 'READY')}
                        >
                          Marcar Pronto
                        </button>
                      )}
                      {ord.status === 'READY' && (
                        <button
                          className="d26-btn d26-btn-secondary"
                          style={{ flex: 1 }}
                          onClick={() => handleAdvanceOrder(ord.id, 'DELIVERED')}
                        >
                          Entregue na Mesa
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* MÓDULO: MESAS, COMANDAS E PEDIDOS */}
        {(activeModule === 'mesas-comandas' || activeModule === 'pedidos') && (
          <div className="d26-split-2">
            <div className="d26-card">
              <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>Comandas Registradas (Entidade Tab)</h2>
              <table className="d26-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Subtotal</th>
                    <th>Taxa 10%</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.tabs.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.code}</strong></td>
                      <td>{t.type}</td>
                      <td><span className="d26-badge d26-badge-outline-pink">{t.status}</span></td>
                      <td>{formatBrlCents(t.subtotalCents)}</td>
                      <td>{formatBrlCents(t.serviceFeeCents)}</td>
                      <td><strong>{formatBrlCents(t.totalCents)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="d26-card">
              <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>Pedidos Disparados (Entidade Order)</h2>
              <table className="d26-table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Origem</th>
                    <th>Itens</th>
                    <th>Status</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.orders.map((o) => (
                    <tr key={o.id}>
                      <td>#{o.id.slice(0, 8)}</td>
                      <td>{o.originNode}</td>
                      <td>{o.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}</td>
                      <td>{o.status}</td>
                      <td>{formatBrlCents(o.totalOrderCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MÓDULO: ESTOQUE (ENTIDADE STOCK_MOVEMENT SEPARADA) */}
        {activeModule === 'estoque' && (
          <div className="d26-split-2">
            <div className="d26-card">
              <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>Saldos Atuais de Estoque</h2>
              <table className="d26-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Produto</th>
                    <th>Saldo Atual</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.stock.balances.slice(0, 15).map((b) => (
                    <tr key={b.productId}>
                      <td>{b.sku}</td>
                      <td>{b.productName}</td>
                      <td><strong>{b.currentQuantity} un</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="d26-card">
              <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>Razão Kardex Auditável (StockMovement)</h2>
              <table className="d26-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Tipo</th>
                    <th>Delta</th>
                    <th>Saldo Após</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.stock.recentMovements.map((m) => (
                    <tr key={m.id}>
                      <td>{m.productName}</td>
                      <td>{m.movementType}</td>
                      <td style={{ color: m.quantityDelta < 0 ? '#F87171' : '#34D399' }}>
                        {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                      </td>
                      <td>{m.balanceAfter}</td>
                      <td>{m.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MÓDULO: HOTEL AUTO POSTO MILLA & RESERVAS */}
        {activeModule === 'hotel-reservas' && (
          <div className="d26-card">
            <h2 style={{ fontSize: '1.05rem', marginBottom: '12px' }}>
              Mapa de Apartamentos — Hotel Auto Posto Milla (Integração Direta de Consumo com o Deck 26)
            </h2>
            <div className="d26-product-grid">
              {snapshot.hotelRooms.map((room) => (
                <div key={room.id} className="d26-product-card">
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: '1.05rem' }}>Apto {room.number}</strong>
                      <span
                        className={`d26-badge ${
                          room.status === 'AVAILABLE' ? 'd26-badge-success' : 'd26-badge-pink'
                        }`}
                      >
                        {room.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)', marginTop: '4px' }}>
                      Categoria: {room.category} • Diária: {formatBrlCents(room.dailyRateCents)}
                    </div>
                    {room.currentGuestName && (
                      <div style={{ marginTop: '8px', fontSize: '0.84rem', color: '#FF5C9E' }}>
                        Hóspede: <strong>{room.currentGuestName}</strong>
                      </div>
                    )}
                  </div>
                  {room.status === 'AVAILABLE' && (
                    <button
                      className="d26-btn d26-btn-primary"
                      onClick={async () => {
                        await fetch(`${localApiBase}/api/hotel/checkin`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ roomNumber: room.number, guestName: `Hóspede Apto ${room.number}` })
                        });
                        await refreshState();
                        notify(`Check-in realizado no Apto ${room.number} com abertura de Comanda de Quarto (Folio).`);
                      }}
                    >
                      Realizar Check-in Rápido
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MÓDULO: IMPRESSORAS TÉRMICAS ESC/POS */}
        {activeModule === 'impressoras' && (
          <div className="d26-card">
            <h2 style={{ fontSize: '1.05rem', marginBottom: '12px' }}>
              Spooler de Impressão Térmica ESC/POS (Entidade PrintJob Separada por Praça)
            </h2>
            {snapshot.printJobs.length === 0 ? (
              <p style={{ color: 'var(--d26-gray-400)' }}>Nenhum trabalho de impressão na fila no momento.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' }}>
                {snapshot.printJobs.map((job) => (
                  <div key={job.id} className="d26-product-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="d26-badge d26-badge-outline-pink">{job.targetPrinter}</span>
                      <span className={`d26-badge ${job.status === 'PRINTED' ? 'd26-badge-success' : 'd26-badge-warning'}`}>
                        {job.status}
                      </span>
                    </div>
                    <pre
                      style={{
                        background: '#050507',
                        padding: '10px',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontFamily: 'var(--d26-font-mono)',
                        overflowX: 'auto',
                        color: '#E4E4E9'
                      }}
                    >
                      {job.payloadText}
                    </pre>
                    {job.status !== 'PRINTED' && (
                      <button
                        className="d26-btn d26-btn-primary"
                        onClick={async () => {
                          await fetch(`${localApiBase}/api/print-jobs/${job.id}/mark-printed`, { method: 'POST' });
                          await refreshState();
                        }}
                      >
                        Confirmar Impressão Física
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* MÓDULO: SINCRONIZAÇÃO BIDIRECIONAL LOCAL ↔ VPS */}
        {activeModule === 'sincronizacao' && (
          <div className="d26-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h2 style={{ fontSize: '1.05rem' }}>
                  Outbox de Eventos Persistentes (Idempotência + SHA-256 + HLC)
                </h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)' }}>
                  Todos os eventos gravados no SQLite local permanecem seguros mesmo sem internet externa e sincronizam em lote com a VPS Hostinger.
                </p>
              </div>
              <button className="d26-btn d26-btn-primary" onClick={handleTriggerCloudSync}>
                Executar Ciclo Push/Pull Agora
              </button>
            </div>
            <table className="d26-table">
              <thead>
                <tr>
                  <th>Chave de Idempotência</th>
                  <th>Entidade</th>
                  <th>Operação</th>
                  <th>Versão</th>
                  <th>Checksum SHA-256</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.syncEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td style={{ fontFamily: 'var(--d26-font-mono)', fontSize: '0.76rem' }}>{ev.idempotencyKey}</td>
                    <td>{ev.entityType}</td>
                    <td>{ev.operation}</td>
                    <td>v{ev.entityVersion}</td>
                    <td style={{ fontFamily: 'var(--d26-font-mono)', fontSize: '0.74rem' }}>
                      {ev.checksumSha256.slice(0, 14)}…
                    </td>
                    <td>
                      <span className={`d26-badge ${ev.status === 'ACKED' ? 'd26-badge-success' : 'd26-badge-warning'}`}>
                        {ev.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* MÓDULO: CONFIGURAÇÕES FISCAIS (SEM EMISSÃO FICTÍCIA) */}
        {activeModule === 'configuracoes-fiscais' && (
          <div className="d26-card">
            <h2 style={{ fontSize: '1.05rem', marginBottom: '8px' }}>
              Configurações Fiscais SEFAZ (NFC-e Modelo 65 / NF-e Modelo 55)
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--d26-gray-300)', marginBottom: '16px' }}>
              Regra estrita de engenharia: este sistema <strong>não emite documentos fiscais fictícios ou simulados</strong>.
              Enquanto o Certificado Digital ICP-Brasil A1 (`.pfx`) e o Código de Segurança do Contribuinte (CSC) não
              estiverem configurados e validados junto à SEFAZ, os recebimentos operam exclusivamente como comprovantes
              internos de controle de comanda.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Razão Social</label>
                <input className="d26-input" defaultValue="HOTEL AUTO POSTO MILLA LTDA" readOnly />
              </div>
              <div>
                <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Modo Fiscal Atual</label>
                <input className="d26-input" value="DISABLED_NOT_CONFIGURED (Aguardando Certificado A1 Real)" readOnly />
              </div>
            </div>
          </div>
        )}

        {/* DEMAIS MÓDULOS ESTRUTURADOS NESTA ETAPA INICIAL */}
        {(['financeiro', 'relatorios', 'funcionarios', 'administracao'] as SystemModuleId[]).includes(activeModule) && (
          <div className="d26-card">
            <h2 style={{ fontSize: '1.05rem', marginBottom: '8px' }}>
              Estrutura Base Pronta — {currentModuleDef.title}
            </h2>
            <p style={{ fontSize: '0.86rem', color: 'var(--d26-gray-300)' }}>
              A navegação, permissões RBAC (`{currentModuleDef.requiredPermission}`), contratos compartilhados em{' '}
              <code>@deck26/contracts</code> e tabelas de banco de dados deste módulo já estão configurados e prontos
              para o detalhamento funcional nas próximas etapas aprovadas.
            </p>
          </div>
        )}
      </main>

      {/* RODAPÉ TÉCNICO DO PROGRAMA WINDOWS */}
      <footer className="d26-statusbar">
        <div>
          <strong>DECK 26</strong> • Hotel Auto Posto Milla • Arquitetura Tauri 2 + Fastify + SQLite WAL (Baixo Consumo de RAM)
        </div>
        <div>
          Garçons na Wi-Fi: <code>http://{snapshot.lanAddresses[0]}:5173/?terminal=garcom</code> | Cozinha KDS:{' '}
          <code>http://{snapshot.lanAddresses[0]}:5173/?terminal=cozinha</code>
        </div>
      </footer>
    </div>
  );
};
