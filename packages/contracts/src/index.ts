/**
 * DECK 26 — Contratos Compartilhados, Entidades de Domínio, RBAC, Navegação e Sincronização
 *
 * REGRAS DE ARQUITETURA APLICADAS:
 * 1. Um catálogo lógico de produtos compartilhado entre os canais (PDV, Mesa, Garçom, QR Code, Delivery, Hotel).
 * 2. Separação estrita entre:
 *    - Pedido (Order / OrderItem)
 *    - Comanda / Conta aberta (Tab)
 *    - Pagamento (Payment)
 *    - Impressão (PrintJob)
 *    - Movimentação de Estoque (StockMovement)
 * 3. Eventos de sincronização persistentes (Outbox Pattern) com idempotencyKey, HLC/Vector Version e resolução de conflitos.
 * 4. Sem emissão fiscal fictícia (status fiscal reflete estritamente contingência local ou autorização SEFAZ real via provedor).
 */

import { z } from 'zod';

// ============================================================================
// 1. IDENTIFICADORES E METADADOS DE AUDITORIA
// ============================================================================

export const UuidSchema = z.string().uuid();
export const IsoDateTimeSchema = z.string().datetime({ offset: true }).or(z.string().min(10));

export const OriginNodeSchema = z.enum([
  'WINDOWS_PDV',      // Computador principal Windows (Tauri / Local Server)
  'WAITER_MOBILE',    // Celulares dos 5 garçons na Wi-Fi local
  'KITCHEN_KDS',      // Dispositivo da cozinha na Wi-Fi local
  'CLOUD_QR_MENU',    // Cliente pedindo via QR Code na mesa
  'CLOUD_DELIVERY',   // Cliente pedindo via Delivery na VPS
  'CLOUD_OWNER_ADMIN' // Proprietário / gerência acessando remotamente na VPS
]);
export type OriginNode = z.infer<typeof OriginNodeSchema>;

// ============================================================================
// 2. AUTENTICAÇÃO, AUTORIZAÇÃO (RBAC) E FUNCIONÁRIOS
// ============================================================================

export const RoleSchema = z.enum([
  'OWNER',        // Proprietário (acesso irrestrito local + nuvem)
  'MANAGER',      // Gerente geral (relatórios, estornos, estoque, hotel)
  'CASHIER',      // Operador de Caixa / PDV
  'WAITER',       // Garçom (mesas, comandas, lançamento de pedidos)
  'KITCHEN',      // Cozinha / Bar (visualização e avanço de preparo KDS)
  'RECEPTIONIST', // Recepção do Hotel Auto Posto Milla (quartos, reservas, lançamentos em quarto)
  'STOCK_CLERK'   // Estoquista
]);
export type UserRole = z.infer<typeof RoleSchema>;

export const PermissionSchema = z.enum([
  'dashboard:view',
  'pos:operate',
  'pos:open_close_register',
  'tabs:manage',
  'tabs:discount_or_void',
  'orders:create',
  'orders:advance_kitchen',
  'catalog:manage',
  'stock:adjust',
  'hotel:manage_reservations',
  'finance:view_and_manage',
  'reports:view',
  'staff:manage',
  'admin:configure',
  'printers:manage',
  'fiscal:configure',
  'sync:manage'
]);
export type Permission = z.infer<typeof PermissionSchema>;

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: [
    'dashboard:view', 'pos:operate', 'pos:open_close_register', 'tabs:manage',
    'tabs:discount_or_void', 'orders:create', 'orders:advance_kitchen',
    'catalog:manage', 'stock:adjust', 'hotel:manage_reservations',
    'finance:view_and_manage', 'reports:view', 'staff:manage',
    'admin:configure', 'printers:manage', 'fiscal:configure', 'sync:manage'
  ],
  MANAGER: [
    'dashboard:view', 'pos:operate', 'pos:open_close_register', 'tabs:manage',
    'tabs:discount_or_void', 'orders:create', 'orders:advance_kitchen',
    'catalog:manage', 'stock:adjust', 'hotel:manage_reservations',
    'finance:view_and_manage', 'reports:view', 'staff:manage',
    'printers:manage', 'sync:manage'
  ],
  CASHIER: [
    'dashboard:view', 'pos:operate', 'pos:open_close_register',
    'tabs:manage', 'orders:create', 'printers:manage'
  ],
  WAITER: [
    'tabs:manage', 'orders:create'
  ],
  KITCHEN: [
    'orders:advance_kitchen'
  ],
  RECEPTIONIST: [
    'dashboard:view', 'hotel:manage_reservations', 'tabs:manage', 'orders:create', 'pos:operate'
  ],
  STOCK_CLERK: [
    'catalog:manage', 'stock:adjust'
  ]
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export interface StaffAccountSeed {
  id: string;
  name: string;
  role: UserRole;
  pin: string; // PIN operacional de 4 dígitos para autenticação local rápida + geração de token HMAC
}

export const DECK26_INITIAL_STAFF: StaffAccountSeed[] = [
  { id: 'usr-owner-01', name: 'Proprietário Deck 26', role: 'OWNER', pin: '2626' },
  { id: 'usr-manager-01', name: 'Gerente Geral Milla', role: 'MANAGER', pin: '1010' },
  { id: 'usr-cashier-01', name: 'Operador Caixa PDV', role: 'CASHIER', pin: '2020' },
  { id: 'usr-waiter-01', name: 'Garçom 01 (Wi-Fi)', role: 'WAITER', pin: '3030' },
  { id: 'usr-kitchen-01', name: 'Chef Cozinha KDS', role: 'KITCHEN', pin: '4040' },
  { id: 'usr-reception-01', name: 'Recepção Hotel Milla', role: 'RECEPTIONIST', pin: '5050' },
  { id: 'usr-stock-01', name: 'Estoquista Deck 26', role: 'STOCK_CLERK', pin: '6060' }
];

// ============================================================================
// 3. MÓDULOS OFICIAIS DO SISTEMA (16 MÓDULOS)
// ============================================================================

export const SystemModuleIdSchema = z.enum([
  'dashboard',
  'caixa-pdv',
  'mesas-comandas',
  'pedidos',
  'garcons',
  'cozinha',
  'produtos-cardapio',
  'estoque',
  'hotel-reservas',
  'financeiro',
  'relatorios',
  'funcionarios',
  'administracao',
  'impressoras',
  'configuracoes-fiscais',
  'sincronizacao'
]);
export type SystemModuleId = z.infer<typeof SystemModuleIdSchema>;

export interface SystemModuleDefinition {
  id: SystemModuleId;
  title: string;
  shortTitle: string;
  group: 'OPERACIONAL' | 'CATALOGO_ESTOQUE' | 'HOTELARIA' | 'GESTAO_RETAGUARDA' | 'INFRA_FISCAL';
  description: string;
  requiredPermission: Permission;
  offlineCapable: boolean;
  shortcut?: string;
}

export const SYSTEM_MODULES: SystemModuleDefinition[] = [
  {
    id: 'dashboard',
    title: 'Dashboard Operacional',
    shortTitle: 'Dashboard',
    group: 'OPERACIONAL',
    description: 'Visão em tempo real do salão, vendas do turno, fila da cozinha, ocupação do hotel e saúde da sincronização.',
    requiredPermission: 'dashboard:view',
    offlineCapable: true,
    shortcut: 'F1'
  },
  {
    id: 'caixa-pdv',
    title: 'Caixa e PDV',
    shortTitle: 'Caixa / PDV',
    group: 'OPERACIONAL',
    description: 'Abertura/fechamento de turno, venda balcão rápida, sangria, suprimento e liquidação de comandas.',
    requiredPermission: 'pos:operate',
    offlineCapable: true,
    shortcut: 'F2'
  },
  {
    id: 'mesas-comandas',
    title: 'Mesas e Comandas',
    shortTitle: 'Mesas & Comandas',
    group: 'OPERACIONAL',
    description: 'Mapa de mesas do Deck 26, abertura de comandas individuais, transferência de itens e divisão de conta.',
    requiredPermission: 'tabs:manage',
    offlineCapable: true,
    shortcut: 'F3'
  },
  {
    id: 'pedidos',
    title: 'Central de Pedidos',
    shortTitle: 'Pedidos',
    group: 'OPERACIONAL',
    description: 'Monitoramento unificado de pedidos de salão, balcão, QR Code na mesa, quarto de hotel e delivery.',
    requiredPermission: 'orders:create',
    offlineCapable: true,
    shortcut: 'F4'
  },
  {
    id: 'garcons',
    title: 'Terminais de Garçons',
    shortTitle: 'Garçons (Wi-Fi)',
    group: 'OPERACIONAL',
    description: 'Gestão dos 5 dispositivos móveis de garçons conectados via Wi-Fi local, comissões e lançamentos rápidos.',
    requiredPermission: 'tabs:manage',
    offlineCapable: true,
    shortcut: 'F5'
  },
  {
    id: 'cozinha',
    title: 'Cozinha e Bar (KDS)',
    shortTitle: 'Cozinha (KDS)',
    group: 'OPERACIONAL',
    description: 'Tela de preparo por praça (Chapa, Cozinha Quente, Bar/Drinks) com tempos de SLA e alerta sonoro.',
    requiredPermission: 'orders:advance_kitchen',
    offlineCapable: true,
    shortcut: 'F6'
  },
  {
    id: 'produtos-cardapio',
    title: 'Produtos e Cardápio Digital',
    shortTitle: 'Cardápio',
    group: 'CATALOGO_ESTOQUE',
    description: 'Catálogo lógico único com preços e disponibilidade por canal (Salão, QR Code, Delivery, Quarto).',
    requiredPermission: 'catalog:manage',
    offlineCapable: true,
    shortcut: 'F7'
  },
  {
    id: 'estoque',
    title: 'Controle de Estoque e Fichas Técnicas',
    shortTitle: 'Estoque',
    group: 'CATALOGO_ESTOQUE',
    description: 'Kardex auditável de entradas, baixas automáticas por venda, perdas, inventário e custo médio.',
    requiredPermission: 'stock:adjust',
    offlineCapable: true
  },
  {
    id: 'hotel-reservas',
    title: 'Hotel Milla & Reservas',
    shortTitle: 'Hotel & Quartos',
    group: 'HOTELARIA',
    description: 'Mapa de apartamentos, check-in/check-out, governança e integração de consumo do restaurante na conta do hóspede.',
    requiredPermission: 'hotel:manage_reservations',
    offlineCapable: true,
    shortcut: 'F8'
  },
  {
    id: 'financeiro',
    title: 'Financeiro (Contas e Conciliação)',
    shortTitle: 'Financeiro',
    group: 'GESTAO_RETAGUARDA',
    description: 'Fluxo de caixa, contas a pagar/receber, conciliação PIX/cartões e fechamento contábil.',
    requiredPermission: 'finance:view_and_manage',
    offlineCapable: true
  },
  {
    id: 'relatorios',
    title: 'Relatórios e DRE Analítico',
    shortTitle: 'Relatórios',
    group: 'GESTAO_RETAGUARDA',
    description: 'Curva ABC de cardápio, ticket médio, giro de mesas, ocupação hoteleira e auditoria de cancelamentos.',
    requiredPermission: 'reports:view',
    offlineCapable: true
  },
  {
    id: 'funcionarios',
    title: 'Funcionários, Escalas e Comissões',
    shortTitle: 'Funcionários',
    group: 'GESTAO_RETAGUARDA',
    description: 'Cadastro de colaboradores, PIN de acesso rápido local, controle de gorjetas (10%) e permissões RBAC.',
    requiredPermission: 'staff:manage',
    offlineCapable: true
  },
  {
    id: 'administracao',
    title: 'Administração e Auditoria',
    shortTitle: 'Administração',
    group: 'GESTAO_RETAGUARDA',
    description: 'Parâmetros do estabelecimento (Deck 26 / Hotel Auto Posto Milla), logs imutáveis e backups locais/nuvem.',
    requiredPermission: 'admin:configure',
    offlineCapable: true
  },
  {
    id: 'impressoras',
    title: 'Impressoras Térmicas (ESC/POS)',
    shortTitle: 'Impressoras',
    group: 'INFRA_FISCAL',
    description: 'Spooler local de impressão por praça (Caixa, Cozinha, Bar) via rede TCP/IP 9100 ou USB Windows.',
    requiredPermission: 'printers:manage',
    offlineCapable: true
  },
  {
    id: 'configuracoes-fiscais',
    title: 'Configurações Fiscais (NFC-e / NF-e)',
    shortTitle: 'Fiscal',
    group: 'INFRA_FISCAL',
    description: 'Certificado A1, CSC, NCM/CEST/CFOP e fila real de emissão/contingência SEFAZ sem simulação fictícia.',
    requiredPermission: 'fiscal:configure',
    offlineCapable: true
  },
  {
    id: 'sincronizacao',
    title: 'Sincronização Local ↔ VPS Hostinger',
    shortTitle: 'Sincronização',
    group: 'INFRA_FISCAL',
    description: 'Outbox de eventos persistentes, status do link com a VPS, idempotência, reprocessamento e conflitos.',
    requiredPermission: 'sync:manage',
    offlineCapable: true,
    shortcut: 'F12'
  }
];

// ============================================================================
// 4. CATÁLOGO LÓGICO COMPARTILHADO ENTRE OS CANAIS
// ============================================================================

export const SalesChannelSchema = z.enum([
  'DINE_IN',      // Mesa / Salão Deck 26
  'COUNTER_PDV',  // Balcão / PDV Rápido
  'QR_TABLE',     // Autoatendimento QR Code na mesa
  'DELIVERY',     // Delivery Online
  'HOTEL_ROOM'    // Consumo lançado no Quarto do Hotel Milla
]);
export type SalesChannel = z.infer<typeof SalesChannelSchema>;

export const PrepStationSchema = z.enum([
  'KITCHEN_HOT',   // Cozinha Quente (Pratos Executivos, Panelada, Carnes)
  'GRIDDLE_TAPIOCA', // Chapa (Tapiocas, Cuscuz, Omeletes, Panquecas)
  'BAR_DRINKS',    // Bar (Drinks, Cervejas, Sucos, Refrigerantes)
  'NONE'           // Itens de pronta entrega sem preparo
]);
export type PrepStation = z.infer<typeof PrepStationSchema>;

export const ModifierOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priceDeltaCents: z.number().int().default(0)
});

export const ModifierGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1), // Ex: "Escolha a base", "Escolha o recheio", "Ponto da carne"
  minSelect: z.number().int().min(0),
  maxSelect: z.number().int().min(1),
  options: z.array(ModifierOptionSchema)
});
export type ModifierGroup = z.infer<typeof ModifierGroupSchema>;

export const CatalogCategorySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  sortOrder: z.number().int(),
  active: z.boolean().default(true)
});
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;

export const CatalogProductSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  categoryId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  priceCents: z.number().int().nonnegative(), // Preço base em centavos de Real (R$)
  channelPricesCents: z.record(SalesChannelSchema, z.number().int().nonnegative()).optional(),
  availableChannels: z.array(SalesChannelSchema).min(1),
  prepStation: PrepStationSchema,
  trackStock: z.boolean().default(true),
  modifierGroups: z.array(ModifierGroupSchema).default([]),
  ncm: z.string().length(8).optional(),
  cfop: z.string().length(4).optional(),
  active: z.boolean().default(true),
  updatedAt: IsoDateTimeSchema
});
export type CatalogProduct = z.infer<typeof CatalogProductSchema>;

// ============================================================================
// 5. ENTIDADES OPERACIONAIS SEPARADAS (REGRA ARQUITETURAL ESTRITA)
//    Comanda (Tab) !== Pedido (Order) !== Pagamento (Payment) !==
//    Impressão (PrintJob) !== Movimentação de Estoque (StockMovement)
// ============================================================================

/**
 * 5.1 COMANDA / CONTA ABERTA (Tab)
 * Representa a conta financeira aberta de uma mesa, cartão de consumo ou quarto de hotel.
 * Pode receber múltiplos pedidos (Orders) ao longo da permanência do cliente e múltiplos pagamentos parciais/totais.
 */
export const TabTypeSchema = z.enum(['TABLE', 'INDIVIDUAL_CARD', 'COUNTER', 'HOTEL_FOLIO']);
export type TabType = z.infer<typeof TabTypeSchema>;
export const TabStatusSchema = z.enum(['OPEN', 'BILL_REQUESTED', 'PARTIALLY_PAID', 'CLOSED', 'CANCELLED']);
export type TabStatus = z.infer<typeof TabStatusSchema>;

export const TabSchema = z.object({
  id: UuidSchema,
  code: z.string().min(1), // Ex: "MESA-04", "CMD-102", "APTO-201"
  type: TabTypeSchema,
  status: TabStatusSchema,
  tableNumber: z.number().int().positive().nullable().optional(),
  hotelReservationId: UuidSchema.nullable().optional(),
  customerName: z.string().nullable().optional(),
  guestsCount: z.number().int().min(1).default(1),
  serviceFeeEnabled: z.boolean().default(true), // Taxa de serviço 10%
  serviceFeeBasisPoints: z.number().int().min(0).max(3000).default(1000), // 1000 bps = 10.00%
  subtotalCents: z.number().int().nonnegative(),
  serviceFeeCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative().default(0),
  totalCents: z.number().int().nonnegative(),
  paidCents: z.number().int().nonnegative().default(0),
  openedByUserId: z.string().min(1),
  openedAt: IsoDateTimeSchema,
  closedAt: IsoDateTimeSchema.nullable().optional(),
  version: z.number().int().positive().default(1)
});
export type Tab = z.infer<typeof TabSchema>;

/**
 * 5.2 PEDIDO (Order & OrderItem)
 * Representa um disparo de produção (comanda do garçom, pedido via QR Code ou pedido de balcão).
 * Uma Comanda (Tab) pode ter 1..N Pedidos (Orders).
 */
export const OrderStatusSchema = z.enum([
  'RECEIVED',       // Registrado localmente ou recebido da nuvem
  'IN_PREPARATION', // Em preparo na cozinha / bar
  'READY',          // Pronto para entrega pelo garçom
  'DELIVERED',      // Entregue na mesa / cliente
  'CANCELLED'       // Cancelado com justificativa auditada
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderItemModifierSelectionSchema = z.object({
  groupId: z.string().min(1),
  groupName: z.string().min(1),
  optionId: z.string().min(1),
  optionName: z.string().min(1),
  priceDeltaCents: z.number().int().default(0)
});

export const OrderItemSchema = z.object({
  id: UuidSchema,
  orderId: UuidSchema,
  productId: z.string().min(1),
  productName: z.string().min(1),
  prepStation: PrepStationSchema,
  quantity: z.number().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  modifiersTotalCents: z.number().int().default(0),
  totalItemCents: z.number().int().nonnegative(),
  notes: z.string().max(280).optional(),
  modifiers: z.array(OrderItemModifierSelectionSchema).default([]),
  status: OrderStatusSchema.default('RECEIVED')
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderSchema = z.object({
  id: UuidSchema,
  tabId: UuidSchema.nullable(), // Obrigatório para salão/quarto, opcional para delivery pré-pago sem comanda
  channel: SalesChannelSchema,
  originNode: OriginNodeSchema,
  idempotencyKey: z.string().min(8), // Garante que reenvio por Wi-Fi instável nunca duplique o pedido
  status: OrderStatusSchema,
  waiterUserId: z.string().nullable().optional(),
  waiterName: z.string().nullable().optional(),
  tableNumber: z.number().int().positive().nullable().optional(),
  customerNotes: z.string().max(500).optional(),
  items: z.array(OrderItemSchema).min(1),
  totalOrderCents: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  version: z.number().int().positive().default(1)
});
export type Order = z.infer<typeof OrderSchema>;

/**
 * 5.3 PAGAMENTO (Payment)
 * Entidade financeira independente vinculada à Comanda (Tab) ou Pedido Direto, e ao Turno de Caixa (CashSession).
 */
export const PaymentMethodSchema = z.enum([
  'CASH',        // Dinheiro em espécie
  'PIX',         // PIX (QR Code dinâmico ou chave)
  'DEBIT_CARD',  // Cartão de Débito
  'CREDIT_CARD', // Cartão de Crédito
  'ROOM_CHARGE', // Transferência para conta do Hóspede no Hotel Milla
  'VOUCHER'      // Vale-refeição / Cortesia autorizada
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PaymentStatusSchema = z.enum(['CONFIRMED', 'REFUNDED', 'PENDING']);

export const PaymentSchema = z.object({
  id: UuidSchema,
  tabId: UuidSchema,
  cashRegisterSessionId: z.string().min(1),
  method: PaymentMethodSchema,
  status: PaymentStatusSchema,
  amountCents: z.number().int().positive(),
  receivedCashCents: z.number().int().nonnegative().optional(),
  changeCents: z.number().int().nonnegative().default(0),
  nsuOrTxId: z.string().optional(), // NSU da maquininha ou EndToEndId do PIX
  idempotencyKey: z.string().min(8),
  operatorUserId: z.string().min(1),
  createdAt: IsoDateTimeSchema
});
export type Payment = z.infer<typeof PaymentSchema>;

/**
 * 5.4 IMPRESSÃO (PrintJob)
 * Fila persistente de trabalhos de impressão térmica ESC/POS (Cozinha, Bar, Conferência de Mesa, Recibo).
 * Separada do pedido para permitir reimpressão, roteamento por praça e tolerância a impressora sem papel/offline.
 */
export const PrintJobTargetSchema = z.enum([
  'PRINTER_KITCHEN_HOT',
  'PRINTER_GRIDDLE',
  'PRINTER_BAR',
  'PRINTER_CASHIER'
]);
export type PrintJobTarget = z.infer<typeof PrintJobTargetSchema>;

export const PrintJobTypeSchema = z.enum([
  'PRODUCTION_TICKET', // Via de produção para cozinha/chapa/bar
  'TAB_BILL_PREVIEW',  // Conferência de conta para mesa
  'PAYMENT_RECEIPT',   // Comprovante não-fiscal de pagamento
  'CASH_REPORT'        // Fechamento de caixa
]);

export const PrintJobStatusSchema = z.enum([
  'QUEUED',
  'PRINTING',
  'PRINTED',
  'FAILED'
]);

export const PrintJobSchema = z.object({
  id: UuidSchema,
  targetPrinter: PrintJobTargetSchema,
  jobType: PrintJobTypeSchema,
  status: PrintJobStatusSchema,
  referenceEntityType: z.enum(['ORDER', 'TAB', 'PAYMENT', 'CASH_SESSION']),
  referenceEntityId: z.string().min(1),
  payloadText: z.string().min(1), // Layout formatado para bobina 80mm / 48 colunas
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
  printedAt: IsoDateTimeSchema.nullable().optional()
});
export type PrintJob = z.infer<typeof PrintJobSchema>;

/**
 * 5.5 MOVIMENTAÇÃO DE ESTOQUE (StockMovement)
 * Entidade de razão (ledger) imutável para cada entrada, saída por venda, perda ou ajuste de inventário.
 */
export const StockMovementTypeSchema = z.enum([
  'PURCHASE_ENTRY',    // Entrada por nota de compra
  'SALE_DEDUCTION',    // Baixa automática por item vendido
  'WASTE_OR_LOSS',     // Quebra, perda ou vencimento
  'INVENTORY_ADJUST',  // Ajuste de contagem física
  'INTERNAL_USE'       // Consumo interno
]);
export type StockMovementType = z.infer<typeof StockMovementTypeSchema>;

export const StockMovementSchema = z.object({
  id: UuidSchema,
  productId: z.string().min(1),
  productName: z.string().min(1),
  movementType: StockMovementTypeSchema,
  quantityDelta: z.number(), // Positivo para entrada, negativo para saída
  balanceAfter: z.number(),
  unitCostCents: z.number().int().nonnegative().optional(),
  referenceEntityType: z.enum(['ORDER', 'PURCHASE_INVOICE', 'MANUAL_AUDIT']).optional(),
  referenceEntityId: z.string().optional(),
  reason: z.string().min(2),
  createdByUserId: z.string().min(1),
  createdAt: IsoDateTimeSchema
});
export type StockMovement = z.infer<typeof StockMovementSchema>;

// ============================================================================
// 6. HOTELARIA (HOTEL AUTO POSTO MILLA)
// ============================================================================

export const HotelRoomStatusSchema = z.enum([
  'AVAILABLE',
  'OCCUPIED',
  'DIRTY_CLEANING',
  'MAINTENANCE',
  'RESERVED'
]);
export type HotelRoomStatus = z.infer<typeof HotelRoomStatusSchema>;

export const HotelRoomSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1), // Ex: "101", "102", "201"
  category: z.enum(['STANDARD_SINGLE', 'STANDARD_DOUBLE', 'LUXO_CASAL', 'TRIPLO']),
  dailyRateCents: z.number().int().positive(),
  status: HotelRoomStatusSchema,
  currentGuestName: z.string().nullable().optional(),
  activeTabId: UuidSchema.nullable().optional(),
  updatedAt: IsoDateTimeSchema
});
export type HotelRoom = z.infer<typeof HotelRoomSchema>;

// ============================================================================
// 7. SINCRONIZAÇÃO BIDIRECIONAL LOCAL ↔ VPS (OUTBOX & INBOX COM IDEMPOTÊNCIA)
// ============================================================================

export const SyncEntityTypeSchema = z.enum([
  'TAB',
  'ORDER',
  'PAYMENT',
  'STOCK_MOVEMENT',
  'CATALOG_PRODUCT',
  'HOTEL_ROOM',
  'FISCAL_CONFIG'
]);
export type SyncEntityType = z.infer<typeof SyncEntityTypeSchema>;

export const SyncOperationSchema = z.enum(['UPSERT', 'STATE_TRANSITION', 'APPEND_LEDGER']);

export const SyncEventStatusSchema = z.enum([
  'PENDING',      // Aguardando envio para VPS (ou aplicação local)
  'IN_FLIGHT',    // Em transmissão
  'ACKED',        // Confirmado pela outra ponta com idempotência garantida
  'CONFLICT',     // Conflito detectado para resolução determinística ou revisão
  'FAILED_RETRY'  // Falha de rede temporária (backoff exponencial)
]);
export type SyncEventStatus = z.infer<typeof SyncEventStatusSchema>;

export const SyncOutboxEventSchema = z.object({
  id: UuidSchema,
  idempotencyKey: z.string().min(12),
  originNode: OriginNodeSchema,
  entityType: SyncEntityTypeSchema,
  entityId: z.string().min(1),
  operation: SyncOperationSchema,
  entityVersion: z.number().int().positive(),
  hlcTimestamp: z.string().min(10), // Hybrid Logical Clock / ISO monotônico
  payloadJson: z.string().min(2),
  checksumSha256: z.string().min(8),
  status: SyncEventStatusSchema,
  retryCount: z.number().int().nonnegative().default(0),
  conflictReason: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
  syncedAt: IsoDateTimeSchema.nullable().optional()
});
export type SyncOutboxEvent = z.infer<typeof SyncOutboxEventSchema>;

export const SyncBatchPushRequestSchema = z.object({
  sourceNodeId: z.string().min(1),
  sourceOrigin: OriginNodeSchema,
  lastPulledRemoteCursor: z.number().int().nonnegative(),
  events: z.array(SyncOutboxEventSchema)
});
export type SyncBatchPushRequest = z.infer<typeof SyncBatchPushRequestSchema>;

export const SyncBatchPushResponseSchema = z.object({
  processedAt: IsoDateTimeSchema,
  ackedEventIds: z.array(UuidSchema),
  duplicateEventIds: z.array(UuidSchema), // Idempotência: eventos já processados anteriormente
  conflicts: z.array(z.object({
    eventId: UuidSchema,
    entityType: SyncEntityTypeSchema,
    entityId: z.string(),
    resolutionStrategy: z.enum(['LOCAL_WINS_OPERATIONAL', 'CLOUD_WINS_CATALOG', 'LEDGER_MERGED', 'MANUAL_REVIEW']),
    reason: z.string()
  })),
  remoteEventsToPull: z.array(SyncOutboxEventSchema),
  newRemoteCursor: z.number().int().nonnegative()
});
export type SyncBatchPushResponse = z.infer<typeof SyncBatchPushResponseSchema>;

// ============================================================================
// 8. CONFIGURAÇÃO FISCAL REAL (SEM EMISSÃO FICTÍCIA)
// ============================================================================

export const FiscalEnvironmentSchema = z.enum(['HOMOLOGATION', 'PRODUCTION']);
export const FiscalModeSchema = z.enum([
  'DISABLED_NOT_CONFIGURED', // Estado honesto padrão até inserção de Certificado A1 + CSC real
  'SEFAZ_NORMAL',
  'SEFAZ_OFFLINE_CONTINGENCY'
]);

export const FiscalConfigSchema = z.object({
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve conter 14 dígitos numéricos').or(z.literal('')),
  razaoSocial: z.string(),
  nomeFantasia: z.string().default('DECK 26 - HOTEL AUTO POSTO MILLA'),
  inscricaoEstadual: z.string(),
  uf: z.string().length(2).default('MA'),
  ambiente: FiscalEnvironmentSchema.default('HOMOLOGATION'),
  mode: FiscalModeSchema.default('DISABLED_NOT_CONFIGURED'),
  cscId: z.string().optional(),
  certificateConfigured: z.boolean().default(false),
  updatedAt: IsoDateTimeSchema
});
export type FiscalConfig = z.infer<typeof FiscalConfigSchema>;

// ============================================================================
// 9. CARDÁPIO OFICIAL DO DECK 26 (EXTRAÍDO DAS IMAGENS REAIS ANEXADAS)
// ============================================================================

export const DECK26_INITIAL_CATEGORIES: CatalogCategory[] = [
  { id: 'cat-qualquer-hora', slug: 'para-qualquer-hora', name: 'Para Qualquer Hora', sortOrder: 1, active: true },
  { id: 'cat-cuscuz', slug: 'cuscuz-recheado', name: 'Cuscuz Recheado', sortOrder: 2, active: true },
  { id: 'cat-tapioca', slug: 'tapioca-recheada', name: 'Tapioca Recheada', sortOrder: 3, active: true },
  { id: 'cat-executivos', slug: 'pratos-executivos', name: 'Pratos Executivos / 1 Pessoa', sortOrder: 4, active: true },
  { id: 'cat-especiais', slug: 'especiais-churrasco', name: 'Especiais & Churrasco', sortOrder: 5, active: true },
  { id: 'cat-bebidas', slug: 'bebidas', name: 'Bebidas & Refrigerantes', sortOrder: 6, active: true }
];

const BASE_MANTEIGA_REQUEIJAO: ModifierGroup = {
  id: 'grp-base-manteiga-requeijao',
  name: 'Escolha a Base',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'opt-manteiga', name: 'Com Manteiga', priceDeltaCents: 0 },
    { id: 'opt-requeijao', name: 'Com Requeijão', priceDeltaCents: 0 }
  ]
};

const RECHEIO_DOCE: ModifierGroup = {
  id: 'grp-recheio-doce',
  name: 'Escolha o Recheio Doce',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'opt-nutella-morango', name: 'Nutella com Calda de Morango', priceDeltaCents: 0 },
    { id: 'opt-romeu-julieta', name: 'Romeu e Julieta', priceDeltaCents: 0 }
  ]
};

const ALL_CHANNELS: SalesChannel[] = ['DINE_IN', 'COUNTER_PDV', 'QR_TABLE', 'DELIVERY', 'HOTEL_ROOM'];

export const DECK26_INITIAL_PRODUCTS: CatalogProduct[] = [
  // --- PARA QUALQUER HORA ---
  {
    id: 'prd-caldo-macaxeira',
    sku: 'D26-QH-001',
    categoryId: 'cat-qualquer-hora',
    name: 'Caldo de Macaxeira',
    description: 'Ovos, macaxeira com carne',
    priceCents: 1000, // R$ 10,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-omelete-simples',
    sku: 'D26-QH-002',
    categoryId: 'cat-qualquer-hora',
    name: 'Omelete Simples',
    description: 'Ovos e tomates',
    priceCents: 900, // R$ 9,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-omelete-recheado',
    sku: 'D26-QH-003',
    categoryId: 'cat-qualquer-hora',
    name: 'Omelete Recheado',
    description: 'Escolha o recheio: Frango, carne moída, queijo e presunto',
    priceCents: 1200, // R$ 12,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [
      {
        id: 'grp-recheio-omelete',
        name: 'Escolha o Recheio',
        minSelect: 1,
        maxSelect: 2,
        options: [
          { id: 'opt-frango', name: 'Frango', priceDeltaCents: 0 },
          { id: 'opt-carne-moida', name: 'Carne Moída', priceDeltaCents: 0 },
          { id: 'opt-queijo-presunto', name: 'Queijo e Presunto', priceDeltaCents: 0 }
        ]
      }
    ],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-panqueca-carne-seca',
    sku: 'D26-QH-004',
    categoryId: 'cat-qualquer-hora',
    name: 'Panqueca c/ Carne Seca',
    description: 'Carne de sol desfiada',
    priceCents: 1200, // R$ 12,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-panqueca-camarao',
    sku: 'D26-QH-005',
    categoryId: 'cat-qualquer-hora',
    name: 'Panqueca c/ Camarão',
    description: 'Panqueca com camarões',
    priceCents: 1400, // R$ 14,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-panqueca-recheada',
    sku: 'D26-QH-006',
    categoryId: 'cat-qualquer-hora',
    name: 'Panqueca Recheada',
    description: 'Escolha o recheio: frango, carne moída e queijo',
    priceCents: 1400, // R$ 14,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [
      {
        id: 'grp-recheio-panqueca',
        name: 'Escolha o Recheio',
        minSelect: 1,
        maxSelect: 2,
        options: [
          { id: 'opt-frango-queijo', name: 'Frango com Queijo', priceDeltaCents: 0 },
          { id: 'opt-carne-moida-queijo', name: 'Carne Moída com Queijo', priceDeltaCents: 0 }
        ]
      }
    ],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-panqueca-doce',
    sku: 'D26-QH-007',
    categoryId: 'cat-qualquer-hora',
    name: 'Panqueca Doce',
    description: 'Nutella com calda de morango ou Romeu e Julieta',
    priceCents: 1600, // R$ 16,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [RECHEIO_DOCE],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },

  // --- CUSCUZ RECHEADO ---
  {
    id: 'prd-cuscuz-ovos',
    sku: 'D26-CZ-001',
    categoryId: 'cat-cuscuz',
    name: 'Cuscuz c/ Ovos',
    description: 'Manteiga ou requeijão e ovos',
    priceCents: 900, // R$ 9,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-cuscuz-queijo-presunto',
    sku: 'D26-CZ-002',
    categoryId: 'cat-cuscuz',
    name: 'Cuscuz c/ Queijo e Presunto',
    description: 'Manteiga ou requeijão, queijo muçarela e presunto',
    priceCents: 1000, // R$ 10,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-cuscuz-frango',
    sku: 'D26-CZ-003',
    categoryId: 'cat-cuscuz',
    name: 'Cuscuz c/ Frango',
    description: 'Manteiga ou requeijão e filé de frango desfiado',
    priceCents: 1200, // R$ 12,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-cuscuz-frango-catupiry',
    sku: 'D26-CZ-004',
    categoryId: 'cat-cuscuz',
    name: 'Cuscuz de Frango c/ Catupiry',
    description: 'Manteiga ou requeijão, filé de frango desfiado e catupiry',
    priceCents: 1400, // R$ 14,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-cuscuz-carne-sol-sem-catupiry',
    sku: 'D26-CZ-005',
    categoryId: 'cat-cuscuz',
    name: 'Cuscuz de Carne de Sol s/ Catupiry',
    description: 'Manteiga ou requeijão e carne de sol desfiada',
    priceCents: 1200, // R$ 12,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-cuscuz-carne-sol-com-catupiry',
    sku: 'D26-CZ-006',
    categoryId: 'cat-cuscuz',
    name: 'Cuscuz de Carne de Sol c/ Catupiry',
    description: 'Manteiga ou requeijão, carne de sol desfiada e catupiry',
    priceCents: 1400, // R$ 14,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-cuscuz-carne-moida',
    sku: 'D26-CZ-007',
    categoryId: 'cat-cuscuz',
    name: 'Cuscuz c/ Carne Moída',
    description: 'Manteiga ou requeijão e carne moída',
    priceCents: 1200, // R$ 12,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },

  // --- TAPIOCA RECHEADA ---
  {
    id: 'prd-tapioca-ovos',
    sku: 'D26-TP-001',
    categoryId: 'cat-tapioca',
    name: 'Tapioca c/ Ovos',
    description: 'Tapioca, manteiga ou requeijão e ovos',
    priceCents: 800, // R$ 8,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-tapioca-queijo-presunto',
    sku: 'D26-TP-002',
    categoryId: 'cat-tapioca',
    name: 'Tapioca c/ Queijo e Presunto',
    description: 'Tapioca, manteiga ou requeijão, queijo muçarela e presunto',
    priceCents: 900, // R$ 9,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-tapioca-frango',
    sku: 'D26-TP-003',
    categoryId: 'cat-tapioca',
    name: 'Tapioca c/ Frango',
    description: 'Tapioca, manteiga ou requeijão e filé de frango desfiado',
    priceCents: 1000, // R$ 10,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-tapioca-frango-catupiry',
    sku: 'D26-TP-004',
    categoryId: 'cat-tapioca',
    name: 'Tapioca de Frango c/ Catupiry',
    description: 'Tapioca, manteiga ou requeijão, filé de frango desfiado e catupiry',
    priceCents: 1400, // R$ 14,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-tapioca-doce',
    sku: 'D26-TP-005',
    categoryId: 'cat-tapioca',
    name: 'Tapioca Doce',
    description: 'Nutella com calda de morango ou Romeu e Julieta',
    priceCents: 1600, // R$ 16,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [RECHEIO_DOCE],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-tapioca-carne-sol',
    sku: 'D26-TP-006',
    categoryId: 'cat-tapioca',
    name: 'Tapioca de Carne de Sol',
    description: 'Tapioca, manteiga ou requeijão e carne de sol desfiada',
    priceCents: 1000, // R$ 10,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-tapioca-carne-sol-catupiry',
    sku: 'D26-TP-007',
    categoryId: 'cat-tapioca',
    name: 'Tapioca de Carne de Sol c/ Catupiry',
    description: 'Tapioca, manteiga e requeijão, carne de sol desfiada e catupiry',
    priceCents: 1400, // R$ 14,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [BASE_MANTEIGA_REQUEIJAO],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },

  // --- PRATOS EXECUTIVOS / 1 PESSOA ---
  {
    id: 'prd-exec-file-mignon-trinchado',
    sku: 'D26-EX-001',
    categoryId: 'cat-executivos',
    name: 'Filé Mignon Trinchado',
    description: 'Caldo de feijão, batata palha, farofa, salada verde e arroz branco',
    priceCents: 4200, // R$ 42,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-exec-carne-de-sol',
    sku: 'D26-EX-002',
    categoryId: 'cat-executivos',
    name: 'Carne de Sol Executiva',
    description: 'Farofa, salada e arroz branco',
    priceCents: 4400, // R$ 44,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-exec-strogonoff-frango',
    sku: 'D26-EX-003',
    categoryId: 'cat-executivos',
    name: 'Strogonoff de Frango',
    description: 'Farofa, batata palha e arroz branco',
    priceCents: 3000, // R$ 30,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-exec-prato-raiz',
    sku: 'D26-EX-004',
    categoryId: 'cat-executivos',
    name: 'Prato Raiz (Carne ou Frango)',
    description: 'Feijão, farofa, salada crua, bife de frango ou carne e arroz branco',
    priceCents: 3000, // R$ 30,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [
      {
        id: 'grp-proteina-prato-raiz',
        name: 'Escolha a Proteína',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { id: 'opt-bife-carne', name: 'Bife de Carne', priceDeltaCents: 0 },
          { id: 'opt-bife-frango', name: 'Bife de Frango', priceDeltaCents: 0 }
        ]
      }
    ],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-exec-file-molho-madeira',
    sku: 'D26-EX-005',
    categoryId: 'cat-executivos',
    name: 'Filé Mignon ao Molho Madeira',
    description: 'Filé mignon gratinado ao molho madeira, servido com farofa e arroz branco',
    priceCents: 4400, // R$ 44,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-exec-camarao-cremoso',
    sku: 'D26-EX-006',
    categoryId: 'cat-executivos',
    name: 'Camarão Cremoso',
    description: 'Filé de camarão com batata inglesa ao molho branco, farofa e arroz branco',
    priceCents: 4700, // R$ 47,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-exec-parmegiana-classica',
    sku: 'D26-EX-007',
    categoryId: 'cat-executivos',
    name: 'Parmegiana Clássica',
    description: 'Filé mignon empanado gratinado com queijo e molho de tomate artesanal, servido com batata palha e arroz branco',
    priceCents: 5500, // R$ 55,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-exec-salmao',
    sku: 'D26-EX-008',
    categoryId: 'cat-executivos',
    name: 'Salmão Grelhado (200g)',
    description: '200g de salmão grelhado, farofa, salada verde, arroz cremoso ou arroz tradicional',
    priceCents: 5900, // R$ 59,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [
      {
        id: 'grp-arroz-salmao',
        name: 'Escolha o Arroz',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { id: 'opt-arroz-cremoso', name: 'Arroz Cremoso', priceDeltaCents: 0 },
          { id: 'opt-arroz-tradicional', name: 'Arroz Tradicional', priceDeltaCents: 0 }
        ]
      }
    ],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-exec-file-tilapia',
    sku: 'D26-EX-009',
    categoryId: 'cat-executivos',
    name: 'Filé de Tilápia',
    description: 'Farofa, salada crua e arroz branco',
    priceCents: 3900, // R$ 39,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-exec-omelete-fitness',
    sku: 'D26-EX-010',
    categoryId: 'cat-executivos',
    name: 'Omelete Fitness',
    description: 'Omelete e salada colorida',
    priceCents: 2400, // R$ 24,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'GRIDDLE_TAPIOCA',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-exec-panelada',
    sku: 'D26-EX-011',
    categoryId: 'cat-executivos',
    name: 'Panelada Regional',
    description: 'Porção individual tradicional servida com acompanhamentos da casa',
    priceCents: 3000, // R$ 30,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },

  // --- ESPECIAIS & CHURRASCO ---
  {
    id: 'prd-esp-picanha',
    sku: 'D26-ESP-001',
    categoryId: 'cat-especiais',
    name: 'Picanha na Chapa (Completa)',
    description: 'Picanha selecionada grelhada com baião, farofa, macaxeira e vinagrete',
    priceCents: 12000, // R$ 120,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },
  {
    id: 'prd-esp-feijoada',
    sku: 'D26-ESP-002',
    categoryId: 'cat-especiais',
    name: 'Feijoada Completa Deck 26',
    description: 'Feijoada tradicional servida com arroz branco, couve, farofa, torresmo e laranja',
    priceCents: 8000, // R$ 80,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },

  // --- BEBIDAS & REFRIGERANTES ---
  {
    id: 'prd-beb-refrigerante-lata',
    sku: 'D26-BEB-001',
    categoryId: 'cat-bebidas',
    name: 'Refrigerante Lata 350ml',
    description: 'Coca-Cola, Coca Zero ou Guaraná Antarctica gelado',
    priceCents: 700, // R$ 7,00
    availableChannels: ALL_CHANNELS,
    prepStation: 'BAR_DRINKS',
    trackStock: true,
    modifierGroups: [],
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  }
];

// ============================================================================
// 10. FUNÇÕES PURAS DE DOMÍNIO E CÁLCULO FINANCEIRO (SEM PONTO FLUTUANTE)
// ============================================================================

export function formatBrlCents(cents: number): string {
  const reais = (cents / 100).toFixed(2).replace('.', ',');
  return `R$ ${reais}`;
}

export function calculateTabTotals(params: {
  orders: Order[];
  serviceFeeEnabled: boolean;
  serviceFeeBasisPoints?: number;
  discountCents?: number;
  paidCents?: number;
}): {
  subtotalCents: number;
  serviceFeeCents: number;
  discountCents: number;
  totalCents: number;
  remainingCents: number;
} {
  const activeOrders = params.orders.filter((o) => o.status !== 'CANCELLED');
  const subtotalCents = activeOrders.reduce((acc, order) => acc + order.totalOrderCents, 0);
  const bps = params.serviceFeeBasisPoints ?? 1000; // 10%
  const serviceFeeCents = params.serviceFeeEnabled
    ? Math.round((subtotalCents * bps) / 10000)
    : 0;
  const discountCents = Math.min(params.discountCents ?? 0, subtotalCents + serviceFeeCents);
  const totalCents = Math.max(0, subtotalCents + serviceFeeCents - discountCents);
  const remainingCents = Math.max(0, totalCents - (params.paidCents ?? 0));

  return {
    subtotalCents,
    serviceFeeCents,
    discountCents,
    totalCents,
    remainingCents
  };
}

export function buildEscPosProductionTicket(order: Order, tabCode?: string): string {
  const lines: string[] = [
    '================================================',
    '            DECK 26 - PRODUCAO LOCAL            ',
    '================================================',
    `PEDIDO: ${order.id.slice(0, 8).toUpperCase()}   CANAL: ${order.channel}`,
    `COMANDA/MESA: ${tabCode ?? (order.tableNumber ? `MESA ${order.tableNumber}` : 'BALCAO')}`,
    `GARCOM: ${order.waiterName ?? 'OPERADOR PDV'}`,
    `HORA: ${new Date(order.createdAt).toLocaleTimeString('pt-BR')}`,
    '------------------------------------------------'
  ];

  for (const item of order.items) {
    lines.push(`${item.quantity}x ${item.productName.toUpperCase()} [${item.prepStation}]`);
    for (const mod of item.modifiers) {
      lines.push(`   + ${mod.groupName}: ${mod.optionName}`);
    }
    if (item.notes) {
      lines.push(`   OBS: ${item.notes}`);
    }
  }

  if (order.customerNotes) {
    lines.push('------------------------------------------------');
    lines.push(`OBS GERAL: ${order.customerNotes}`);
  }
  lines.push('================================================\n\n');
  return lines.join('\n');
}
