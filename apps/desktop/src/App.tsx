import { FinancialDashboard } from './FinancialDashboard.js';
import { tableSignal } from './tableSignals.js';
import React, { useEffect, useMemo, useState } from 'react';
import {
  BillSplitMode,
  CashRegisterMovement,
  CashRegisterSession,
  CatalogCategory,
  CatalogProduct,
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  DiningTableQr,
  DiscountType,
  HotelDashboardMetrics,
  HotelFolioEntry,
  HotelGuest,
  HotelMinibarItem,
  HotelReservation,
  HotelRoom,
  HotelRoomCategory,
  HotelService,
  HotelStay,
  KdsSlaConfig,
  OperationalNotification,
  Order,
  OrderStatus,
  OutOfStockPolicy,
  Payment,
  PaymentMethod,
  PrepStation,
  PrintJob,
  ProductRecipe,
  RoomHousekeepingStatus,
  RoomMaintenanceStatus,
  RoomOccupancyStatus,
  RoomCommercialStatus,
  SYSTEM_MODULES,
  SalesChannel,
  StockMovement,
  StockMovementType,
  SyncOutboxEvent,
  SystemModuleId,
  Tab,
  TablePhysicalStatus,
  UserRole,
  calculateGrossMarginPercent,
  calculateNightsCount,
  AccountsPayable,
  AccountsReceivable,
  CostCenter,
  DeliveryAddress,
  DeliveryCourier,
  DeliveryCustomer,
  DeliveryOrder,
  DeliveryOrderStatus,
  DeliverySettlement,
  DeliveryZone,
  DreStatement,
  ExecutiveDashboardMetrics,
  FinancialAccount,
  FinancialCategory,
  FinancialTransaction,
  FinancialTransfer,
  PurchaseInvoice,
  Supplier,
  evaluateKdsOrderSla,
  formatBrlCents,
  hasPermission,
  resolveChannelPriceCents
} from '@deck26/contracts';
import { Deck26Logo, MenuPriceBadge } from '@deck26/ui';
import { DeliveryModule } from './DeliveryModule.js';
import { FinanceModule } from './FinanceModule.js';
import { ReportsModule } from './ReportsModule.js';

interface CashierOperationalSummary {
  activeSession: CashRegisterSession | null;
  recentSessions: CashRegisterSession[];
  movements: CashRegisterMovement[];
  financialSummary: {
    registeredSalesCents: number;
    actualReceivedTotalCents: number;
    receivedByMethod: Record<PaymentMethod, number>;
    totalChangeGivenCents: number;
    totalRefundedCents: number;
    totalDiscountsCents: number;
    totalServiceFeesCents: number;
    pendingReceivablesCents: number;
    openTabsCount: number;
    partiallyPaidTabsCount: number;
    closedTabsCount: number;
  };
}

interface ServerStateSnapshot {
  lanAddresses: string[];
  cloudSyncState: {
    online: boolean;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  };
  catalog: { categories: CatalogCategory[]; products: CatalogProduct[] };
  recipes?: ProductRecipe[];
  qrTables?: DiningTableQr[];
  tabs: Tab[];
  orders: Order[];
  payments: Payment[];
  printJobs: PrintJob[];
  stock: {
    balances: Array<{
      productId: string;
      productName: string;
      sku: string;
      currentQuantity: number;
      minStockQuantity?: number;
      lowStockAlert?: boolean;
      updatedAt: string;
    }>;
    recentMovements: StockMovement[];
  };
  hotelRooms: HotelRoom[];
  hotelGuests?: HotelGuest[];
  hotelReservations?: HotelReservation[];
  hotelStays?: HotelStay[];
  hotelServices?: HotelService[];
  hotelMetrics?: HotelDashboardMetrics;
  syncEvents: SyncOutboxEvent[];
  notifications?: OperationalNotification[];
  kdsSlaConfig?: KdsSlaConfig;
  cashierSummary?: CashierOperationalSummary;
  deliveryZones?: DeliveryZone[];
  deliveryCouriers?: DeliveryCourier[];
  deliveryOrders?: DeliveryOrder[];
  deliveryCustomers?: DeliveryCustomer[];
  costCenters?: CostCenter[];
  financialCategories?: FinancialCategory[];
  financialAccounts?: FinancialAccount[];
  suppliers?: Supplier[];
  accountsReceivable?: AccountsReceivable[];
  accountsPayable?: AccountsPayable[];
  executiveMetrics?: ExecutiveDashboardMetrics;
}

interface AuthSessionInfo {
  token: string;
  userId: string;
  name: string;
  role: UserRole;
}

interface CartEntry {
  cartItemId: string;
  product: CatalogProduct;
  quantity: number;
  notes: string;
  modifiers: Array<{
    groupId: string;
    groupName: string;
    optionId: string;
    optionName: string;
    priceDeltaCents: number;
  }>;
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
    const host = window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost' ? '127.0.0.1' : window.location.hostname || '127.0.0.1';
    return import.meta.env.VITE_LOCAL_API_URL || `http://${host}:4000`;
  }, []);

  const [activeModule, setActiveModule] = useState<SystemModuleId>(() => {
    const params = new URLSearchParams(window.location.search);
    const terminal = params.get('terminal');
    if (terminal === 'garcom') return 'garcons';
    if (terminal === 'cozinha') return 'cozinha';
    return 'dashboard';
  });

  // Autenticação Real por PIN no Backend
  const [authSession, setAuthSession] = useState<AuthSessionInfo | null>(null);
  const [pinInput, setPinInput] = useState<string>('2626');
  const [showPinModal, setShowPinModal] = useState<boolean>(true);

  const [serverConnected, setServerConnected] = useState<boolean>(false);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const [snapshot, setSnapshot] = useState<ServerStateSnapshot>({
    lanAddresses: ['127.0.0.1'],
    cloudSyncState: { online: false, lastAttemptAt: null, lastSuccessAt: null, lastError: null },
    catalog: { categories: DECK26_INITIAL_CATEGORIES, products: DECK26_INITIAL_PRODUCTS },
    recipes: [],
    qrTables: [],
    tabs: [],
    orders: [],
    payments: [],
    printJobs: [],
    stock: { balances: [], recentMovements: [] },
    hotelRooms: [],
    hotelGuests: [],
    hotelReservations: [],
    hotelStays: [],
    hotelServices: [],
    hotelMetrics: undefined,
    syncEvents: [],
    deliveryZones: [],
    deliveryCouriers: [],
    deliveryOrders: [],
    deliveryCustomers: [],
    costCenters: [],
    financialCategories: [],
    financialAccounts: [],
    suppliers: [],
    accountsReceivable: [],
    accountsPayable: [],
    executiveMetrics: undefined
  });

  // Estados de PDV e Garçom (Seções 13 e 14)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [posSearchQuery, setPosSearchQuery] = useState<string>('');
  const [selectedChannel, setSelectedChannel] = useState<SalesChannel>('DINE_IN');
  const [selectedTableNumber, setSelectedTableNumber] = useState<number>(5);
  const [waiterName, setWaiterName] = useState<string>('Garçom 01 (Wi-Fi)');
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [customizingProduct, setCustomizingProduct] = useState<CatalogProduct | null>(null);
  const [customNotes, setCustomNotes] = useState<string>('');
  const [selectedModifierIds, setSelectedModifierIds] = useState<Record<string, string[]>>({});

  // Pagamentos Parciais ou Totais por Comanda
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PIX');
  const [partialAmountsInput, setPartialAmountsInput] = useState<Record<string, string>>({});

  // Estados do Gerenciador Inteligente de Produtos, Categorias e Fichas Técnicas (Seções 3 a 10)
  const [catalogSubTab, setCatalogSubTab] = useState<'PRODUCTS' | 'CATEGORIES' | 'RECIPES'>('PRODUCTS');
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [catalogCatFilter, setCatalogCatFilter] = useState<string>('ALL');
  const [catalogStatusFilter, setCatalogStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [catalogStockFilter, setCatalogStockFilter] = useState<'ALL' | 'LOW_STOCK'>('ALL');
  const [catalogSourceFilter, setCatalogSourceFilter] = useState<'ALL' | 'OFFICIAL_MENU' | 'TEST_ONLY'>('ALL');
  const [catalogSortBy, setCatalogSortBy] = useState<'NAME' | 'PRICE_ASC' | 'PRICE_DESC' | 'MARGIN_DESC'>('NAME');
  const [catalogViewMode, setCatalogViewMode] = useState<'GRID' | 'LIST'>('GRID');
  const [catalogPage, setCatalogPage] = useState<number>(1);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  // Formulário de Criação/Edição Completa de Produto
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [showProductForm, setShowProductForm] = useState<boolean>(false);
  const [prodSku, setProdSku] = useState<string>('');
  const [prodBarcode, setProdBarcode] = useState<string>('');
  const [prodName, setProdName] = useState<string>('');
  const [prodDescription, setProdDescription] = useState<string>('');
  const [prodCategoryId, setProdCategoryId] = useState<string>('cat-qualquer-hora');
  const [prodSubcategory, setProdSubcategory] = useState<string>('');
  const [prodUnit, setProdUnit] = useState<string>('UN');
  const [prodPriceReais, setProdPriceReais] = useState<string>('25,00');
  const [prodCostReais, setProdCostReais] = useState<string>('10,00');
  const [prodDeliveryPriceReais, setProdDeliveryPriceReais] = useState<string>('');
  const [prodHotelPriceReais, setProdHotelPriceReais] = useState<string>('');
  const [prodPrepStation, setProdPrepStation] = useState<PrepStation>('KITCHEN_HOT');
  const [prodPrepMinutes, setProdPrepMinutes] = useState<number>(15);
  const [prodTrackStock, setProdTrackStock] = useState<boolean>(true);
  const [prodInitialStock, setProdInitialStock] = useState<number>(30);
  const [prodMinStock, setProdMinStock] = useState<number>(5);
  const [prodOutOfStockPolicy, setProdOutOfStockPolicy] = useState<OutOfStockPolicy>('BLOCK_SALE');
  const [prodNcm, setProdNcm] = useState<string>('');
  const [prodCfop, setProdCfop] = useState<string>('');
  const [prodInternalNotes, setProdInternalNotes] = useState<string>('');
  const [prodActive, setProdActive] = useState<boolean>(true);

  // Formulário de Categoria
  const [catName, setCatName] = useState<string>('');
  const [catDescription, setCatDescription] = useState<string>('');
  const [catSortOrder, setCatSortOrder] = useState<number>(10);

  // Formulário de Ficha Técnica
  const [recipeProductId, setRecipeProductId] = useState<string>('prd-qh-caldo-macaxeira');
  const [recipeIngredientId, setRecipeIngredientId] = useState<string>('prd-qh-omelete-simples');
  const [recipeQuantityUsed, setRecipeQuantityUsed] = useState<number>(1);
  const [recipeNotes, setRecipeNotes] = useState<string>('Receita padrão aprovada pela cozinha Deck 26');

  // Formulário de Movimentação de Estoque
  const [stockFilterLowOnly, setStockFilterLowOnly] = useState<boolean>(false);
  const [stockProductId, setStockProductId] = useState<string>('prd-qh-caldo-macaxeira');
  const [stockMovementType, setStockMovementType] = useState<StockMovementType>('PURCHASE_ENTRY');
  const [stockQuantityDelta, setStockQuantityDelta] = useState<number>(10);
  const [stockUnitCostReais, setStockUnitCostReais] = useState<string>('');
  const [stockReason, setStockReason] = useState<string>('Entrada de mercadoria cfe. nota de compra');

  // Estados da Etapa 4: Gestão Visual de Mesas, KDS, Turno de Caixa e Operações de Comanda
  const [tablesViewMode, setTablesViewMode] = useState<'GRID' | 'LIST'>('GRID');
  const [tablesStatusFilter, setTablesStatusFilter] = useState<'ALL' | TablePhysicalStatus>('ALL');
  const [tablesWaiterFilter, setTablesWaiterFilter] = useState<string>('ALL');
  const [tablesSearch, setTablesSearch] = useState<string>('');
  const [openTableGuests, setOpenTableGuests] = useState<number>(2);
  const [transferFromTable, setTransferFromTable] = useState<number>(3);
  const [transferToTable, setTransferToTable] = useState<number>(8);
  const [joinPrimaryTable, setJoinPrimaryTable] = useState<number>(4);
  const [joinAdditionalTable, setJoinAdditionalTable] = useState<number>(5);
  const [kdsStationFilter, setKdsStationFilter] = useState<'ALL' | PrepStation>('ALL');
  const [receivedCashInput, setReceivedCashInput] = useState<Record<string, string>>({});
  const [cashShiftOpeningReais, setCashShiftOpeningReais] = useState<string>('200,00');
  const [cashShiftMovementType, setCashShiftMovementType] = useState<'SANGRIA' | 'SUPRIMENTO'>('SANGRIA');
  const [cashShiftMovementReais, setCashShiftMovementReais] = useState<string>('50,00');
  const [cashShiftMovementReason, setCashShiftMovementReason] = useState<string>('Sangria para cofre');
  const [cashShiftCountedReais, setCashShiftCountedReais] = useState<string>('');

  // Estados da Etapa 5 e 7A: PMS Hotel Auto Posto Milla (24 Apartamentos)
  const [hotelSubTab, setHotelSubTab] = useState<'MAPA' | 'RESERVAS' | 'HOSPEDES' | 'CHECKIN_CHECKOUT' | 'FOLIO' | 'RESTAURANTE' | 'FRIGOBAR_SERVICOS' | 'GOVERNANCA'>('MAPA');
  const [hotelRoomFilter, setHotelRoomFilter] = useState<'ALL' | 'OPERACIONAL' | 'EM_CONSTRUCAO' | 'LIVRE' | 'OCUPADO' | 'RESERVADO' | 'BLOQUEADO' | 'SUJO'>('ALL');
  const [editingRoom, setEditingRoom] = useState<HotelRoom | null>(null);
  const [editRoomName, setEditRoomName] = useState<string>('');
  const [editRoomDailyRateReais, setEditRoomDailyRateReais] = useState<string>('');
  const [editRoomCommercialStatus, setEditRoomCommercialStatus] = useState<RoomCommercialStatus>('OPERACIONAL');
  const [editRoomCategory, setEditRoomCategory] = useState<HotelRoomCategory>('STANDARD_DOUBLE');
  const [editRoomBedConfig, setEditRoomBedConfig] = useState<string>('');
  const [editRoomFloorSector, setEditRoomFloorSector] = useState<string>('');
  const [editRoomNotes, setEditRoomNotes] = useState<string>('');
  const [showEditRoomModal, setShowEditRoomModal] = useState<boolean>(false);
  const [selectedFolioStayId, setSelectedFolioStayId] = useState<string>('');
  const [folioData, setFolioData] = useState<{
    stay: HotelStay;
    folioTab: Tab;
    entries: HotelFolioEntry[];
    totals: { debitsCents: number; creditsCents: number; balanceCents: number };
  } | null>(null);
  const [folioLoading, setFolioLoading] = useState<boolean>(false);
  const [folioPayReais, setFolioPayReais] = useState<string>('');
  const [folioPayMethod, setFolioPayMethod] = useState<PaymentMethod>('PIX');

  // Hóspedes
  const [guestSearchQuery, setGuestSearchQuery] = useState<string>('');
  const [showNewGuestModal, setShowNewGuestModal] = useState<boolean>(false);
  const [guestName, setGuestName] = useState<string>('');
  const [guestDoc, setGuestDoc] = useState<string>('');
  const [guestPhone, setGuestPhone] = useState<string>('');
  const [guestEmail, setGuestEmail] = useState<string>('');
  const [guestCity, setGuestCity] = useState<string>('');
  const [guestState, setGuestState] = useState<string>('MA');
  const [guestPlate, setGuestPlate] = useState<string>('');

  // Reservas
  const [showNewResModal, setShowNewResModal] = useState<boolean>(false);
  const [resGuestId, setResGuestId] = useState<string>('');
  const [resRoomNumber, setResRoomNumber] = useState<string>('101');
  const [resCheckInDate, setResCheckInDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [resCheckOutDate, setResCheckOutDate] = useState<string>(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [resGuestsCount, setResGuestsCount] = useState<number>(1);
  const [resDailyReais, setResDailyReais] = useState<string>('180,00');
  const [resDepositReais, setResDepositReais] = useState<string>('0,00');
  const [resDepositPaid, setResDepositPaid] = useState<boolean>(false);
  const [resNotes, setResNotes] = useState<string>('');

  // Check-In Guiado
  const [showCheckInModal, setShowCheckInModal] = useState<boolean>(false);
  const [checkInRoomNumber, setCheckInRoomNumber] = useState<string>('101');
  const [checkInGuestId, setCheckInGuestId] = useState<string>('');
  const [checkInScheduledOut, setCheckInScheduledOut] = useState<string>(() => new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  const [checkInEarlyReais, setCheckInEarlyReais] = useState<string>('0,00');
  const [checkInNotes, setCheckInNotes] = useState<string>('');

  // Transferência Restaurante -> Folio
  const [transferTabId, setTransferTabId] = useState<string>('');
  const [transferRoomNumber, setTransferRoomNumber] = useState<string>('');

  // Frigobar & Serviços
  const [minibarRoomNumber, setMinibarRoomNumber] = useState<string>('101');
  const [minibarProductId, setMinibarProductId] = useState<string>('prd-beb-refrigerante-lata');
  const [minibarQty, setMinibarQty] = useState<number>(1);
  const [serviceRoomNumber, setServiceRoomNumber] = useState<string>('101');
  const [selectedServiceId, setSelectedServiceId] = useState<string>('srv-lavanderia-expressa');

  // Governança & Manutenção
  const [maintRoomNumber, setMaintRoomNumber] = useState<string>('101');
  const [maintDescription, setMaintDescription] = useState<string>('');
  const [maintSeverity, setMaintSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('MEDIUM');
  const [maintBlockRoom, setMaintBlockRoom] = useState<boolean>(true);

  const activeRole: UserRole = authSession?.role ?? 'WAITER';

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
      // Servidor iniciando
    }
  }

  async function refreshState() {
    try {
      const res = await fetch(`${localApiBase}/api/state`, {headers: getAuthHeaders()});
      if (res.status === 401) { setAuthSession(null); setShowPinModal(true); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ServerStateSnapshot;
      setSnapshot(data);
      setServerConnected(true);
    } catch {
      setServerConnected(false);
    }
  }

  useEffect(() => {
    if (!authSession) return;
    refreshState();
    const timer = setInterval(refreshState, 4000);

    // Conexão SSE em tempo real (Etapa 4 — Seção 16)

    try {
      // Poll with the Authorization header; native EventSource cannot send it.
    } catch {
      // Fallback para polling caso SSE não esteja disponível
    }

    return () => {
      clearInterval(timer);

    };
  }, [localApiBase, authSession]);

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
    setTimeout(() => setFeedbackBanner(null), 6500);
  }

  function parseReaisToCents(raw: string, fallbackCents: number): number {
    if (!raw || !raw.trim()) return fallbackCents;
    const normalized = raw.replace(/\./g, '').replace(',', '.').trim();
    const num = Number(normalized);
    if (Number.isNaN(num) || num < 0) return fallbackCents;
    return Math.round(num * 100);
  }

  const stockBalanceByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of snapshot.stock.balances) {
      map.set(b.productId, b.currentQuantity);
    }
    return map;
  }, [snapshot.stock.balances]);

  // Adição ao carrinho com suporte a adicionais (Seção 7)
  function handleProductClickForPos(product: CatalogProduct) {
    if (product.modifierGroups && product.modifierGroups.length > 0) {
      setCustomizingProduct(product);
      setCustomNotes('');
      const initialMods: Record<string, string[]> = {};
      for (const grp of product.modifierGroups) {
        if (grp.minSelect > 0 && grp.options[0]) {
          initialMods[grp.id] = [grp.options[0].id];
        } else {
          initialMods[grp.id] = [];
        }
      }
      setSelectedModifierIds(initialMods);
      return;
    }
    appendCartEntry(product, [], '');
  }

  function appendCartEntry(
    product: CatalogProduct,
    modifiers: CartEntry['modifiers'],
    notes: string
  ) {
    const sig = `${product.id}::${modifiers.map((m) => m.optionId).sort().join(',')}::${notes.trim()}`;
    setCart((prev) => {
      const existing = prev.find((i) => i.cartItemId === sig);
      if (existing) {
        return prev.map((i) => (i.cartItemId === sig ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [
        ...prev,
        {
          cartItemId: sig,
          product,
          quantity: 1,
          notes: notes.trim(),
          modifiers
        }
      ];
    });
    setCustomizingProduct(null);
  }

  function confirmCustomizedProduct() {
    if (!customizingProduct) return;
    const chosenMods: CartEntry['modifiers'] = [];
    for (const grp of customizingProduct.modifierGroups) {
      const chosenIds = selectedModifierIds[grp.id] ?? [];
      if (grp.required && chosenIds.length < grp.minSelect) {
        notify(`Selecione pelo menos ${grp.minSelect} opção(ões) em "${grp.name}".`);
        return;
      }
      for (const optId of chosenIds) {
        const opt = grp.options.find((o) => o.id === optId);
        if (opt) {
          chosenMods.push({
            groupId: grp.id,
            groupName: grp.name,
            optionId: opt.id,
            optionName: opt.name,
            priceDeltaCents: opt.priceDeltaCents
          });
        }
      }
    }
    appendCartEntry(customizingProduct, chosenMods, customNotes);
  }

  async function submitOrder(originNode: 'WINDOWS_PDV' | 'WAITER_MOBILE') {
    if (cart.length === 0) return;
    const idempotencyKey = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const effectiveChannel: SalesChannel = activeModule === 'garcons' ? 'DINE_IN' : selectedChannel;

    try {
      const res = await fetch(`${localApiBase}/api/orders`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          idempotencyKey,
          tableNumber:
            effectiveChannel === 'DINE_IN' || effectiveChannel === 'QR_TABLE'
              ? selectedTableNumber
              : null,
          channel: effectiveChannel,
          originNode,
          waiterName,
          items: cart.map((c) => ({
            productId: c.product.id,
            quantity: c.quantity,
            notes: c.notes || undefined,
            modifiers: c.modifiers
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
        `Pedido #${created.order.id.slice(0, 8)} gravado (${effectiveChannel}) | ${created.printJobs.length} via(s) incremental(is) | ${created.stockMovements.length} baixa(s) de estoque.`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao enviar pedido');
    }
  }

  async function handleAdvanceOrder(orderId: string, status: OrderStatus, reverseStockOnCancel?: boolean) {
    const res = await fetch(`${localApiBase}/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        status,
        originNode: 'KITCHEN_KDS',
        reverseStockOnCancel,
        cancelReason: status === 'CANCELLED' ? 'Cancelamento operacional autorizado no PDV' : undefined
      })
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({ error: 'Sem permissão' }));
      notify(errJson.error ?? 'Erro ao atualizar pedido');
      return;
    }
    await refreshState();
    notify(
      status === 'CANCELLED'
        ? `Pedido #${orderId.slice(0, 8)} cancelado com estorno auditável de estoque.`
        : `Pedido #${orderId.slice(0, 8)} atualizado para ${status}.`
    );
  }

  async function handleSettleTab(tab: Tab) {
    const remainingCents = Math.max(0, tab.totalCents - tab.paidCents);
    if (remainingCents <= 0) return;

    const customStr = partialAmountsInput[tab.id];
    const amountCentsToPay = parseReaisToCents(customStr ?? '', remainingCents);
    const cashStr = receivedCashInput[tab.id];
    const receivedCashCents =
      paymentMethod === 'CASH' && cashStr?.trim()
        ? parseReaisToCents(cashStr, amountCentsToPay)
        : amountCentsToPay;

    const res = await fetch(`${localApiBase}/api/payments`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        idempotencyKey: `pay-${tab.id}-${Date.now()}`,
        tabId: tab.id,
        method: paymentMethod,
        amountCents: amountCentsToPay,
        receivedCashCents
      })
    });

    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível registrar o pagamento.');
      return;
    }

    setPartialAmountsInput((prev) => ({ ...prev, [tab.id]: '' }));
    setReceivedCashInput((prev) => ({ ...prev, [tab.id]: '' }));
    await refreshState();
    const newRemaining = Math.max(0, data.tab.totalCents - data.tab.paidCents);
    const changeMsg =
      data.payment?.changeCents > 0 ? ` | Troco: ${formatBrlCents(data.payment.changeCents)}` : '';
    notify(
      `Pagamento de ${formatBrlCents(amountCentsToPay)} (${paymentMethod}) confirmado para ${tab.code}${changeMsg}. Status: ${data.tab.status} | Restante: ${formatBrlCents(newRemaining)}`
    );
  }

  // =========================================================================
  // HANDLERS DA ETAPA 4: MESAS, COMANDAS, GARÇONS, KDS E TURNO DE CAIXA
  // =========================================================================

  async function handleOpenTable(tableNum: number) {
    const res = await fetch(`${localApiBase}/api/tables/open`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        tableNumber: tableNum,
        guestsCount: openTableGuests,
        assignedWaiterId: authSession?.userId ?? 'usr-waiter-01',
        assignedWaiterName: waiterName,
        notes: `Abertura operacional Mesa ${String(tableNum).padStart(2, '0')}`
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível abrir a mesa.');
      return;
    }
    setSelectedTableNumber(tableNum);
    await refreshState();
    notify(
      `Mesa ${String(tableNum).padStart(2, '0')} aberta (${openTableGuests} pessoas) • Comanda ${data.tab.code}`
    );
  }

  async function handleUpdateTableStatus(tableNum: number, status: TablePhysicalStatus, reason: string) {
    const res = await fetch(`${localApiBase}/api/tables/${tableNum}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ physicalStatus: status, reason })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível alterar o estado físico da mesa.');
      return;
    }
    await refreshState();
    notify(`Mesa ${String(tableNum).padStart(2, '0')} atualizada para ${status}.`);
  }

  async function handleTransferTable(fromNum: number, toNum: number) {
    const res = await fetch(`${localApiBase}/api/tables/transfer`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        fromTableNumber: fromNum,
        toTableNumber: toNum,
        reason: `Transferência operacional da Mesa ${fromNum} para Mesa ${toNum}`
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível transferir a mesa.');
      return;
    }
    setSelectedTableNumber(toNum);
    await refreshState();
    notify(`Comanda ${data.tab.code} transferida da Mesa ${fromNum} para a Mesa ${toNum}.`);
  }

  async function handleJoinTables(primaryNum: number, additionalNum: number) {
    const res = await fetch(`${localApiBase}/api/tables/join`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        primaryTableNumber: primaryNum,
        additionalTableNumbers: [additionalNum],
        reason: `União de mesas ${primaryNum} + ${additionalNum}`
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível unir as mesas.');
      return;
    }
    await refreshState();
    notify(`Mesas ${primaryNum} e ${additionalNum} unidas na Comanda ${data.tab.code}.`);
  }

  async function handleUnjoinTable(primaryNum: number, tableToSeparate: number) {
    const res = await fetch(`${localApiBase}/api/tables/unjoin`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        primaryTableNumber: primaryNum,
        tableNumbersToSeparate: [tableToSeparate],
        reason: `Separação operacional da Mesa ${tableToSeparate}`
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível separar a mesa.');
      return;
    }
    await refreshState();
    notify(`Mesa ${tableToSeparate} desvinculada da Mesa ${primaryNum}.`);
  }

  async function handleRequestBill(tabId: string) {
    const res = await fetch(`${localApiBase}/api/tabs/${tabId}/request-bill`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ notes: 'Fechamento de conta solicitado pelo atendimento' })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível solicitar fechamento.');
      return;
    }
    await refreshState();
    notify(`Conta solicitada para ${data.tab.code} (AGUARDANDO_PAGAMENTO).`);
  }

  async function handleApplyDiscount(tabId: string, discountType: DiscountType, valueNum: number) {
    const payload =
      discountType === 'PERCENTAGE'
        ? {
            discountType: 'PERCENTAGE',
            discountBasisPoints: valueNum,
            discountReason: 'Desconto percentual gerencial autorizado'
          }
        : {
            discountType,
            discountCents: valueNum,
            discountReason: 'Desconto em valor autorizado pela gerência'
          };
    const res = await fetch(`${localApiBase}/api/tabs/${tabId}/discount`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Permissão insuficiente ou valor inválido para desconto.');
      return;
    }
    await refreshState();
    notify(`Desconto aplicado na comanda ${data.tab.code}. Novo total: ${formatBrlCents(data.tab.totalCents)}.`);
  }

  async function handleToggleServiceFee(tab: Tab) {
    const nextEnabled = !(tab.serviceFeeEnabled ?? true);
    const res = await fetch(`${localApiBase}/api/tabs/${tab.id}/service-fee`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        serviceFeeEnabled: nextEnabled,
        serviceFeeBasisPoints: tab.serviceFeeBasisPoints ?? 1000,
        reason: nextEnabled ? 'Reativação da taxa de serviço 10%' : 'Isenção da taxa de serviço 10% a pedido do cliente'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível alterar a taxa de serviço.');
      return;
    }
    await refreshState();
    notify(
      `Taxa de serviço ${nextEnabled ? 'ativada (10%)' : 'removida (0%)'} em ${data.tab.code}. Total: ${formatBrlCents(data.tab.totalCents)}`
    );
  }

  async function handleSplitTab(tab: Tab, mode: BillSplitMode, sharesCount: number) {
    const res = await fetch(`${localApiBase}/api/tabs/${tab.id}/split`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        mode,
        sharesCount: Math.max(2, sharesCount)
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível calcular a divisão da conta.');
      return;
    }
    await refreshState();
    const shareCents = data.splitSummary?.shareAmountCents;
    if (typeof shareCents === 'number' && shareCents > 0) {
      setPartialAmountsInput((prev) => ({
        ...prev,
        [tab.id]: (shareCents / 100).toFixed(2).replace('.', ',')
      }));
    }
    notify(
      `Conta ${tab.code} dividida em ${sharesCount} cotas (${typeof shareCents === 'number' ? formatBrlCents(shareCents) : ''} por pessoa preenchida no caixa).`
    );
  }

  async function handleCloseTabAndReleaseTable(tabId: string, markForCleaning = false) {
    const res = await fetch(`${localApiBase}/api/tabs/${tabId}/close`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        markTableForCleaning: markForCleaning,
        notes: 'Encerramento de comanda e liberação de mesa no Caixa'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível encerrar a comanda.');
      return;
    }
    await refreshState();
    notify(
      `Comanda ${data.tab.code} encerrada! Mesa(s) liberada(s): ${(data.releasedTables ?? []).join(', ')}.`
    );
  }

  async function handleRefundPayment(paymentId: string) {
    const res = await fetch(`${localApiBase}/api/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        reason: 'Estorno operacional autorizado no Caixa PDV'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível estornar o pagamento.');
      return;
    }
    await refreshState();
    notify(`Pagamento estornado com sucesso! Saldo recalculado na comanda ${data.tab.code}.`);
  }

  async function handleOpenCashSession(e: React.FormEvent) {
    e.preventDefault();
    const openingCents = parseReaisToCents(cashShiftOpeningReais, 20000);
    const res = await fetch(`${localApiBase}/api/cash-sessions/open`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        openingBalanceCents: openingCents,
        notes: 'Abertura de turno de caixa operacional'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível abrir o turno de caixa.');
      return;
    }
    await refreshState();
    notify(`Turno de Caixa aberto com troco inicial de ${formatBrlCents(openingCents)}.`);
  }

  async function handleRecordCashMovement(e: React.FormEvent) {
    e.preventDefault();
    const activeSessionId = snapshot.cashierSummary?.activeSession?.id;
    if (!activeSessionId) {
      notify('Abra um turno de caixa antes de registrar sangria ou suprimento.');
      return;
    }
    const amountCents = parseReaisToCents(cashShiftMovementReais, 0);
    const res = await fetch(`${localApiBase}/api/cash-sessions/movements`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        sessionId: activeSessionId,
        movementType: cashShiftMovementType,
        amountCents,
        reason: cashShiftMovementReason
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Falha ao registrar movimentação de caixa.');
      return;
    }
    await refreshState();
    notify(
      `${cashShiftMovementType} de ${formatBrlCents(amountCents)} registrada no caixa. Saldo esperado em espécie: ${formatBrlCents(data.session.expectedCashCents)}`
    );
  }

  async function handleCloseCashSession(e: React.FormEvent) {
    e.preventDefault();
    const activeSession = snapshot.cashierSummary?.activeSession;
    if (!activeSession) return;
    const countedCents = parseReaisToCents(
      cashShiftCountedReais,
      activeSession.expectedCashCents
    );
    const res = await fetch(`${localApiBase}/api/cash-sessions/close`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        sessionId: activeSession.id,
        countedCashCents: countedCents,
        notes: 'Fechamento e conferência de turno de caixa'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Falha ao fechar turno de caixa.');
      return;
    }
    setCashShiftCountedReais('');
    await refreshState();
    notify(
      `Turno de Caixa encerrado! Esperado: ${formatBrlCents(data.cashSession.expectedCashCents)} | Contado: ${formatBrlCents(data.cashSession.countedCashCents)} | Diferença: ${formatBrlCents(data.cashSession.differenceCents)}`
    );
  }

  async function handleAcknowledgeNotification(notificationId: string) {
    await fetch(`${localApiBase}/api/notifications/${notificationId}/ack`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    await refreshState();
  }

  // Funções de Cadastro e Edição de Produtos (Seções 3, 4, 6)
  function openCreateProductModal() {
    setEditingProductId(null);
    setProdSku(`D26-${Math.floor(100 + Math.random() * 900)}`);
    setProdBarcode('');
    setProdName('');
    setProdDescription('');
    setProdCategoryId(snapshot.catalog.categories[0]?.id ?? 'cat-qualquer-hora');
    setProdSubcategory('');
    setProdUnit('UN');
    setProdPriceReais('25,00');
    setProdCostReais('10,00');
    setProdDeliveryPriceReais('');
    setProdHotelPriceReais('');
    setProdPrepStation('KITCHEN_HOT');
    setProdPrepMinutes(15);
    setProdTrackStock(true);
    setProdInitialStock(30);
    setProdMinStock(5);
    setProdOutOfStockPolicy('BLOCK_SALE');
    setProdNcm('');
    setProdCfop('');
    setProdInternalNotes('');
    setProdActive(true);
    setShowProductForm(true);
  }

  function openEditProductModal(p: CatalogProduct) {
    setEditingProductId(p.id);
    setProdSku(p.sku);
    setProdBarcode(p.barcode ?? '');
    setProdName(p.name);
    setProdDescription(p.description);
    setProdCategoryId(p.categoryId);
    setProdSubcategory(p.subcategory ?? '');
    setProdUnit(p.unitOfMeasure ?? 'UN');
    setProdPriceReais((p.priceCents / 100).toFixed(2).replace('.', ','));
    setProdCostReais(((p.costPriceCents ?? 0) / 100).toFixed(2).replace('.', ','));
    setProdDeliveryPriceReais(
      p.channelPricesCents?.DELIVERY
        ? (p.channelPricesCents.DELIVERY / 100).toFixed(2).replace('.', ',')
        : ''
    );
    setProdHotelPriceReais(
      p.channelPricesCents?.HOTEL_ROOM
        ? (p.channelPricesCents.HOTEL_ROOM / 100).toFixed(2).replace('.', ',')
        : ''
    );
    setProdPrepStation(p.prepStation);
    setProdPrepMinutes(p.prepTimeMinutes ?? 15);
    setProdTrackStock(p.trackStock);
    setProdInitialStock(stockBalanceByProductId.get(p.id) ?? 50);
    setProdMinStock(p.minStockQuantity ?? 5);
    setProdOutOfStockPolicy(p.outOfStockPolicy ?? 'BLOCK_SALE');
    setProdNcm(p.ncm ?? '');
    setProdCfop(p.cfop ?? '');
    setProdInternalNotes(p.internalNotes ?? '');
    setProdActive(p.active);
    setShowProductForm(true);
  }

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = parseReaisToCents(prodPriceReais, 0);
    const costPriceCents = parseReaisToCents(prodCostReais, 0);
    const channelPricesCents: Partial<Record<SalesChannel, number>> = {};
    if (prodDeliveryPriceReais.trim()) {
      channelPricesCents.DELIVERY = parseReaisToCents(prodDeliveryPriceReais, priceCents);
    }
    if (prodHotelPriceReais.trim()) {
      channelPricesCents.HOTEL_ROOM = parseReaisToCents(prodHotelPriceReais, priceCents);
    }

    const payload = {
      sku: prodSku,
      barcode: prodBarcode || null,
      categoryId: prodCategoryId,
      subcategory: prodSubcategory,
      name: prodName,
      description: prodDescription,
      unitOfMeasure: prodUnit,
      priceCents,
      costPriceCents,
      channelPricesCents,
      prepStation: prodPrepStation,
      prepTimeMinutes: prodPrepMinutes,
      trackStock: prodTrackStock,
      initialStock: prodInitialStock,
      minStockQuantity: prodMinStock,
      outOfStockPolicy: prodOutOfStockPolicy,
      ncm: prodNcm || undefined,
      cfop: prodCfop || undefined,
      internalNotes: prodInternalNotes,
      active: prodActive
    };

    const url = editingProductId
      ? `${localApiBase}/api/catalog/products/${editingProductId}`
      : `${localApiBase}/api/catalog/products`;
    const method = editingProductId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Erro ao salvar produto.');
      return;
    }
    setShowProductForm(false);
    await refreshState();
    notify(
      editingProductId
        ? `Produto "${data.product.name}" atualizado com sucesso (histórico de vendas preservado).`
        : `Produto "${data.product.name}" cadastrado no catálogo único compartilhado.`
    );
  }

  async function handleDeleteOrDeactivateProduct(productId: string) {
    const res = await fetch(`${localApiBase}/api/catalog/products/${productId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Erro ao desativar produto');
      return;
    }
    await refreshState();
    if (data.mode === 'LOGICAL_DEACTIVATED') {
      notify('Produto desativado logicamente (possui histórico de pedidos/estoque preservado).');
    } else {
      notify('Produto sem histórico removido fisicamente do cadastro.');
    }
  }

  async function handleBatchStatus(active: boolean) {
    if (selectedProductIds.length === 0) return;
    const res = await fetch(`${localApiBase}/api/catalog/products/batch-status`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ productIds: selectedProductIds, active })
    });
    if (res.ok) {
      setSelectedProductIds([]);
      await refreshState();
      notify(`${selectedProductIds.length} produto(s) ${active ? 'ativado(s)' : 'desativado(s)'} em lote.`);
    }
  }

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catName.trim()) return;
    const res = await fetch(`${localApiBase}/api/catalog/categories`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: catName,
        description: catDescription,
        sortOrder: catSortOrder,
        active: true
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Erro ao criar categoria');
      return;
    }
    setCatName('');
    setCatDescription('');
    await refreshState();
    notify(`Categoria "${data.category.name}" salva com sucesso.`);
  }

  async function handleDeleteCategory(categoryId: string) {
    const res = await fetch(`${localApiBase}/api/catalog/categories/${categoryId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível excluir a categoria');
      return;
    }
    await refreshState();
    notify('Categoria excluída com sucesso.');
  }

  async function handleSaveRecipe(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`${localApiBase}/api/recipes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        productId: recipeProductId,
        status: 'APPROVED',
        yieldQuantity: 1,
        notes: recipeNotes,
        items: [
          {
            ingredientProductId: recipeIngredientId,
            quantityUsed: recipeQuantityUsed,
            unitOfMeasure: 'UN'
          }
        ]
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Erro ao salvar ficha técnica');
      return;
    }
    await refreshState();
    notify(
      `Ficha Técnica v${data.recipe.version} aprovada para o produto! Próximas vendas baixarão os insumos.`
    );
  }

  async function handleStockAdjustment(e: React.FormEvent) {
    e.preventDefault();
    const signedDelta =
      stockMovementType === 'WASTE_OR_LOSS' || stockMovementType === 'SALE_DEDUCTION'
        ? -Math.abs(stockQuantityDelta)
        : Number(stockQuantityDelta);

    const unitCostCents = stockUnitCostReais.trim()
      ? parseReaisToCents(stockUnitCostReais, 0)
      : undefined;

    const res = await fetch(`${localApiBase}/api/stock/adjust`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        productId: stockProductId,
        movementType: stockMovementType,
        quantityDelta: signedDelta,
        unitCostCents,
        reason: stockReason
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Falha ao movimentar estoque');
      return;
    }
    await refreshState();
    notify(
      `Movimentação ${data.movement.movementType} registrada (${signedDelta > 0 ? `+${signedDelta}` : signedDelta}). Saldo após: ${data.movement.balanceAfter}`
    );
  }

  async function handleReverseStockMovement(movementId: string) {
    const res = await fetch(`${localApiBase}/api/stock/reverse`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        movementId,
        reason: 'Estorno auditado pelo operador no painel de Estoque'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error ?? 'Não foi possível estornar a movimentação');
      return;
    }
    await refreshState();
    notify(`Movimentação estornada com sucesso! Novo saldo: ${data.movement.balanceAfter}`);
  }

  async function handleToggleQrApprovalPolicy(tableNumber: number, currentVal: boolean) {
    const res = await fetch(`${localApiBase}/api/qr-tables/${tableNumber}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ requiresOperatorApproval: !currentVal })
    });
    if (res.ok) {
      await refreshState();
      notify(
        `Política da Mesa ${tableNumber} alterada para: ${
          !currentVal ? 'Exige Aprovação do Operador' : 'Envio Direto para Cozinha'
        }`
      );
    }
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

  // =========================================================================
  // Operações do Módulo Hoteleiro (Etapa 5 — Hotel Auto Posto Milla PMS)
  // =========================================================================
  async function loadFolio(stayId: string) {
    if (!stayId) {
      setFolioData(null);
      return;
    }
    setFolioLoading(true);
    try {
      const res = await fetch(`${localApiBase}/api/hotel/stays/${stayId}/folio`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setFolioData(data);
      }
    } catch (err) {
      console.error('Erro ao carregar folio', err);
    } finally {
      setFolioLoading(false);
    }
  }

  useEffect(() => {
    if (selectedFolioStayId) {
      loadFolio(selectedFolioStayId);
    } else {
      setFolioData(null);
    }
  }, [selectedFolioStayId]);

  async function handleCreateGuest() {
    if (!guestName.trim()) {
      notify('Nome do hóspede é obrigatório.');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/hotel/guests`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          fullName: guestName.trim(),
          documentNumber: guestDoc.trim() || '000.000.000-00',
          documentType: 'CPF',
          phone: guestPhone.trim() || undefined,
          email: guestEmail.trim() || undefined,
          address: {
            city: guestCity.trim() || undefined,
            state: guestState.trim() || undefined
          },
          notes: guestPlate.trim() ? `Placa: ${guestPlate.trim()}` : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao cadastrar hóspede');
      setShowNewGuestModal(false);
      setGuestName('');
      setGuestDoc('');
      setGuestPhone('');
      setGuestEmail('');
      setGuestPlate('');
      await refreshState();
      notify(`Hóspede ${data.guest.fullName} cadastrado com sucesso.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao cadastrar hóspede');
    }
  }

  async function handleCreateReservation() {
    if (!resGuestId) {
      notify('Selecione um hóspede para a reserva.');
      return;
    }
    try {
      const dailyCents = parseReaisToCents(resDailyReais, 18000);
      const depositCents = parseReaisToCents(resDepositReais, 0);
      const res = await fetch(`${localApiBase}/api/hotel/reservations`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          guestId: resGuestId,
          roomNumber: resRoomNumber,
          checkInDate: resCheckInDate,
          checkOutDate: resCheckOutDate,
          guestsCount: resGuestsCount,
          dailyRateCents: dailyCents,
          depositCents: depositCents > 0 ? depositCents : undefined,
          depositPaid: resDepositPaid,
          sourceChannel: 'BALCAO_DIRETO',
          notes: resNotes.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao criar reserva');
      setShowNewResModal(false);
      setResNotes('');
      await refreshState();
      notify(`Reserva #${data.reservation.locatorCode} confirmada para o Apto ${resRoomNumber}.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao criar reserva');
    }
  }

  async function handleCheckInStay() {
    if (!checkInGuestId) {
      notify('Selecione o hóspede para realizar o check-in.');
      return;
    }
    try {
      const earlyCents = parseReaisToCents(checkInEarlyReais, 0);
      const res = await fetch(`${localApiBase}/api/hotel/checkin`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          roomNumber: checkInRoomNumber,
          guestId: checkInGuestId,
          checkOutScheduledAt: checkInScheduledOut ? new Date(checkInScheduledOut).toISOString() : new Date(Date.now() + 86400000).toISOString(),
          earlyCheckinCents: earlyCents > 0 ? earlyCents : undefined,
          notes: checkInNotes.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao realizar check-in');
      setShowCheckInModal(false);
      setCheckInNotes('');
      await refreshState();
      notify(`Check-in realizado com sucesso no Apto ${checkInRoomNumber}. Folio aberto.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao realizar check-in');
    }
  }

  async function handleTransferTabToFolio() {
    if (!transferTabId || !transferRoomNumber) {
      notify('Selecione a comanda da mesa e o apartamento de destino.');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/hotel/transfer-tab-to-folio`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          restaurantTabId: transferTabId,
          roomNumber: transferRoomNumber
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao transferir consumo');
      setTransferTabId('');
      await refreshState();
      if (selectedFolioStayId) await loadFolio(selectedFolioStayId);
      notify(`Consumo transferido com sucesso para o Apto ${transferRoomNumber}. Mesa liberada.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao transferir consumo');
    }
  }

  async function handleRecordMinibar() {
    try {
      const res = await fetch(`${localApiBase}/api/hotel/minibar/consume`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          roomNumber: minibarRoomNumber,
          productId: minibarProductId,
          quantity: minibarQty
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao lançar frigobar');
      await refreshState();
      if (selectedFolioStayId) await loadFolio(selectedFolioStayId);
      notify(`Consumo de frigobar lançado no Apto ${minibarRoomNumber}: ${minibarQty}x (${formatBrlCents(data.folioEntry.amountCents)}).`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao lançar frigobar');
    }
  }

  async function handleOrderHotelService() {
    try {
      const res = await fetch(`${localApiBase}/api/hotel/services/order`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          roomNumber: serviceRoomNumber,
          serviceId: selectedServiceId,
          quantity: 1
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao solicitar serviço');
      await refreshState();
      if (selectedFolioStayId) await loadFolio(selectedFolioStayId);
      notify(`Serviço lançado na conta do Apto ${serviceRoomNumber}: ${data.serviceOrder.serviceName} (${formatBrlCents(data.folioEntry.amountCents)}).`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao solicitar serviço');
    }
  }

  async function handlePayFolio() {
    if (!folioData) return;
    const amountCents = parseReaisToCents(folioPayReais, folioData.totals.balanceCents);
    if (amountCents <= 0) {
      notify('Informe um valor válido para pagamento.');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/payments`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          idempotencyKey: `folio-pay-${folioData.stay.id}-${Date.now()}`,
          tabId: folioData.folioTab.id,
          method: folioPayMethod,
          amountCents
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao processar pagamento do folio');
      setFolioPayReais('');
      await refreshState();
      await loadFolio(folioData.stay.id);
      notify(`Pagamento de ${formatBrlCents(amountCents)} (${folioPayMethod}) registrado com sucesso no Folio.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao registrar pagamento');
    }
  }

  async function handleCheckOutStay(stayId: string, allowOverride = false) {
    try {
      const res = await fetch(`${localApiBase}/api/hotel/checkout`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          stayId,
          allowOverrideWithAudit: allowOverride
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao realizar check-out');
      await refreshState();
      if (selectedFolioStayId === stayId) {
        setSelectedFolioStayId('');
        setFolioData(null);
      }
      notify(`Check-out concluído para o Apto ${data.room.number}. Quarto liberado e marcado como SUJO.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao realizar check-out');
    }
  }

  async function handleUpdateHousekeeping(roomNumber: string, housekeepingStatus: RoomHousekeepingStatus) {
    try {
      const res = await fetch(`${localApiBase}/api/hotel/housekeeping/status`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          roomNumber,
          housekeepingStatus
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao atualizar governança');
      await refreshState();
      notify(`Apto ${roomNumber} atualizado para governança: ${housekeepingStatus}.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao atualizar governança');
    }
  }

  function openEditRoomModal(room: HotelRoom) {
    setEditingRoom(room);
    setEditRoomName(room.name || '');
    setEditRoomDailyRateReais((room.dailyRateCents / 100).toFixed(2));
    setEditRoomCommercialStatus(room.commercialStatus || 'OPERACIONAL');
    setEditRoomCategory(room.category);
    setEditRoomBedConfig(room.bedConfiguration || '');
    setEditRoomFloorSector(room.floorSector || '');
    setEditRoomNotes(room.internalNotes || '');
    setShowEditRoomModal(true);
  }

  async function handleSaveRoomEdit() {
    if (!editingRoom) return;
    try {
      const dailyRateCents = Math.round(parseFloat(editRoomDailyRateReais.replace(',', '.')) * 100);
      if (isNaN(dailyRateCents) || dailyRateCents <= 0) {
        notify('Informe uma tarifa diária válida em reais.');
        return;
      }
      const res = await fetch(`${localApiBase}/api/hotel/rooms/${editingRoom.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: editRoomName.trim() || undefined,
          commercialStatus: editRoomCommercialStatus,
          dailyRateCents,
          category: editRoomCategory,
          bedConfiguration: editRoomBedConfig.trim() || undefined,
          floorSector: editRoomFloorSector.trim() || undefined,
          internalNotes: editRoomNotes.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar quarto');
      await refreshState();
      notify(`Apartamento ${editingRoom.number} atualizado com sucesso!`);
      setShowEditRoomModal(false);
      setEditingRoom(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar quarto');
    }
  }

  async function handleCreateMaintenance() {
    if (!maintDescription.trim()) {
      notify('Descreva o problema de manutenção.');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/hotel/maintenance`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          roomNumber: maintRoomNumber,
          description: maintDescription.trim(),
          severity: maintSeverity,
          blockRoom: maintBlockRoom
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao abrir chamado de manutenção');
      setMaintDescription('');
      await refreshState();
      notify(`Chamado de manutenção aberto para o Apto ${maintRoomNumber}. Quarto bloqueado.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao abrir chamado');
    }
  }

  // Filtragem e Ordenação Inteligente do Catálogo (Seção 4)
  const filteredCatalogProducts = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    const list = snapshot.catalog.products.filter((p) => {
      if (catalogCatFilter !== 'ALL' && p.categoryId !== catalogCatFilter) return false;
      if (catalogStatusFilter === 'ACTIVE' && !p.active) return false;
      if (catalogStatusFilter === 'INACTIVE' && p.active) return false;
      if (catalogSourceFilter !== 'ALL' && (p.dataSource ?? 'OFFICIAL_MENU') !== catalogSourceFilter) {
        return false;
      }
      if (catalogStockFilter === 'LOW_STOCK') {
        const qty = stockBalanceByProductId.get(p.id) ?? 0;
        if (qty > (p.minStockQuantity ?? 5)) return false;
      }
      if (q) {
        const matchName = p.name.toLowerCase().includes(q);
        const matchSku = p.sku.toLowerCase().includes(q);
        const matchDesc = p.description.toLowerCase().includes(q);
        if (!matchName && !matchSku && !matchDesc) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (catalogSortBy === 'PRICE_ASC') return a.priceCents - b.priceCents;
      if (catalogSortBy === 'PRICE_DESC') return b.priceCents - a.priceCents;
      if (catalogSortBy === 'MARGIN_DESC') {
        return (
          calculateGrossMarginPercent(b.priceCents, b.costPriceCents ?? 0) -
          calculateGrossMarginPercent(a.priceCents, a.costPriceCents ?? 0)
        );
      }
      return a.name.localeCompare(b.name, 'pt-BR');
    });
  }, [
    snapshot.catalog.products,
    catalogSearch,
    catalogCatFilter,
    catalogStatusFilter,
    catalogSourceFilter,
    catalogStockFilter,
    catalogSortBy,
    stockBalanceByProductId
  ]);

  const PAGE_SIZE = 12;
  const totalCatalogPages = Math.max(1, Math.ceil(filteredCatalogProducts.length / PAGE_SIZE));
  const paginatedCatalogProducts = filteredCatalogProducts.slice(
    (catalogPage - 1) * PAGE_SIZE,
    catalogPage * PAGE_SIZE
  );

  // Produtos ativos para o PDV / Garçom
  const posActiveProducts = useMemo(() => {
    const q = posSearchQuery.trim().toLowerCase();
    const effectiveCh: SalesChannel = activeModule === 'garcons' ? 'DINE_IN' : selectedChannel;
    return snapshot.catalog.products.filter((p) => {
      if (!p.active) return false;
      if (!p.availableChannels.includes(effectiveCh)) return false;
      if (selectedCategoryId !== 'ALL' && p.categoryId !== selectedCategoryId) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [snapshot.catalog.products, posSearchQuery, selectedCategoryId, selectedChannel, activeModule]);

  const currentModuleDef = SYSTEM_MODULES.find((m) => m.id === activeModule) ?? SYSTEM_MODULES[0]!;
  const openTabs = snapshot.tabs.filter((t) => t.status !== 'CLOSED' && t.status !== 'CANCELLED');
  const activeKitchenOrders = snapshot.orders.filter(
    (o) => o.status === 'RECEIVED' || o.status === 'IN_PREPARATION'
  );
  const pendingOutboxCount = snapshot.syncEvents.filter((e) => e.status === 'PENDING').length;
  const lowStockCount = snapshot.stock.balances.filter((b) => b.lowStockAlert).length;

  const previewPriceCents = parseReaisToCents(prodPriceReais, 0);
  const previewCostCents = parseReaisToCents(prodCostReais, 0);
  const previewMargin = calculateGrossMarginPercent(previewPriceCents, previewCostCents);

  return (
    <div className="d26-shell">
      {/* BARRA SUPERIOR DO APLICATIVO WINDOWS TAURI 2 */}
      <header className="d26-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Deck26Logo size={42} showHotelSubtitle />
          <span className="d26-badge d26-badge-purple">Estação de trabalho</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {lowStockCount > 0 && (
            <span className="d26-badge d26-badge-warning">
              ⚠ {lowStockCount} item(ns) com estoque baixo
            </span>
          )}
          <span className={`d26-badge ${serverConnected ? 'd26-badge-success' : 'd26-badge-warning'}`}>
            ● {serverConnected ? 'Operação conectada' : 'Aguardando conexão'}
          </span>

          <span
            className={`d26-badge ${
              snapshot.cloudSyncState.online ? 'd26-badge-success' : 'd26-badge-outline-purple'
            }`}
          >
            ⇄ VPS Simulada:{' '}
            {snapshot.cloudSyncState.online
              ? 'Sincronizado'
              : `Offline-First (${pendingOutboxCount} na Outbox)`}
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
        {(
          ['OPERACIONAL', 'CATALOGO_ESTOQUE', 'HOTELARIA', 'GESTAO_RETAGUARDA', 'INFRA_FISCAL'] as const
        ).map((groupKey) => {
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
        })}
      </aside>

      {/* ÁREA DE TRABALHO PRINCIPAL */}
      <main className="d26-workspace">
        {/* MODAL DE AUTENTICAÇÃO REAL POR PIN NO BACKEND */}
        {showPinModal && (
          <div
            className="d26-card"
            style={{
              border: '1px solid #7209B7',
              background: '#222222',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '14px'
            }}
          >
            <div>
              <h3 style={{ fontSize: '0.98rem' }}>
                Acesse sua estação de trabalho
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-300)', marginTop: '3px' }}>
                Digite seu PIN pessoal para acessar as funções autorizadas do seu perfil.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="password"
                className="d26-input"
                style={{ width: '130px' }}
                placeholder="Digite o PIN"
                aria-label="PIN do operador"
                inputMode="numeric"
                onKeyDown={e=>{if(e.key==='Enter')void authenticateWithPin(pinInput);}}
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

        {/* MODAL DE SELEÇÃO DE ADICIONAIS / OBSERVAÇÕES NO PDV E GARÇOM */}
        {customizingProduct && (
          <div
            className="d26-card"
            style={{
              border: '2px solid #F72585',
              background: '#16161B',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem' }}>
                  Personalizar Item: {customizingProduct.name}
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--d26-gray-300)' }}>
                  Preço base no canal: {formatBrlCents(resolveChannelPriceCents(customizingProduct, selectedChannel))}
                </span>
              </div>
              <button
                className="d26-btn d26-btn-secondary"
                onClick={() => setCustomizingProduct(null)}
              >
                Cancelar
              </button>
            </div>

            {customizingProduct.modifierGroups.map((grp) => {
              const currentSelected = selectedModifierIds[grp.id] ?? [];
              return (
                <div
                  key={grp.id}
                  style={{
                    background: 'var(--d26-black-900)',
                    padding: '10px 14px',
                    borderRadius: '8px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong>{grp.name}</strong>
                    <span className="d26-badge d26-badge-outline-purple">
                      {grp.required ? `Obrigatório (Mín: ${grp.minSelect})` : 'Opcional'} • Máx: {grp.maxSelect}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {grp.options
                      .filter((o) => o.available !== false)
                      .map((opt) => {
                        const isChecked = currentSelected.includes(opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            className={`d26-btn ${isChecked ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
                            onClick={() => {
                              setSelectedModifierIds((prev) => {
                                const list = prev[grp.id] ?? [];
                                if (list.includes(opt.id)) {
                                  return { ...prev, [grp.id]: list.filter((x) => x !== opt.id) };
                                }
                                if (grp.maxSelect === 1) {
                                  return { ...prev, [grp.id]: [opt.id] };
                                }
                                if (list.length >= grp.maxSelect) return prev;
                                return { ...prev, [grp.id]: [...list, opt.id] };
                              });
                            }}
                          >
                            {isChecked ? '✓ ' : '+ '}
                            {opt.name}
                            {opt.priceDeltaCents > 0 ? ` (+${formatBrlCents(opt.priceDeltaCents)})` : ''}
                          </button>
                        );
                      })}
                  </div>
                </div>
              );
            })}

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                className="d26-input"
                placeholder="Observação do cliente para a cozinha (ex: sem cebola, bem passado)..."
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
              />
              <button className="d26-btn d26-btn-primary" onClick={confirmCustomizedProduct}>
                Confirmar e Adicionar ao Pedido
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
            <button
              className="d26-btn d26-btn-secondary"
              style={{ padding: '4px 10px' }}
              onClick={() => setFeedbackBanner(null)}
            >
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


            </div>
            <p style={{ color: 'var(--d26-gray-300)', fontSize: '0.86rem', marginTop: '4px' }}>
              {currentModuleDef.description}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="d26-btn d26-btn-secondary" onClick={refreshState}>
              ↻ Atualizar
            </button>
            <button className="d26-btn d26-btn-primary" onClick={handleTriggerCloudSync}>
              ⇄ Sincronizar
            </button>
          </div>
        </div>

        {/* =====================================================================
            MÓDULO 1: DASHBOARD
           ===================================================================== */}
        {activeModule === 'dashboard' && (
          <>
            {authSession && hasPermission(activeRole, 'finance:view_dre') && <FinancialDashboard apiBase={localApiBase} token={authSession.token}/>}
            <div className="d26-grid-kpi">
              <div className="d26-card">
                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.78rem' }}>
                  COMANDAS / MESAS ABERTAS
                </span>
                <div className="d26-kpi-value">{openTabs.length}</div>
                <span style={{ fontSize: '0.76rem', color: '#34D399' }}>
                  Suporte a Pagamento Parcial Ativo
                </span>
              </div>
              <div className="d26-card">
                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.78rem' }}>
                  FILA NA COZINHA / CHAPA (KDS)
                </span>
                <div className="d26-kpi-value">{activeKitchenOrders.length}</div>
                <span style={{ fontSize: '0.76rem', color: '#FFAFCC' }}>
                  Impressão Incremental por Pedido
                </span>
              </div>
              <div className="d26-card">
                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.78rem' }}>
                  RECEBIMENTOS DO RESTAURANTE
                </span>
                <div className="d26-kpi-value">
                  {formatBrlCents(snapshot.payments.filter(p=>p.status==='CONFIRMED').reduce((acc, p) => acc + p.amountCents, 0))}
                </div>
                <span style={{ fontSize: '0.76rem', color: '#D8B4FE' }}>
                  {snapshot.payments.filter(p=>p.status==='CONFIRMED').length} pagamento(s) confirmado(s)
                </span>
              </div>
              <div className="d26-card">
                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.78rem' }}>
                  CATÁLOGO INTEGRADO & ESTOQUE
                </span>
                <div className="d26-kpi-value">
                  {snapshot.catalog.products.filter((p) => p.active).length} ativos
                </div>
                <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-300)' }}>
                  {snapshot.catalog.categories.length} categorias • {lowStockCount} alerta(s) estoque
                </span>
              </div>
            </div>

            <div className="d26-split-2">
              <div className="d26-card"><h2 style={{fontSize:'1rem',marginBottom:12}}>Sua operação, em um só lugar</h2><p style={{color:'var(--d26-gray-300)',lineHeight:1.8,fontSize:13}}>Acompanhe as mesas, o preparo dos pedidos e as hospedagens. Recebimentos, transferências e estornos permanecem vinculados à sua origem.</p><div style={{display:'flex',gap:10,marginTop:20,flexWrap:'wrap'}}><span className={serverConnected?'d26-badge d26-badge-success':'d26-badge d26-badge-warning'}>{serverConnected?'Operação local conectada':'Conexão local indisponível'}</span><span className="d26-badge d26-badge-purple">{pendingOutboxCount} evento(s) aguardando sincronização</span></div><p style={{color:'var(--d26-gray-400)',fontSize:12,marginTop:18,lineHeight:1.8}}>A emissão fiscal permanece em demonstração. Confira caixa e recebimentos com os comprovantes da operação.</p></div>
              <div className="d26-card">
                <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>Acesso Rápido aos Módulos</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    className="d26-btn d26-btn-primary"
                    onClick={() => setActiveModule('produtos-cardapio')}
                  >
                    Cadastro de Produtos & Cardápio (F7)
                  </button>
                  <button
                    className="d26-btn d26-btn-tertiary"
                    onClick={() => setActiveModule('estoque')}
                  >
                    Controle de Estoque & Kardex (F8)
                  </button>
                  <button
                    className="d26-btn d26-btn-secondary"
                    onClick={() => setActiveModule('caixa-pdv')}
                  >
                    Abrir Caixa & PDV (F2)
                  </button>
                  <button
                    className="d26-btn d26-btn-secondary"
                    onClick={() => setActiveModule('mesas-comandas')}
                  >
                    Mesas, Comandas & QR Codes (F3)
                  </button>
                  <button
                    className="d26-btn d26-btn-secondary"
                    onClick={() => setActiveModule('garcons')}
                  >
                    Terminal Garçons (F5)
                  </button>
                  <button
                    className="d26-btn d26-btn-secondary"
                    onClick={() => setActiveModule('cozinha')}
                  >
                    KDS Cozinha & Chapa (F6)
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* =====================================================================
            MÓDULO 2: CADASTRO INTELIGENTE DE PRODUTOS, CATEGORIAS E FICHAS TÉCNICAS (F7)
           ===================================================================== */}
        {activeModule === 'produtos-cardapio' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* SUB-ABAS DO MÓDULO DE CATÁLOGO */}
            <div className="d26-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className={`d26-btn ${catalogSubTab === 'PRODUCTS' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setCatalogSubTab('PRODUCTS')}
                >
                  📦 Produtos ({snapshot.catalog.products.length})
                </button>
                <button
                  className={`d26-btn ${catalogSubTab === 'CATEGORIES' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setCatalogSubTab('CATEGORIES')}
                >
                  🗂 Categorias ({snapshot.catalog.categories.length})
                </button>
                <button
                  className={`d26-btn ${catalogSubTab === 'RECIPES' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setCatalogSubTab('RECIPES')}
                >
                  📋 Fichas Técnicas ({(snapshot.recipes ?? []).length})
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="d26-btn d26-btn-primary" onClick={openCreateProductModal}>
                  + Novo Produto Completo
                </button>
              </div>
            </div>

            {/* MODAL/PAINEL DE CRIAÇÃO E EDIÇÃO COMPLETA DE PRODUTO */}
            {showProductForm && (
              <form
                onSubmit={handleSaveProduct}
                className="d26-card"
                style={{ border: '2px solid #F72585', display: 'flex', flexDirection: 'column', gap: '12px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '1.05rem' }}>
                    {editingProductId ? `Editar Produto (${prodSku})` : 'Novo Produto no Catálogo Único'}
                  </h3>
                  <span className="d26-badge d26-badge-purple">
                    Margem Bruta Calculada: {previewMargin.toFixed(1)}%
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Código SKU *</label>
                    <input
                      className="d26-input"
                      required
                      value={prodSku}
                      onChange={(e) => setProdSku(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Código de Barras (EAN)</label>
                    <input
                      className="d26-input"
                      placeholder="Opcional"
                      value={prodBarcode}
                      onChange={(e) => setProdBarcode(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Nome do Produto *</label>
                    <input
                      className="d26-input"
                      required
                      value={prodName}
                      onChange={(e) => setProdName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Categoria *</label>
                    <select
                      className="d26-select"
                      value={prodCategoryId}
                      onChange={(e) => setProdCategoryId(e.target.value)}
                    >
                      {snapshot.catalog.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Subcategoria</label>
                    <input
                      className="d26-input"
                      placeholder="Ex: Grelhados / Tradicionais"
                      value={prodSubcategory}
                      onChange={(e) => setProdSubcategory(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Unidade de Medida</label>
                    <select
                      className="d26-select"
                      value={prodUnit}
                      onChange={(e) => setProdUnit(e.target.value)}
                    >
                      <option value="UN">UN (Unidade)</option>
                      <option value="PORCAO">PORÇÃO</option>
                      <option value="PRATO">PRATO</option>
                      <option value="KG">KG (Quilograma)</option>
                      <option value="L">L (Litro)</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Preço Padrão Salão/PDV (R$) *</label>
                    <input
                      className="d26-input"
                      required
                      value={prodPriceReais}
                      onChange={(e) => setProdPriceReais(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Custo Estimado (R$)</label>
                    <input
                      className="d26-input"
                      value={prodCostReais}
                      onChange={(e) => setProdCostReais(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Preço Específico Delivery (R$)</label>
                    <input
                      className="d26-input"
                      placeholder="Usa preço padrão se vazio"
                      value={prodDeliveryPriceReais}
                      onChange={(e) => setProdDeliveryPriceReais(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Preço Específico Quarto Hotel (R$)</label>
                    <input
                      className="d26-input"
                      placeholder="Usa preço padrão se vazio"
                      value={prodHotelPriceReais}
                      onChange={(e) => setProdHotelPriceReais(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Estação de Preparo</label>
                    <select
                      className="d26-select"
                      value={prodPrepStation}
                      onChange={(e) => setProdPrepStation(e.target.value as PrepStation)}
                    >
                      <option value="KITCHEN_HOT">Cozinha Quente</option>
                      <option value="KITCHEN_COLD">Cozinha Fria</option>
                      <option value="GRIDDLE_TAPIOCA">Chapa (Tapioca/Cuscuz)</option>
                      <option value="BAR_DRINKS">Bar e Bebidas</option>
                      <option value="CASHIER_COUNTER">Balcão / Caixa</option>
                      <option value="NONE">Sem Impressão de Produção</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Tempo Médio Preparo (min)</label>
                    <input
                      type="number"
                      className="d26-input"
                      value={prodPrepMinutes}
                      onChange={(e) => setProdPrepMinutes(Number(e.target.value) || 10)}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Saldo de Estoque</label>
                    <input
                      type="number"
                      className="d26-input"
                      value={prodInitialStock}
                      onChange={(e) => setProdInitialStock(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Estoque Mínimo (Alerta)</label>
                    <input
                      type="number"
                      className="d26-input"
                      value={prodMinStock}
                      onChange={(e) => setProdMinStock(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Política Sem Estoque</label>
                    <select
                      className="d26-select"
                      value={prodOutOfStockPolicy}
                      onChange={(e) => setProdOutOfStockPolicy(e.target.value as OutOfStockPolicy)}
                    >
                      <option value="BLOCK_SALE">Bloquear Venda (BLOCK_SALE)</option>
                      <option value="ALLOW_BACKORDER">Permitir Venda c/ Alerta</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>NCM Fiscal (Revisão Contábil)</label>
                    <input
                      className="d26-input"
                      placeholder="Ex: 2106.90.90"
                      value={prodNcm}
                      onChange={(e) => setProdNcm(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>CFOP Padrão</label>
                    <input
                      className="d26-input"
                      placeholder="Ex: 5102"
                      value={prodCfop}
                      onChange={(e) => setProdCfop(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Status no Catálogo</label>
                    <select
                      className="d26-select"
                      value={prodActive ? 'ACTIVE' : 'INACTIVE'}
                      onChange={(e) => setProdActive(e.target.value === 'ACTIVE')}
                    >
                      <option value="ACTIVE">Ativo para Venda</option>
                      <option value="INACTIVE">Inativo (Oculto nos Canais)</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Descrição no Cardápio</label>
                    <input
                      className="d26-input"
                      value={prodDescription}
                      onChange={(e) => setProdDescription(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Observações Internas da Cozinha</label>
                    <input
                      className="d26-input"
                      value={prodInternalNotes}
                      onChange={(e) => setProdInternalNotes(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="button"
                    className="d26-btn d26-btn-secondary"
                    onClick={() => setShowProductForm(false)}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="d26-btn d26-btn-primary">
                    Salvar Produto no Catálogo
                  </button>
                </div>
              </form>
            )}

            {/* ABA 1: LISTA E GRADE INTELIGENTE DE PRODUTOS */}
            {catalogSubTab === 'PRODUCTS' && (
              <div className="d26-card">
                {/* BARRA DE BUSCA INSTANTÂNEA, FILTROS, ORDENAÇÃO E AÇÕES EM LOTE */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '14px', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="d26-input"
                    style={{ flex: '1 1 220px' }}
                    placeholder="🔍 Buscar produto por nome, código SKU ou ingrediente..."
                    value={catalogSearch}
                    onChange={(e) => {
                      setCatalogSearch(e.target.value);
                      setCatalogPage(1);
                    }}
                  />
                  <select
                    className="d26-select"
                    style={{ width: '190px' }}
                    value={catalogCatFilter}
                    onChange={(e) => {
                      setCatalogCatFilter(e.target.value);
                      setCatalogPage(1);
                    }}
                  >
                    <option value="ALL">Todas as Categorias</option>
                    {snapshot.catalog.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="d26-select"
                    style={{ width: '150px' }}
                    value={catalogStatusFilter}
                    onChange={(e) =>
                      setCatalogStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')
                    }
                  >
                    <option value="ALL">Status: Todos</option>
                    <option value="ACTIVE">Apenas Ativos</option>
                    <option value="INACTIVE">Apenas Inativos</option>
                  </select>
                  <select
                    className="d26-select"
                    style={{ width: '170px' }}
                    value={catalogStockFilter}
                    onChange={(e) => setCatalogStockFilter(e.target.value as 'ALL' | 'LOW_STOCK')}
                  >
                    <option value="ALL">Estoque: Todos</option>
                    <option value="LOW_STOCK">⚠ Abaixo do Mínimo</option>
                  </select>
                  <select
                    className="d26-select"
                    style={{ width: '185px' }}
                    value={catalogSourceFilter}
                    onChange={(e) =>
                      setCatalogSourceFilter(
                        e.target.value as 'ALL' | 'OFFICIAL_MENU' | 'TEST_ONLY'
                      )
                    }
                  >
                    <option value="ALL">Origem: Todos ({snapshot.catalog.products.length})</option>
                    <option value="OFFICIAL_MENU">Cardápio Oficial Deck 26</option>
                    <option value="TEST_ONLY">Itens de Teste Técnico</option>
                  </select>
                  <select
                    className="d26-select"
                    style={{ width: '165px' }}
                    value={catalogSortBy}
                    onChange={(e) =>
                      setCatalogSortBy(
                        e.target.value as 'NAME' | 'PRICE_ASC' | 'PRICE_DESC' | 'MARGIN_DESC'
                      )
                    }
                  >
                    <option value="NAME">Ordenar: Nome A-Z</option>
                    <option value="PRICE_ASC">Menor Preço</option>
                    <option value="PRICE_DESC">Maior Preço</option>
                    <option value="MARGIN_DESC">Maior Margem %</option>
                  </select>
                  <button
                    className="d26-btn d26-btn-secondary"
                    onClick={() => setCatalogViewMode((m) => (m === 'GRID' ? 'LIST' : 'GRID'))}
                  >
                    {catalogViewMode === 'GRID' ? '☰ Visão em Lista' : '⊞ Visão em Grade'}
                  </button>
                </div>

                {selectedProductIds.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: 'rgba(114, 9, 183, 0.2)',
                      borderRadius: '8px',
                      marginBottom: '12px'
                    }}
                  >
                    <strong>{selectedProductIds.length} selecionado(s)</strong>
                    <button
                      className="d26-btn d26-btn-primary"
                      style={{ padding: '4px 10px', fontSize: '0.76rem' }}
                      onClick={() => handleBatchStatus(true)}
                    >
                      Ativar Selecionados
                    </button>
                    <button
                      className="d26-btn d26-btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '0.76rem' }}
                      onClick={() => handleBatchStatus(false)}
                    >
                      Desativar Selecionados
                    </button>
                    <button
                      className="d26-btn d26-btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '0.76rem' }}
                      onClick={() => setSelectedProductIds([])}
                    >
                      Limpar Seleção
                    </button>
                  </div>
                )}

                {catalogViewMode === 'GRID' ? (
                  <div className="d26-product-grid">
                    {paginatedCatalogProducts.map((product) => {
                      const stockQty = stockBalanceByProductId.get(product.id) ?? 0;
                      const isLow = stockQty <= (product.minStockQuantity ?? 5);
                      const margin = calculateGrossMarginPercent(
                        product.priceCents,
                        product.costPriceCents ?? 0
                      );
                      return (
                        <div
                          key={product.id}
                          className="d26-product-card"
                          style={{ opacity: product.active ? 1 : 0.55 }}
                        >
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={selectedProductIds.includes(product.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedProductIds((prev) => [...prev, product.id]);
                                    } else {
                                      setSelectedProductIds((prev) => prev.filter((id) => id !== product.id));
                                    }
                                  }}
                                />
                                <strong style={{ fontSize: '0.92rem' }}>{product.name}</strong>
                              </label>
                              <MenuPriceBadge cents={product.priceCents} />
                            </div>
                            <p style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)', marginTop: '4px' }}>
                              {product.description}
                            </p>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                              <span className="d26-badge d26-badge-outline-purple" style={{ fontSize: '0.65rem' }}>
                                SKU: {product.sku}
                              </span>
                              <span className="d26-badge d26-badge-outline-pink" style={{ fontSize: '0.65rem' }}>
                                Margem: {margin.toFixed(0)}%
                              </span>
                              <span
                                className={`d26-badge ${
                                  stockQty <= 0
                                    ? 'd26-badge-warning'
                                    : isLow
                                      ? 'd26-badge-warning'
                                      : 'd26-badge-success'
                                }`}
                                style={{ fontSize: '0.65rem' }}
                              >
                                Estoque: {stockQty} {product.unitOfMeasure ?? 'UN'}
                              </span>
                              {product.dataSource === 'TEST_ONLY' && (
                                <span className="d26-badge d26-badge-purple" style={{ fontSize: '0.65rem' }}>
                                  TEST_ONLY
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', gap: '6px' }}>
                            <button
                              className="d26-btn d26-btn-secondary"
                              style={{ padding: '5px 10px', fontSize: '0.75rem', flex: 1 }}
                              onClick={() => openEditProductModal(product)}
                            >
                              ✎ Editar
                            </button>
                            <button
                              className="d26-btn d26-btn-secondary"
                              style={{ padding: '5px 10px', fontSize: '0.75rem' }}
                              onClick={() => handleDeleteOrDeactivateProduct(product.id)}
                            >
                              {product.active ? 'Desativar' : 'Excluir/Desativar'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <table className="d26-table">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Produto</th>
                        <th>Estação</th>
                        <th>Preço Salão</th>
                        <th>Custo / Margem</th>
                        <th>Estoque</th>
                        <th>Origem</th>
                        <th>Status</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedCatalogProducts.map((p) => {
                        const qty = stockBalanceByProductId.get(p.id) ?? 0;
                        const margin = calculateGrossMarginPercent(p.priceCents, p.costPriceCents ?? 0);
                        return (
                          <tr key={p.id}>
                            <td><code>{p.sku}</code></td>
                            <td><strong>{p.name}</strong></td>
                            <td>{p.prepStation}</td>
                            <td>{formatBrlCents(p.priceCents)}</td>
                            <td>
                              {formatBrlCents(p.costPriceCents ?? 0)} ({margin.toFixed(0)}%)
                            </td>
                            <td>{qty} {p.unitOfMeasure ?? 'UN'}</td>
                            <td>{p.dataSource ?? 'OFFICIAL_MENU'}</td>
                            <td>
                              <span className={`d26-badge ${p.active ? 'd26-badge-success' : 'd26-badge-warning'}`}>
                                {p.active ? 'ATIVO' : 'INATIVO'}
                              </span>
                            </td>
                            <td style={{ display: 'flex', gap: '6px' }}>
                              <button
                                className="d26-btn d26-btn-secondary"
                                style={{ padding: '4px 8px', fontSize: '0.74rem' }}
                                onClick={() => openEditProductModal(p)}
                              >
                                Editar
                              </button>
                              <button
                                className="d26-btn d26-btn-secondary"
                                style={{ padding: '4px 8px', fontSize: '0.74rem' }}
                                onClick={() => handleDeleteOrDeactivateProduct(p.id)}
                              >
                                Desativar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {/* PAGINAÇÃO */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)' }}>
                    Exibindo {paginatedCatalogProducts.length} de {filteredCatalogProducts.length} produtos filtrados
                  </span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      className="d26-btn d26-btn-secondary"
                      disabled={catalogPage <= 1}
                      onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                    >
                      ← Anterior
                    </button>
                    <span style={{ fontSize: '0.82rem' }}>
                      Página {catalogPage} de {totalCatalogPages}
                    </span>
                    <button
                      className="d26-btn d26-btn-secondary"
                      disabled={catalogPage >= totalCatalogPages}
                      onClick={() => setCatalogPage((p) => Math.min(totalCatalogPages, p + 1))}
                    >
                      Próxima →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ABA 2: GERENCIAMENTO DE CATEGORIAS (SEÇÃO 5) */}
            {catalogSubTab === 'CATEGORIES' && (
              <div className="d26-split-2">
                <div className="d26-card">
                  <h3 style={{ fontSize: '1rem', marginBottom: '12px' }}>Categorias do Cardápio</h3>
                  <table className="d26-table">
                    <thead>
                      <tr>
                        <th>Ordem</th>
                        <th>Categoria</th>
                        <th>Descrição</th>
                        <th>Status</th>
                        <th>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.catalog.categories.map((cat) => (
                        <tr key={cat.id}>
                          <td>{cat.sortOrder}</td>
                          <td><strong>{cat.name}</strong></td>
                          <td>{cat.description}</td>
                          <td>
                            <span className={`d26-badge ${cat.active ? 'd26-badge-success' : 'd26-badge-warning'}`}>
                              {cat.active ? 'Ativa' : 'Inativa'}
                            </span>
                          </td>
                          <td>
                            <button
                              className="d26-btn d26-btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '0.74rem' }}
                              onClick={() => handleDeleteCategory(cat.id)}
                            >
                              Excluir
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <form onSubmit={handleCreateCategory} className="d26-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <h3 style={{ fontSize: '1rem' }}>Nova Categoria</h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)' }}>
                    Proteção ativa: o sistema bloqueia automaticamente a exclusão de categorias que possuam produtos vinculados.
                  </p>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--d26-gray-300)' }}>Nome da Categoria *</label>
                    <input
                      className="d26-input"
                      required
                      placeholder="Ex: Sobremesas Regionais"
                      value={catName}
                      onChange={(e) => setCatName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--d26-gray-300)' }}>Descrição</label>
                    <input
                      className="d26-input"
                      placeholder="Ex: Doces artesanais e taças"
                      value={catDescription}
                      onChange={(e) => setCatDescription(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--d26-gray-300)' }}>Ordem de Exibição</label>
                    <input
                      type="number"
                      className="d26-input"
                      value={catSortOrder}
                      onChange={(e) => setCatSortOrder(Number(e.target.value) || 10)}
                    />
                  </div>
                  <button type="submit" className="d26-btn d26-btn-primary">
                    Salvar Categoria
                  </button>
                </form>
              </div>
            )}

            {/* ABA 3: FICHAS TÉCNICAS VERSIONADAS (SEÇÃO 10) */}
            {catalogSubTab === 'RECIPES' && (
              <div className="d26-split-2">
                <div className="d26-card">
                  <h3 style={{ fontSize: '1rem', marginBottom: '10px' }}>
                    Fichas Técnicas Aprovadas (Baixa Automática de Insumos)
                  </h3>
                  {(snapshot.recipes ?? []).length === 0 ? (
                    <p style={{ fontSize: '0.82rem', color: 'var(--d26-gray-400)' }}>
                      Nenhuma ficha técnica cadastrada ainda. Sem ficha técnica aprovada, o sistema realiza a baixa direta na unidade do produto vendido.
                    </p>
                  ) : (
                    <table className="d26-table">
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th>Versão</th>
                          <th>Status</th>
                          <th>Ingredientes Consumidos por Venda</th>
                          <th>Custo Ficha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(snapshot.recipes ?? []).map((r) => {
                          const prod = snapshot.catalog.products.find((p) => p.id === r.productId);
                          return (
                            <tr key={r.id}>
                              <td><strong>{prod?.name ?? r.productId}</strong></td>
                              <td>v{r.version}</td>
                              <td>
                                <span className="d26-badge d26-badge-success">{r.status}</span>
                              </td>
                              <td>
                                {r.items.map((i) => `${i.quantityUsed} ${i.unitOfMeasure} de ${i.ingredientName}`).join(', ')}
                              </td>
                              <td>{formatBrlCents(r.estimatedCostCents)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                <form onSubmit={handleSaveRecipe} className="d26-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <h3 style={{ fontSize: '1rem' }}>Cadastrar / Versionar Ficha Técnica Real</h3>
                  <p style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>
                    Ao aprovar uma Ficha Técnica para um prato, cada venda confirmada (`RECEIVED`) deduzirá automaticamente os ingredientes vinculados.
                  </p>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--d26-gray-300)' }}>Prato Principal</label>
                    <select
                      className="d26-select"
                      value={recipeProductId}
                      onChange={(e) => setRecipeProductId(e.target.value)}
                    >
                      {snapshot.catalog.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--d26-gray-300)' }}>Insumo / Ingrediente Consumido</label>
                    <select
                      className="d26-select"
                      value={recipeIngredientId}
                      onChange={(e) => setRecipeIngredientId(e.target.value)}
                    >
                      {snapshot.catalog.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (Custo: {formatBrlCents(p.costPriceCents ?? 0)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--d26-gray-300)' }}>Quantidade Utilizada por Porção</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      className="d26-input"
                      value={recipeQuantityUsed}
                      onChange={(e) => setRecipeQuantityUsed(Number(e.target.value) || 1)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--d26-gray-300)' }}>Observações Técnicas</label>
                    <input
                      className="d26-input"
                      value={recipeNotes}
                      onChange={(e) => setRecipeNotes(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="d26-btn d26-btn-primary">
                    Aprovar Nova Versão de Ficha Técnica
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* =====================================================================
            MÓDULOS DE LANÇAMENTO DE PEDIDOS E CAIXA (PDV E GARÇONS)
           ===================================================================== */}
        {(activeModule === 'caixa-pdv' || activeModule === 'garcons') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* BANNER DE NOTIFICAÇÕES EM TEMPO REAL PARA O GARÇOM (ETAPA 4 — SEÇÃO 16) */}
            {activeModule === 'garcons' &&
              (snapshot.notifications ?? []).filter(
                (n) => !n.acknowledgedAt && n.eventType === 'ORDER_READY'
              ).length > 0 && (
                <div
                  className="d26-card"
                  style={{
                    borderLeft: '4px solid #34D399',
                    background: 'rgba(16, 185, 129, 0.12)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}
                >
                  <strong style={{ color: '#34D399', fontSize: '0.92rem' }}>
                    🔔 Avisos da Cozinha — Pedidos Prontos para Retirada
                  </strong>
                  {(snapshot.notifications ?? [])
                    .filter((n) => !n.acknowledgedAt && n.eventType === 'ORDER_READY')
                    .map((n) => (
                      <div
                        key={n.id}
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
                          <strong>{n.title}</strong> — {n.message}
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {n.orderId && (
                            <button
                              className="d26-btn d26-btn-primary"
                              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                              onClick={async () => {
                                await handleAdvanceOrder(n.orderId!, 'DELIVERED');
                                await handleAcknowledgeNotification(n.id);
                              }}
                            >
                              ✓ Confirmar Entrega na Mesa
                            </button>
                          )}
                          <button
                            className="d26-btn d26-btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                            onClick={() => handleAcknowledgeNotification(n.id)}
                          >
                            Ciente
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}

            {/* RESUMO OPERACIONAL E TURNO DE CAIXA (ETAPA 4 — SEÇÕES 19 E 20) */}
            {activeModule === 'caixa-pdv' && snapshot.cashierSummary && (
              <div className="d26-card" style={{ borderLeft: '4px solid #F72585' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                    flexWrap: 'wrap',
                    gap: '8px'
                  }}
                >
                  <h2 style={{ fontSize: '1rem' }}>
                    Controle de Turno de Caixa, Sangria, Suprimento e Conciliação Financeira
                  </h2>
                  <span
                    className={`d26-badge ${
                      snapshot.cashierSummary.activeSession ? 'd26-badge-success' : 'd26-badge-warning'
                    }`}
                  >
                    {snapshot.cashierSummary.activeSession
                      ? `Turno Aberto (${snapshot.cashierSummary.activeSession.openedByUserId})`
                      : 'Caixa Fechado'}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
                    gap: '10px',
                    marginBottom: '12px'
                  }}
                >
                  <div style={{ background: 'var(--d26-black-900)', padding: '10px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>
                      Vendas Registradas
                    </div>
                    <strong style={{ fontSize: '1.05rem', color: '#F72585' }}>
                      {formatBrlCents(snapshot.cashierSummary.financialSummary.registeredSalesCents)}
                    </strong>
                  </div>
                  <div style={{ background: 'var(--d26-black-900)', padding: '10px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>
                      Recebido Líquido
                    </div>
                    <strong style={{ fontSize: '1.05rem', color: '#34D399' }}>
                      {formatBrlCents(snapshot.cashierSummary.financialSummary.actualReceivedTotalCents)}
                    </strong>
                  </div>
                  <div style={{ background: 'var(--d26-black-900)', padding: '10px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>
                      Saldo Espécie na Gaveta
                    </div>
                    <strong style={{ fontSize: '1.05rem', color: '#FFAFCC' }}>
                      {formatBrlCents(
                        snapshot.cashierSummary.activeSession?.expectedCashCents ?? 0
                      )}
                    </strong>
                  </div>
                  <div style={{ background: 'var(--d26-black-900)', padding: '10px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>
                      Pendente em Comandas
                    </div>
                    <strong style={{ fontSize: '1.05rem', color: '#FBBF24' }}>
                      {formatBrlCents(snapshot.cashierSummary.financialSummary.pendingReceivablesCents)}
                    </strong>
                  </div>
                  <div style={{ background: 'var(--d26-black-900)', padding: '10px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>
                      Descontos / Estornos
                    </div>
                    <strong style={{ fontSize: '0.92rem' }}>
                      {formatBrlCents(snapshot.cashierSummary.financialSummary.totalDiscountsCents)} /{' '}
                      {formatBrlCents(snapshot.cashierSummary.financialSummary.totalRefundedCents)}
                    </strong>
                  </div>
                </div>

                {!snapshot.cashierSummary.activeSession ? (
                  <form
                    onSubmit={handleOpenCashSession}
                    style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <input
                      type="text"
                      className="d26-input"
                      style={{ width: '180px' }}
                      placeholder="Troco inicial (R$)"
                      value={cashShiftOpeningReais}
                      onChange={(e) => setCashShiftOpeningReais(e.target.value)}
                    />
                    <button type="submit" className="d26-btn d26-btn-primary">
                      Abrir Turno de Caixa
                    </button>
                  </form>
                ) : (
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <form
                      onSubmit={handleRecordCashMovement}
                      style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <select
                        className="d26-select"
                        style={{ width: '145px' }}
                        value={cashShiftMovementType}
                        onChange={(e) =>
                          setCashShiftMovementType(e.target.value as 'SANGRIA' | 'SUPRIMENTO')
                        }
                      >
                        <option value="SANGRIA">Sangria (-)</option>
                        <option value="SUPRIMENTO">Suprimento (+)</option>
                      </select>
                      <input
                        type="text"
                        className="d26-input"
                        style={{ width: '110px' }}
                        placeholder="Valor R$"
                        value={cashShiftMovementReais}
                        onChange={(e) => setCashShiftMovementReais(e.target.value)}
                      />
                      <input
                        type="text"
                        className="d26-input"
                        style={{ width: '200px' }}
                        placeholder="Motivo auditável"
                        value={cashShiftMovementReason}
                        onChange={(e) => setCashShiftMovementReason(e.target.value)}
                      />
                      <button type="submit" className="d26-btn d26-btn-secondary">
                        Registrar Movimento
                      </button>
                    </form>

                    <form
                      onSubmit={handleCloseCashSession}
                      style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto' }}
                    >
                      <input
                        type="text"
                        className="d26-input"
                        style={{ width: '165px' }}
                        placeholder="Espécie contado (R$)"
                        value={cashShiftCountedReais}
                        onChange={(e) => setCashShiftCountedReais(e.target.value)}
                      />
                      <button type="submit" className="d26-btn d26-btn-tertiary">
                        Fechar Turno de Caixa
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}

            <div className="d26-split-2">
              <div className="d26-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <h2 style={{ fontSize: '1.05rem' }}>Catálogo Compartilhado — Lançamento Rápido</h2>
                  <input
                    type="text"
                    className="d26-input"
                    style={{ width: '240px' }}
                    placeholder="🔍 Buscar item ou SKU..."
                    value={posSearchQuery}
                    onChange={(e) => setPosSearchQuery(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                  <button
                    className={`d26-btn ${selectedCategoryId === 'ALL' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                    style={{ padding: '5px 10px', fontSize: '0.76rem' }}
                    onClick={() => setSelectedCategoryId('ALL')}
                  >
                    Todos ({posActiveProducts.length})
                  </button>
                  {snapshot.catalog.categories
                    .filter((c) => c.active)
                    .map((cat) => (
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

                <div className="d26-product-grid">
                  {posActiveProducts.map((product) => {
                    const effectiveCh: SalesChannel =
                      activeModule === 'garcons' ? 'DINE_IN' : selectedChannel;
                    const channelPrice = resolveChannelPriceCents(product, effectiveCh);
                    const stockQty = stockBalanceByProductId.get(product.id) ?? 0;
                    const outOfStockBlocked =
                      product.trackStock &&
                      product.outOfStockPolicy === 'BLOCK_SALE' &&
                      stockQty <= 0;

                    return (
                      <div key={product.id} className="d26-product-card">
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                            <strong style={{ fontSize: '0.92rem' }}>{product.name}</strong>
                            <MenuPriceBadge cents={channelPrice} />
                          </div>
                          <p style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)', marginTop: '4px' }}>
                            {product.description}
                          </p>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                          <span className="d26-badge d26-badge-outline-purple" style={{ fontSize: '0.65rem' }}>
                            {product.prepStation} • Est: {stockQty}
                          </span>
                          <button
                            className="d26-btn d26-btn-primary"
                            style={{ padding: '5px 12px', fontSize: '0.78rem' }}
                            disabled={outOfStockBlocked}
                            onClick={() => handleProductClickForPos(product)}
                          >
                            {outOfStockBlocked
                              ? 'Esgotado'
                              : product.modifierGroups.length > 0
                                ? '+ Opções'
                                : '+ Adicionar'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* COLUNA DIREITA: DISPARO DE PEDIDO INCREMENTAL E PAGAMENTO PARCIAL */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="d26-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                    <h2 style={{ fontSize: '1.05rem' }}>
                      Novo Pedido Incremental ({activeModule === 'garcons' ? 'Terminal Garçom' : 'Caixa / PDV Windows'})
                    </h2>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        className="d26-btn d26-btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                        onClick={() => handleOpenTable(selectedTableNumber)}
                      >
                        + Abrir Mesa {String(selectedTableNumber).padStart(2, '0')}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', color: 'var(--d26-gray-300)' }}>Canal de Venda</label>
                      <select
                        className="d26-select"
                        value={activeModule === 'garcons' ? 'DINE_IN' : selectedChannel}
                        disabled={activeModule === 'garcons'}
                        onChange={(e) => setSelectedChannel(e.target.value as SalesChannel)}
                      >
                        <option value="DINE_IN">Mesa / Salão</option>
                        <option value="COUNTER_PDV">Balcão PDV</option>
                        <option value="DELIVERY">Delivery</option>
                        <option value="PICKUP">Retirada</option>
                        <option value="HOTEL_ROOM">Consumo Hotel</option>
                      </select>
                    </div>
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
                    <p style={{ color: 'var(--d26-gray-400)', fontSize: '0.84rem', padding: '12px 0' }}>
                      Selecione itens do cardápio ao lado para compor o pedido da Mesa {selectedTableNumber}.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                      {cart.map((item) => {
                        const effectiveCh: SalesChannel =
                          activeModule === 'garcons' ? 'DINE_IN' : selectedChannel;
                        const unitCents = resolveChannelPriceCents(item.product, effectiveCh);
                        const modCents = item.modifiers.reduce((a, m) => a + m.priceDeltaCents, 0);
                        const lineTotal = (unitCents + modCents) * item.quantity;
                        return (
                          <div
                            key={item.cartItemId}
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
                              <strong>
                                {item.quantity}x {item.product.name}
                              </strong>
                              {item.modifiers.length > 0 && (
                                <div style={{ fontSize: '0.73rem', color: '#FFAFCC' }}>
                                  + {item.modifiers.map((m) => m.optionName).join(', ')}
                                </div>
                              )}
                              {item.notes && (
                                <div style={{ fontSize: '0.72rem', color: '#D8B4FE' }}>
                                  Obs: {item.notes}
                                </div>
                              )}
                              <div style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>
                                {formatBrlCents(lineTotal)}
                              </div>
                            </div>
                            <button
                              className="d26-btn d26-btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                              onClick={() =>
                                setCart((prev) => prev.filter((p) => p.cartItemId !== item.cartItemId))
                              }
                            >
                              Remover
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderTop: 'var(--d26-border-subtle)',
                      paddingTop: '12px'
                    }}
                  >
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>
                        Total deste Pedido:
                      </span>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#F72585' }}>
                        {formatBrlCents(
                          cart.reduce((acc, c) => {
                            const effectiveCh: SalesChannel =
                              activeModule === 'garcons' ? 'DINE_IN' : selectedChannel;
                            const u = resolveChannelPriceCents(c.product, effectiveCh);
                            const m = c.modifiers.reduce((s, mod) => s + mod.priceDeltaCents, 0);
                            return acc + (u + m) * c.quantity;
                          }, 0)
                        )}
                      </div>
                    </div>
                    <button
                      className="d26-btn d26-btn-primary"
                      disabled={cart.length === 0}
                      onClick={() =>
                        submitOrder(activeModule === 'garcons' ? 'WAITER_MOBILE' : 'WINDOWS_PDV')
                      }
                    >
                      Disparar Pedido Incremental
                    </button>
                  </div>
                </div>

                {/* CONSULTA DE PEDIDOS ANTERIORES DA MESA SELECIONADA (SEÇÃO 13) */}
                <div className="d26-card">
                  <h3 style={{ fontSize: '0.94rem', marginBottom: '8px' }}>
                    Histórico da Mesa {selectedTableNumber} neste Turno
                  </h3>
                  {snapshot.orders.filter((o) => o.tableNumber === selectedTableNumber).length === 0 ? (
                    <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)' }}>
                      Nenhum pedido lançado para a Mesa {selectedTableNumber} ainda.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {snapshot.orders
                        .filter((o) => o.tableNumber === selectedTableNumber)
                        .map((ord) => (
                          <div
                            key={ord.id}
                            style={{
                              fontSize: '0.78rem',
                              padding: '6px 10px',
                              background: 'var(--d26-black-900)',
                              borderRadius: '6px',
                              display: 'flex',
                              justifyContent: 'space-between'
                            }}
                          >
                            <span>
                              <strong>#{ord.id.slice(0, 6)}</strong>:{' '}
                              {ord.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}
                            </span>
                            <span className="d26-badge d26-badge-outline-purple">{ord.status}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* LIQUIDAÇÃO PARCIAL OU TOTAL, DIVISÃO, DESCONTO E LIBERAÇÃO DE COMANDAS */}
                <div className="d26-card">
                  <h3 style={{ fontSize: '0.96rem', marginBottom: '6px' }}>
                    Comandas Abertas — Divisão, Desconto, Pagamento Parcial/Misto e Liberação
                  </h3>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <select
                      className="d26-select"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    >
                      <option value="PIX">Método: PIX</option>
                      <option value="CASH">Método: Dinheiro em Espécie (Calcula Troco)</option>
                      <option value="DEBIT_CARD">Método: Cartão de Débito</option>
                      <option value="CREDIT_CARD">Método: Cartão de Crédito</option>
                      <option value="ROOM_CHARGE">Método: Transferir p/ Quarto Hotel Milla</option>
                    </select>
                  </div>

                  {openTabs.length === 0 ? (
                    <p style={{ fontSize: '0.82rem', color: 'var(--d26-gray-400)' }}>
                      Nenhuma comanda aberta no momento.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {openTabs.map((t) => {
                        const remaining = Math.max(0, t.totalCents - t.paidCents);
                        const tabPayments = snapshot.payments.filter(
                          (p) => p.tabId === t.id && p.status === 'CONFIRMED'
                        );
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                              <div>
                                <strong>{t.code}</strong>{' '}
                                <span className="d26-badge d26-badge-outline-purple">{t.status}</span>
                                {t.joinedTables && t.joinedTables.length > 1 && (
                                  <span className="d26-badge d26-badge-pink" style={{ marginLeft: '6px' }}>
                                    Mesas Unidas: {t.joinedTables.join(', ')}
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: '0.8rem', color: '#34D399' }}>
                                Já Pago: {formatBrlCents(t.paidCents)}
                              </span>
                            </div>

                            <div style={{ fontSize: '0.78rem', color: 'var(--d26-gray-300)' }}>
                              Subtotal: {formatBrlCents(t.subtotalCents)} | Desconto:{' '}
                              {formatBrlCents(t.discountCents ?? 0)} | Taxa 10%:{' '}
                              {formatBrlCents(t.serviceFeeCents)} | Total:{' '}
                              <strong>{formatBrlCents(t.totalCents)}</strong> |{' '}
                              <strong style={{ color: '#F72585' }}>
                                Falta Pagar: {formatBrlCents(remaining)}
                              </strong>
                            </div>

                            {/* AÇÕES OPERACIONAIS DA COMANDA (DIVISÃO, CONTA, TAXA 10%, DESCONTO) */}
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              <button
                                className="d26-btn d26-btn-secondary"
                                style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                                onClick={() => handleRequestBill(t.id)}
                              >
                                Pedir Conta
                              </button>
                              <button
                                className="d26-btn d26-btn-secondary"
                                style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                                onClick={() => handleSplitTab(t, 'EQUAL_SHARES', Math.max(2, t.guestsCount || 2))}
                              >
                                Dividir Igual ({Math.max(2, t.guestsCount || 2)} pessoas)
                              </button>
                              <button
                                className="d26-btn d26-btn-secondary"
                                style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                                onClick={() => handleToggleServiceFee(t)}
                              >
                                {(t.serviceFeeEnabled ?? true) ? 'Isentar Taxa 10%' : 'Ativar Taxa 10%'}
                              </button>
                              <button
                                className="d26-btn d26-btn-secondary"
                                style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                                onClick={() => handleApplyDiscount(t.id, 'PERCENTAGE', 1000)}
                              >
                                Desconto 10%
                              </button>
                            </div>

                            {remaining > 0 ? (
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <input
                                  type="text"
                                  className="d26-input"
                                  style={{ flex: 1, minWidth: '140px' }}
                                  placeholder={`Valor em R$ (ex: ${(remaining / 100).toFixed(2).replace('.', ',')})`}
                                  value={partialAmountsInput[t.id] ?? ''}
                                  onChange={(e) =>
                                    setPartialAmountsInput((prev) => ({
                                      ...prev,
                                      [t.id]: e.target.value
                                    }))
                                  }
                                />
                                {paymentMethod === 'CASH' && (
                                  <input
                                    type="text"
                                    className="d26-input"
                                    style={{ width: '145px' }}
                                    placeholder="Recebido R$ (Troco)"
                                    value={receivedCashInput[t.id] ?? ''}
                                    onChange={(e) =>
                                      setReceivedCashInput((prev) => ({
                                        ...prev,
                                        [t.id]: e.target.value
                                      }))
                                    }
                                  />
                                )}
                                <button
                                  className="d26-btn d26-btn-primary"
                                  style={{ whiteSpace: 'nowrap' }}
                                  onClick={() => handleSettleTab(t)}
                                >
                                  Confirmar Recebimento
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                  className="d26-btn d26-btn-primary"
                                  style={{ flex: 1 }}
                                  onClick={() => handleCloseTabAndReleaseTable(t.id, false)}
                                >
                                  ✓ Encerrar Comanda e Liberar Mesa (LIVRE)
                                </button>
                                <button
                                  className="d26-btn d26-btn-secondary"
                                  onClick={() => handleCloseTabAndReleaseTable(t.id, true)}
                                >
                                  Enviar p/ Limpeza
                                </button>
                              </div>
                            )}

                            {tabPayments.length > 0 && (
                              <div style={{ fontSize: '0.73rem', color: 'var(--d26-gray-400)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {tabPayments.map((pay) => (
                                  <div key={pay.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>
                                      • {pay.method}: {formatBrlCents(pay.amountCents)}
                                      {pay.changeCents ? ` (Troco: ${formatBrlCents(pay.changeCents)})` : ''}
                                    </span>
                                    <button
                                      className="d26-btn d26-btn-secondary"
                                      style={{ padding: '2px 6px', fontSize: '0.68rem' }}
                                      onClick={() => handleRefundPayment(pay.id)}
                                    >
                                      Estornar
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            MÓDULO: COZINHA E BAR (KDS PROFISSIONAL COM SLA E ESTAÇÃO — SEÇÕES 14, 15, 17)
           ===================================================================== */}
        {activeModule === 'cozinha' && (
          <div className="d26-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h2 style={{ fontSize: '1.05rem' }}>
                  Fila de Produção KDS (Cozinha Quente, Cozinha Fria, Chapa de Tapiocas/Cuscuz e Bar)
                </h2>
                <p style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>
                  SLA Configurado: Normal até {snapshot.kdsSlaConfig?.warningThresholdMinutes ?? 10} min • Atenção até {snapshot.kdsSlaConfig?.delayedThresholdMinutes ?? 20} min • Acima disso Atrasado
                </p>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(
                  [
                    ['ALL', 'Todas as Estações'],
                    ['KITCHEN_HOT', '🔥 Cozinha Quente'],
                    ['GRIDDLE_TAPIOCA', '🥞 Chapa (Tapioca/Cuscuz)'],
                    ['KITCHEN_COLD', '🥗 Cozinha Fria'],
                    ['BAR_DRINKS', '🍹 Bar & Drinks']
                  ] as const
                ).map(([st, label]) => (
                  <button
                    key={st}
                    className={`d26-btn ${kdsStationFilter === st ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                    style={{ padding: '5px 10px', fontSize: '0.75rem' }}
                    onClick={() => setKdsStationFilter(st)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {snapshot.orders.filter((ord) =>
              kdsStationFilter === 'ALL'
                ? true
                : ord.items.some((it) => it.prepStation === kdsStationFilter)
            ).length === 0 ? (
              <p style={{ color: 'var(--d26-gray-400)' }}>
                Nenhum pedido na fila para a estação selecionada no momento.
              </p>
            ) : (
              <div className="d26-product-grid">
                {snapshot.orders
                  .filter((ord) =>
                    kdsStationFilter === 'ALL'
                      ? true
                      : ord.items.some((it) => it.prepStation === kdsStationFilter)
                  )
                  .map((ord) => {
                    const sla = evaluateKdsOrderSla(
                      ord.createdAt,
                      Date.now(),
                      snapshot.kdsSlaConfig ?? {
                        warningThresholdMinutes: 10,
                        delayedThresholdMinutes: 20,
                        updatedAt: new Date().toISOString()
                      }
                    );
                    const slaBadgeClass =
                      sla.slaStatus === 'DELAYED'
                        ? 'd26-badge-warning'
                        : sla.slaStatus === 'WARNING'
                          ? 'd26-badge-outline-pink'
                          : 'd26-badge-success';

                    return (
                      <div key={ord.id} className="d26-product-card">
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '4px' }}>
                            <span className="d26-badge d26-badge-pink">
                              {ord.tableNumber ? `MESA ${ord.tableNumber}` : ord.channel}
                            </span>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              {ord.status !== 'DELIVERED' && ord.status !== 'CANCELLED' && (
                                <span className={`d26-badge ${slaBadgeClass}`} style={{ fontSize: '0.68rem' }}>
                                  ⏱ {sla.elapsedMinutes} min ({sla.slaStatus})
                                </span>
                              )}
                              <span className="d26-badge d26-badge-purple">{ord.status}</span>
                            </div>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)', marginBottom: '8px' }}>
                            Pedido #{ord.id.slice(0, 8)} • Origem: {ord.originNode}
                            {ord.waiterName ? ` • ${ord.waiterName}` : ''}
                          </div>
                          <ul style={{ paddingLeft: '16px', fontSize: '0.86rem', marginBottom: '10px' }}>
                            {ord.items.map((it) => (
                              <li key={it.id}>
                                <strong>
                                  {it.quantity}x {it.productName}
                                </strong>{' '}
                                <span style={{ color: 'var(--d26-gray-400)', fontSize: '0.73rem' }}>
                                  [{it.prepStation}]
                                </span>
                                {it.modifiers && it.modifiers.length > 0 && (
                                  <div style={{ fontSize: '0.74rem', color: '#FFAFCC' }}>
                                    + {it.modifiers.map((m) => m.optionName).join(', ')}
                                  </div>
                                )}
                                {it.notes && (
                                  <div style={{ fontSize: '0.74rem', color: '#D8B4FE' }}>
                                    Obs: {it.notes}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {ord.status === 'PENDING_APPROVAL' && (
                            <button
                              className="d26-btn d26-btn-primary"
                              style={{ flex: 1 }}
                              onClick={() => handleAdvanceOrder(ord.id, 'RECEIVED')}
                            >
                              Aprovar Pedido QR
                            </button>
                          )}
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
                              Marcar Pronto (Notificar Garçom)
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
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* =====================================================================
            MÓDULO: GESTÃO VISUAL DE MESAS, COMANDAS, PEDIDOS E QR CODES (ETAPA 4 — SEÇÕES 3 A 10)
           ===================================================================== */}
        {activeModule === 'mesas-comandas' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* PAINEL OPERACIONAL DE MESAS DO SALÃO (SEÇÕES 3, 4, 8, 9, 21) */}
            <div className="d26-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <h2 style={{ fontSize: '1.05rem' }}>
                    Mapa de mesas
                  </h2>
                  <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)' }}>
                    Acompanhe o atendimento e identifique rapidamente as mesas que precisam de atenção.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    className="d26-input"
                    style={{ width: '190px' }}
                    placeholder="🔍 Buscar mesa ou garçom..."
                    value={tablesSearch}
                    onChange={(e) => setTablesSearch(e.target.value)}
                  />
                  <select
                    className="d26-select"
                    style={{ width: '190px' }}
                    value={tablesStatusFilter}
                    onChange={(e) => setTablesStatusFilter(e.target.value as 'ALL' | TablePhysicalStatus)}
                  >
                    <option value="ALL">Todos os Estados</option>
                    <option value="LIVRE">LIVRE</option>
                    <option value="AGUARDANDO_PEDIDO">AGUARDANDO_PEDIDO</option>
                    <option value="EM_ATENDIMENTO">EM_ATENDIMENTO</option>
                    <option value="AGUARDANDO_PAGAMENTO">AGUARDANDO_PAGAMENTO</option>
                    <option value="LIMPEZA">LIMPEZA</option>
                    <option value="INDISPONIVEL">INDISPONIVEL</option>
                  </select>
                  <select
                    className="d26-select"
                    style={{ width: '175px' }}
                    value={tablesWaiterFilter}
                    onChange={(e) => setTablesWaiterFilter(e.target.value)}
                  >
                    <option value="ALL">Todos os Garçons</option>
                    <option value="Garçom 01 (Wi-Fi)">Garçom 01 (Wi-Fi)</option>
                    <option value="Garçom 02 (Wi-Fi)">Garçom 02 (Wi-Fi)</option>
                    <option value="Garçom 03 (Wi-Fi)">Garçom 03 (Wi-Fi)</option>
                  </select>
                  <button
                    className="d26-btn d26-btn-secondary"
                    onClick={() => setTablesViewMode((m) => (m === 'GRID' ? 'LIST' : 'GRID'))}
                  >
                    {tablesViewMode === 'GRID' ? '☰ Lista' : '⊞ Grade'}
                  </button>
                </div>
              </div>

              {/* BARRA DE OPERAÇÕES RÁPIDAS DE SALÃO: TRANSFERIR E UNIR MESAS (SEÇÕES 8 E 9) */}
              <div
                style={{
                  display: 'flex',
                  gap: '16px',
                  flexWrap: 'wrap',
                  padding: '10px 12px',
                  background: 'var(--d26-black-900)',
                  borderRadius: '8px',
                  marginBottom: '14px',
                  alignItems: 'center'
                }}
              >
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-300)' }}>Pessoas na Abertura:</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    className="d26-input"
                    style={{ width: '68px' }}
                    value={openTableGuests}
                    onChange={(e) => setOpenTableGuests(Number(e.target.value) || 2)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-300)' }}>Transferir Mesa:</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className="d26-input"
                    style={{ width: '64px' }}
                    value={transferFromTable}
                    onChange={(e) => setTransferFromTable(Number(e.target.value) || 1)}
                  />
                  <span>→</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className="d26-input"
                    style={{ width: '64px' }}
                    value={transferToTable}
                    onChange={(e) => setTransferToTable(Number(e.target.value) || 1)}
                  />
                  <button
                    className="d26-btn d26-btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                    onClick={() => handleTransferTable(transferFromTable, transferToTable)}
                  >
                    Transferir
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-300)' }}>Unir Mesas:</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className="d26-input"
                    style={{ width: '64px' }}
                    value={joinPrimaryTable}
                    onChange={(e) => setJoinPrimaryTable(Number(e.target.value) || 1)}
                  />
                  <span>+</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className="d26-input"
                    style={{ width: '64px' }}
                    value={joinAdditionalTable}
                    onChange={(e) => setJoinAdditionalTable(Number(e.target.value) || 1)}
                  />
                  <button
                    className="d26-btn d26-btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                    onClick={() => handleJoinTables(joinPrimaryTable, joinAdditionalTable)}
                  >
                    Unir Mesas
                  </button>
                  <button
                    className="d26-btn d26-btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                    onClick={() => handleUnjoinTable(joinPrimaryTable, joinAdditionalTable)}
                  >
                    Separar
                  </button>
                </div>
              </div>

              <div className="d26-table-legend" aria-label="Legenda das situações de mesa"><span className="d26-table-free">● Livre</span><span className="d26-table-occupied">● Ocupada / em atendimento</span><span className="d26-table-payment">● Aguardando pagamento</span><span className="d26-table-cleaning">● Em limpeza</span><span className="d26-table-unavailable">● Indisponível</span></div>
              <div className="d26-product-grid">
                {(snapshot.qrTables ?? [])
                  .filter((qt) => {
                    const st = qt.physicalStatus ?? 'LIVRE';
                    if (tablesStatusFilter !== 'ALL' && st !== tablesStatusFilter) return false;
                    if (
                      tablesWaiterFilter !== 'ALL' &&
                      (qt.assignedWaiterName ?? '') !== tablesWaiterFilter
                    ) {
                      return false;
                    }
                    if (tablesSearch.trim()) {
                      const q = tablesSearch.trim().toLowerCase();
                      const matchNum = String(qt.tableNumber).includes(q);
                      const matchWaiter = (qt.assignedWaiterName ?? '').toLowerCase().includes(q);
                      if (!matchNum && !matchWaiter) return false;
                    }
                    return true;
                  })
                  .map((qt) => {
                    const phys = qt.physicalStatus ?? 'LIVRE';
                    const signal = tableSignal(phys);
                    const linkedTab = snapshot.tabs.find((t) => t.id === qt.activeTabId);
                    const remaining = linkedTab
                      ? Math.max(0, linkedTab.totalCents - linkedTab.paidCents)
                      : 0;
                    const occupiedMinutes = qt.openedAt
                      ? Math.max(0, Math.floor((Date.now() - Date.parse(qt.openedAt)) / 60000))
                      : 0;
                    const prepOrdersCount = snapshot.orders.filter(
                      (o) =>
                        o.tableNumber === qt.tableNumber &&
                        (o.status === 'RECEIVED' || o.status === 'IN_PREPARATION')
                    ).length;

                    return (
                      <div
                        key={qt.tableNumber}
                        className={`d26-product-card d26-table-signal d26-table-${signal.tone}`}
                        aria-label={`Mesa ${qt.tableNumber}: ${signal.label}`}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <strong style={{ fontSize: '1.02rem' }}>
                              Mesa {String(qt.tableNumber).padStart(2, '0')}
                            </strong>
                            <span
                              className={`d26-badge d26-table-status d26-table-${signal.tone}`}
                            >
                              <span aria-hidden="true">{signal.icon}</span> {signal.label}
                            </span>
                          </div>

                          {linkedTab ? (
                            <div style={{ fontSize: '0.76rem', color: 'var(--d26-gray-300)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <div>
                                Comanda: <strong>{linkedTab.code}</strong> ({linkedTab.status})
                              </div>
                              <div>
                                Pessoas: <strong>{qt.guestsCount ?? linkedTab.guestsCount ?? 1}</strong> • Tempo:{' '}
                                <strong>{occupiedMinutes} min</strong>
                              </div>
                              <div>
                                Garçom: <strong>{qt.assignedWaiterName ?? linkedTab.waiterName ?? 'Salão'}</strong>
                              </div>
                              <div>
                                Consumido: <strong>{formatBrlCents(linkedTab.totalCents)}</strong> • Pago:{' '}
                                <span style={{ color: '#34D399' }}>{formatBrlCents(linkedTab.paidCents)}</span>
                              </div>
                              <div style={{ color: '#F72585', fontWeight: 700 }}>
                                Restante: {formatBrlCents(remaining)}
                              </div>
                              {prepOrdersCount > 0 && (
                                <div style={{ color: '#FFAFCC' }}>
                                  🍳 {prepOrdersCount} pedido(s) em preparo no KDS
                                </div>
                              )}
                            </div>
                          ) : (
                            <p style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)', margin: '6px 0' }}>
                              {phys === 'LIMPEZA'
                                ? 'Mesa em higienização aguardando liberação.'
                                : 'Mesa disponível para abertura imediata.'}
                            </p>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                          {phys === 'LIVRE' && (
                            <button
                              className="d26-btn d26-btn-primary"
                              style={{ flex: 1, padding: '5px 8px', fontSize: '0.75rem' }}
                              onClick={() => handleOpenTable(qt.tableNumber)}
                            >
                              Abrir Mesa
                            </button>
                          )}
                          {phys === 'LIMPEZA' && (
                            <button
                              className="d26-btn d26-btn-primary"
                              style={{ flex: 1, padding: '5px 8px', fontSize: '0.75rem' }}
                              onClick={() =>
                                handleUpdateTableStatus(
                                  qt.tableNumber,
                                  'LIVRE',
                                  'Mesa higienizada e liberada para novos clientes'
                                )
                              }
                            >
                              Liberar Mesa (LIVRE)
                            </button>
                          )}
                          {linkedTab && (
                            <>
                              <button
                                className="d26-btn d26-btn-primary"
                                style={{ padding: '4px 8px', fontSize: '0.73rem' }}
                                onClick={() => {
                                  setSelectedTableNumber(qt.tableNumber);
                                  setActiveModule('garcons');
                                }}
                              >
                                + Pedido
                              </button>
                              <button
                                className="d26-btn d26-btn-secondary"
                                style={{ padding: '4px 8px', fontSize: '0.73rem' }}
                                onClick={() => handleRequestBill(linkedTab.id)}
                              >
                                Pedir Conta
                              </button>
                              {remaining === 0 && (
                                <button
                                  className="d26-btn d26-btn-tertiary"
                                  style={{ padding: '4px 8px', fontSize: '0.73rem' }}
                                  onClick={() => handleCloseTabAndReleaseTable(linkedTab.id, false)}
                                >
                                  Encerrar
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="d26-split-2">
              <div className="d26-card">
                <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>
                  Resumo das comandas
                </h2>
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
                        <td>
                          <strong>{t.code}</strong>
                        </td>
                        <td>
                          <span className="d26-badge d26-badge-outline-purple">{t.status}</span>
                        </td>
                        <td>{formatBrlCents(t.subtotalCents)}</td>
                        <td>{formatBrlCents(t.serviceFeeCents)}</td>
                        <td>
                          <strong>{formatBrlCents(t.totalCents)}</strong>
                        </td>
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
                <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>
                  Pedidos Incrementais & Cancelamento por Estágio (Seção 17)
                </h2>
                <table className="d26-table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Mesa/Canal</th>
                      <th>Itens</th>
                      <th>Status</th>
                      <th>Valor</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.orders.map((o) => (
                      <tr key={o.id}>
                        <td>#{o.id.slice(0, 8)}</td>
                        <td>{o.tableNumber ? `Mesa ${o.tableNumber}` : o.channel}</td>
                        <td>{o.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}</td>
                        <td>
                          <span className="d26-badge d26-badge-outline-purple">{o.status}</span>
                        </td>
                        <td>{formatBrlCents(o.totalOrderCents)}</td>
                        <td style={{ display: 'flex', gap: '4px' }}>
                          {o.status === 'PENDING_APPROVAL' && (
                            <button
                              className="d26-btn d26-btn-primary"
                              style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                              onClick={() => handleAdvanceOrder(o.id, 'RECEIVED')}
                            >
                              Aprovar QR
                            </button>
                          )}
                          {o.status !== 'CANCELLED' && (
                            <button
                              className="d26-btn d26-btn-secondary"
                              style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                              onClick={() =>
                                handleAdvanceOrder(
                                  o.id,
                                  'CANCELLED',
                                  o.status === 'RECEIVED' || o.status === 'PENDING_APPROVAL'
                                )
                              }
                            >
                              {o.status === 'RECEIVED' || o.status === 'PENDING_APPROVAL'
                                ? 'Cancelar (Estorna Estoque)'
                                : 'Cancelar c/ Perda (Gerência)'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* PAINEL DE QR CODES CRIPTOGRÁFICOS NÃO-PREVISÍVEIS POR MESA (SEÇÃO 12) */}
            <div className="d26-card">
              <h2 style={{ fontSize: '1rem', marginBottom: '6px' }}>
                QR Codes Seguros por Mesa (Identificadores Não-Previsíveis contra Fraude de URL)
              </h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)', marginBottom: '12px' }}>
                Cada mesa possui um token HMAC único validado no servidor, impedindo que clientes alterem o número da mesa ou o preço na URL.
              </p>
              <table className="d26-table">
                <thead>
                  <tr>
                    <th>Mesa</th>
                    <th>Token Criptográfico QR</th>
                    <th>Política de Recebimento</th>
                    <th>Link Direto para Teste no Navegador / Celular</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot.qrTables ?? []).slice(0, 10).map((qt) => {
                    const qrUrl = `http://localhost:5174/?qr=${qt.qrToken}`;
                    return (
                      <tr key={qt.tableNumber}>
                        <td>
                          <strong>Mesa {String(qt.tableNumber).padStart(2, '0')}</strong>
                        </td>
                        <td>
                          <code>{qt.qrToken}</code>
                        </td>
                        <td>
                          <button
                            className={`d26-btn ${
                              qt.requiresOperatorApproval ? 'd26-btn-tertiary' : 'd26-btn-secondary'
                            }`}
                            style={{ padding: '4px 10px', fontSize: '0.73rem' }}
                            onClick={() =>
                              handleToggleQrApprovalPolicy(
                                qt.tableNumber,
                                qt.requiresOperatorApproval
                              )
                            }
                          >
                            {qt.requiresOperatorApproval
                              ? 'Exige Aprovação Manual'
                              : 'Direto p/ Cozinha (RECEIVED)'}
                          </button>
                        </td>
                        <td>
                          <a
                            href={qrUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: '#F72585', fontSize: '0.78rem', fontWeight: 600 }}
                          >
                            Abrir Cardápio QR da Mesa {String(qt.tableNumber).padStart(2, '0')} ↗
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =====================================================================
            MÓDULO: CENTRAL DE PEDIDOS & DELIVERY PRÓPRIO (ETAPA 6)
           ===================================================================== */}
        {activeModule === 'pedidos' && (
          <DeliveryModule
            localApiBase={localApiBase}
            deliveryOrders={snapshot.deliveryOrders ?? []}
            deliveryCouriers={snapshot.deliveryCouriers ?? []}
            deliveryZones={snapshot.deliveryZones ?? []}
            deliveryCustomers={snapshot.deliveryCustomers ?? []}
            getAuthHeaders={getAuthHeaders}
            refreshState={refreshState}
            notify={notify}
          />
        )}

        {/* =====================================================================
            MÓDULO: ESTOQUE COMPLETO, ALERTAS E KARDEX AUDITÁVEL (SEÇÕES 8 E 9)
           ===================================================================== */}
        {activeModule === 'estoque' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* FORMULÁRIO DE ENTRADA DE COMPRA, PERDA, DEVOLUÇÃO OU AJUSTE */}
            <form
              onSubmit={handleStockAdjustment}
              className="d26-card"
              style={{
                borderLeft: '4px solid #7209B7',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '10px',
                alignItems: 'end'
              }}
            >
              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Produto / Insumo</label>
                <select
                  className="d26-select"
                  value={stockProductId}
                  onChange={(e) => setStockProductId(e.target.value)}
                >
                  {snapshot.catalog.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Tipo de Movimentação</label>
                <select
                  className="d26-select"
                  value={stockMovementType}
                  onChange={(e) => setStockMovementType(e.target.value as StockMovementType)}
                >
                  <option value="PURCHASE_ENTRY">Entrada por Compra (+)</option>
                  <option value="RETURN_ENTRY">Devolução / Retorno (+)</option>
                  <option value="WASTE_OR_LOSS">Perda / Quebra / Desperdício (-)</option>
                  <option value="INVENTORY_ADJUST">Ajuste Manual de Inventário</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Quantidade</label>
                <input
                  type="number"
                  step="0.5"
                  className="d26-input"
                  required
                  value={stockQuantityDelta}
                  onChange={(e) => setStockQuantityDelta(Number(e.target.value) || 1)}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Custo Unitário (R$ opcional)</label>
                <input
                  type="text"
                  className="d26-input"
                  placeholder="Atualiza custo na compra"
                  value={stockUnitCostReais}
                  onChange={(e) => setStockUnitCostReais(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-300)' }}>Motivo Auditável *</label>
                <input
                  type="text"
                  className="d26-input"
                  required
                  value={stockReason}
                  onChange={(e) => setStockReason(e.target.value)}
                />
              </div>
              <button type="submit" className="d26-btn d26-btn-primary">
                Registrar Movimentação
              </button>
            </form>

            <div className="d26-split-2">
              <div className="d26-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h2 style={{ fontSize: '1rem' }}>Saldos Atuais e Alertas de Estoque Mínimo</h2>
                  <button
                    className={`d26-btn ${stockFilterLowOnly ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                    style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                    onClick={() => setStockFilterLowOnly((v) => !v)}
                  >
                    {stockFilterLowOnly ? 'Exibindo Abaixo do Mínimo' : 'Filtrar Estoque Baixo'}
                  </button>
                </div>
                <table className="d26-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Produto</th>
                      <th>Saldo Atual</th>
                      <th>Mínimo</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.stock.balances
                      .filter((b) => !stockFilterLowOnly || b.lowStockAlert)
                      .map((b) => (
                        <tr key={b.productId}>
                          <td>
                            <code>{b.sku}</code>
                          </td>
                          <td>{b.productName}</td>
                          <td>
                            <strong>{b.currentQuantity} un</strong>
                          </td>
                          <td>{b.minStockQuantity ?? 5} un</td>
                          <td>
                            <span
                              className={`d26-badge ${
                                b.lowStockAlert ? 'd26-badge-warning' : 'd26-badge-success'
                              }`}
                            >
                              {b.lowStockAlert ? '⚠ REPOR ESTOQUE' : 'NORMAL'}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className="d26-card">
                <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>
                  Razão Kardex Auditável (StockMovement)
                </h2>
                <table className="d26-table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Tipo</th>
                      <th>Delta</th>
                      <th>Após</th>
                      <th>Motivo</th>
                      <th>Estorno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.stock.recentMovements.map((m) => (
                      <tr key={m.id}>
                        <td>{m.productName}</td>
                        <td>
                          <span className="d26-badge d26-badge-outline-purple" style={{ fontSize: '0.68rem' }}>
                            {m.movementType}
                          </span>
                        </td>
                        <td style={{ color: m.quantityDelta < 0 ? '#F87171' : '#34D399', fontWeight: 700 }}>
                          {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                        </td>
                        <td>{m.balanceAfter}</td>
                        <td style={{ fontSize: '0.75rem' }}>{m.reason}</td>
                        <td>
                          {!m.reversedByMovementId && m.movementType !== 'REVERSAL_ENTRY' ? (
                            <button
                              className="d26-btn d26-btn-secondary"
                              style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                              onClick={() => handleReverseStockMovement(m.id)}
                            >
                              Estornar
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.7rem', color: 'var(--d26-gray-400)' }}>
                              {m.movementType === 'REVERSAL_ENTRY' ? 'Reversão' : 'Estornado'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            MÓDULO: HOTEL AUTO POSTO MILLA & RESERVAS
           ===================================================================== */}
        {/* =====================================================================
            MÓDULO: HOTEL AUTO POSTO MILLA — PMS COMPLETO (ETAPA 5)
           ===================================================================== */}
        {activeModule === 'hotel-reservas' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Header & Sub-navigation */}
            <div className="d26-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <h2 style={{ fontSize: '1.2rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>🏨</span> HOTEL AUTO POSTO MILLA — PMS & GESTÃO INTEGRADA
                  </h2>
                  <div style={{ fontSize: '0.82rem', color: 'var(--d26-gray-400)', marginTop: '4px' }}>
                    Gestão hoteleira completa com governança, reservas, diárias, frigobar, serviços, extrato do quarto (Folio) e integração ao restaurante Deck 26.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button className="d26-btn d26-btn-secondary" onClick={() => setShowNewGuestModal(true)}>
                    + Novo Hóspede
                  </button>
                  <button className="d26-btn d26-btn-secondary" onClick={() => setShowNewResModal(true)}>
                    + Nova Reserva
                  </button>
                  <button className="d26-btn d26-btn-primary" onClick={() => setShowCheckInModal(true)}>
                    🔑 Novo Check-In
                  </button>
                </div>
              </div>

              {/* KPIs Hoteleiros */}
              <div className="d26-grid-kpi" style={{ marginBottom: '14px' }}>
                <div className="d26-product-card">
                  <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)', textTransform: 'uppercase' }}>Taxa de Ocupação</span>
                  <div className="d26-kpi-value" style={{ color: '#F72585' }}>
                    {snapshot.hotelMetrics?.occupancyRatePercent ?? 0}%
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>
                    {snapshot.hotelMetrics?.occupiedRooms ?? 0} de {snapshot.hotelMetrics?.totalRooms ?? snapshot.hotelRooms.length} quartos
                  </span>
                </div>
                <div className="d26-product-card">
                  <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)', textTransform: 'uppercase' }}>Diária Média (ADR)</span>
                  <div className="d26-kpi-value" style={{ color: '#7209B7' }}>
                    {formatBrlCents(snapshot.hotelMetrics?.adrCents ?? 0)}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>Média por quarto ocupado</span>
                </div>
                <div className="d26-product-card">
                  <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)', textTransform: 'uppercase' }}>RevPAR</span>
                  <div className="d26-kpi-value" style={{ color: '#4CC9F0' }}>
                    {formatBrlCents(snapshot.hotelMetrics?.revparCents ?? 0)}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>Receita por quarto disponível</span>
                </div>
                <div className="d26-product-card">
                  <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)', textTransform: 'uppercase' }}>Governança & Reparos</span>
                  <div style={{ marginTop: '6px', fontSize: '0.88rem' }}>
                    <span style={{ color: '#4ADE80' }}>● {snapshot.hotelMetrics?.availableRooms ?? 0} Disponíveis</span>{' '}
                    <span style={{ color: '#FB923C' }}>● {snapshot.hotelMetrics?.dirtyCleaningRooms ?? 0} Limpeza</span>{' '}
                    <span style={{ color: '#F43F5E' }}>● {snapshot.hotelMetrics?.maintenanceRooms ?? 0} Manutenção</span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)', marginTop: '4px', display: 'block' }}>
                    {snapshot.hotelMetrics?.blockedRooms ?? 0} quartos bloqueados
                  </span>
                </div>
                <div className="d26-product-card">
                  <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)', textTransform: 'uppercase' }}>Faturamento Folios</span>
                  <div style={{ marginTop: '6px', fontSize: '0.88rem' }}>
                    <div style={{ color: '#4ADE80', fontWeight: 600 }}>
                      Recebido: {formatBrlCents(snapshot.hotelMetrics?.totalPaymentsReceivedCents ?? 0)}
                    </div>
                    <div style={{ color: '#F72585', fontWeight: 600 }}>
                      Pendente: {formatBrlCents(snapshot.hotelMetrics?.totalBalancePendingCents ?? 0)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Subtabs bar */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '12px' }}>
                <button
                  className={`d26-btn ${hotelSubTab === 'MAPA' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setHotelSubTab('MAPA')}
                >
                  🗺️ Mapa de Quartos
                </button>
                <button
                  className={`d26-btn ${hotelSubTab === 'RESERVAS' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setHotelSubTab('RESERVAS')}
                >
                  📅 Reservas ({snapshot.hotelReservations?.length ?? 0})
                </button>
                <button
                  className={`d26-btn ${hotelSubTab === 'HOSPEDES' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setHotelSubTab('HOSPEDES')}
                >
                  👤 Hóspedes ({snapshot.hotelGuests?.length ?? 0})
                </button>
                <button
                  className={`d26-btn ${hotelSubTab === 'CHECKIN_CHECKOUT' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setHotelSubTab('CHECKIN_CHECKOUT')}
                >
                  🔑 Check-In & Estadias ({snapshot.hotelStays?.filter((s) => s.status === 'ACTIVE').length ?? 0})
                </button>
                <button
                  className={`d26-btn ${hotelSubTab === 'FOLIO' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setHotelSubTab('FOLIO')}
                >
                  📑 Extrato do Quarto (Folio)
                </button>
                <button
                  className={`d26-btn ${hotelSubTab === 'RESTAURANTE' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setHotelSubTab('RESTAURANTE')}
                >
                  🍽️ Transferir Mesa p/ Quarto
                </button>
                <button
                  className={`d26-btn ${hotelSubTab === 'FRIGOBAR_SERVICOS' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setHotelSubTab('FRIGOBAR_SERVICOS')}
                >
                  🧊 Frigobar & Serviços
                </button>
                <button
                  className={`d26-btn ${hotelSubTab === 'GOVERNANCA' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setHotelSubTab('GOVERNANCA')}
                >
                  🧹 Governança & Manutenção
                </button>
              </div>
            </div>

            {/* ================= SUBTAB 1: MAPA DE QUARTOS ================= */}
            {hotelSubTab === 'MAPA' && (
              <div className="d26-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)' }}>Filtrar status:</span>
                    {([
                      { key: 'ALL', label: `Todos (${snapshot.hotelRooms.length})` },
                      { key: 'OPERACIONAL', label: `Operacionais (${snapshot.hotelRooms.filter(r => r.commercialStatus === 'OPERACIONAL').length})` },
                      { key: 'EM_CONSTRUCAO', label: `Em Obras (${snapshot.hotelRooms.filter(r => r.commercialStatus === 'EM_CONSTRUCAO').length})` },
                      { key: 'LIVRE', label: 'Livres' },
                      { key: 'OCUPADO', label: 'Ocupados' },
                      { key: 'RESERVADO', label: 'Reservados' },
                      { key: 'BLOQUEADO', label: 'Bloqueados' },
                      { key: 'SUJO', label: 'Sujos' }
                    ] as const).map(({ key, label }) => (
                      <button
                        key={key}
                        className={`d26-btn ${hotelRoomFilter === key ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                        style={{ fontSize: '0.76rem', padding: '4px 10px' }}
                        onClick={() => setHotelRoomFilter(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="d26-product-grid">
                  {snapshot.hotelRooms
                    .filter((room) => {
                      if (hotelRoomFilter === 'ALL') return true;
                      if (hotelRoomFilter === 'OPERACIONAL') return room.commercialStatus === 'OPERACIONAL';
                      if (hotelRoomFilter === 'EM_CONSTRUCAO') return room.commercialStatus === 'EM_CONSTRUCAO';
                      if (hotelRoomFilter === 'SUJO') return room.housekeepingStatus === 'SUJO';
                      return room.occupancyStatus === hotelRoomFilter;
                    })
                    .map((room) => {
                      const isUnderConstruction = room.commercialStatus === 'EM_CONSTRUCAO';
                      const isOccupied = room.occupancyStatus === 'OCUPADO';
                      const isFree = room.occupancyStatus === 'LIVRE' && !isUnderConstruction;
                      const borderLeftColor = isUnderConstruction
                        ? '#EAB308'
                        : isOccupied
                        ? '#F72585'
                        : isFree
                        ? '#4ADE80'
                        : '#7209B7';
                      return (
                        <div key={room.id} className="d26-product-card" style={{ borderLeft: `4px solid ${borderLeftColor}` }}>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <strong style={{ fontSize: '1.15rem' }}>Apto {room.number}</strong>
                                  {room.name && (
                                    <span style={{ fontSize: '0.78rem', color: isUnderConstruction ? '#FDE047' : '#FFFFFF', fontWeight: 600 }}>
                                      • {room.name}
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)', marginTop: '2px' }}>
                                  {room.floorSector} • {room.category}
                                </div>
                              </div>
                              {isUnderConstruction ? (
                                <span
                                  className="d26-badge d26-badge-warning"
                                  style={{ background: '#78350F', color: '#FDE047', border: '1px solid #CA8A04', fontSize: '0.72rem', fontWeight: 700 }}
                                >
                                  🚧 EM OBRAS
                                </span>
                              ) : (
                                <span
                                  className={`d26-badge ${
                                    room.occupancyStatus === 'LIVRE'
                                      ? 'd26-badge-success'
                                      : room.occupancyStatus === 'OCUPADO'
                                      ? 'd26-badge-pink'
                                      : room.occupancyStatus === 'RESERVADO'
                                      ? 'd26-badge-purple'
                                      : 'd26-badge-warning'
                                  }`}
                                >
                                  {room.occupancyStatus}
                                </span>
                              )}
                            </div>

                            {/* Badges Independentes de Governança e Manutenção */}
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                              <span
                                className={`d26-badge ${
                                  room.housekeepingStatus === 'LIMPO'
                                    ? 'd26-badge-success'
                                    : room.housekeepingStatus === 'SUJO'
                                    ? 'd26-badge-warning'
                                    : 'd26-badge-purple'
                                }`}
                                style={{ fontSize: '0.68rem', padding: '2px 6px' }}
                              >
                                Limpeza: {room.housekeepingStatus}
                              </span>
                              {room.maintenanceStatus !== 'DISPONIVEL' && (
                                <span className="d26-badge d26-badge-pink" style={{ fontSize: '0.68rem', padding: '2px 6px' }}>
                                  {room.maintenanceStatus}
                                </span>
                              )}
                            </div>

                            <div style={{ fontSize: '0.8rem', color: 'var(--d26-gray-300)', marginTop: '8px' }}>
                              Diária: <strong>{formatBrlCents(room.dailyRateCents)}</strong>
                            </div>

                            {isUnderConstruction && (
                              <div style={{ marginTop: '8px', padding: '6px 8px', background: 'rgba(234, 179, 8, 0.12)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '6px', fontSize: '0.76rem', color: '#FDE047' }}>
                                ⚠️ <strong>Apartamento em obras.</strong> Check-in e reservas bloqueados até a conclusão da reforma.
                              </div>
                            )}

                            {room.currentGuestName && (
                              <div style={{ marginTop: '8px', padding: '6px 8px', background: 'rgba(247, 37, 133, 0.12)', borderRadius: '6px', fontSize: '0.82rem' }}>
                                <div style={{ fontSize: '0.7rem', color: '#FFAFCC', textTransform: 'uppercase' }}>Hóspede Atual</div>
                                <strong style={{ color: '#FFFFFF' }}>{room.currentGuestName}</strong>
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                            {isUnderConstruction ? (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                <button
                                  className="d26-btn d26-btn-secondary"
                                  style={{ fontSize: '0.74rem', padding: '6px', opacity: 0.5, cursor: 'not-allowed' }}
                                  disabled
                                  title="Apartamento em obras. Check-in bloqueado."
                                >
                                  🚫 Bloqueado
                                </button>
                                <button
                                  className="d26-btn d26-btn-primary"
                                  style={{ fontSize: '0.74rem', padding: '6px' }}
                                  onClick={() => openEditRoomModal(room)}
                                >
                                  ⚙️ Gerenciar
                                </button>
                              </div>
                            ) : (
                              <>
                                {isOccupied && (
                                  <>
                                    <button
                                      className="d26-btn d26-btn-primary"
                                      style={{ fontSize: '0.78rem', padding: '6px' }}
                                      onClick={() => {
                                        if (room.activeStayId) {
                                          setSelectedFolioStayId(room.activeStayId);
                                          setHotelSubTab('FOLIO');
                                        }
                                      }}
                                    >
                                      📑 Ver Extrato (Folio)
                                    </button>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                      <button
                                        className="d26-btn d26-btn-secondary"
                                        style={{ fontSize: '0.74rem', padding: '4px' }}
                                        onClick={() => {
                                          setTransferRoomNumber(room.number);
                                          setHotelSubTab('RESTAURANTE');
                                        }}
                                      >
                                        🍽️ Consumo
                                      </button>
                                      <button
                                        className="d26-btn d26-btn-secondary"
                                        style={{ fontSize: '0.74rem', padding: '4px' }}
                                        onClick={() => {
                                          setMinibarRoomNumber(room.number);
                                          setServiceRoomNumber(room.number);
                                          setHotelSubTab('FRIGOBAR_SERVICOS');
                                        }}
                                      >
                                        🧊 Frigobar
                                      </button>
                                    </div>
                                  </>
                                )}

                                {isFree && (
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                    <button
                                      className="d26-btn d26-btn-primary"
                                      style={{ fontSize: '0.76rem', padding: '6px' }}
                                      onClick={() => {
                                        setCheckInRoomNumber(room.number);
                                        setShowCheckInModal(true);
                                      }}
                                    >
                                      🔑 Check-In
                                    </button>
                                    <button
                                      className="d26-btn d26-btn-secondary"
                                      style={{ fontSize: '0.76rem', padding: '6px' }}
                                      onClick={() => {
                                        setResRoomNumber(room.number);
                                        setShowNewResModal(true);
                                      }}
                                    >
                                      📅 Reservar
                                    </button>
                                  </div>
                                )}

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px', marginTop: '4px' }}>
                                  {room.housekeepingStatus === 'SUJO' && (
                                    <button
                                      className="d26-btn d26-btn-secondary"
                                      style={{ fontSize: '0.7rem', padding: '3px 6px' }}
                                      onClick={() => handleUpdateHousekeeping(room.number, 'EM_LIMPEZA')}
                                    >
                                      Iniciar Limpeza
                                    </button>
                                  )}
                                  {room.housekeepingStatus === 'EM_LIMPEZA' && (
                                    <button
                                      className="d26-btn d26-btn-secondary"
                                      style={{ fontSize: '0.7rem', padding: '3px 6px' }}
                                      onClick={() => handleUpdateHousekeeping(room.number, 'LIMPO')}
                                    >
                                      Marcar Limpo
                                    </button>
                                  )}
                                  {room.housekeepingStatus === 'LIMPO' && !isOccupied && (
                                    <button
                                      className="d26-btn d26-btn-secondary"
                                      style={{ fontSize: '0.7rem', padding: '3px 6px', opacity: 0.7 }}
                                      onClick={() => handleUpdateHousekeeping(room.number, 'SUJO')}
                                    >
                                      Marcar Sujo
                                    </button>
                                  )}
                                  <button
                                    className="d26-btn d26-btn-secondary"
                                    style={{ fontSize: '0.7rem', padding: '3px 6px' }}
                                    onClick={() => openEditRoomModal(room)}
                                    title="Editar detalhes do apartamento"
                                  >
                                    ⚙️ Editar
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* ================= SUBTAB 2: RESERVAS ================= */}
            {hotelSubTab === 'RESERVAS' && (
              <div className="d26-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <h3 style={{ fontSize: '1.05rem', margin: 0 }}>Quadro de Reservas de Hospedagem</h3>
                  <button className="d26-btn d26-btn-primary" onClick={() => setShowNewResModal(true)}>
                    + Nova Reserva
                  </button>
                </div>

                {(!snapshot.hotelReservations || snapshot.hotelReservations.length === 0) ? (
                  <p style={{ color: 'var(--d26-gray-400)', padding: '16px 0' }}>
                    Nenhuma reserva cadastrada no momento. Clique em "+ Nova Reserva" para agendar uma estadia.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="d26-table">
                      <thead>
                        <tr>
                          <th>Localizador</th>
                          <th>Hóspede</th>
                          <th>Apto</th>
                          <th>Período</th>
                          <th>Hóspedes</th>
                          <th>Diária</th>
                          <th>Sinal</th>
                          <th>Status</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.hotelReservations.map((res) => (
                          <tr key={res.id}>
                            <td>
                              <strong style={{ color: '#D8B4FE', fontFamily: 'monospace' }}>#{res.reservationCode}</strong>
                            </td>
                            <td>
                              <strong>{res.guestName ?? 'Hóspede'}</strong>
                              {res.guestPhone && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>{res.guestPhone}</div>
                              )}
                            </td>
                            <td>
                              <span className="d26-badge d26-badge-purple">Apto {res.roomNumber}</span>
                            </td>
                            <td style={{ fontSize: '0.8rem' }}>
                              {res.checkInDate} ➔ {res.checkOutDate}
                              <div style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>
                                {calculateNightsCount(res.checkInDate, res.checkOutDate)} noite(s)
                              </div>
                            </td>
                            <td>{res.guestsCount} pessoa(s)</td>
                            <td>{formatBrlCents(res.dailyRateCents)}</td>
                            <td>
                              {res.depositCents ? formatBrlCents(res.depositCents) : 'R$ 0,00'}
                              {res.depositPaid && (
                                <span className="d26-badge d26-badge-success" style={{ marginLeft: '4px', fontSize: '0.65rem' }}>
                                  Pago
                                </span>
                              )}
                            </td>
                            <td>
                              <span
                                className={`d26-badge ${
                                  res.status === 'CONFIRMADA'
                                    ? 'd26-badge-success'
                                    : res.status === 'CHECK_IN_REALIZADO'
                                    ? 'd26-badge-pink'
                                    : 'd26-badge-warning'
                                }`}
                              >
                                {res.status}
                              </span>
                            </td>
                            <td>
                              {res.status === 'CONFIRMADA' && (
                                <button
                                  className="d26-btn d26-btn-primary"
                                  style={{ fontSize: '0.74rem', padding: '4px 8px' }}
                                  onClick={() => {
                                    setCheckInRoomNumber(res.roomNumber);
                                    setCheckInGuestId(res.guestId);
                                    setShowCheckInModal(true);
                                  }}
                                >
                                  Check-In
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ================= SUBTAB 3: HÓSPEDES LGPD ================= */}
            {hotelSubTab === 'HOSPEDES' && (
              <div className="d26-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flex: 1, maxWidth: '480px' }}>
                    <input
                      className="d26-input"
                      placeholder="Buscar por nome, CPF ou telefone..."
                      value={guestSearchQuery}
                      onChange={(e) => setGuestSearchQuery(e.target.value)}
                    />
                  </div>
                  <button className="d26-btn d26-btn-primary" onClick={() => setShowNewGuestModal(true)}>
                    + Cadastrar Hóspede
                  </button>
                </div>

                {(!snapshot.hotelGuests || snapshot.hotelGuests.length === 0) ? (
                  <p style={{ color: 'var(--d26-gray-400)', padding: '16px 0' }}>
                    Nenhum hóspede cadastrado. Cadastre o primeiro hóspede para iniciar reservas e estadias.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="d26-table">
                      <thead>
                        <tr>
                          <th>Nome Completo</th>
                          <th>Documento (CPF)</th>
                          <th>Telefone / WhatsApp</th>
                          <th>E-mail</th>
                          <th>Origem / Cidade</th>
                          <th>Placa do Veículo</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.hotelGuests
                          .filter((g) => {
                            if (!guestSearchQuery.trim()) return true;
                            const q = guestSearchQuery.toLowerCase();
                            return (
                              g.fullName.toLowerCase().includes(q) ||
                              (g.documentNumber && g.documentNumber.includes(q)) ||
                              (g.phone && g.phone.includes(q))
                            );
                          })
                          .map((g) => (
                            <tr key={g.id}>
                              <td>
                                <strong>{g.fullName}</strong>
                              </td>
                              <td style={{ fontFamily: 'monospace' }}>{g.documentNumber ?? '—'}</td>
                              <td>{g.phone ?? '—'}</td>
                              <td>{g.email ?? '—'}</td>
                              <td>{g.address?.city ? `${g.address.city}/${g.address.state ?? 'MA'}` : '—'}</td>
                              <td>
                                {g.notes && g.notes.includes('Placa:') ? (
                                  <span className="d26-badge d26-badge-purple" style={{ fontFamily: 'monospace' }}>
                                    {g.notes}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    className="d26-btn d26-btn-secondary"
                                    style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                                    onClick={() => {
                                      setResGuestId(g.id);
                                      setShowNewResModal(true);
                                    }}
                                  >
                                    Reservar
                                  </button>
                                  <button
                                    className="d26-btn d26-btn-primary"
                                    style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                                    onClick={() => {
                                      setCheckInGuestId(g.id);
                                      setShowCheckInModal(true);
                                    }}
                                  >
                                    Check-In
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ================= SUBTAB 4: CHECK-IN & ESTADIAS ATIVAS ================= */}
            {hotelSubTab === 'CHECKIN_CHECKOUT' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="d26-card">
                  <h3 style={{ fontSize: '1.05rem', marginBottom: '14px' }}>Estadias Hoteleiras em Andamento</h3>
                  {(!snapshot.hotelStays || snapshot.hotelStays.filter((s) => s.status === 'ACTIVE').length === 0) ? (
                    <p style={{ color: 'var(--d26-gray-400)', padding: '16px 0' }}>
                      Nenhum hóspede hospedado no momento. Utilize o formulário abaixo ou o Mapa de Quartos para realizar check-in.
                    </p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="d26-table">
                        <thead>
                          <tr>
                            <th>Apto</th>
                            <th>Hóspede</th>
                            <th>Entrada</th>
                            <th>Saída Prevista</th>
                            <th>Comanda Folio</th>
                            <th>Diária</th>
                            <th>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {snapshot.hotelStays
                            .filter((s) => s.status === 'ACTIVE')
                            .map((stay) => {
                              const guest = snapshot.hotelGuests?.find((g) => g.id === stay.guestId);
                              return (
                                <tr key={stay.id}>
                                  <td>
                                    <strong style={{ fontSize: '1.05rem', color: '#F72585' }}>Apto {stay.roomNumber}</strong>
                                  </td>
                                  <td>
                                    <strong>{guest?.fullName ?? 'Hóspede'}</strong>
                                    {guest?.phone && (
                                      <div style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>{guest.phone}</div>
                                    )}
                                  </td>
                                  <td style={{ fontSize: '0.8rem' }}>{new Date(stay.checkInAt).toLocaleString('pt-BR')}</td>
                                  <td style={{ fontSize: '0.8rem' }}>
                                    {new Date(stay.checkOutScheduledAt).toLocaleString('pt-BR')}
                                  </td>
                                  <td>
                                    <span className="d26-badge d26-badge-purple" style={{ fontFamily: 'monospace' }}>
                                      APTO-{stay.roomNumber}
                                    </span>
                                  </td>
                                  <td>{formatBrlCents(stay.dailyRateCents)}</td>
                                  <td>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <button
                                        className="d26-btn d26-btn-primary"
                                        style={{ fontSize: '0.74rem', padding: '4px 8px' }}
                                        onClick={() => {
                                          setSelectedFolioStayId(stay.id);
                                          setHotelSubTab('FOLIO');
                                        }}
                                      >
                                        📑 Ver Folio
                                      </button>
                                      <button
                                        className="d26-btn d26-btn-secondary"
                                        style={{ fontSize: '0.74rem', padding: '4px 8px' }}
                                        onClick={() => {
                                          setSelectedFolioStayId(stay.id);
                                          setHotelSubTab('FOLIO');
                                        }}
                                      >
                                        🚪 Check-Out
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ================= SUBTAB 5: EXTRATO DO QUARTO (FOLIO) ================= */}
            {hotelSubTab === 'FOLIO' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="d26-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '0.86rem', color: 'var(--d26-gray-300)' }}>Selecione o Apartamento:</span>
                      <select
                        className="d26-select"
                        style={{ minWidth: '220px' }}
                        value={selectedFolioStayId}
                        onChange={(e) => setSelectedFolioStayId(e.target.value)}
                      >
                        <option value="">-- Escolha uma estadia ativa --</option>
                        {snapshot.hotelStays
                          ?.filter((s) => s.status === 'ACTIVE')
                          .map((stay) => {
                            const guest = snapshot.hotelGuests?.find((g) => g.id === stay.guestId);
                            return (
                              <option key={stay.id} value={stay.id}>
                                Apto {stay.roomNumber} — {guest?.fullName ?? 'Hóspede'}
                              </option>
                            );
                          })}
                      </select>
                    </div>

                    {selectedFolioStayId && (
                      <button className="d26-btn d26-btn-secondary" onClick={() => loadFolio(selectedFolioStayId)}>
                        ↻ Atualizar Folio
                      </button>
                    )}
                  </div>

                  {!folioData ? (
                    <p style={{ color: 'var(--d26-gray-400)', padding: '24px 0', textAlign: 'center' }}>
                      Selecione um apartamento ocupado acima para visualizar o extrato detalhado de débitos e créditos.
                    </p>
                  ) : (
                    <div>
                      {/* Resumo Financeiro do Folio */}
                      <div className="d26-grid-kpi" style={{ marginBottom: '16px' }}>
                        <div className="d26-product-card">
                          <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)', textTransform: 'uppercase' }}>Total de Débitos</span>
                          <div className="d26-kpi-value" style={{ color: '#FFFFFF' }}>
                            {formatBrlCents(folioData.totals.debitsCents)}
                          </div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>Diárias, restaurante e serviços</span>
                        </div>
                        <div className="d26-product-card">
                          <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)', textTransform: 'uppercase' }}>Total Pago / Créditos</span>
                          <div className="d26-kpi-value" style={{ color: '#4ADE80' }}>
                            {formatBrlCents(folioData.totals.creditsCents)}
                          </div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>Sinal, adiantamentos e pagamentos</span>
                        </div>
                        <div className="d26-product-card" style={{ borderColor: folioData.totals.balanceCents > 0 ? '#F72585' : '#4ADE80' }}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)', textTransform: 'uppercase' }}>Saldo Devedor a Quitar</span>
                          <div className="d26-kpi-value" style={{ color: folioData.totals.balanceCents > 0 ? '#F72585' : '#4ADE80' }}>
                            {formatBrlCents(folioData.totals.balanceCents)}
                          </div>
                          <span style={{ fontSize: '0.72rem', color: folioData.totals.balanceCents > 0 ? '#FFAFCC' : '#86EFAC' }}>
                            {folioData.totals.balanceCents > 0 ? 'Pendente de pagamento' : 'Conta 100% quitada'}
                          </span>
                        </div>
                      </div>

                      {/* Lançamentos do Extrato */}
                      <h4 style={{ fontSize: '0.95rem', marginBottom: '10px' }}>Extrato Cronológico Auditável</h4>
                      <div style={{ overflowX: 'auto', marginBottom: '18px' }}>
                        <table className="d26-table">
                          <thead>
                            <tr>
                              <th>Data / Hora</th>
                              <th>Tipo</th>
                              <th>Descrição</th>
                              <th>Operador</th>
                              <th style={{ textAlign: 'right' }}>Valor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {folioData.entries.map((entry) => {
                              const isDebit = entry.amountCents > 0;
                              return (
                                <tr key={entry.id}>
                                  <td style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)' }}>
                                    {new Date(entry.createdAt).toLocaleString('pt-BR')}
                                  </td>
                                  <td>
                                    <span
                                      className={`d26-badge ${
                                        entry.entryType === 'ROOM_RATE'
                                          ? 'd26-badge-purple'
                                          : entry.entryType === 'RESTAURANT_ORDER' || entry.entryType === 'BAR_ORDER'
                                          ? 'd26-badge-pink'
                                          : entry.entryType === 'PAYMENT' || entry.entryType === 'ADVANCE_PAYMENT'
                                          ? 'd26-badge-success'
                                          : 'd26-badge-warning'
                                      }`}
                                      style={{ fontSize: '0.68rem' }}
                                    >
                                      {entry.entryType}
                                    </span>
                                  </td>
                                  <td>
                                    <strong>{entry.description}</strong>
                                    {entry.sourceReferenceId && (
                                      <div style={{ fontSize: '0.7rem', color: 'var(--d26-gray-400)', fontFamily: 'monospace' }}>
                                        Ref: {entry.sourceReferenceId}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ fontSize: '0.78rem' }}>{entry.operatorName}</td>
                                  <td style={{ textAlign: 'right', fontWeight: 600, color: isDebit ? '#FFFFFF' : '#4ADE80' }}>
                                    {isDebit ? '+' : '-'} {formatBrlCents(Math.abs(entry.amountCents))}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagamento & Check-out */}
                      <div className="d26-split-2">
                        {/* Registrar Pagamento */}
                        <div style={{ background: 'var(--d26-black-850)', padding: '14px', borderRadius: '8px', border: 'var(--d26-border-subtle)' }}>
                          <h4 style={{ fontSize: '0.92rem', marginBottom: '10px' }}>Registrar Pagamento na Conta</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div>
                              <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Valor (R$)</label>
                              <input
                                className="d26-input"
                                placeholder={`Ex: ${(folioData.totals.balanceCents / 100).toFixed(2).replace('.', ',')}`}
                                value={folioPayReais}
                                onChange={(e) => setFolioPayReais(e.target.value)}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Forma de Pagamento</label>
                              <select
                                className="d26-select"
                                value={folioPayMethod}
                                onChange={(e) => setFolioPayMethod(e.target.value as PaymentMethod)}
                              >
                                <option value="PIX">PIX (Chave Automática)</option>
                                <option value="CASH">Dinheiro em Espécie</option>
                                <option value="CREDIT_CARD">Cartão de Crédito</option>
                                <option value="DEBIT_CARD">Cartão de Débito</option>
                              </select>
                            </div>
                            <button
                              className="d26-btn d26-btn-primary"
                              disabled={folioData.totals.balanceCents <= 0}
                              onClick={handlePayFolio}
                            >
                              Confirmar Recebimento de Pagamento
                            </button>
                          </div>
                        </div>

                        {/* Encerrar Estadia (Check-Out) */}
                        <div style={{ background: 'var(--d26-black-850)', padding: '14px', borderRadius: '8px', border: 'var(--d26-border-subtle)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                          <div>
                            <h4 style={{ fontSize: '0.92rem', marginBottom: '8px' }}>Encerramento de Estadia (Check-Out)</h4>
                            <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-300)', lineHeight: '1.4' }}>
                              Regra operacional: O check-out exige saldo devedor zerado (R$ 0,00). Ao confirmar, a comanda APTO-{folioData.stay.roomNumber} é encerrada, o quarto passa a <strong>LIVRE</strong> e a governança a <strong>SUJO</strong>.
                            </p>
                            {folioData.totals.balanceCents > 0 && (
                              <div style={{ padding: '8px', background: 'rgba(247, 37, 133, 0.15)', borderRadius: '6px', fontSize: '0.78rem', color: '#FFAFCC', marginTop: '10px' }}>
                                ⚠️ Saldo pendente de {formatBrlCents(folioData.totals.balanceCents)}. Realize o pagamento antes de encerrar.
                              </div>
                            )}
                          </div>
                          <div style={{ marginTop: '14px', display: 'flex', gap: '8px' }}>
                            <button
                              className="d26-btn d26-btn-primary"
                              style={{ flex: 1 }}
                              disabled={folioData.totals.balanceCents > 0}
                              onClick={() => handleCheckOutStay(folioData.stay.id, false)}
                            >
                              🚪 Efetivar Check-Out
                            </button>
                            {folioData.totals.balanceCents > 0 && (
                              <button
                                className="d26-btn d26-btn-secondary"
                                style={{ fontSize: '0.74rem' }}
                                title="Check-out especial com autorização auditada no log de segurança"
                                onClick={() => {
                                  if (confirm('Atenção: A estadia possui saldo pendente. Deseja realizar check-out com liberação auditada de dívida?')) {
                                    handleCheckOutStay(folioData.stay.id, true);
                                  }
                                }}
                              >
                                Forçar com Auditoria
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ================= SUBTAB 6: TRANSFERIR MESA P/ QUARTO ================= */}
            {hotelSubTab === 'RESTAURANTE' && (
              <div className="d26-card">
                <h3 style={{ fontSize: '1.05rem', marginBottom: '8px' }}>
                  🍽️ Integração Deck 26: Transferir Consumo de Mesa para Quarto de Hotel
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--d26-gray-300)', marginBottom: '16px', lineHeight: '1.4' }}>
                  Permite que hóspedes do Hotel Auto Posto Milla consumam no restaurante/bar e transfiram o total para a conta do apartamento (Método <strong>ROOM_CHARGE</strong>). A mesa é liberada imediatamente, sem duplicar saídas de estoque e sem faturamento antecipado no caixa do restaurante.
                </p>

                <div className="d26-split-2">
                  <div>
                    <h4 style={{ fontSize: '0.92rem', marginBottom: '10px' }}>1. Comandas / Mesas Abertas no Restaurante</h4>
                    {snapshot.tabs.filter((t) => t.status === 'OPEN' && t.type !== 'HOTEL_FOLIO').length === 0 ? (
                      <p style={{ color: 'var(--d26-gray-400)', fontSize: '0.84rem' }}>Nenhuma mesa aberta com consumo no momento.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {snapshot.tabs
                          .filter((t) => t.status === 'OPEN' && t.type !== 'HOTEL_FOLIO')
                          .map((tab) => {
                            const isSelected = transferTabId === tab.id;
                            const remainingCents = Math.max(0, tab.totalCents - tab.paidCents);
                            return (
                              <div
                                key={tab.id}
                                style={{
                                  padding: '10px',
                                  borderRadius: '6px',
                                  background: isSelected ? 'rgba(247, 37, 133, 0.2)' : 'var(--d26-black-850)',
                                  border: isSelected ? '1px solid #F72585' : 'var(--d26-border-subtle)',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center'
                                }}
                                onClick={() => setTransferTabId(tab.id)}
                              >
                                <div>
                                  <strong>{tab.code}</strong>
                                  <div style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>
                                    {tab.customerName ? `Cliente: ${tab.customerName} • ` : ''}Garçom: {tab.waiterName ?? '—'}
                                  </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <strong style={{ color: '#F72585' }}>{formatBrlCents(remainingCents)}</strong>
                                  <div style={{ fontSize: '0.7rem', color: 'var(--d26-gray-400)' }}>Total pendente</div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 style={{ fontSize: '0.92rem', marginBottom: '10px' }}>2. Selecionar Apartamento de Destino</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Apartamento Ocupado</label>
                        <select
                          className="d26-select"
                          value={transferRoomNumber}
                          onChange={(e) => setTransferRoomNumber(e.target.value)}
                        >
                          <option value="">-- Escolha o apartamento --</option>
                          {snapshot.hotelRooms
                            .filter((r) => r.occupancyStatus === 'OCUPADO')
                            .map((r) => (
                              <option key={r.id} value={r.number}>
                                Apto {r.number} ({r.currentGuestName ?? 'Hóspede'})
                              </option>
                            ))}
                        </select>
                      </div>

                      <button
                        className="d26-btn d26-btn-primary"
                        style={{ padding: '12px' }}
                        disabled={!transferTabId || !transferRoomNumber}
                        onClick={handleTransferTabToFolio}
                      >
                        Transferir Consumo para o Apto {transferRoomNumber || '___'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================= SUBTAB 7: FRIGOBAR & SERVIÇOS ================= */}
            {hotelSubTab === 'FRIGOBAR_SERVICOS' && (
              <div className="d26-split-2">
                {/* Lançamento de Frigobar */}
                <div className="d26-card">
                  <h3 style={{ fontSize: '1.05rem', marginBottom: '8px' }}>🧊 Consumo de Frigobar</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)', marginBottom: '14px' }}>
                    Lança itens consumidos do frigobar do apartamento diretamente no folio e debita o estoque.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Apartamento</label>
                      <select
                        className="d26-select"
                        value={minibarRoomNumber}
                        onChange={(e) => setMinibarRoomNumber(e.target.value)}
                      >
                        {snapshot.hotelRooms
                          .filter((r) => r.occupancyStatus === 'OCUPADO')
                          .map((r) => (
                            <option key={r.id} value={r.number}>
                              Apto {r.number} ({r.currentGuestName ?? 'Hóspede'})
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Item Consumido</label>
                      <select
                        className="d26-select"
                        value={minibarProductId}
                        onChange={(e) => setMinibarProductId(e.target.value)}
                      >
                        {snapshot.catalog.products
                          .filter((p) => p.categoryId.includes('bebidas') || p.categoryId.includes('qualquer-hora'))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} — {formatBrlCents(p.priceCents)}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Quantidade</label>
                      <input
                        type="number"
                        min="1"
                        className="d26-input"
                        value={minibarQty}
                        onChange={(e) => setMinibarQty(Math.max(1, Number(e.target.value)))}
                      />
                    </div>
                    <button className="d26-btn d26-btn-primary" onClick={handleRecordMinibar}>
                      Lançar Consumo no Folio do Apto {minibarRoomNumber}
                    </button>
                  </div>
                </div>

                {/* Serviços Adicionais */}
                <div className="d26-card">
                  <h3 style={{ fontSize: '1.05rem', marginBottom: '8px' }}>🛎️ Serviços Adicionais</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)', marginBottom: '14px' }}>
                    Lança serviços de hotelaria (lavanderia, cama extra, café extra, etc.) na conta do hóspede.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Apartamento</label>
                      <select
                        className="d26-select"
                        value={serviceRoomNumber}
                        onChange={(e) => setServiceRoomNumber(e.target.value)}
                      >
                        {snapshot.hotelRooms
                          .filter((r) => r.occupancyStatus === 'OCUPADO')
                          .map((r) => (
                            <option key={r.id} value={r.number}>
                              Apto {r.number} ({r.currentGuestName ?? 'Hóspede'})
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Serviço</label>
                      <select
                        className="d26-select"
                        value={selectedServiceId}
                        onChange={(e) => setSelectedServiceId(e.target.value)}
                      >
                        {snapshot.hotelServices?.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} — {formatBrlCents(s.defaultPriceCents)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button className="d26-btn d26-btn-primary" onClick={handleOrderHotelService}>
                      Lançar Serviço na Conta do Apto {serviceRoomNumber}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ================= SUBTAB 8: GOVERNANÇA & MANUTENÇÃO ================= */}
            {hotelSubTab === 'GOVERNANCA' && (
              <div className="d26-split-2">
                {/* Painel de Governança */}
                <div className="d26-card">
                  <h3 style={{ fontSize: '1.05rem', marginBottom: '12px' }}>🧹 Painel de Governança & Camareiras</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {snapshot.hotelRooms.map((room) => (
                      <div
                        key={room.id}
                        style={{
                          padding: '10px',
                          background: 'var(--d26-black-850)',
                          borderRadius: '6px',
                          border: 'var(--d26-border-subtle)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                      >
                        <div>
                          <strong>Apto {room.number}</strong>
                          <span style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)', marginLeft: '8px' }}>
                            {room.floorSector}
                          </span>
                          <div style={{ marginTop: '4px' }}>
                            <span
                              className={`d26-badge ${
                                room.housekeepingStatus === 'LIMPO'
                                  ? 'd26-badge-success'
                                  : room.housekeepingStatus === 'SUJO'
                                  ? 'd26-badge-warning'
                                  : 'd26-badge-purple'
                              }`}
                              style={{ fontSize: '0.7rem' }}
                            >
                              {room.housekeepingStatus}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            className="d26-btn d26-btn-secondary"
                            style={{ fontSize: '0.7rem', padding: '4px 6px' }}
                            onClick={() => handleUpdateHousekeeping(room.number, 'EM_LIMPEZA')}
                          >
                            Em Limpeza
                          </button>
                          <button
                            className="d26-btn d26-btn-secondary"
                            style={{ fontSize: '0.7rem', padding: '4px 6px' }}
                            onClick={() => handleUpdateHousekeeping(room.number, 'INSPECAO_PENDENTE')}
                          >
                            Inspeção
                          </button>
                          <button
                            className="d26-btn d26-btn-primary"
                            style={{ fontSize: '0.7rem', padding: '4px 6px' }}
                            onClick={() => handleUpdateHousekeeping(room.number, 'LIMPO')}
                          >
                            Aprovar Limpo
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Painel de Manutenção */}
                <div className="d26-card">
                  <h3 style={{ fontSize: '1.05rem', marginBottom: '12px' }}>🔧 Chamado de Manutenção</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Apartamento</label>
                      <select
                        className="d26-select"
                        value={maintRoomNumber}
                        onChange={(e) => setMaintRoomNumber(e.target.value)}
                      >
                        {snapshot.hotelRooms.map((r) => (
                          <option key={r.id} value={r.number}>
                            Apto {r.number}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Severidade</label>
                      <select
                        className="d26-select"
                        value={maintSeverity}
                        onChange={(e) => setMaintSeverity(e.target.value as any)}
                      >
                        <option value="LOW">Baixa (Pequeno reparo estético)</option>
                        <option value="MEDIUM">Média (Troca de lâmpada, ajuste)</option>
                        <option value="HIGH">Alta (Ar condicionado, chuveiro)</option>
                        <option value="CRITICAL">Crítica (Vazamento grave, elétrica)</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Descrição do Problema</label>
                      <textarea
                        className="d26-input"
                        rows={3}
                        placeholder="Ex: Ar condicionado vazando água no quarto..."
                        value={maintDescription}
                        onChange={(e) => setMaintDescription(e.target.value)}
                      />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={maintBlockRoom}
                        onChange={(e) => setMaintBlockRoom(e.target.checked)}
                      />
                      Bloquear apartamento para reservas/ocupação durante o reparo
                    </label>
                    <button className="d26-btn d26-btn-primary" onClick={handleCreateMaintenance}>
                      Abrir Chamado de Manutenção
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ================= MODAL: NOVO HÓSPEDE (LGPD) ================= */}
            {showNewGuestModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0,0,0,0.75)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999
                }}
              >
                <div className="d26-card" style={{ width: '480px', maxWidth: '95vw' }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: '14px' }}>👤 Cadastrar Novo Hóspede (LGPD)</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Nome Completo *</label>
                      <input
                        className="d26-input"
                        placeholder="Ex: João da Silva"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>CPF / Passaporte</label>
                        <input
                          className="d26-input"
                          placeholder="000.000.000-00"
                          value={guestDoc}
                          onChange={(e) => setGuestDoc(e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Telefone / WhatsApp</label>
                        <input
                          className="d26-input"
                          placeholder="(98) 98888-8888"
                          value={guestPhone}
                          onChange={(e) => setGuestPhone(e.target.value)}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Cidade</label>
                        <input
                          className="d26-input"
                          placeholder="São Luís"
                          value={guestCity}
                          onChange={(e) => setGuestCity(e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>UF</label>
                        <input
                          className="d26-input"
                          placeholder="MA"
                          value={guestState}
                          onChange={(e) => setGuestState(e.target.value)}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>E-mail</label>
                        <input
                          className="d26-input"
                          placeholder="hospede@email.com"
                          value={guestEmail}
                          onChange={(e) => setGuestEmail(e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Placa do Veículo (Posto Milla)</label>
                        <input
                          className="d26-input"
                          placeholder="ABC1D23"
                          value={guestPlate}
                          onChange={(e) => setGuestPlate(e.target.value)}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
                      <button className="d26-btn d26-btn-secondary" onClick={() => setShowNewGuestModal(false)}>
                        Cancelar
                      </button>
                      <button className="d26-btn d26-btn-primary" onClick={handleCreateGuest}>
                        Salvar Hóspede
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================= MODAL: NOVA RESERVA ================= */}
            {showNewResModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0,0,0,0.75)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999
                }}
              >
                <div className="d26-card" style={{ width: '480px', maxWidth: '95vw' }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: '14px' }}>📅 Nova Reserva de Hospedagem</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Hóspede *</label>
                      <select
                        className="d26-select"
                        value={resGuestId}
                        onChange={(e) => setResGuestId(e.target.value)}
                      >
                        <option value="">-- Selecione o hóspede cadastrado --</option>
                        {snapshot.hotelGuests?.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.fullName} ({g.phone ?? g.documentNumber ?? 'sem contato'})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Apartamento *</label>
                      <select
                        className="d26-select"
                        value={resRoomNumber}
                        onChange={(e) => setResRoomNumber(e.target.value)}
                      >
                        {snapshot.hotelRooms.map((r) => (
                          <option key={r.id} value={r.number}>
                            Apto {r.number} ({r.category} • {formatBrlCents(r.dailyRateCents)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Check-in (Entrada)</label>
                        <input
                          type="date"
                          className="d26-input"
                          value={resCheckInDate}
                          onChange={(e) => setResCheckInDate(e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Check-out (Saída)</label>
                        <input
                          type="date"
                          className="d26-input"
                          value={resCheckOutDate}
                          onChange={(e) => setResCheckOutDate(e.target.value)}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Hóspedes</label>
                        <input
                          type="number"
                          min="1"
                          className="d26-input"
                          value={resGuestsCount}
                          onChange={(e) => setResGuestsCount(Math.max(1, Number(e.target.value)))}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Diária (R$)</label>
                        <input
                          className="d26-input"
                          value={resDailyReais}
                          onChange={(e) => setResDailyReais(e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Sinal (R$)</label>
                        <input
                          className="d26-input"
                          value={resDepositReais}
                          onChange={(e) => setResDepositReais(e.target.value)}
                        />
                      </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={resDepositPaid}
                        onChange={(e) => setResDepositPaid(e.target.checked)}
                      />
                      Sinal / Depósito já foi pago na reserva
                    </label>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
                      <button className="d26-btn d26-btn-secondary" onClick={() => setShowNewResModal(false)}>
                        Cancelar
                      </button>
                      <button className="d26-btn d26-btn-primary" onClick={handleCreateReservation}>
                        Confirmar Reserva
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================= MODAL: NOVO CHECK-IN ================= */}
            {showCheckInModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0,0,0,0.75)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999
                }}
              >
                <div className="d26-card" style={{ width: '480px', maxWidth: '95vw' }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: '14px' }}>🔑 Check-In Guiado de Estadia</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Apartamento *</label>
                      <select
                        className="d26-select"
                        value={checkInRoomNumber}
                        onChange={(e) => setCheckInRoomNumber(e.target.value)}
                      >
                        {snapshot.hotelRooms.map((r) => (
                          <option key={r.id} value={r.number}>
                            Apto {r.number} ({r.category} • {r.occupancyStatus})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Hóspede Titular *</label>
                      <select
                        className="d26-select"
                        value={checkInGuestId}
                        onChange={(e) => setCheckInGuestId(e.target.value)}
                      >
                        <option value="">-- Selecione o hóspede --</option>
                        {snapshot.hotelGuests?.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.fullName} ({g.documentNumber ?? g.phone ?? 'sem doc'})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Previsão de Saída (Check-Out)</label>
                      <input
                        type="datetime-local"
                        className="d26-input"
                        value={checkInScheduledOut}
                        onChange={(e) => setCheckInScheduledOut(e.target.value)}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Taxa de Early Check-In (R$)</label>
                      <input
                        className="d26-input"
                        placeholder="0,00"
                        value={checkInEarlyReais}
                        onChange={(e) => setCheckInEarlyReais(e.target.value)}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Observações de Entrada</label>
                      <input
                        className="d26-input"
                        placeholder="Ex: Hóspede solicitou andar silencioso"
                        value={checkInNotes}
                        onChange={(e) => setCheckInNotes(e.target.value)}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
                      <button className="d26-btn d26-btn-secondary" onClick={() => setShowCheckInModal(false)}>
                        Cancelar
                      </button>
                      <button className="d26-btn d26-btn-primary" onClick={handleCheckInStay}>
                        Concluir Check-In & Abrir Folio
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================= MODAL: EDITAR / CUSTOMIZAR APARTAMENTO ================= */}
            {showEditRoomModal && editingRoom && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0,0,0,0.75)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999
                }}
              >
                <div className="d26-card" style={{ width: '520px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h3 style={{ fontSize: '1.1rem', margin: 0 }}>⚙️ Gerenciar Apartamento {editingRoom.number}</h3>
                    <span
                      className={`d26-badge ${
                        editRoomCommercialStatus === 'OPERACIONAL'
                          ? 'd26-badge-success'
                          : editRoomCommercialStatus === 'EM_CONSTRUCAO'
                          ? 'd26-badge-warning'
                          : 'd26-badge-pink'
                      }`}
                    >
                      {editRoomCommercialStatus === 'OPERACIONAL' ? 'Operacional' : editRoomCommercialStatus === 'EM_CONSTRUCAO' ? 'Em Obras' : 'Desativado'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Nome Fantasia / Exibição</label>
                      <input
                        className="d26-input"
                        placeholder="Ex: Suíte Presidencial Vista Jardim"
                        value={editRoomName}
                        onChange={(e) => setEditRoomName(e.target.value)}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Status Comercial *</label>
                        <select
                          className="d26-select"
                          value={editRoomCommercialStatus}
                          onChange={(e) => setEditRoomCommercialStatus(e.target.value as RoomCommercialStatus)}
                        >
                          <option value="OPERACIONAL">OPERACIONAL (Disponível para reservas e check-in)</option>
                          <option value="EM_CONSTRUCAO">EM_CONSTRUÇÃO (Bloqueado p/ obras / fora da taxa)</option>
                          <option value="DESATIVADO">DESATIVADO (Inativo)</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Diária Padrão (R$) *</label>
                        <input
                          className="d26-input"
                          placeholder="Ex: 180,00"
                          value={editRoomDailyRateReais}
                          onChange={(e) => setEditRoomDailyRateReais(e.target.value)}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Categoria</label>
                        <select
                          className="d26-select"
                          value={editRoomCategory}
                          onChange={(e) => setEditRoomCategory(e.target.value as HotelRoomCategory)}
                        >
                          <option value="STANDARD_SINGLE">Standard Single</option>
                          <option value="STANDARD_DOUBLE">Standard Casal / Duplo</option>
                          <option value="LUXO_CASAL">Luxo Casal</option>
                          <option value="TRIPLO">Triplo</option>
                          <option value="SUITE_MASTER">Suíte Master</option>
                          <option value="FAMILIAR">Familiar</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Andar / Setor</label>
                        <input
                          className="d26-input"
                          placeholder="Ex: Térreo, 1º Andar"
                          value={editRoomFloorSector}
                          onChange={(e) => setEditRoomFloorSector(e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Configuração de Camas</label>
                      <input
                        className="d26-input"
                        placeholder="Ex: 1 Cama King Size + 1 Cama Solteiro"
                        value={editRoomBedConfig}
                        onChange={(e) => setEditRoomBedConfig(e.target.value)}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Notas Internas da Recepção</label>
                      <textarea
                        className="d26-input"
                        rows={2}
                        placeholder="Ex: Quarto silencioso, pintura recente em 2026"
                        value={editRoomNotes}
                        onChange={(e) => setEditRoomNotes(e.target.value)}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' }}>
                      <button className="d26-btn d26-btn-secondary" onClick={() => setShowEditRoomModal(false)}>
                        Cancelar
                      </button>
                      <button className="d26-btn d26-btn-primary" onClick={handleSaveRoomEdit}>
                        Salvar Alterações
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =====================================================================
            MÓDULO: IMPRESSORAS TÉRMICAS ESC/POS (COM REIMPRESSÃO AUTORIZADA)
           ===================================================================== */}
        {activeModule === 'impressoras' && (
          <div className="d26-card">
            <h2 style={{ fontSize: '1.05rem', marginBottom: '12px' }}>
              Spooler de Impressão Incremental ESC/POS (Separado por Destino: Cozinha Quente, Cozinha Fria, Chapa, Bar e Caixa)
            </h2>
            {snapshot.printJobs.length === 0 ? (
              <p style={{ color: 'var(--d26-gray-400)' }}>
                Nenhum trabalho de impressão na fila no momento.
              </p>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                  gap: '12px'
                }}
              >
                {snapshot.printJobs.map((job) => (
                  <div key={job.id} className="d26-product-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <span className="d26-badge d26-badge-purple">{job.targetPrinter}</span>
                        <span className="d26-badge d26-badge-outline-pink">
                          {job.isReprint ? `2ª VIA #${job.copyNumber ?? 2}` : '1ª VIA ORIGINAL'}
                        </span>
                      </div>
                      <span
                        className={`d26-badge ${
                          job.status === 'PRINTED' ? 'd26-badge-success' : 'd26-badge-warning'
                        }`}
                      >
                        {job.status} ({job.attempts} tent.)
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
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {job.status !== 'PRINTED' && (
                        <button
                          className="d26-btn d26-btn-primary"
                          style={{ flex: 1 }}
                          onClick={async () => {
                            await fetch(`${localApiBase}/api/print-jobs/${job.id}/mark-printed`, {
                              method: 'POST',
                              headers: getAuthHeaders()
                            });
                            await refreshState();
                          }}
                        >
                          Confirmar Impressão
                        </button>
                      )}
                      {job.status !== 'UNKNOWN_OUTCOME' && job.status !== 'PRINTED' && (
                        <button
                          className="d26-btn d26-btn-secondary"
                          onClick={async () => {
                            await fetch(`${localApiBase}/api/print-jobs/${job.id}/status`, {
                              method: 'PATCH',
                              headers: getAuthHeaders(),
                              body: JSON.stringify({
                                status: 'UNKNOWN_OUTCOME',
                                lastError: 'Timeout de resposta da impressora térmica'
                              })
                            });
                            await refreshState();
                            notify(
                              'Trabalho marcado como UNKNOWN_OUTCOME (bloqueia reenvio cego automático).'
                            );
                          }}
                        >
                          Simular Timeout
                        </button>
                      )}
                      <button
                        className="d26-btn d26-btn-secondary"
                        style={{ flex: 1 }}
                        onClick={async () => {
                          await fetch(`${localApiBase}/api/print-jobs/${job.id}/reprint`, {
                            method: 'POST',
                            headers: getAuthHeaders()
                          });
                          await refreshState();
                          notify('Reimpressão autorizada (2ª Via) reenfileirada no spooler.');
                        }}
                      >
                        Reimprimir (2ª Via)
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* =====================================================================
            MÓDULO: SINCRONIZAÇÃO BIDIRECIONAL LOCAL ↔ VPS
           ===================================================================== */}
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
                    <td style={{ fontFamily: 'var(--d26-font-mono)', fontSize: '0.76rem' }}>
                      {ev.idempotencyKey}
                    </td>
                    <td>{ev.entityType}</td>
                    <td>{ev.operation}</td>
                    <td>v{ev.entityVersion}</td>
                    <td style={{ fontFamily: 'var(--d26-font-mono)', fontSize: '0.74rem' }}>
                      {ev.checksumSha256.slice(0, 14)}…
                    </td>
                    <td>
                      <span
                        className={`d26-badge ${
                          ev.status === 'ACKED' ? 'd26-badge-success' : 'd26-badge-warning'
                        }`}
                      >
                        {ev.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* =====================================================================
            MÓDULO: CONFIGURAÇÕES FISCAIS (SEM EMISSÃO FICTÍCIA)
           ===================================================================== */}
        {activeModule === 'configuracoes-fiscais' && (
          <div className="d26-card">
            <h2 style={{ fontSize: '1.05rem', marginBottom: '8px' }}>
              Configurações Fiscais SEFAZ (NFC-e Modelo 65 / NF-e Modelo 55)
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--d26-gray-300)', marginBottom: '16px' }}>
              Regra estrita de engenharia: este sistema{' '}
              <strong>não emite documentos fiscais fictícios ou simulados</strong>. Cada produto no
              catálogo possui campos de preparação fiscal (<code>NCM</code>, <code>CEST</code>,{' '}
              <code>CFOP</code>, <code>Origem</code> e perfil{' '}
              <code>REVISAO_CONTABIL_PENDENTE</code>) para revisão pelo contador antes da ativação
              do Certificado A1.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>
                  Razão Social
                </label>
                <input className="d26-input" defaultValue="HOTEL AUTO POSTO MILLA LTDA" readOnly />
              </div>
              <div>
                <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>
                  Modo Fiscal Atual
                </label>
                <input
                  className="d26-input"
                  value="DISABLED_NOT_CONFIGURED (Aguardando Certificado A1 Real)"
                  readOnly
                />
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            MÓDULO: GESTÃO FINANCEIRA INTEGRADA & TESOURARIA (ETAPA 6)
           ===================================================================== */}
        {activeModule === 'financeiro' && (
          <FinanceModule
            localApiBase={localApiBase}
            financialAccounts={snapshot.financialAccounts ?? []}
            costCenters={snapshot.costCenters ?? []}
            financialCategories={snapshot.financialCategories ?? []}
            suppliers={snapshot.suppliers ?? []}
            accountsPayable={snapshot.accountsPayable ?? []}
            accountsReceivable={snapshot.accountsReceivable ?? []}
            getAuthHeaders={getAuthHeaders}
            refreshState={refreshState}
            notify={notify}
          />
        )}

        {/* =====================================================================
            MÓDULO: RELATÓRIOS COMERCIAIS & DRE GERENCIAL (ETAPA 6)
           ===================================================================== */}
        {activeModule === 'relatorios' && (
          <ReportsModule
            localApiBase={localApiBase}
            costCenters={snapshot.costCenters ?? []}
            executiveMetrics={snapshot.executiveMetrics}
            getAuthHeaders={getAuthHeaders}
            notify={notify}
          />
        )}

        {/* DEMAIS MÓDULOS ESTRUTURADOS */}
        {(['funcionarios', 'administracao'] as SystemModuleId[]).includes(activeModule) && (
          <div className="d26-card">
            <h2 style={{ fontSize: '1.05rem', marginBottom: '8px' }}>
              Estrutura Base Pronta — {currentModuleDef.title}
            </h2>
            <p style={{ fontSize: '0.86rem', color: 'var(--d26-gray-300)' }}>
              A navegação, permissões RBAC (<code>{currentModuleDef.requiredPermission}</code>),
              contratos compartilhados em <code>@deck26/contracts</code> e tabelas de banco de dados
              deste módulo já estão configurados e prontos.
            </p>
          </div>
        )}
      </main>

      {/* RODAPÉ TÉCNICO DO PROGRAMA WINDOWS */}
      <footer className="d26-statusbar"><span>DECK 26 · Restaurante, bar & hospitalidade</span><span>{authSession?'Sessão autenticada · '+authSession.name:'Entre para acessar a operação'}</span></footer>
    </div>
  );
};
