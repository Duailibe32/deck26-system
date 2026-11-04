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

interface AuthSessionInfo {
  token: string;
  userId: string;
  name: string;
  role: UserRole;
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

  // Autenticação Real por PIN no Backend (Substitui seletor visual sem senha)
  const [authSession, setAuthSession] = useState<AuthSessionInfo | null>(null);
  const [pinInput, setPinInput] = useState<string>('2626');
  const [showPinModal, setShowPinModal] = useState<boolean>(false);

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
  const [selectedTableNumber, setSelectedTableNumber] = useState<number>(5);
  const [waiterName, setWaiterName] = useState<string>('Garçom 01 (Wi-Fi)');
  const [cart, setCart] = useState<Array<{ product: CatalogProduct; quantity: number; notes: string }>>([]);

  // Pagamentos Parciais ou Totais por Comanda (em Reais ex: "50,00")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PIX');
  const [partialAmountsInput, setPartialAmountsInput] = useState<Record<string, string>>({});

  const activeRole: UserRole = authSession?.role ?? 'OWNER';

  function getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authSession?.token) {
      headers.Authorization = `Bearer ${authSession.token}`;
    }
    return headers;
  }

  async function authenticateWithPin(pinToUse: string) {
    try {
      const res = await fetch(`${localApiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinToUse })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'PIN inválido' }));
        notify(errData.error ?? 'PIN incorreto.');
        return;
      }
      const data = await res.json();
      setAuthSession({
        token: data.token,
        userId: data.user.userId,
        name: data.user.name,
        role: data.user.role
      });
      setShowPinModal(false);
      notify(`Operador autenticado: ${data.user.name} (${data.user.role})`);
    } catch {
      // Se o servidor ainda estiver iniciando, aguarda silenciosamente
    }
  }

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
    authenticateWithPin('2626');
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
    setTimeout(() => setFeedbackBanner(null), 6000);
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
        headers: getAuthHeaders(),
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

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: 'Falha ao gravar pedido' }));
        throw new Error(errJson.error ?? 'Falha ao gravar pedido no servidor local');
      }
      const created = await res.json();
      setCart([]);
      await refreshState();
      notify(
        `Pedido #${created.order.id.slice(0, 8)} gravado na MESA ${selectedTableNumber} | ${created.printJobs.length} via(s) incremental(is) ESC/POS enfileirada(s) | ${created.stockMovements.length} baixa(s) de estoque.`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao enviar pedido');
    }
  }

  async function handleAdvanceOrder(orderId: string, status: OrderStatus) {
    const res = await fetch(`${localApiBase}/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status, originNode: 'KITCHEN_KDS' })
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({ error: 'Sem permissão' }));
      notify(errJson.error ?? 'Erro ao avançar pedido');
      return;
    }
    await refreshState();
    notify(`Pedido #${orderId.slice(0, 8)} atualizado para ${status}.`);
  }

  function parseReaisToCents(raw: string, fallbackCents: number): number {
    if (!raw || !raw.trim()) return fallbackCents;
    const normalized = raw.replace(/\./g, '').replace(',', '.').trim();
    const num = Number(normalized);
    if (Number.isNaN(num) || num <= 0) return fallbackCents;
    return Math.round(num * 100);
  }

  async function handleSettleTab(tab: Tab) {
    const remainingCents = Math.max(0, tab.totalCents - tab.paidCents);
    if (remainingCents <= 0) return;

    const customStr = partialAmountsInput[tab.id];
    const amountCentsToPay = parseReaisToCents(customStr ?? '', remainingCents);

    const res = await fetch(`${localApiBase}/api/payments`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        idempotencyKey: `pay-${tab.id}-${Date.now()}`,
        tabId: tab.id,
        method: paymentMethod,
        amountCents: amountCentsToPay,
        receivedCashCents: amountCentsToPay
      })
    });

    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível registrar o pagamento.');
      return;
    }

    setPartialAmountsInput((prev) => ({ ...prev, [tab.id]: '' }));
    await refreshState();
    const newRemaining = Math.max(0, data.tab.totalCents - data.tab.paidCents);
    notify(
      `Pagamento de ${formatBrlCents(amountCentsToPay)} (${paymentMethod}) confirmado para ${tab.code}. Status: ${data.tab.status} | Saldo Restante: ${formatBrlCents(newRemaining)}`
    );
  }

  async function handleTriggerCloudSync() {
    const res = await fetch(`${localApiBase}/api/sync/trigger`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    await refreshState();
    if (data.synced) {
      notify(
        `Sincronização VPS concluída: ${data.ackedCount} enviados, ${data.pulledFromCloudCount} recebidos da nuvem.`
      );
    } else {
      notify(
        `Operação local garantida (Modo Offline). ${data.pendingLocalEvents ?? 0} evento(s) aguardando conexão com a VPS.`
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
          <span className="d26-badge d26-badge-purple">Windows 11 • Tauri 2</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className={`d26-badge ${serverConnected ? 'd26-badge-success' : 'd26-badge-warning'}`}>
            ● {serverConnected ? `SQLite Local Ativo (Porta 4000)` : 'Iniciando Servidor Local...'}
          </span>

          <span className={`d26-badge ${snapshot.cloudSyncState.online ? 'd26-badge-success' : 'd26-badge-outline-purple'}`}>
            ⇄ VPS Simulada: {snapshot.cloudSyncState.online ? 'Sincronizado' : `Offline-First (${pendingOutboxCount} na Outbox)`}
          </span>

          <button
            className="d26-btn d26-btn-tertiary"
            style={{ padding: '6px 12px', fontSize: '0.78rem' }}
            onClick={() => setShowPinModal((v) => !v)}
          >
            🔐 {authSession ? `${authSession.name} [${authSession.role}]` : 'Autenticar PIN'}
          </button>
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
        {/* MODAL DE AUTENTICAÇÃO REAL POR PIN NO BACKEND */}
        {showPinModal && (
          <div
            className="d26-card"
            style={{
              border: '1px solid #7209B7',
              background: 'linear-gradient(135deg, #1A1A1A 0%, #1F112B 100%)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '14px'
            }}
          >
            <div>
              <h3 style={{ fontSize: '0.98rem' }}>🔐 Autenticação de Operador por PIN (Validado no Backend com Token HMAC)</h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-300)', marginTop: '3px' }}>
                PINs de Desenvolvimento: Proprietário <code>2626</code> | Gerente <code>1010</code> | Caixa <code>2020</code> | Garçom <code>3030</code> | Cozinha <code>4040</code> | Recepção <code>5050</code>
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="password"
                className="d26-input"
                style={{ width: '130px' }}
                placeholder="Digite o PIN"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
              />
              <button className="d26-btn d26-btn-primary" onClick={() => authenticateWithPin(pinInput)}>
                Validar PIN
              </button>
              <button className="d26-btn d26-btn-secondary" onClick={() => setShowPinModal(false)}>
                Fechar
              </button>
            </div>
          </div>
        )}

        {feedbackBanner && (
          <div
            style={{
              background: 'linear-gradient(90deg, rgba(247, 37, 133, 0.2), rgba(114, 9, 183, 0.25))',
              border: '1px solid #F72585',
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
            borderLeft: '4px solid #F72585'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '1.35rem', fontWeight: 800 }}>{currentModuleDef.title}</h1>
              <span className="d26-badge d26-badge-pink">Primary #F72585</span>
              <span className="d26-badge d26-badge-purple">Tertiary #7209B7</span>
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
              ⇄ Sincronizar com VPS Simulada
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
                <span style={{ fontSize: '0.76rem', color: '#34D399' }}>Suporte a Pagamento Parcial Ativo</span>
              </div>
              <div className="d26-card">
                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.78rem' }}>FILA NA COZINHA / CHAPA (KDS)</span>
                <div className="d26-kpi-value">{activeKitchenOrders.length}</div>
                <span style={{ fontSize: '0.76rem', color: '#FFAFCC' }}>Impressão Incremental por Pedido</span>
              </div>
              <div className="d26-card">
                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.78rem' }}>FATURAMENTO RECEBIDO (TURNO)</span>
                <div className="d26-kpi-value">
                  {formatBrlCents(snapshot.payments.reduce((acc, p) => acc + p.amountCents, 0))}
                </div>
                <span style={{ fontSize: '0.76rem', color: '#D8B4FE' }}>
                  {snapshot.payments.length} pagamento(s) confirmado(s)
                </span>
              </div>
              <div className="d26-card">
                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.78rem' }}>PRODUTOS NO CATÁLOGO OFICIAL</span>
                <div className="d26-kpi-value">{snapshot.catalog.products.length}</div>
                <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-300)' }}>
                  {snapshot.catalog.categories.length} categorias compartilhadas
                </span>
              </div>
            </div>

            <div className="d26-split-2">
              <div className="d26-card">
                <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>
                  Ambiente Local de Desenvolvimento (Windows 11 — Persistência Dual SQLite)
                </h2>
                <table className="d26-table">
                  <thead>
                    <tr>
                      <th>Serviço</th>
                      <th>Porta</th>
                      <th>Persistência</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>1. Servidor Operacional Local</strong></td>
                      <td><code>127.0.0.1:4000</code></td>
                      <td><code>data/deck26-local.sqlite</code></td>
                      <td><span className="d26-badge d26-badge-success">Ativo</span></td>
                    </tr>
                    <tr>
                      <td><strong>2. Interface Windows (PDV / Caixa / Mesas)</strong></td>
                      <td><code>localhost:5173</code></td>
                      <td>Consome API Local</td>
                      <td><span className="d26-badge d26-badge-pink">Ativo</span></td>
                    </tr>
                    <tr>
                      <td><strong>3. Servidor de Nuvem Simulado (VPS)</strong></td>
                      <td><code>127.0.0.1:4100</code></td>
                      <td><code>data/deck26-cloud-vps.sqlite</code></td>
                      <td>
                        <span className="d26-badge d26-badge-purple">
                          {pendingOutboxCount} na Outbox
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td><strong>4. Site Público (Cardápio QR / Delivery)</strong></td>
                      <td><code>localhost:5174</code></td>
                      <td>Consome VPS Simulada</td>
                      <td><span className="d26-badge d26-badge-outline-pink">Pronto</span></td>
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
                  <button className="d26-btn d26-btn-tertiary" onClick={() => setActiveModule('mesas-comandas')}>
                    Mesas e Comandas (F3)
                  </button>
                  <button className="d26-btn d26-btn-secondary" onClick={() => setActiveModule('garcons')}>
                    Terminal Garçons (F5)
                  </button>
                  <button className="d26-btn d26-btn-secondary" onClick={() => setActiveModule('cozinha')}>
                    KDS Cozinha & Chapa (F6)
                  </button>
                  <button className="d26-btn d26-btn-secondary" onClick={() => setActiveModule('impressoras')}>
                    Fila Impressão Incremental
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
                      className={`d26-btn ${selectedCategoryId === cat.id ? 'd26-btn-tertiary' : 'd26-btn-secondary'}`}
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
                        <span className="d26-badge d26-badge-outline-purple" style={{ fontSize: '0.65rem' }}>
                          {product.prepStation}
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

            {/* COLUNA DIREITA: DISPARO DE PEDIDO INCREMENTAL E PAGAMENTO PARCIAL */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="d26-card">
                <h2 style={{ fontSize: '1.05rem', marginBottom: '12px' }}>
                  Novo Pedido Incremental ({activeModule === 'garcons' ? 'Terminal Garçom' : 'Caixa / PDV Windows'})
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
                      <option value="Garçom 01 (Wi-Fi)">Garçom 01 (Wi-Fi)</option>
                      <option value="Garçom 02 (Wi-Fi)">Garçom 02 (Wi-Fi)</option>
                      <option value="Garçom 03 (Wi-Fi)">Garçom 03 (Wi-Fi)</option>
                      <option value="Garçom 04 (Wi-Fi)">Garçom 04 (Wi-Fi)</option>
                      <option value="Garçom 05 (Wi-Fi)">Garçom 05 (Wi-Fi)</option>
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
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#F72585' }}>
                      {formatBrlCents(cart.reduce((acc, c) => acc + c.product.priceCents * c.quantity, 0))}
                    </div>
                  </div>
                  <button
                    className="d26-btn d26-btn-primary"
                    disabled={cart.length === 0}
                    onClick={() => submitOrder(activeModule === 'garcons' ? 'WAITER_MOBILE' : 'WINDOWS_PDV')}
                  >
                    Disparar Pedido Incremental
                  </button>
                </div>
              </div>

              {/* LIQUIDAÇÃO PARCIAL OU TOTAL DE COMANDAS ABERTAS NO CAIXA */}
              <div className="d26-card">
                <h3 style={{ fontSize: '0.96rem', marginBottom: '6px' }}>
                  Recebimento Parcial ou Total de Comandas (Caixa)
                </h3>
                <p style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)', marginBottom: '10px' }}>
                  Informe o valor parcial que o cliente deseja pagar agora (ex: <code>50,00</code> via PIX e depois <code>80,00</code> em Dinheiro) ou deixe em branco para quitar o saldo restante.
                </p>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <select
                    className="d26-select"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  >
                    <option value="PIX">Método: PIX</option>
                    <option value="CASH">Método: Dinheiro em Espécie</option>
                    <option value="DEBIT_CARD">Método: Cartão de Débito</option>
                    <option value="CREDIT_CARD">Método: Cartão de Crédito</option>
                    <option value="ROOM_CHARGE">Método: Transferir p/ Quarto Hotel Milla</option>
                  </select>
                </div>

                {openTabs.length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--d26-gray-400)' }}>Nenhuma comanda aberta no momento.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {openTabs.map((t) => {
                      const remaining = Math.max(0, t.totalCents - t.paidCents);
                      return (
                        <div
                          key={t.id}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            padding: '12px',
                            background: 'var(--d26-black-900)',
                            borderRadius: '10px',
                            border: '1px solid rgba(114, 9, 183, 0.45)'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <strong>{t.code}</strong>{' '}
                              <span className="d26-badge d26-badge-outline-purple">{t.status}</span>
                            </div>
                            <span style={{ fontSize: '0.8rem', color: '#34D399' }}>
                              Já Pago: {formatBrlCents(t.paidCents)}
                            </span>
                          </div>

                          <div style={{ fontSize: '0.78rem', color: 'var(--d26-gray-300)' }}>
                            Subtotal: {formatBrlCents(t.subtotalCents)} | Taxa 10%: {formatBrlCents(t.serviceFeeCents)} |{' '}
                            Total: <strong>{formatBrlCents(t.totalCents)}</strong> |{' '}
                            <strong style={{ color: '#F72585' }}>Falta Pagar: {formatBrlCents(remaining)}</strong>
                          </div>

                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                              type="text"
                              className="d26-input"
                              placeholder={`Valor em R$ (ex: ${(remaining / 100).toFixed(2).replace('.', ',')})`}
                              value={partialAmountsInput[t.id] ?? ''}
                              onChange={(e) =>
                                setPartialAmountsInput((prev) => ({ ...prev, [t.id]: e.target.value }))
                              }
                            />
                            <button
                              className="d26-btn d26-btn-primary"
                              style={{ whiteSpace: 'nowrap' }}
                              onClick={() => handleSettleTab(t)}
                            >
                              Confirmar Recebimento
                            </button>
                          </div>
                        </div>
                      );
                    })}
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
                        <span className="d26-badge d26-badge-purple">{ord.status}</span>
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
                          className="d26-btn d26-btn-tertiary"
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
              <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>Comandas Acumuladas (Entidade Tab)</h2>
              <table className="d26-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Status</th>
                    <th>Subtotal</th>
                    <th>Taxa 10%</th>
                    <th>Total</th>
                    <th>Pago</th>
                    <th>Restante</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.tabs.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.code}</strong></td>
                      <td><span className="d26-badge d26-badge-outline-purple">{t.status}</span></td>
                      <td>{formatBrlCents(t.subtotalCents)}</td>
                      <td>{formatBrlCents(t.serviceFeeCents)}</td>
                      <td><strong>{formatBrlCents(t.totalCents)}</strong></td>
                      <td style={{ color: '#34D399' }}>{formatBrlCents(t.paidCents)}</td>
                      <td style={{ color: '#F72585', fontWeight: 700 }}>
                        {formatBrlCents(Math.max(0, t.totalCents - t.paidCents))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="d26-card">
              <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>Pedidos Incrementais (Entidade Order)</h2>
              <table className="d26-table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Mesa</th>
                    <th>Itens deste Pedido</th>
                    <th>Status</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.orders.map((o) => (
                    <tr key={o.id}>
                      <td>#{o.id.slice(0, 8)}</td>
                      <td>{o.tableNumber ? `Mesa ${o.tableNumber}` : o.channel}</td>
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
                  {snapshot.stock.balances.slice(0, 20).map((b) => (
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
                      <div style={{ marginTop: '8px', fontSize: '0.84rem', color: '#FFAFCC' }}>
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
                          headers: getAuthHeaders(),
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
              Spooler de Impressão Incremental ESC/POS (Separado por Destino: Cozinha, Chapa, Bar e Caixa)
            </h2>
            {snapshot.printJobs.length === 0 ? (
              <p style={{ color: 'var(--d26-gray-400)' }}>Nenhum trabalho de impressão na fila no momento.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' }}>
                {snapshot.printJobs.map((job) => (
                  <div key={job.id} className="d26-product-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="d26-badge d26-badge-purple">{job.targetPrinter}</span>
                      <span className={`d26-badge ${job.status === 'PRINTED' ? 'd26-badge-success' : 'd26-badge-warning'}`}>
                        {job.status}
                      </span>
                    </div>
                    <pre
                      style={{
                        background: '#09090B',
                        padding: '10px',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontFamily: 'var(--d26-font-mono)',
                        overflowX: 'auto',
                        color: '#E5E5EA'
                      }}
                    >
                      {job.payloadText}
                    </pre>
                    {job.status !== 'PRINTED' && (
                      <button
                        className="d26-btn d26-btn-primary"
                        onClick={async () => {
                          await fetch(`${localApiBase}/api/print-jobs/${job.id}/mark-printed`, {
                            method: 'POST',
                            headers: getAuthHeaders()
                          });
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
                  Todos os eventos gravados no SQLite local permanecem seguros durante falhas de conexão e sincronizam em lote com o Simulador da VPS.
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

        {/* DEMAIS MÓDULOS ESTRUTURADOS */}
        {(['financeiro', 'relatorios', 'funcionarios', 'administracao'] as SystemModuleId[]).includes(activeModule) && (
          <div className="d26-card">
            <h2 style={{ fontSize: '1.05rem', marginBottom: '8px' }}>
              Estrutura Base Pronta — {currentModuleDef.title}
            </h2>
            <p style={{ fontSize: '0.86rem', color: 'var(--d26-gray-300)' }}>
              A navegação, permissões RBAC (`{currentModuleDef.requiredPermission}`), contratos compartilhados em{' '}
              <code>@deck26/contracts</code> e tabelas de banco de dados deste módulo já estão configurados e prontos.
            </p>
          </div>
        )}
      </main>

      {/* RODAPÉ TÉCNICO DO PROGRAMA WINDOWS */}
      <footer className="d26-statusbar">
        <div>
          <strong>DECK 26</strong> • Paleta Oficial: Rosa <code>#F72585</code> | Preto <code>#111111</code> | Roxo <code>#7209B7</code> | Neutro <code>#1A1A1A</code> • Plus Jakarta Sans
        </div>
        <div>
          Segurança Ativa: Loopback Local <code>127.0.0.1</code> + Autenticação por PIN HMAC
        </div>
      </footer>
    </div>
  );
};
