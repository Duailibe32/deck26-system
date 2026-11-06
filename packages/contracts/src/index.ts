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
import { IsoDateTimeSchema } from './common.js';
export { IsoDateTimeSchema } from './common.js';

// ============================================================================
// 1. IDENTIFICADORES E METADADOS DE AUDITORIA
// ============================================================================

export const UuidSchema = z.string().uuid();

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
  'hotel:manage_rooms',
  'hotel:manage_guests',
  'hotel:manage_reservations',
  'hotel:manage_rates',
  'hotel:checkin_checkout',
  'hotel:post_charges',
  'hotel:housekeeping',
  'hotel:maintenance',
  'hotel:view_pii',
  'hotel:reports',
  'finance:view_and_manage',
  'reports:view',
  'staff:manage',
  'admin:configure',
  'printers:manage',
  'fiscal:configure',
  'sync:manage',
  // Etapa 6: Delivery e Gestão Financeira Avançada
  'delivery:manage_orders',
  'delivery:manage_couriers',
  'delivery:settle',
  'finance:view_overview',
  'finance:manage_receivables',
  'finance:manage_payables',
  'finance:manage_accounts',
  'finance:transfers',
  'finance:reconcile',
  'finance:view_dre',
  'finance:manage_suppliers',
  'finance:export_reports'
]);
export type Permission = z.infer<typeof PermissionSchema>;

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: [
    'dashboard:view', 'pos:operate', 'pos:open_close_register', 'tabs:manage',
    'tabs:discount_or_void', 'orders:create', 'orders:advance_kitchen',
    'catalog:manage', 'stock:adjust',
    'hotel:manage_rooms', 'hotel:manage_guests', 'hotel:manage_reservations',
    'hotel:manage_rates', 'hotel:checkin_checkout', 'hotel:post_charges',
    'hotel:housekeeping', 'hotel:maintenance', 'hotel:view_pii', 'hotel:reports',
    'finance:view_and_manage', 'reports:view', 'staff:manage',
    'admin:configure', 'printers:manage', 'fiscal:configure', 'sync:manage',
    'delivery:manage_orders', 'delivery:manage_couriers', 'delivery:settle',
    'finance:view_overview', 'finance:manage_receivables', 'finance:manage_payables',
    'finance:manage_accounts', 'finance:transfers', 'finance:reconcile',
    'finance:view_dre', 'finance:manage_suppliers', 'finance:export_reports'
  ],
  MANAGER: [
    'dashboard:view', 'pos:operate', 'pos:open_close_register', 'tabs:manage',
    'tabs:discount_or_void', 'orders:create', 'orders:advance_kitchen',
    'catalog:manage', 'stock:adjust',
    'hotel:manage_rooms', 'hotel:manage_guests', 'hotel:manage_reservations',
    'hotel:manage_rates', 'hotel:checkin_checkout', 'hotel:post_charges',
    'hotel:housekeeping', 'hotel:maintenance', 'hotel:view_pii', 'hotel:reports',
    'finance:view_and_manage', 'reports:view', 'staff:manage',
    'printers:manage', 'sync:manage',
    'delivery:manage_orders', 'delivery:manage_couriers', 'delivery:settle',
    'finance:view_overview', 'finance:manage_receivables', 'finance:manage_payables',
    'finance:manage_accounts', 'finance:transfers', 'finance:reconcile',
    'finance:view_dre', 'finance:manage_suppliers', 'finance:export_reports'
  ],
  CASHIER: [
    'dashboard:view', 'pos:operate', 'pos:open_close_register',
    'tabs:manage', 'orders:create', 'printers:manage',
    'hotel:post_charges', 'hotel:checkin_checkout',
    'delivery:manage_orders', 'delivery:settle',
    'finance:view_overview', 'finance:manage_receivables'
  ],
  WAITER: [
    'tabs:manage', 'orders:create'
  ],
  KITCHEN: [
    'orders:advance_kitchen'
  ],
  RECEPTIONIST: [
    'dashboard:view', 'pos:operate', 'tabs:manage', 'orders:create',
    'hotel:manage_rooms', 'hotel:manage_guests', 'hotel:manage_reservations',
    'hotel:manage_rates', 'hotel:checkin_checkout', 'hotel:post_charges',
    'hotel:housekeeping', 'hotel:maintenance', 'hotel:view_pii', 'hotel:reports'
  ],
  STOCK_CLERK: [
    'catalog:manage', 'stock:adjust', 'finance:manage_suppliers'
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
  'sincronizacao',
  'auditoria'
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
  {id:'auditoria',title:'Logs de Auditoria',shortTitle:'Auditoria',group:'GESTAO_RETAGUARDA',description:'Histórico cronológico de pedidos, cancelamentos, recebimentos e ações operacionais.',requiredPermission:'staff:manage',offlineCapable:true},
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
    title: 'Preparação Fiscal (NFC-e / NFS-e)',
    shortTitle: 'Fiscal',
    group: 'INFRA_FISCAL',
    description: 'Cadastros para revisão e ensaios identificados. Emissão real, certificado A1 e conexão SEFAZ ainda não habilitados.',
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
  'PICKUP',       // Retirada no Estabelecimento
  'HOTEL_ROOM'    // Consumo lançado no Quarto do Hotel Milla
]);
export type SalesChannel = z.infer<typeof SalesChannelSchema>;

export const PrepStationSchema = z.enum([
  'KITCHEN_HOT',     // Cozinha Quente (Pratos Executivos, Panelada, Carnes)
  'KITCHEN_COLD',    // Cozinha Fria / Saladas / Sobremesas
  'GRIDDLE_TAPIOCA', // Chapa (Tapiocas, Cuscuz, Omeletes, Panquecas)
  'BAR_DRINKS',      // Bar (Drinks, Cervejas, Sucos, Refrigerantes)
  'CASHIER_COUNTER', // Caixa / Recepção
  'NONE'             // Itens de pronta entrega sem preparo
]);
export type PrepStation = z.infer<typeof PrepStationSchema>;

export const ModifierOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priceDeltaCents: z.number().int().default(0),
  available: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  stockProductId: z.string().optional(), // Se o adicional consumir estoque de um insumo/produto cadastrado
  stockQuantityUsed: z.number().positive().optional()
});
export type ModifierOption = z.infer<typeof ModifierOptionSchema>;

export const ModifierGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1), // Ex: "Escolha a base", "Escolha o recheio", "Ponto da carne"
  required: z.boolean().optional(),
  minSelect: z.number().int().min(0),
  maxSelect: z.number().int().min(1),
  sortOrder: z.number().int().optional(),
  available: z.boolean().optional(),
  options: z.array(ModifierOptionSchema)
});
export type ModifierGroup = z.infer<typeof ModifierGroupSchema>;

export const CatalogCategorySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.string().nullable().optional(),
  sortOrder: z.number().int(),
  availableChannels: z.array(SalesChannelSchema).optional(),
  active: z.boolean().default(true),
  updatedAt: IsoDateTimeSchema.optional()
});
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;

export const OutOfStockPolicySchema = z.enum(['BLOCK_SALE', 'ALLOW_BACKORDER']);
export type OutOfStockPolicy = z.infer<typeof OutOfStockPolicySchema>;

export const DataSourceTypeSchema = z.enum(['OFFICIAL_MENU', 'TEST_ONLY', 'STAGE7A_CARDAPIO_DIGITAL']);
export type DataSourceType = z.infer<typeof DataSourceTypeSchema>;

export const CatalogProductSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().nullable().optional(),
  categoryId: z.string().min(1),
  subcategory: z.string().optional(),
  name: z.string().min(1),
  description: z.string().default(''),
  imageUrl: z.string().nullable().optional(),
  unitOfMeasure: z.string().optional(),
  priceCents: z.number().int().nonnegative(), // Preço base de venda em centavos
  costPriceCents: z.number().int().nonnegative().optional(), // Preço de custo em centavos
  channelPricesCents: z.partialRecord(SalesChannelSchema, z.number().int().nonnegative()).optional(),
  availableChannels: z.array(SalesChannelSchema).min(1),
  prepStation: PrepStationSchema,
  targetPrinter: z.string().optional(),
  prepTimeMinutes: z.number().int().nonnegative().optional(),
  trackStock: z.boolean().default(true),
  minStockQuantity: z.number().nonnegative().optional(),
  outOfStockPolicy: OutOfStockPolicySchema.optional(),
  modifierGroups: z.array(ModifierGroupSchema).default([]),
  internalNotes: z.string().optional(),
  ncm: z.string().optional(),
  cest: z.string().optional(),
  cfop: z.string().optional(),
  csosn: z.string().optional(),
  cstIcms: z.string().optional(),
  cstPis: z.string().optional(),
  cstCofins: z.string().optional(),
  origemMercadoria: z.number().int().optional(),
  verificationPending: z.array(z.string()).optional(),
  merchandiseOrigin: z.string().optional(),
  taxProfile: z.string().optional(),
  dataSource: DataSourceTypeSchema.optional(),
  active: z.boolean().default(true),
  createdAt: IsoDateTimeSchema.optional(),
  updatedAt: IsoDateTimeSchema
});
export type CatalogProduct = z.infer<typeof CatalogProductSchema>;

/**
 * 4.1 FICHA TÉCNICA E RECEITAS (Opcional, Versionada e sem valores fictícios)
 */
export const RecipeItemSchema = z.object({
  id: z.string().min(1),
  recipeId: z.string().min(1),
  ingredientProductId: z.string().min(1),
  ingredientName: z.string().min(1),
  quantityUsed: z.number().positive(),
  unitOfMeasure: z.string().default('UN'),
  unitCostCents: z.number().int().nonnegative().default(0)
});
export type RecipeItem = z.infer<typeof RecipeItemSchema>;

export const ProductRecipeSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(['DRAFT', 'APPROVED', 'ARCHIVED']),
  yieldQuantity: z.number().positive().default(1),
  estimatedCostCents: z.number().int().nonnegative(),
  notes: z.string().default(''),
  approvedByUserId: z.string().nullable().optional(),
  items: z.array(RecipeItemSchema).min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});
export type ProductRecipe = z.infer<typeof ProductRecipeSchema>;

/**
 * 4.2 GESTÃO FÍSICA DE MESAS E IDENTIFICADOR CRIPTOGRÁFICO DE QR CODE (SEÇÃO 3 E 4)
 * Diferencia estritamente o estado físico da mesa (LIVRE, OCUPADA, LIMPEZA, etc.)
 * do estado financeiro da comanda (OPEN, PARTIALLY_PAID, CLOSED).
 */
export const TablePhysicalStatusSchema = z.enum([
  'LIVRE',
  'OCUPADA',
  'AGUARDANDO_PEDIDO',
  'EM_ATENDIMENTO',
  'AGUARDANDO_PAGAMENTO',
  'LIMPEZA',
  'INDISPONIVEL'
]);
export type TablePhysicalStatus = z.infer<typeof TablePhysicalStatusSchema>;

export const DiningTableQrSchema = z.object({
  tableNumber: z.number().int().positive(),
  qrToken: z.string().min(16),
  label: z.string().min(1),
  requiresOperatorApproval: z.boolean().default(false),
  active: z.boolean().default(true),
  physicalStatus: TablePhysicalStatusSchema.optional(),
  activeTabId: z.string().nullable().optional(),
  primaryTableNumber: z.number().int().positive().nullable().optional(),
  joinedGroupId: z.string().nullable().optional(),
  assignedWaiterUserId: z.string().nullable().optional(),
  assignedWaiterName: z.string().nullable().optional(),
  guestsCount: z.number().int().nonnegative().optional(),
  openedAt: IsoDateTimeSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema.optional()
});
export type DiningTableQr = z.infer<typeof DiningTableQrSchema>;

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

export const DiscountTypeSchema = z.enum(['NONE', 'FIXED_CENTS', 'PERCENTAGE', 'COURTESY']);
export type DiscountType = z.infer<typeof DiscountTypeSchema>;

export const BillSplitModeSchema = z.enum([
  'NONE',
  'FREE_AMOUNT',
  'EQUAL_SHARES',
  'BY_ITEMS',
  'MIXED'
]);
export type BillSplitMode = z.infer<typeof BillSplitModeSchema>;

export const BillSplitItemAllocationSchema = z.object({
  orderItemId: z.string().min(1),
  productName: z.string().optional(),
  quantity: z.number().positive(),
  amountCents: z.number().int().nonnegative(),
  payerLabel: z.string().min(1),
  paid: z.boolean().optional()
});
export type BillSplitItemAllocation = z.infer<typeof BillSplitItemAllocationSchema>;

export const BillSplitPlanSchema = z.object({
  mode: BillSplitModeSchema,
  sharesCount: z.number().int().positive().optional(),
  perShareCents: z.number().int().nonnegative().optional(),
  itemAllocations: z.array(BillSplitItemAllocationSchema).optional(),
  updatedAt: IsoDateTimeSchema.optional()
});
export type BillSplitPlan = z.infer<typeof BillSplitPlanSchema>;

export const TabSchema = z.object({
  id: UuidSchema,
  code: z.string().min(1), // Ex: "MESA-04", "CMD-102", "APTO-201"
  type: TabTypeSchema,
  status: TabStatusSchema,
  tableNumber: z.number().int().positive().nullable().optional(),
  joinedTables: z.array(z.number().int().positive()).optional(),
  hotelReservationId: UuidSchema.nullable().optional(),
  customerName: z.string().nullable().optional(),
  guestsCount: z.number().int().min(1).default(1),
  waiterUserId: z.string().nullable().optional(),
  waiterName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  serviceFeeEnabled: z.boolean().default(true), // Taxa de serviço configurável
  serviceFeeBasisPoints: z.number().int().min(0).max(5000).default(1000), // 1000 bps = 10.00%
  subtotalCents: z.number().int().nonnegative(),
  serviceFeeCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative().default(0),
  discountType: DiscountTypeSchema.nullable().optional(),
  discountBasisPoints: z.number().int().nonnegative().optional(),
  discountValue: z.number().int().nonnegative().optional(),
  discountReason: z.string().nullable().optional(),
  discountByUserId: z.string().nullable().optional(),
  discountAuthorizedByUserId: z.string().nullable().optional(),
  splitPlan: BillSplitPlanSchema.nullable().optional(),
  totalCents: z.number().int().nonnegative(),
  paidCents: z.number().int().nonnegative().default(0),
  openedByUserId: z.string().min(1),
  openedAt: IsoDateTimeSchema,
  closedByUserId: z.string().nullable().optional(),
  closedAt: IsoDateTimeSchema.nullable().optional(),
  updatedAt: IsoDateTimeSchema.optional(),
  version: z.number().int().positive().default(1)
});
export type Tab = z.infer<typeof TabSchema>;

/**
 * 5.2 PEDIDO (Order & OrderItem)
 * Representa um disparo de produção (comanda do garçom, pedido via QR Code ou pedido de balcão).
 * Uma Comanda (Tab) pode ter 1..N Pedidos (Orders).
 */
export const OrderStatusSchema = z.enum([
  'PENDING_APPROVAL', // Aguardando aprovação operacional (quando política de mesa QR exige confirmação)
  'RECEIVED',         // Registrado localmente ou aprovado para produção (RECEBIDO)
  'IN_PREPARATION',   // Em preparo na cozinha / bar (EM_PREPARO)
  'READY',            // Pronto para entrega pelo garçom (PRONTO)
  'DELIVERED',        // Entregue na mesa / cliente (ENTREGUE)
  'CANCELLED'         // Cancelado com justificativa auditada (CANCELADO)
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderPrioritySchema = z.enum(['NORMAL', 'HIGH', 'RUSH']);
export type OrderPriority = z.infer<typeof OrderPrioritySchema>;

export const OrderCancelStageSchema = z.enum(['BEFORE_PREP', 'DURING_PREP', 'AFTER_DELIVERY']);
export type OrderCancelStage = z.infer<typeof OrderCancelStageSchema>;

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
  status: OrderStatusSchema.default('RECEIVED'),
  transferredFromTabId: z.string().nullable().optional(),
  transferredFromOrderId: z.string().nullable().optional(),
  transferredToTabId: z.string().nullable().optional(),
  transferredAt: IsoDateTimeSchema.nullable().optional(),
  transferredByUserId: z.string().nullable().optional(),
  paidQuantity: z.number().nonnegative().optional()
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderSchema = z.object({
  id: UuidSchema,
  tabId: UuidSchema.nullable(),
  channel: SalesChannelSchema,
  originNode: OriginNodeSchema,
  idempotencyKey: z.string().min(8),
  status: OrderStatusSchema,
  priority: OrderPrioritySchema.optional(),
  waiterUserId: z.string().nullable().optional(),
  waiterName: z.string().nullable().optional(),
  tableNumber: z.number().int().positive().nullable().optional(),
  customerNotes: z.string().max(500).optional(),
  items: z.array(OrderItemSchema).min(1),
  totalOrderCents: z.number().int().nonnegative(),
  prepStartedAt: IsoDateTimeSchema.nullable().optional(),
  readyAt: IsoDateTimeSchema.nullable().optional(),
  deliveredAt: IsoDateTimeSchema.nullable().optional(),
  deliveredByUserId: z.string().nullable().optional(),
  cancelledAt: IsoDateTimeSchema.nullable().optional(),
  cancelledByUserId: z.string().nullable().optional(),
  cancelledAuthorizedByUserId: z.string().nullable().optional(),
  cancelReason: z.string().nullable().optional(),
  cancelStage: OrderCancelStageSchema.nullable().optional(),
  waiterNotifiedAt: IsoDateTimeSchema.nullable().optional(),
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

export const PaymentConfirmationModeSchema = z.enum([
  'MANUAL_DECLARED',              // Registrado manualmente pelo operador no caixa
  'ELECTRONIC_PROVIDER_CONFIRMED' // Confirmado eletronicamente por provedor homologado
]);
export type PaymentConfirmationMode = z.infer<typeof PaymentConfirmationModeSchema>;

export const PaymentSchema = z.object({
  id: UuidSchema,
  tabId: UuidSchema,
  cashRegisterSessionId: z.string().min(1),
  method: PaymentMethodSchema,
  status: PaymentStatusSchema,
  confirmationMode: PaymentConfirmationModeSchema.optional(),
  payerLabel: z.string().nullable().optional(),
  allocatedItems: z.array(BillSplitItemAllocationSchema).optional(),
  amountCents: z.number().int().positive(),
  receivedCashCents: z.number().int().nonnegative().optional(),
  changeCents: z.number().int().nonnegative().default(0),
  nsuOrTxId: z.string().optional(),
  idempotencyKey: z.string().min(8),
  operatorUserId: z.string().min(1),
  refundedAt: IsoDateTimeSchema.nullable().optional(),
  refundedByUserId: z.string().nullable().optional(),
  refundReason: z.string().nullable().optional(),
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
  'PRINTER_KITCHEN_COLD',
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
  'PENDING',
  'PRINTING',
  'SENDING',
  'PRINTED',
  'FAILED',
  'UNKNOWN_OUTCOME',
  'CANCELLED'
]);
export type PrintJobStatus = z.infer<typeof PrintJobStatusSchema>;

export const PrintJobSchema = z.object({
  id: UuidSchema,
  targetPrinter: PrintJobTargetSchema,
  jobType: PrintJobTypeSchema,
  status: PrintJobStatusSchema,
  referenceEntityType: z.enum(['ORDER', 'TAB', 'PAYMENT', 'CASH_SESSION']),
  referenceEntityId: z.string().min(1),
  payloadText: z.string().min(1),
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().optional(),
  isReprint: z.boolean().optional(),
  copyNumber: z.number().int().positive().optional(),
  reprintAuthorizedByUserId: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema.optional(),
  printedAt: IsoDateTimeSchema.nullable().optional()
});
export type PrintJob = z.infer<typeof PrintJobSchema>;

/**
 * 5.4.1 TURNO DE CAIXA, SANGRIA, SUPRIMENTO E NOTIFICAÇÕES KDS/GARÇOM (SEÇÕES 14, 15, 16, 20)
 */
export const CashRegisterMovementTypeSchema = z.enum([
  'SANGRIA',
  'SUPRIMENTO',
  'AUTHORIZED_OUTFLOW',
  'MANUAL_INFLOW'
]);
export type CashRegisterMovementType = z.infer<typeof CashRegisterMovementTypeSchema>;

export const CashRegisterMovementSchema = z.object({
  id: UuidSchema,
  sessionId: z.string().min(1),
  movementType: CashRegisterMovementTypeSchema,
  amountCents: z.number().int().positive(),
  reason: z.string().min(2),
  createdByUserId: z.string().min(1),
  authorizedByUserId: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema
});
export type CashRegisterMovement = z.infer<typeof CashRegisterMovementSchema>;

export const CashRegisterSessionSchema = z.object({
  id: z.string().min(1),
  openedByUserId: z.string().min(1),
  openedAt: IsoDateTimeSchema,
  openingBalanceCents: z.number().int().nonnegative(),
  closedByUserId: z.string().nullable().optional(),
  closedAt: IsoDateTimeSchema.nullable().optional(),
  expectedCashCents: z.number().int(),
  countedCashCents: z.number().int().nullable().optional(),
  differenceCents: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(['OPEN', 'CLOSED'])
});
export type CashRegisterSession = z.infer<typeof CashRegisterSessionSchema>;

export const OperationalNotificationSchema = z.object({
  id: UuidSchema,
  cursorId: z.number().int().positive().optional(),
  eventType: z.enum([
    'TABLE_OPENED',
    'TABLE_TRANSFERRED',
    'TABLES_JOINED',
    'TAB_ITEM_TRANSFERRED',
    'ORDER_CREATED',
    'ORDER_IN_PREP',
    'ORDER_READY',
    'ORDER_DELIVERED',
    'ORDER_CANCELLED',
    'BILL_REQUESTED',
    'PAYMENT_CONFIRMED',
    'PAYMENT_REFUNDED',
    'TAB_CLOSED',
    'PRINT_FAILED',
    'CASH_MOVEMENT',
    'TABLE_SERVICE_CALL'
  ]),
  targetRole: RoleSchema.nullable().optional(),
  targetUserId: z.string().nullable().optional(),
  tableNumber: z.number().int().positive().nullable().optional(),
  orderId: z.string().nullable().optional(),
  tabId: z.string().nullable().optional(),
  title: z.string(),
  message: z.string(),
  payloadJson: z.string().default('{}'),
  acknowledgedByUserId: z.string().nullable().optional(),
  acknowledgedAt: IsoDateTimeSchema.nullable().optional(),
  createdAt: IsoDateTimeSchema
});
export type OperationalNotification = z.infer<typeof OperationalNotificationSchema>;

export const KdsSlaConfigSchema = z.object({
  warningThresholdMinutes: z.number().int().positive().default(10),
  delayedThresholdMinutes: z.number().int().positive().default(20),
  updatedAt: IsoDateTimeSchema
});
export type KdsSlaConfig = z.infer<typeof KdsSlaConfigSchema>;

/**
 * 5.5 MOVIMENTAÇÃO DE ESTOQUE (StockMovement)
 * Entidade de razão (ledger) imutável para cada entrada, saída por venda, perda ou ajuste de inventário.
 */
export const StockMovementTypeSchema = z.enum([
  'PURCHASE_ENTRY',    // Entrada de mercadorias por nota/compra
  'SALE_DEDUCTION',    // Baixa automática por item ou ingrediente vendido
  'WASTE_OR_LOSS',     // Perdas, quebras ou desperdícios
  'INVENTORY_ADJUST',  // Ajuste manual autorizado de inventário
  'INTERNAL_USE',      // Consumo interno
  'RETURN_ENTRY',      // Devolução de mercadoria
  'REVERSAL_ENTRY'     // Estorno auditável de movimentação / cancelamento de pedido
]);
export type StockMovementType = z.infer<typeof StockMovementTypeSchema>;

export const StockMovementSchema = z.object({
  id: UuidSchema,
  idempotencyKey: z.string().optional(),
  productId: z.string().min(1),
  productName: z.string().min(1),
  movementType: StockMovementTypeSchema,
  quantityDelta: z.number(), // Positivo para entrada/estorno, negativo para saída
  balanceAfter: z.number(),
  unitCostCents: z.number().int().nonnegative().optional(),
  originChannel: z.string().optional(),
  referenceEntityType: z.enum(['ORDER', 'PURCHASE_INVOICE', 'MANUAL_AUDIT', 'REVERSAL']).optional(),
  referenceEntityId: z.string().optional(),
  reversedByMovementId: z.string().nullable().optional(),
  reason: z.string().min(2),
  createdByUserId: z.string().min(1),
  createdAt: IsoDateTimeSchema
});
export type StockMovement = z.infer<typeof StockMovementSchema>;

// ============================================================================
// 6. HOTELARIA (HOTEL AUTO POSTO MILLA — PMS INTEGRADO AO RESTAURANTE/BAR)
// ============================================================================

// 6.1 Status Operacionais Independentes (Ocupação, Governança/Limpeza e Manutenção)
export const RoomOccupancyStatusSchema = z.enum([
  'LIVRE',
  'RESERVADO',
  'OCUPADO',
  'BLOQUEADO'
]);
export type RoomOccupancyStatus = z.infer<typeof RoomOccupancyStatusSchema>;

export const RoomHousekeepingStatusSchema = z.enum([
  'LIMPO',
  'SUJO',
  'EM_LIMPEZA',
  'INSPECAO_PENDENTE'
]);
export type RoomHousekeepingStatus = z.infer<typeof RoomHousekeepingStatusSchema>;

export const RoomMaintenanceStatusSchema = z.enum([
  'DISPONIVEL',
  'EM_MANUTENCAO',
  'INTERDITADO'
]);
export type RoomMaintenanceStatus = z.infer<typeof RoomMaintenanceStatusSchema>;

export const HotelRoomCategorySchema = z.enum([
  'STANDARD_SINGLE',
  'STANDARD_DOUBLE',
  'LUXO_CASAL',
  'TRIPLO',
  'SUITE_MASTER',
  'FAMILIAR'
]);
export type HotelRoomCategory = z.infer<typeof HotelRoomCategorySchema>;

export const HotelRoomStatusSchema = z.enum([
  'AVAILABLE',
  'OCCUPIED',
  'DIRTY_CLEANING',
  'MAINTENANCE',
  'RESERVED'
]);
export type HotelRoomStatus = z.infer<typeof HotelRoomStatusSchema>;

export const RoomCommercialStatusSchema = z.enum([
  'OPERACIONAL',
  'EM_CONSTRUCAO',
  'DESATIVADO'
]);
export type RoomCommercialStatus = z.infer<typeof RoomCommercialStatusSchema>;

export const HotelRoomSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1), // Ex: "101", "102", "201"
  name: z.string().default(''),
  floorSector: z.string().default('Térreo'),
  category: HotelRoomCategorySchema.default('STANDARD_DOUBLE'),
  maxGuests: z.number().int().min(1).default(2),
  bedCount: z.number().int().min(1).default(1),
  bedConfiguration: z.string().default('1 Cama Casal'),
  description: z.string().default(''),
  amenities: z.array(z.string()).default([]),
  photos: z.array(z.string()).default([]),
  dailyRateCents: z.number().int().positive(),
  status: HotelRoomStatusSchema.default('AVAILABLE'), // Compatibilidade
  occupancyStatus: RoomOccupancyStatusSchema.default('LIVRE'),
  housekeepingStatus: RoomHousekeepingStatusSchema.default('LIMPO'),
  maintenanceStatus: RoomMaintenanceStatusSchema.default('DISPONIVEL'),
  commercialStatus: RoomCommercialStatusSchema.default('OPERACIONAL'),
  active: z.boolean().default(true),
  currentGuestName: z.string().nullable().optional(),
  currentGuestId: z.string().nullable().optional(),
  activeTabId: UuidSchema.nullable().optional(),
  activeStayId: z.string().nullable().optional(),
  internalNotes: z.string().default(''),
  createdAt: IsoDateTimeSchema.optional(),
  updatedAt: IsoDateTimeSchema
});
export type HotelRoom = z.infer<typeof HotelRoomSchema>;

// 6.2 Cadastro Seguro de Hóspedes (LGPD e Auditoria)
export const HotelGuestDocumentTypeSchema = z.enum(['CPF', 'RG', 'PASSAPORTE', 'OUTRO']);
export type HotelGuestDocumentType = z.infer<typeof HotelGuestDocumentTypeSchema>;

export const HotelGuestAddressSchema = z.object({
  street: z.string().default(''),
  number: z.string().default(''),
  neighborhood: z.string().default(''),
  city: z.string().default(''),
  state: z.string().default(''),
  postalCode: z.string().default('')
});
export type HotelGuestAddress = z.infer<typeof HotelGuestAddressSchema>;

export const HotelGuestSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().min(2),
  documentType: HotelGuestDocumentTypeSchema.default('CPF'),
  documentNumber: z.string().min(3),
  phone: z.string().default(''),
  email: z.string().default(''),
  nationality: z.string().default('Brasileira'),
  birthDate: z.string().nullable().optional(),
  address: HotelGuestAddressSchema.optional().default(() => HotelGuestAddressSchema.parse({})),
  notes: z.string().default(''),
  totalStaysCount: z.number().int().nonnegative().default(0),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});
export type HotelGuest = z.infer<typeof HotelGuestSchema>;

// 6.3 Reservas com Proteção de Sobreposição de Datas
export const HotelReservationStatusSchema = z.enum([
  'PENDENTE',
  'CONFIRMADA',
  'CHECK_IN_REALIZADO',
  'CANCELADA',
  'NO_SHOW',
  'CONCLUIDA'
]);
export type HotelReservationStatus = z.infer<typeof HotelReservationStatusSchema>;

export const HotelReservationSourceSchema = z.enum([
  'BALCAO',
  'WHATSAPP',
  'TELEFONE',
  'BOOKING',
  'SITE',
  'OUTRO'
]);
export type HotelReservationSource = z.infer<typeof HotelReservationSourceSchema>;

export const HotelReservationSchema = z.object({
  id: z.string().min(1),
  reservationCode: z.string().min(1),
  guestId: z.string().min(1),
  guestName: z.string().min(2),
  guestPhone: z.string().default(''),
  roomId: z.string().nullable().optional(),
  roomNumber: z.string().min(1),
  roomCategory: HotelRoomCategorySchema.default('STANDARD_DOUBLE'),
  guestsCount: z.number().int().min(1).default(1),
  checkInDate: z.string().min(10),  // YYYY-MM-DD
  checkOutDate: z.string().min(10), // YYYY-MM-DD
  dailyRateCents: z.number().int().positive(),
  estimatedTotalCents: z.number().int().positive(),
  depositCents: z.number().int().nonnegative().default(0),
  depositPaid: z.boolean().default(false),
  sourceChannel: HotelReservationSourceSchema.default('BALCAO'),
  status: HotelReservationStatusSchema.default('CONFIRMADA'),
  cancellationReason: z.string().nullable().optional(),
  cancelledAt: IsoDateTimeSchema.nullable().optional(),
  cancelledByUserId: z.string().nullable().optional(),
  notes: z.string().default(''),
  createdByUserId: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});
export type HotelReservation = z.infer<typeof HotelReservationSchema>;

// 6.4 Hospedagens / Estadias Ativas (Check-In e Check-Out)
export const HotelStayStatusSchema = z.enum(['ACTIVE', 'CHECKED_OUT', 'CANCELLED']);
export type HotelStayStatus = z.infer<typeof HotelStayStatusSchema>;

export const HotelCompanionSchema = z.object({
  name: z.string().min(2),
  document: z.string().optional()
});
export type HotelCompanion = z.infer<typeof HotelCompanionSchema>;

export const HotelStaySchema = z.object({
  id: z.string().min(1),
  stayCode: z.string().min(1),
  reservationId: z.string().nullable().optional(),
  roomId: z.string().min(1),
  roomNumber: z.string().min(1),
  guestId: z.string().min(1),
  guestName: z.string().min(2),
  guestDocument: z.string().min(3),
  companions: z.array(HotelCompanionSchema).default([]),
  checkInAt: IsoDateTimeSchema,
  checkOutScheduledAt: IsoDateTimeSchema,
  checkOutActualAt: IsoDateTimeSchema.nullable().optional(),
  dailyRateCents: z.number().int().positive(),
  nightsCount: z.number().int().min(1).default(1),
  earlyCheckinCents: z.number().int().nonnegative().default(0),
  lateCheckoutCents: z.number().int().nonnegative().default(0),
  extraGuestsCents: z.number().int().nonnegative().default(0),
  discountCents: z.number().int().nonnegative().default(0),
  discountReason: z.string().nullable().optional(),
  tabId: UuidSchema,
  status: HotelStayStatusSchema.default('ACTIVE'),
  openedByUserId: z.string().min(1),
  closedByUserId: z.string().nullable().optional(),
  notes: z.string().default(''),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});
export type HotelStay = z.infer<typeof HotelStaySchema>;

// 6.5 Extrato / Folio do Quarto (Lançamentos Auditáveis de Diárias, Bar, Restaurante, Frigobar, Serviços e Pagamentos)
export const HotelFolioEntryTypeSchema = z.enum([
  'ROOM_RATE',
  'RESTAURANT_ORDER',
  'BAR_ORDER',
  'MINIBAR',
  'SERVICE',
  'DISCOUNT',
  'ADVANCE_PAYMENT',
  'PAYMENT',
  'ADJUSTMENT',
  'REFUND'
]);
export type HotelFolioEntryType = z.infer<typeof HotelFolioEntryTypeSchema>;

export const HotelFolioEntrySchema = z.object({
  id: z.string().min(1),
  stayId: z.string().min(1),
  tabId: UuidSchema,
  roomNumber: z.string().min(1),
  entryType: HotelFolioEntryTypeSchema,
  description: z.string().min(1),
  amountCents: z.number().int(), // Positivo = Débito/Cobrança; Negativo = Crédito/Pagamento/Desconto
  sourceReferenceType: z.string().nullable().optional(),
  sourceReferenceId: z.string().nullable().optional(),
  sourceDetailsJson: z.string().nullable().optional(),
  operatorUserId: z.string().min(1),
  operatorName: z.string().min(1),
  createdAt: IsoDateTimeSchema
});
export type HotelFolioEntry = z.infer<typeof HotelFolioEntrySchema>;

// 6.6 Frigobar por Quarto
export const HotelMinibarItemSchema = z.object({
  id: z.string().min(1),
  roomNumber: z.string().min(1),
  productId: z.string().min(1),
  productName: z.string().min(1),
  initialQuantity: z.number().int().nonnegative().default(0),
  currentQuantity: z.number().int().nonnegative().default(0),
  unitPriceCents: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema
});
export type HotelMinibarItem = z.infer<typeof HotelMinibarItemSchema>;

export const HotelMinibarMovementTypeSchema = z.enum([
  'CONSUMPTION',
  'RESTOCK',
  'LOSS',
  'AUDIT_CORRECTION'
]);
export type HotelMinibarMovementType = z.infer<typeof HotelMinibarMovementTypeSchema>;

export const HotelMinibarConsumptionSchema = z.object({
  id: z.string().min(1),
  stayId: z.string().min(1),
  roomNumber: z.string().min(1),
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  movementType: HotelMinibarMovementTypeSchema.default('CONSUMPTION'),
  folioEntryId: z.string().nullable().optional(),
  recordedByUserId: z.string().min(1),
  createdAt: IsoDateTimeSchema
});
export type HotelMinibarConsumption = z.infer<typeof HotelMinibarConsumptionSchema>;

// 6.7 Serviços Adicionais (Lavanderia, Café, Estacionamento, etc.)
export const HotelServiceCategorySchema = z.enum([
  'LAVANDERIA',
  'CAFE_MANHA',
  'ESTACIONAMENTO',
  'CAMA_EXTRA',
  'GERAL'
]);
export type HotelServiceCategory = z.infer<typeof HotelServiceCategorySchema>;

export const HotelServiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2),
  category: HotelServiceCategorySchema.default('GERAL'),
  defaultPriceCents: z.number().int().nonnegative(),
  active: z.boolean().default(true),
  createdAt: IsoDateTimeSchema
});
export type HotelService = z.infer<typeof HotelServiceSchema>;

export const HotelServiceOrderSchema = z.object({
  id: z.string().min(1),
  stayId: z.string().min(1),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  unitPriceCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  folioEntryId: z.string().nullable().optional(),
  status: z.string().default('CONFIRMED'),
  operatorUserId: z.string().min(1),
  createdAt: IsoDateTimeSchema
});
export type HotelServiceOrder = z.infer<typeof HotelServiceOrderSchema>;

// 6.8 Governança e Limpeza
export const HotelHousekeepingActionSchema = z.enum([
  'SET_DIRTY',
  'START_CLEANING',
  'FINISH_CLEANING',
  'REQUEST_INSPECTION',
  'APPROVE_INSPECTION',
  'REJECT_INSPECTION'
]);
export type HotelHousekeepingAction = z.infer<typeof HotelHousekeepingActionSchema>;

export const HotelHousekeepingLogSchema = z.object({
  id: z.string().min(1),
  roomNumber: z.string().min(1),
  action: HotelHousekeepingActionSchema,
  previousStatus: z.string(),
  newStatus: z.string(),
  attendantUserId: z.string().min(1),
  attendantName: z.string().min(1),
  notes: z.string().default(''),
  createdAt: IsoDateTimeSchema
});
export type HotelHousekeepingLog = z.infer<typeof HotelHousekeepingLogSchema>;

// 6.9 Manutenção de Apartamentos
export const HotelMaintenancePrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
export type HotelMaintenancePriority = z.infer<typeof HotelMaintenancePrioritySchema>;

export const HotelMaintenanceStatusSchema = z.enum(['EM_MANUTENCAO', 'INTERDITADO', 'RESOLVED']);
export type HotelMaintenanceStatus = z.infer<typeof HotelMaintenanceStatusSchema>;

export const HotelMaintenanceRecordSchema = z.object({
  id: z.string().min(1),
  roomNumber: z.string().min(1),
  issueDescription: z.string().min(2),
  priority: HotelMaintenancePrioritySchema.default('NORMAL'),
  maintenanceStatus: HotelMaintenanceStatusSchema.default('EM_MANUTENCAO'),
  reportedByUserId: z.string().min(1),
  reportedByName: z.string().min(1),
  assignedTo: z.string().default(''),
  resolutionNotes: z.string().default(''),
  resolvedByUserId: z.string().nullable().optional(),
  resolvedAt: IsoDateTimeSchema.nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});
export type HotelMaintenanceRecord = z.infer<typeof HotelMaintenanceRecordSchema>;

// 6.10 Métricas do Dashboard Hoteleiro
export const HotelDashboardMetricsSchema = z.object({
  totalRooms: z.number().int().nonnegative(),
  occupiedRooms: z.number().int().nonnegative(),
  availableRooms: z.number().int().nonnegative(),
  dirtyCleaningRooms: z.number().int().nonnegative(),
  maintenanceRooms: z.number().int().nonnegative(),
  blockedRooms: z.number().int().nonnegative(),
  underConstructionRooms: z.number().int().nonnegative().default(0),
  occupancyRatePercent: z.number().nonnegative(),
  adrCents: z.number().int().nonnegative(),
  revparCents: z.number().int().nonnegative(),
  expectedCheckInsToday: z.number().int().nonnegative(),
  expectedCheckOutsToday: z.number().int().nonnegative(),
  totalFolioRevenueCents: z.number().int().nonnegative(),
  totalPaymentsReceivedCents: z.number().int().nonnegative(),
  totalBalancePendingCents: z.number().int().nonnegative()
});
export type HotelDashboardMetrics = z.infer<typeof HotelDashboardMetricsSchema>;

/**
 * Calcula a quantidade de diárias inteiras entre check-in e check-out (mínimo 1 diária).
 * Regra: entrada inclusiva, saída exclusiva.
 */
export function calculateNightsCount(checkInDate: string, checkOutDate: string): number {
  const dIn = new Date(checkInDate.slice(0, 10) + 'T00:00:00.000Z');
  const dOut = new Date(checkOutDate.slice(0, 10) + 'T00:00:00.000Z');
  const diffMs = dOut.getTime() - dIn.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, days);
}

/**
 * Valida sobreposição entre dois intervalos com entrada inclusiva e saída exclusiva: [inA, outA) e [inB, outB).
 * Retorna true se houver sobreposição (conflito).
 */
export function areDateIntervalsOverlapping(startA: string, endA: string, startB: string, endB: string): boolean {
  const sA = startA.slice(0, 10);
  const eA = endA.slice(0, 10);
  const sB = startB.slice(0, 10);
  const eB = endB.slice(0, 10);
  return sA < eB && eA > sB;
}

/**
 * Totalizador financeiro de extrato de quarto (Folio).
 * Débitos = diárias, consumos restaurante/bar, frigobar, serviços adicionais.
 * Créditos = adiantamentos, pagamentos, descontos e estornos.
 */
export function calculateStayFolioTotals(entries: HotelFolioEntry[]): {
  totalChargesCents: number;
  totalPaymentsCents: number;
  balanceCents: number;
} {
  let totalChargesCents = 0;
  let totalPaymentsCents = 0;

  for (const entry of entries) {
    if (entry.amountCents > 0) {
      totalChargesCents += entry.amountCents;
    } else {
      totalPaymentsCents += Math.abs(entry.amountCents);
    }
  }

  const balanceCents = totalChargesCents - totalPaymentsCents;
  return {
    totalChargesCents,
    totalPaymentsCents,
    balanceCents
  };
}

/** Complete response consumed by the hotel statement and checkout screen. */
export const HotelFolioViewSchema = z.object({
  stay: HotelStaySchema.pick({id:true,tabId:true,roomNumber:true,status:true}),
  folioTab: TabSchema.pick({id:true,type:true,status:true}),
  entries: z.array(HotelFolioEntrySchema),
  totals: z.object({totalChargesCents:z.number().int().nonnegative(),totalPaymentsCents:z.number().int().nonnegative(),balanceCents:z.number().int()})
});
export type HotelFolioView = z.infer<typeof HotelFolioViewSchema>;
export const HotelFolioPaymentDraftSchema=z.object({stayId:z.string().min(1),amountCents:z.number().int().positive(),paymentMethod:PaymentMethodSchema,idempotencyKey:z.string().min(12)});
export type HotelFolioPaymentDraft=z.infer<typeof HotelFolioPaymentDraftSchema>;

// ============================================================================
// 7. SINCRONIZAÇÃO BIDIRECIONAL LOCAL ↔ VPS (OUTBOX & INBOX COM IDEMPOTÊNCIA)
// ============================================================================

export const SyncEntityTypeSchema = z.enum([
  'TAB',
  'ORDER',
  'PAYMENT',
  'STOCK_MOVEMENT',
  'CATALOG_CATEGORY',
  'CATALOG_PRODUCT',
  'PRODUCT_RECIPE',
  'HOTEL_ROOM',
  'HOTEL_GUEST',
  'HOTEL_RESERVATION',
  'HOTEL_STAY',
  'HOTEL_FOLIO_ENTRY',
  'HOTEL_MINIBAR',
  'HOTEL_SERVICE',
  'HOTEL_MAINTENANCE',
  'FISCAL_CONFIG',
  // Etapa 6: Delivery e Gestão Financeira
  'DELIVERY_ORDER',
  'DELIVERY_CUSTOMER',
  'DELIVERY_COURIER',
  'DELIVERY_ZONE',
  'DELIVERY_SETTLEMENT',
  'FINANCIAL_CATEGORY',
  'COST_CENTER',
  'FINANCIAL_ACCOUNT',
  'ACCOUNTS_RECEIVABLE',
  'ACCOUNTS_PAYABLE',
  'FINANCIAL_TRANSACTION',
  'FINANCIAL_TRANSFER',
  'SUPPLIER',
  'PURCHASE_INVOICE',
  'ACCOUNT_RECONCILIATION'
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

const ALL_CHANNELS: SalesChannel[] = ['DINE_IN', 'COUNTER_PDV', 'QR_TABLE', 'DELIVERY', 'PICKUP', 'HOTEL_ROOM'];

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

  // --- ESPECIAIS & CHURRASCO (CRIADOS EXCLUSIVAMENTE PARA CENÁRIOS DE TESTE OPERACIONAL) ---
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
    dataSource: 'TEST_ONLY',
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
    dataSource: 'TEST_ONLY',
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  },

  // --- BEBIDAS & REFRIGERANTES (CENÁRIO DE TESTE DE ESTOQUE 50 UN -> 48 UN) ---
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
    dataSource: 'TEST_ONLY',
    active: true,
    updatedAt: '2026-11-03T00:00:00.000Z'
  }
];

export function resolveChannelPriceCents(product: CatalogProduct, channel: SalesChannel): number {
  const custom = product.channelPricesCents?.[channel];
  if (typeof custom === 'number' && custom >= 0) {
    return custom;
  }
  return product.priceCents;
}

export function calculateGrossMarginPercent(priceCents: number, costPriceCents?: number): number {
  if (priceCents <= 0) return 0;
  const cost = costPriceCents ?? 0;
  return Number((((priceCents - cost) / priceCents) * 100).toFixed(2));
}

// ============================================================================
// 10. FUNÇÕES PURAS DE DOMÍNIO E CÁLCULO FINANCEIRO (SEM PONTO FLUTUANTE)
// ============================================================================

export function formatBrlCents(cents: number): string {
  const reais = new Intl.NumberFormat('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2}).format(cents / 100);
  return `R$ ${reais}`;
}

export function evaluateKdsOrderSla(
  createdAtIso: string,
  nowMs: number = Date.now(),
  config?: { warningThresholdMinutes: number; delayedThresholdMinutes: number }
): {
  elapsedMinutes: number;
  slaStatus: 'NORMAL' | 'WARNING' | 'DELAYED';
} {
  const createdMs = Date.parse(createdAtIso);
  const elapsedMinutes = Number.isNaN(createdMs)
    ? 0
    : Math.max(0, Math.floor((nowMs - createdMs) / 60000));
  const warnMin = config?.warningThresholdMinutes ?? 10;
  const delayMin = config?.delayedThresholdMinutes ?? 20;
  const slaStatus =
    elapsedMinutes >= delayMin
      ? 'DELAYED'
      : elapsedMinutes >= warnMin
        ? 'WARNING'
        : 'NORMAL';
  return { elapsedMinutes, slaStatus };
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
  const activeOrders = params.orders.filter((o) => o.status !== 'CANCELLED' && o.status !== 'PENDING_APPROVAL');
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

export function buildEscPosProductionTicket(
  order: Order,
  tabCode?: string,
  options?: { isReprint?: boolean; copyNumber?: number }
): string {
  const lines: string[] = [
    '================================================',
    '            DECK 26 - PRODUCAO LOCAL            ',
    '================================================'
  ];

  if (options?.isReprint || (options?.copyNumber && options.copyNumber > 1)) {
    lines.push(`*** 2a VIA / REIMPRESSAO AUTORIZADA (COPIA #${options?.copyNumber ?? 2}) ***`);
    lines.push('------------------------------------------------');
  }

  lines.push(
    `PEDIDO: ${order.id.slice(0, 8).toUpperCase()}   CANAL: ${order.channel}`,
    `COMANDA/MESA: ${tabCode ?? (order.tableNumber ? `MESA ${order.tableNumber}` : 'BALCAO')}`,
    `GARCOM: ${order.waiterName ?? 'OPERADOR PDV'}`,
    `HORA: ${new Date(order.createdAt).toLocaleTimeString('pt-BR')}`,
    '------------------------------------------------'
  );

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


// ============================================================================
// 12. ETAPA 6 — DELIVERY PRÓPRIO COMPLETO
// ============================================================================

export const DeliveryOrderStatusSchema = z.enum([
  'NOVO',
  'AGUARDANDO_CONFIRMACAO',
  'CONFIRMADO',
  'EM_PREPARO',
  'PRONTO',
  'AGUARDANDO_ENTREGADOR',
  'SAIU_PARA_ENTREGA',
  'ENTREGUE',
  'CANCELADO'
]);
export type DeliveryOrderStatus = z.infer<typeof DeliveryOrderStatusSchema>;

export const DeliveryTypeSchema = z.enum(['DELIVERY', 'TAKEOUT']);
export type DeliveryType = z.infer<typeof DeliveryTypeSchema>;

export const DeliveryOriginSchema = z.enum([
  'SITE_WEB',
  'PHONE',
  'WHATSAPP_MANUAL',
  'COUNTER'
]);
export type DeliveryOrigin = z.infer<typeof DeliveryOriginSchema>;

export const DeliveryCourierStatusSchema = z.enum([
  'DISPONIVEL',
  'EM_ENTREGA',
  'INDISPONIVEL'
]);
export type DeliveryCourierStatus = z.infer<typeof DeliveryCourierStatusSchema>;

export const DeliveryZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  feeCents: z.number().int().nonnegative(),
  minimumOrderCents: z.number().int().nonnegative().default(0),
  estimatedMinutes: z.number().int().positive().default(40),
  active: z.boolean().default(true)
});
export type DeliveryZone = z.infer<typeof DeliveryZoneSchema>;

export const DeliveryCourierSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().min(1),
  vehicleType: z.enum(['MOTO', 'BICICLETA', 'CARRO', 'OUTRO']).default('MOTO'),
  vehiclePlate: z.string().nullable().optional(),
  feePerDeliveryCents: z.number().int().nonnegative().default(500),
  status: DeliveryCourierStatusSchema.default('DISPONIVEL'),
  active: z.boolean().default(true)
});
export type DeliveryCourier = z.infer<typeof DeliveryCourierSchema>;

export const DeliveryAddressSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  street: z.string().min(1),
  number: z.string().min(1),
  complement: z.string().nullable().optional(),
  neighborhood: z.string().min(1),
  city: z.string().default('Santa Inês'),
  reference: z.string().nullable().optional(),
  deliveryZoneId: z.string().nullable().optional(),
  isDefault: z.boolean().default(false)
});
export type DeliveryAddress = z.infer<typeof DeliveryAddressSchema>;

export const DeliveryCustomerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().min(8),
  document: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  addresses: z.array(DeliveryAddressSchema).default([]),
  notes: z.string().nullable().optional(),
  totalOrders: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type DeliveryCustomer = z.infer<typeof DeliveryCustomerSchema>;

export const DeliveryOrderSchema = z.object({
  id: z.string().min(1),
  orderNumber: z.number().int().positive(),
  orderId: z.string().min(1),
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  customerPhone: z.string().min(1),
  deliveryType: DeliveryTypeSchema,
  origin: DeliveryOriginSchema,
  status: DeliveryOrderStatusSchema,
  deliveryAddress: DeliveryAddressSchema.nullable().optional(),
  deliveryZoneId: z.string().nullable().optional(),
  deliveryFeeCents: z.number().int().nonnegative().default(0),
  itemsSubtotalCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative().default(0),
  totalCents: z.number().int().nonnegative(),
  paymentMethodDeclared: PaymentMethodSchema,
  paymentStatus: z.enum(['PENDING', 'PAID', 'REFUNDED']).default('PENDING'),
  changeForCents: z.number().int().nullable().optional(),
  courierId: z.string().nullable().optional(),
  courierName: z.string().nullable().optional(),
  courierFeeCents: z.number().int().nonnegative().default(0),
  estimatedDeliveryAt: z.string().nullable().optional(),
  dispatchedAt: z.string().nullable().optional(),
  deliveredAt: z.string().nullable().optional(),
  canceledAt: z.string().nullable().optional(),
  cancelReason: z.string().nullable().optional(),
  settlementId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type DeliveryOrder = z.infer<typeof DeliveryOrderSchema>;

export const DeliverySettlementSchema = z.object({
  id: z.string().min(1),
  courierId: z.string().min(1),
  courierName: z.string().min(1),
  shiftId: z.string().nullable().optional(),
  financialAccountId: z.string().min(1),
  deliveryOrderIds: z.array(z.string()),
  totalDeliveries: z.number().int().nonnegative(),
  totalCashCollectedCents: z.number().int().nonnegative(),
  totalCourierFeesCents: z.number().int().nonnegative(),
  netAmountSettledCents: z.number().int(),
  status: z.enum(['PENDING', 'SETTLED']).default('SETTLED'),
  settledAt: z.string(),
  settledByStaffId: z.string().min(1),
  notes: z.string().nullable().optional()
});
export type DeliverySettlement = z.infer<typeof DeliverySettlementSchema>;

// ============================================================================
// 13. ETAPA 6 — GESTÃO FINANCEIRA INTEGRADA, FLUXO DE CAIXA E DRE
// ============================================================================

export const FinancialCategoryTypeSchema = z.enum([
  'REVENUE',          // 1. Receitas operacionais
  'DEDUCTION',        // 2. Deduções da receita bruta (descontos, estornos)
  'COST_DIRECT',      // 3. Custos diretos / CMV (consumo de estoque Kardex)
  'EXPENSE_OP',       // 4. Despesas operacionais (fixas e variáveis)
  'FINANCIAL_RESULT'  // 5. Resultado financeiro (juros, tarifas de cartão)
]);
export type FinancialCategoryType = z.infer<typeof FinancialCategoryTypeSchema>;

export const FinancialCategorySchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  type: FinancialCategoryTypeSchema,
  parentId: z.string().nullable().optional(),
  active: z.boolean().default(true)
});
export type FinancialCategory = z.infer<typeof FinancialCategorySchema>;

export const CostCenterSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  active: z.boolean().default(true)
});
export type CostCenter = z.infer<typeof CostCenterSchema>;

export const FinancialAccountTypeSchema = z.enum([
  'CASH_DRAWER',    // Gaveta de caixa do turno
  'BANK_ACCOUNT',  // Conta corrente bancária
  'PIX_KEY',       // Chave PIX direta PJ
  'COURIER_WALLET', // Carteira transitória de motoboy
  'SAFE_DEPOSIT'   // Cofre geral da empresa / tesouraria
]);
export type FinancialAccountType = z.infer<typeof FinancialAccountTypeSchema>;

export const FinancialAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: FinancialAccountTypeSchema,
  bankName: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  pixKey: z.string().nullable().optional(),
  currentBalanceCents: z.number().int().default(0),
  initialBalanceCents: z.number().int().default(0),
  active: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type FinancialAccount = z.infer<typeof FinancialAccountSchema>;

export const SupplierSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tradeName: z.string().nullable().optional(),
  document: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  active: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Supplier = z.infer<typeof SupplierSchema>;

export const AccountsReceivableStatusSchema = z.enum([
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELED'
]);
export type AccountsReceivableStatus = z.infer<typeof AccountsReceivableStatusSchema>;

export const AccountsReceivableOriginSchema = z.enum([
  'TAB',
  'DELIVERY',
  'HOTEL_FOLIO',
  'DIRECT_SALE',
  'MANUAL'
]);
export type AccountsReceivableOrigin = z.infer<typeof AccountsReceivableOriginSchema>;

export const AccountsReceivableSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  origin: AccountsReceivableOriginSchema,
  originReferenceId: z.string().nullable().optional(),
  costCenterId: z.string().min(1),
  categoryId: z.string().min(1),
  totalAmountCents: z.number().int().positive(),
  paidAmountCents: z.number().int().nonnegative().default(0),
  remainingAmountCents: z.number().int().nonnegative(),
  accrualDate: z.string(),
  dueDate: z.string(),
  status: AccountsReceivableStatusSchema.default('PENDING'),
  customerName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type AccountsReceivable = z.infer<typeof AccountsReceivableSchema>;

export const AccountsPayableStatusSchema = z.enum([
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELED'
]);
export type AccountsPayableStatus = z.infer<typeof AccountsPayableStatusSchema>;

export const AccountsPayableOriginSchema = z.enum([
  'PURCHASE_INVOICE',
  'OPERATIONAL_EXPENSE',
  'PAYROLL',
  'MAINTENANCE',
  'UTILITY',
  'MANUAL'
]);
export type AccountsPayableOrigin = z.infer<typeof AccountsPayableOriginSchema>;

export const AccountsPayableSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  origin: AccountsPayableOriginSchema,
  originReferenceId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  supplierName: z.string().nullable().optional(),
  costCenterId: z.string().min(1),
  categoryId: z.string().min(1),
  totalAmountCents: z.number().int().positive(),
  paidAmountCents: z.number().int().nonnegative().default(0),
  remainingAmountCents: z.number().int().nonnegative(),
  accrualDate: z.string(),
  dueDate: z.string(),
  status: AccountsPayableStatusSchema.default('PENDING'),
  invoiceNumber: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type AccountsPayable = z.infer<typeof AccountsPayableSchema>;

export const FinancialTransactionTypeSchema = z.enum([
  'INCOME',
  'EXPENSE',
  'INTERNAL_TRANSFER_IN',
  'INTERNAL_TRANSFER_OUT'
]);
export type FinancialTransactionType = z.infer<typeof FinancialTransactionTypeSchema>;

export const FinancialTransactionSchema = z.object({
  id: z.string().min(1),
  financialAccountId: z.string().min(1),
  type: FinancialTransactionTypeSchema,
  categoryId: z.string().nullable().optional(),
  costCenterId: z.string().nullable().optional(),
  amountCents: z.number().int().positive(),
  paymentMethod: PaymentMethodSchema,
  referenceType: z.enum([
    'ACCOUNTS_RECEIVABLE',
    'ACCOUNTS_PAYABLE',
    'POS_SALE',
    'DELIVERY_SETTLEMENT',
    'TRANSFER',
    'MANUAL'
  ]),
  referenceId: z.string().nullable().optional(),
  description: z.string().min(1),
  accrualDate: z.string(),
  settlementDate: z.string(),
  registeredByStaffId: z.string().min(1),
  createdAt: z.string()
});
export type FinancialTransaction = z.infer<typeof FinancialTransactionSchema>;

export const FinancialTransferSchema = z.object({
  id: z.string().min(1),
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amountCents: z.number().int().positive(),
  reason: z.string().min(1),
  registeredByStaffId: z.string().min(1),
  transferredAt: z.string(),
  createdAt: z.string()
});
export type FinancialTransfer = z.infer<typeof FinancialTransferSchema>;

export const PurchaseInvoiceItemSchema = z.object({
  id: z.string().min(1),
  invoiceId: z.string().min(1),
  productId: z.string().min(1),
  productName: z.string().min(1),
  unitOfMeasure: z.string().default('UN'),
  quantity: z.number().positive(),
  unitCostCents: z.number().int().nonnegative(),
  totalCostCents: z.number().int().nonnegative()
});
export type PurchaseInvoiceItem = z.infer<typeof PurchaseInvoiceItemSchema>;

export const PurchaseInvoiceSchema = z.object({
  id: z.string().min(1),
  invoiceNumber: z.string().min(1),
  supplierId: z.string().min(1),
  supplierName: z.string().min(1),
  costCenterId: z.string().min(1),
  issueDate: z.string(),
  totalAmountCents: z.number().int().nonnegative(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELED']).default('CONFIRMED'),
  accountsPayableId: z.string().nullable().optional(),
  stockMoved: z.boolean().default(true),
  items: z.array(PurchaseInvoiceItemSchema).default([]),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type PurchaseInvoice = z.infer<typeof PurchaseInvoiceSchema>;

export const AccountReconciliationSchema = z.object({
  id: z.string().min(1),
  financialAccountId: z.string().min(1),
  reconciliationDate: z.string(),
  systemCalculatedBalanceCents: z.number().int(),
  declaredPhysicalBalanceCents: z.number().int(),
  differenceCents: z.number().int(),
  adjustmentTransactionId: z.string().nullable().optional(),
  status: z.enum(['BALANCED', 'DISCREPANCY_ADJUSTED', 'DISCREPANCY_PENDING']),
  reconciledByStaffId: z.string().min(1),
  notes: z.string().nullable().optional(),
  createdAt: z.string()
});
export type AccountReconciliation = z.infer<typeof AccountReconciliationSchema>;

export const DreStatementSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  costCenterId: z.string().nullable().optional(),
  grossRevenueCents: z.number().int(),
  deductionsCents: z.number().int(),
  netRevenueCents: z.number().int(),
  directCostsCents: z.number().int(), // CMV
  grossProfitCents: z.number().int(),
  grossMarginPercent: z.number(),
  operationalExpensesCents: z.number().int(),
  operatingResultCents: z.number().int(), // EBITDA
  operatingMarginPercent: z.number(),
  financialResultCents: z.number().int(),
  netProfitCents: z.number().int(),
  netMarginPercent: z.number(),
  revenueByCostCenter: z.record(z.string(), z.number().int()),
  expensesByCategory: z.record(z.string(), z.number().int())
});
export type DreStatement = z.infer<typeof DreStatementSchema>;

export const CashFlowRealizedSummarySchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  accountId: z.string().nullable().optional(),
  openingBalanceCents: z.number().int(),
  totalInflowsCents: z.number().int(),
  totalOutflowsCents: z.number().int(),
  netCashFlowCents: z.number().int(),
  closingBalanceCents: z.number().int(),
  inflowsByCategory: z.record(z.string(), z.number().int()),
  outflowsByCategory: z.record(z.string(), z.number().int()),
  inflowsByPaymentMethod: z.record(z.string(), z.number().int())
});
export type CashFlowRealizedSummary = z.infer<typeof CashFlowRealizedSummarySchema>;

export const DailyCashFlowProjectionSchema = z.object({
  date: z.string(),
  expectedInflowsCents: z.number().int(),
  expectedOutflowsCents: z.number().int(),
  projectedBalanceCents: z.number().int()
});
export type DailyCashFlowProjection = z.infer<typeof DailyCashFlowProjectionSchema>;

export const CashFlowProjectedSummarySchema = z.object({
  asOfDate: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  currentBalanceCents: z.number().int(),
  projectedReceivablesCents: z.number().int(),
  projectedPayablesCents: z.number().int(),
  projectedNetCashFlowCents: z.number().int(),
  projectedFinalBalanceCents: z.number().int(),
  dailyProjections: z.array(DailyCashFlowProjectionSchema)
});
export type CashFlowProjectedSummary = z.infer<typeof CashFlowProjectedSummarySchema>;

export const ExecutiveDashboardMetricsSchema = z.object({
  todaySalesCents: z.number().int(),
  todayDeliveryOrdersCount: z.number().int(),
  activeDeliveryOrdersCount: z.number().int(),
  todayHotelRevenueCents: z.number().int(),
  currentOccupancyRatePercent: z.number(),
  monthRealizedRevenueCents: z.number().int(),
  monthRealizedExpensesCents: z.number().int(),
  monthEstimatedNetProfitCents: z.number().int(),
  accountsReceivableOverdueCents: z.number().int(),
  accountsPayableDueTodayCents: z.number().int(),
  treasuryTotalBalanceCents: z.number().int()
});
export type ExecutiveDashboardMetrics = z.infer<typeof ExecutiveDashboardMetricsSchema>;

/**
 * Sanitiza valores para exportação segura em CSV, prevenindo ataques de CSV Formula Injection.
 * Caracteres perigosos no início (=, +, -, @, \t, \r) recebem prefixo de apóstrofo (')
 * e campos com delimitadores são protegidos com aspas duplas escapadas.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '""';
  }
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Cálculo padronizado de DRE Gerencial por competência.
 */
export function calculateDreStatement(params: {
  grossRevenueCents: number;
  deductionsCents: number;
  directCostsCents: number;
  operationalExpensesCents: number;
  financialResultCents: number;
  periodStart: string;
  periodEnd: string;
  costCenterId?: string | null;
  revenueByCostCenter?: Record<string, number>;
  expensesByCategory?: Record<string, number>;
}): DreStatement {
  const netRevenueCents = Math.max(0, params.grossRevenueCents - params.deductionsCents);
  const grossProfitCents = netRevenueCents - params.directCostsCents;
  const grossMarginPercent = netRevenueCents > 0
    ? Math.round((grossProfitCents / netRevenueCents) * 10000) / 100
    : 0;
  const operatingResultCents = grossProfitCents - params.operationalExpensesCents;
  const operatingMarginPercent = netRevenueCents > 0
    ? Math.round((operatingResultCents / netRevenueCents) * 10000) / 100
    : 0;
  const netProfitCents = operatingResultCents + params.financialResultCents;
  const netMarginPercent = netRevenueCents > 0
    ? Math.round((netProfitCents / netRevenueCents) * 10000) / 100
    : 0;

  return {
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    costCenterId: params.costCenterId ?? null,
    grossRevenueCents: params.grossRevenueCents,
    deductionsCents: params.deductionsCents,
    netRevenueCents,
    directCostsCents: params.directCostsCents,
    grossProfitCents,
    grossMarginPercent,
    operationalExpensesCents: params.operationalExpensesCents,
    operatingResultCents,
    operatingMarginPercent,
    financialResultCents: params.financialResultCents,
    netProfitCents,
    netMarginPercent,
    revenueByCostCenter: params.revenueByCostCenter ?? {},
    expensesByCategory: params.expensesByCategory ?? {}
  };
}

export const DECK26_INITIAL_DELIVERY_ZONES: DeliveryZone[] = [
  { id: 'zone-centro', name: 'Centro Comercial', feeCents: 500, minimumOrderCents: 2000, estimatedMinutes: 30, active: true },
  { id: 'zone-vila-militar', name: 'Vila Militar / Rodovia', feeCents: 700, minimumOrderCents: 2500, estimatedMinutes: 40, active: true },
  { id: 'zone-aeroporto', name: 'Distrito Aeroporto', feeCents: 1000, minimumOrderCents: 3000, estimatedMinutes: 50, active: true },
  { id: 'zone-caninde', name: 'Bairro Canindé', feeCents: 800, minimumOrderCents: 2500, estimatedMinutes: 45, active: true },
  { id: 'zone-palmeiras', name: 'Jardim das Palmeiras', feeCents: 900, minimumOrderCents: 3000, estimatedMinutes: 45, active: true }
];

export const DECK26_INITIAL_COST_CENTERS: CostCenter[] = [
  { id: 'REST', code: 'REST', name: 'Restaurante Deck 26', description: 'Operação salão restaurante principal', active: true },
  { id: 'BAR', code: 'BAR', name: 'Bar & Choperia', description: 'Bebidas, drinks e chopes', active: true },
  { id: 'DELIV', code: 'DELIV', name: 'Delivery Próprio', description: 'Entregas em domicílio e retiradas', active: true },
  { id: 'HOTEL', code: 'HOTEL', name: 'Hotel Auto Posto Milla', description: 'Hospedagem, diárias e frigobar', active: true },
  { id: 'ADMIN', code: 'ADMIN', name: 'Administração & Sede', description: 'Despesas estruturais e corporativas', active: true }
];

export const DECK26_INITIAL_FINANCIAL_CATEGORIES: FinancialCategory[] = [
  { id: 'cat-rec-rest', code: '1.01', name: 'Receita Restaurante', type: 'REVENUE', active: true },
  { id: 'cat-rec-bar', code: '1.02', name: 'Receita Bar & Bebidas', type: 'REVENUE', active: true },
  { id: 'cat-rec-deliv', code: '1.03', name: 'Receita Delivery', type: 'REVENUE', active: true },
  { id: 'cat-rec-taxa-entrega', code: '1.04', name: 'Taxas de Entrega Delivery', type: 'REVENUE', active: true },
  { id: 'cat-rec-hotel-diarias', code: '1.05', name: 'Receita Hotel - Diárias', type: 'REVENUE', active: true },
  { id: 'cat-rec-hotel-frigobar', code: '1.06', name: 'Receita Hotel - Frigobar & Serviços', type: 'REVENUE', active: true },
  { id: 'cat-ded-descontos', code: '2.01', name: 'Descontos Concedidos', type: 'DEDUCTION', active: true },
  { id: 'cat-ded-cancelamentos', code: '2.02', name: 'Cancelamentos e Estornos', type: 'DEDUCTION', active: true },
  { id: 'cat-custo-cmv-alim', code: '3.01', name: 'CMV Alimentos e Insumos Cozinha', type: 'COST_DIRECT', active: true },
  { id: 'cat-custo-cmv-beb', code: '3.02', name: 'CMV Bebidas e Drinks', type: 'COST_DIRECT', active: true },
  { id: 'cat-custo-entregas', code: '3.03', name: 'Custo Repasse Entregadores', type: 'COST_DIRECT', active: true },
  { id: 'cat-custo-hotel-lav', code: '3.04', name: 'Custo Enxoval e Lavanderia Hotel', type: 'COST_DIRECT', active: true },
  { id: 'cat-desp-folha', code: '4.01', name: 'Folha de Pagamento e Salários', type: 'EXPENSE_OP', active: true },
  { id: 'cat-desp-energia-agua', code: '4.02', name: 'Energia Elétrica e Água', type: 'EXPENSE_OP', active: true },
  { id: 'cat-desp-manutencao', code: '4.03', name: 'Manutenção Predial e Equipamentos', type: 'EXPENSE_OP', active: true },
  { id: 'cat-desp-marketing', code: '4.04', name: 'Marketing e Divulgação Local', type: 'EXPENSE_OP', active: true },
  { id: 'cat-desp-limpeza', code: '4.05', name: 'Material de Limpeza e Higiene', type: 'EXPENSE_OP', active: true },
  { id: 'cat-fin-taxas-cartao', code: '5.01', name: 'Taxas de Cartão e Meios de Pagamento', type: 'FINANCIAL_RESULT', active: true },
  { id: 'cat-fin-juros-tarifas', code: '5.02', name: 'Tarifas Bancárias e Rendimentos', type: 'FINANCIAL_RESULT', active: true }
];

export const DECK26_INITIAL_FINANCIAL_ACCOUNTS: FinancialAccount[] = [
  {
    id: 'acc-caixa-geral',
    name: 'Caixa Físico Principal (PDV)',
    type: 'CASH_DRAWER',
    currentBalanceCents: 50000,
    initialBalanceCents: 50000,
    active: true,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z'
  },
  {
    id: 'acc-banco-brasil',
    name: 'Banco do Brasil C/C Operacional',
    type: 'BANK_ACCOUNT',
    bankName: 'Banco do Brasil',
    accountNumber: '12345-6',
    currentBalanceCents: 1500000,
    initialBalanceCents: 1500000,
    active: true,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z'
  },
  {
    id: 'acc-conta-pix',
    name: 'Conta PIX PJ Instantânea',
    type: 'PIX_KEY',
    pixKey: 'financeiro@deck26.com.br',
    currentBalanceCents: 350000,
    initialBalanceCents: 350000,
    active: true,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z'
  },
  {
    id: 'acc-carteira-motoboys',
    name: 'Carteira Transitória de Entregadores',
    type: 'COURIER_WALLET',
    currentBalanceCents: 0,
    initialBalanceCents: 0,
    active: true,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z'
  },
  {
    id: 'acc-cofre-sede',
    name: 'Cofre Geral da Tesouraria',
    type: 'SAFE_DEPOSIT',
    currentBalanceCents: 200000,
    initialBalanceCents: 200000,
    active: true,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z'
  }
];

// Re-exporta módulos da Etapa 7A: Estrutura Fiscal e Catálogo Estendido (93 Produtos + 24 Apartamentos)
export * from './fiscal.js';
export * from './stage7a_catalog.js';


export const TableServiceCallSchema=z.object({id:z.string(),tableNumber:z.number().int().positive(),tabId:z.string(),kind:z.enum(['WAITER','BILL']),paymentPreference:z.enum(['PIX','CARD']).nullable(),requestedAt:IsoDateTimeSchema});
export type TableServiceCall=z.infer<typeof TableServiceCallSchema>;
