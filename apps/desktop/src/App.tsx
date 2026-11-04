import React, { useEffect, useMemo, useState } from 'react';
import {
  CatalogCategory,
  CatalogProduct,
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  DiningTableQr,
  HotelRoom,
  Order,
  OrderStatus,
  OutOfStockPolicy,
  Payment,
  PaymentMethod,
  PrepStation,
  PrintJob,
  ProductRecipe,
  SYSTEM_MODULES,
  SalesChannel,
  StockMovement,
  StockMovementType,
  SyncOutboxEvent,
  SystemModuleId,
  Tab,
  UserRole,
  calculateGrossMarginPercent,
  formatBrlCents,
  hasPermission,
  resolveChannelPriceCents
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
  syncEvents: SyncOutboxEvent[];
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

  // Autenticação Real por PIN no Backend
  const [authSession, setAuthSession] = useState<AuthSessionInfo | null>(null);
  const [pinInput, setPinInput] = useState<string>('2626');
  const [showPinModal, setShowPinModal] = useState<boolean>(false);

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
    syncEvents: []
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
      // Servidor iniciando
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
      `Pagamento de ${formatBrlCents(amountCentsToPay)} (${paymentMethod}) confirmado para ${tab.code}. Status: ${data.tab.status} | Restante: ${formatBrlCents(newRemaining)}`
    );
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
          <span className="d26-badge d26-badge-purple">Windows 11 • Tauri 2</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {lowStockCount > 0 && (
            <span className="d26-badge d26-badge-warning">
              ⚠ {lowStockCount} item(ns) com estoque baixo
            </span>
          )}
          <span className={`d26-badge ${serverConnected ? 'd26-badge-success' : 'd26-badge-warning'}`}>
            ● {serverConnected ? `SQLite Local Ativo (Porta 4000)` : 'Iniciando Servidor Local...'}
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
              background: 'linear-gradient(135deg, #1A1A1A 0%, #1F112B 100%)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '14px'
            }}
          >
            <div>
              <h3 style={{ fontSize: '0.98rem' }}>
                🔐 Autenticação de Operador por PIN (Validado no Backend com Token HMAC)
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-300)', marginTop: '3px' }}>
                PINs de Desenvolvimento: Proprietário <code>2626</code> | Gerente <code>1010</code> | Caixa{' '}
                <code>2020</code> | Garçom <code>3030</code> | Cozinha <code>4040</code> | Recepção{' '}
                <code>5050</code>
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

        {/* =====================================================================
            MÓDULO 1: DASHBOARD
           ===================================================================== */}
        {activeModule === 'dashboard' && (
          <>
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
                  FATURAMENTO RECEBIDO (TURNO)
                </span>
                <div className="d26-kpi-value">
                  {formatBrlCents(snapshot.payments.reduce((acc, p) => acc + p.amountCents, 0))}
                </div>
                <span style={{ fontSize: '0.76rem', color: '#D8B4FE' }}>
                  {snapshot.payments.length} pagamento(s) confirmado(s)
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
                      <td>
                        <strong>1. Servidor Operacional Local</strong>
                      </td>
                      <td>
                        <code>127.0.0.1:4000</code>
                      </td>
                      <td>
                        <code>data/deck26-local.sqlite</code>
                      </td>
                      <td>
                        <span className="d26-badge d26-badge-success">Ativo</span>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>2. Interface Windows (PDV / Caixa / Mesas)</strong>
                      </td>
                      <td>
                        <code>localhost:5173</code>
                      </td>
                      <td>Consome API Local</td>
                      <td>
                        <span className="d26-badge d26-badge-pink">Ativo</span>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>3. Servidor de Nuvem Simulado (VPS)</strong>
                      </td>
                      <td>
                        <code>127.0.0.1:4100</code>
                      </td>
                      <td>
                        <code>data/deck26-cloud-vps.sqlite</code>
                      </td>
                      <td>
                        <span className="d26-badge d26-badge-purple">
                          {pendingOutboxCount} na Outbox
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>4. Cardápio Digital QR Code / Delivery</strong>
                      </td>
                      <td>
                        <code>localhost:5174</code>
                      </td>
                      <td>Token QR Seguro + API Local/VPS</td>
                      <td>
                        <span className="d26-badge d26-badge-outline-pink">Pronto</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

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
                <h2 style={{ fontSize: '1.05rem', marginBottom: '12px' }}>
                  Novo Pedido Incremental ({activeModule === 'garcons' ? 'Terminal Garçom' : 'Caixa / PDV Windows'})
                </h2>
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

              {/* LIQUIDAÇÃO PARCIAL OU TOTAL DE COMANDAS ABERTAS NO CAIXA */}
              <div className="d26-card">
                <h3 style={{ fontSize: '0.96rem', marginBottom: '6px' }}>
                  Recebimento Parcial ou Total de Comandas (Caixa)
                </h3>
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
                  <p style={{ fontSize: '0.82rem', color: 'var(--d26-gray-400)' }}>
                    Nenhuma comanda aberta no momento.
                  </p>
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
                            Subtotal: {formatBrlCents(t.subtotalCents)} | Taxa 10%:{' '}
                            {formatBrlCents(t.serviceFeeCents)} | Total:{' '}
                            <strong>{formatBrlCents(t.totalCents)}</strong> |{' '}
                            <strong style={{ color: '#F72585' }}>
                              Falta Pagar: {formatBrlCents(remaining)}
                            </strong>
                          </div>

                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                              type="text"
                              className="d26-input"
                              placeholder={`Valor em R$ (ex: ${(remaining / 100).toFixed(2).replace('.', ',')})`}
                              value={partialAmountsInput[t.id] ?? ''}
                              onChange={(e) =>
                                setPartialAmountsInput((prev) => ({
                                  ...prev,
                                  [t.id]: e.target.value
                                }))
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

        {/* =====================================================================
            MÓDULO: COZINHA E BAR (KDS)
           ===================================================================== */}
        {activeModule === 'cozinha' && (
          <div className="d26-card">
            <h2 style={{ fontSize: '1.05rem', marginBottom: '12px' }}>
              Fila de Produção KDS (Cozinha Quente, Cozinha Fria, Chapa de Tapiocas/Cuscuz e Bar)
            </h2>
            {snapshot.orders.length === 0 ? (
              <p style={{ color: 'var(--d26-gray-400)' }}>
                Nenhum pedido na fila da cozinha no momento.
              </p>
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

        {/* =====================================================================
            MÓDULO: MESAS, COMANDAS, PEDIDOS E QR CODES SEGUROS (SEÇÃO 12)
           ===================================================================== */}
        {(activeModule === 'mesas-comandas' || activeModule === 'pedidos') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="d26-split-2">
              <div className="d26-card">
                <h2 style={{ fontSize: '1rem', marginBottom: '12px' }}>
                  Comandas Acumuladas (Entidade Tab)
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
                  Pedidos Incrementais & Cancelamento Auditável (Entidade Order)
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
                          {o.status !== 'CANCELLED' && o.status !== 'DELIVERED' && (
                            <button
                              className="d26-btn d26-btn-secondary"
                              style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                              onClick={() => handleAdvanceOrder(o.id, 'CANCELLED', true)}
                            >
                              Cancelar + Estornar Estoque
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
                          body: JSON.stringify({
                            roomNumber: room.number,
                            guestName: `Hóspede Apto ${room.number}`
                          })
                        });
                        await refreshState();
                        notify(
                          `Check-in realizado no Apto ${room.number} com abertura de Comanda de Quarto (Folio).`
                        );
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
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="d26-badge d26-badge-purple">{job.targetPrinter}</span>
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
                    <div style={{ display: 'flex', gap: '8px' }}>
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
                      <button
                        className="d26-btn d26-btn-secondary"
                        style={{ flex: 1 }}
                        onClick={async () => {
                          await fetch(`${localApiBase}/api/print-jobs/${job.id}/reprint`, {
                            method: 'POST',
                            headers: getAuthHeaders()
                          });
                          await refreshState();
                          notify('Reimpressão autorizada reenfileirada no spooler.');
                        }}
                      >
                        Reimprimir Autorizado
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

        {/* DEMAIS MÓDULOS ESTRUTURADOS */}
        {(['financeiro', 'relatorios', 'funcionarios', 'administracao'] as SystemModuleId[]).includes(
          activeModule
        ) && (
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
      <footer className="d26-statusbar">
        <div>
          <strong>DECK 26</strong> • Paleta Oficial: Rosa <code>#F72585</code> | Preto{' '}
          <code>#111111</code> | Roxo <code>#7209B7</code> | Neutro <code>#1A1A1A</code> • Plus
          Jakarta Sans
        </div>
        <div>
          Segurança Ativa: Loopback Local <code>127.0.0.1</code> + Autenticação por PIN HMAC
        </div>
      </footer>
    </div>
  );
};
