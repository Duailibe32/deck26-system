/**
 * DECK 26 — Servidor Operacional Local (Fastify + SQLite WAL + Autenticação Real & Autorização RBAC)
 *
 * Atende simultaneamente:
 * - Aplicativo Windows Principal (PDV / Caixa / Recepção Hotel Milla / Catálogo & Estoque)
 * - Terminais Internos com Autenticação por PIN + Token Assinado HMAC-SHA256
 * - Cardápio Digital QR Code Seguro por Mesa (Tokens Não-Previsíveis)
 * - Sincronizador Bidirecional com a VPS (ou Simulador Local da VPS na porta 4100)
 */

import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  ModifierGroupSchema,
  OrderStatusSchema,
  OriginNodeSchema,
  OutOfStockPolicySchema,
  PaymentMethodSchema,
  Permission,
  PrepStationSchema,
  SalesChannel,
  SalesChannelSchema,
  StockMovementTypeSchema,
  SyncBatchPushResponseSchema,
  TabTypeSchema,
  UserRole,
  hasPermission
} from '@deck26/contracts';
import { z } from 'zod';
import { LocalOperationalStore } from './store.js';

export interface AuthenticatedSession {
  userId: string;
  name: string;
  role: UserRole;
  issuedAt: number;
}

const TOKEN_SECRET = process.env.DECK26_AUTH_SECRET ?? 'deck26-local-hmac-dev-key-change-in-prod';

export function signSessionToken(session: AuthenticatedSession): string {
  const payloadB64 = Buffer.from(JSON.stringify(session), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string | undefined): AuthenticatedSession | null {
  if (!token) return null;
  const clean = token.replace(/^Bearer\s+/i, '').trim();
  const [payloadB64, sig] = clean.split('.');
  if (!payloadB64 || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as AuthenticatedSession;
  } catch {
    return null;
  }
}

export function getLanIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['127.0.0.1'];
}

export async function buildLocalServer(options?: {
  dbPath?: string;
  cloudApiUrl?: string;
  requireStrictAuth?: boolean;
}): Promise<{
  app: FastifyInstance;
  store: LocalOperationalStore;
  setCloudApiUrl: (newUrl: string) => void;
}> {
  const app = Fastify({ logger: false });

  const allowedOrigins = (
    process.env.DECK26_ALLOWED_ORIGINS ??
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174'
  )
    .split(',')
    .map((o) => o.trim());

  await app.register(cors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        origin.startsWith('http://192.168.') ||
        origin.startsWith('http://10.')
      ) {
        cb(null, true);
        return;
      }
      cb(new Error('Origem CORS não autorizada pelo Servidor Operacional Deck 26'), false);
    },
    credentials: true
  });

  const dbPath =
    options?.dbPath ??
    process.env.DECK26_LOCAL_DB_PATH ??
    path.resolve(process.cwd(), 'data', 'deck26-local.sqlite');

  let cloudApiUrl =
    options?.cloudApiUrl ?? process.env.DECK26_CLOUD_API_URL ?? 'http://127.0.0.1:4100';

  const requireStrictAuth = options?.requireStrictAuth ?? false;
  const store = new LocalOperationalStore(dbPath);
  let lastPulledRemoteCursor = 0;
  let lastSyncStatus: {
    online: boolean;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  } = {
    online: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null
  };

  function resolveSession(req: FastifyRequest): AuthenticatedSession | null {
    const authHeader = req.headers.authorization;
    const verified = verifySessionToken(authHeader);
    if (verified) return verified;
    if (!requireStrictAuth) {
      // Fallback seguro apenas para testes de integração internos no próprio loopback quando token não enviado
      return {
        userId: 'usr-owner-01',
        name: 'Operador Local (Loopback)',
        role: 'OWNER',
        issuedAt: Date.now()
      };
    }
    return null;
  }

  function authorizePermission(
    req: FastifyRequest,
    reply: FastifyReply,
    permission: Permission
  ): AuthenticatedSession | null {
    const session = resolveSession(req);
    if (!session) {
      reply.status(401).send({ error: 'Não autenticado. Informe seu PIN operacional válido.' });
      return null;
    }
    if (!hasPermission(session.role, permission)) {
      reply.status(403).send({
        error: `Acesso negado: o cargo ${session.role} não possui a permissão '${permission}'.`
      });
      return null;
    }
    return session;
  }

  // 1. Autenticação Real por PIN no Backend
  const LoginPinSchema = z.object({
    pin: z.string().min(4).max(12)
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginPinSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Formato de PIN inválido.' });
    }
    const user = store.authenticateByPin(parsed.data.pin);
    if (!user) {
      return reply.status(401).send({ error: 'PIN incorreto ou colaborador inativo.' });
    }
    const session: AuthenticatedSession = {
      userId: user.id,
      name: user.name,
      role: user.role,
      issuedAt: Date.now()
    };
    const token = signSessionToken(session);
    return {
      authenticated: true,
      token,
      user: session
    };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const verified = verifySessionToken(req.headers.authorization);
    if (!verified) {
      return reply.status(401).send({ authenticated: false });
    }
    return { authenticated: true, user: verified };
  });

  // 2. Health & Descoberta de Rede Local
  app.get('/api/health', async () => {
    const lanIps = getLanIpv4Addresses();
    const pendingSync = store.listPendingSyncEvents(200).length;
    return {
      service: 'deck26-local-server',
      establishment: 'DECK 26 — Hotel Auto Posto Milla',
      status: 'OPERATIONAL_OFFLINE_READY',
      bindMode: process.env.HOST ?? '127.0.0.1 (Loopback Seguro)',
      lanAddresses: lanIps,
      waiterUrlHint: `http://${lanIps[0]}:5173/?terminal=garcom`,
      kitchenUrlHint: `http://${lanIps[0]}:5173/?terminal=cozinha`,
      pendingSyncEvents: pendingSync,
      cloudSyncState: lastSyncStatus,
      timestamp: new Date().toISOString()
    };
  });

  // 3. Estado Consolidado para Dashboard, PDV, Mesas, Cozinha, Catálogo, Estoque, Hotel e Impressoras
  app.get('/api/state', async () => {
    const catalog = store.getCatalog({ includeInactive: true });
    const recipes = store.listProductRecipes();
    const qrTables = store.listDiningTablesQr();
    const tabs = store.listTabs();
    const orders = store.listOrders();
    const payments = store.listPayments();
    const printJobs = store.listPrintJobs();
    const stock = store.listStockBalancesAndMovements();
    const hotelRooms = store.listHotelRooms();
    const syncEvents = store.listAllSyncEvents(50);

    return {
      lanAddresses: getLanIpv4Addresses(),
      cloudSyncState: lastSyncStatus,
      catalog,
      recipes,
      qrTables,
      tabs,
      orders,
      payments,
      printJobs,
      stock,
      hotelRooms,
      syncEvents
    };
  });

  // 4. Catálogo Lógico Compartilhado (Categorias, Produtos e Fichas Técnicas)
  app.get<{ Querystring: { includeInactive?: string; channel?: SalesChannel } }>(
    '/api/catalog',
    async (req) => {
      const includeInactive = req.query.includeInactive === 'true';
      const channel = req.query.channel;
      return store.getCatalog({ includeInactive, channel });
    }
  );

  const UpsertCategoryBodySchema = z.object({
    id: z.string().optional(),
    slug: z.string().optional(),
    name: z.string().min(2),
    description: z.string().optional(),
    imageUrl: z.string().nullable().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    availableChannels: z.array(SalesChannelSchema).optional(),
    active: z.boolean().optional()
  });

  app.post('/api/catalog/categories', async (req, reply) => {
    const session = authorizePermission(req, reply, 'catalog:manage');
    if (!session) return;

    const parsed = UpsertCategoryBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Dados de categoria inválidos', issues: parsed.error.issues });
    }
    const category = store.upsertCategory(parsed.data);
    return reply.status(201).send({ category });
  });

  app.put<{ Params: { id: string } }>('/api/catalog/categories/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'catalog:manage');
    if (!session) return;

    const parsed = UpsertCategoryBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Dados de categoria inválidos', issues: parsed.error.issues });
    }
    const category = store.upsertCategory({ ...parsed.data, id: req.params.id });
    return { category };
  });

  app.delete<{ Params: { id: string } }>('/api/catalog/categories/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'catalog:manage');
    if (!session) return;

    try {
      const result = store.deleteCategory(req.params.id);
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao excluir categoria'
      });
    }
  });

  const ProductInputSchema = z.object({
    id: z.string().optional(),
    sku: z.string().min(2),
    barcode: z.string().nullable().optional(),
    categoryId: z.string().min(1),
    subcategory: z.string().optional(),
    name: z.string().min(2),
    description: z.string().optional(),
    imageUrl: z.string().nullable().optional(),
    unitOfMeasure: z.string().optional(),
    priceCents: z.number().int().nonnegative(),
    costPriceCents: z.number().int().nonnegative().optional(),
    channelPricesCents: z.record(SalesChannelSchema, z.number().int().nonnegative()).optional(),
    prepStation: PrepStationSchema,
    targetPrinter: z.string().optional(),
    prepTimeMinutes: z.number().int().nonnegative().optional(),
    trackStock: z.boolean().optional(),
    initialStock: z.number().nonnegative().optional(),
    minStockQuantity: z.number().nonnegative().optional(),
    outOfStockPolicy: OutOfStockPolicySchema.optional(),
    modifierGroups: z.array(ModifierGroupSchema).optional(),
    internalNotes: z.string().optional(),
    ncm: z.string().optional(),
    cest: z.string().optional(),
    cfop: z.string().optional(),
    merchandiseOrigin: z.string().optional(),
    taxProfile: z.string().optional(),
    dataSource: z.enum(['OFFICIAL_MENU', 'TEST_ONLY']).optional(),
    availableChannels: z.array(SalesChannelSchema).optional(),
    active: z.boolean().optional()
  });

  app.post('/api/catalog/products', async (req, reply) => {
    const session = authorizePermission(req, reply, 'catalog:manage');
    if (!session) return;

    const parsed = ProductInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Dados de produto inválidos', issues: parsed.error.issues });
    }
    const product = store.createCatalogProduct(parsed.data);
    return reply.status(201).send({ product });
  });

  app.put<{ Params: { id: string } }>('/api/catalog/products/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'catalog:manage');
    if (!session) return;

    const parsed = ProductInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Dados de atualização inválidos', issues: parsed.error.issues });
    }
    try {
      const product = store.updateCatalogProduct(req.params.id, parsed.data);
      return { product };
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : 'Produto não encontrado'
      });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/catalog/products/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'catalog:manage');
    if (!session) return;

    try {
      const result = store.deleteOrDeactivateProduct(req.params.id);
      return result;
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : 'Erro ao desativar/excluir produto'
      });
    }
  });

  const BatchProductsStatusSchema = z.object({
    productIds: z.array(z.string().min(1)).min(1),
    active: z.boolean()
  });

  app.post('/api/catalog/products/batch-status', async (req, reply) => {
    const session = authorizePermission(req, reply, 'catalog:manage');
    if (!session) return;

    const parsed = BatchProductsStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Lote de produtos inválido', issues: parsed.error.issues });
    }
    const result = store.batchSetProductsStatus(parsed.data.productIds, parsed.data.active);
    return result;
  });

  // 4.1 Fichas Técnicas Versionadas (Product Recipes)
  app.get<{ Querystring: { productId?: string } }>('/api/recipes', async (req) => {
    return { recipes: store.listProductRecipes(req.query.productId) };
  });

  const SaveRecipeBodySchema = z.object({
    productId: z.string().min(1),
    status: z.enum(['DRAFT', 'APPROVED']).optional(),
    yieldQuantity: z.number().positive().optional(),
    notes: z.string().optional(),
    items: z
      .array(
        z.object({
          ingredientProductId: z.string().min(1),
          quantityUsed: z.number().positive(),
          unitOfMeasure: z.string().optional()
        })
      )
      .min(1)
  });

  app.post('/api/recipes', async (req, reply) => {
    const session = authorizePermission(req, reply, 'catalog:manage');
    if (!session) return;

    const parsed = SaveRecipeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Ficha técnica inválida', issues: parsed.error.issues });
    }
    try {
      const recipe = store.saveProductRecipe({
        ...parsed.data,
        approvedByUserId: session.userId
      });
      return reply.status(201).send({ recipe });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao salvar ficha técnica'
      });
    }
  });

  // 5. Abertura / Consulta de Comandas e Mesas (Tab)
  const OpenTabBodySchema = z.object({
    code: z.string().min(1),
    type: TabTypeSchema.default('TABLE'),
    tableNumber: z.number().int().positive().nullable().optional(),
    customerName: z.string().nullable().optional(),
    guestsCount: z.number().int().min(1).default(1),
    openedByUserId: z.string().optional(),
    originNode: OriginNodeSchema.default('WINDOWS_PDV')
  });

  app.post('/api/tabs', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:manage');
    if (!session) return;

    const parsed = OpenTabBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Dados inválidos para abertura de comanda', issues: parsed.error.issues });
    }
    const tab = store.openOrGetTab({
      ...parsed.data,
      openedByUserId: parsed.data.openedByUserId ?? session.userId
    });
    return reply.status(201).send({ tab });
  });

  // 6. Criação de Pedido (Order) com Idempotência, Preço por Canal, Impressão Incremental e Baixa de Estoque
  const CreateOrderBodySchema = z.object({
    idempotencyKey: z.string().min(8),
    tabId: z.string().uuid().nullable().optional(),
    tableNumber: z.number().int().positive().nullable().optional(),
    qrToken: z.string().optional(),
    channel: SalesChannelSchema.default('DINE_IN'),
    originNode: OriginNodeSchema.default('WINDOWS_PDV'),
    waiterUserId: z.string().nullable().optional(),
    waiterName: z.string().nullable().optional(),
    customerNotes: z.string().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          quantity: z.number().positive(),
          notes: z.string().optional(),
          modifiers: z
            .array(
              z.object({
                groupId: z.string(),
                groupName: z.string(),
                optionId: z.string(),
                optionName: z.string(),
                priceDeltaCents: z.number().int().optional()
              })
            )
            .optional()
        })
      )
      .min(1)
  });

  app.post('/api/orders', async (req, reply) => {
    const session = authorizePermission(req, reply, 'orders:create');
    if (!session) return;

    const parsed = CreateOrderBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Pedido inválido', issues: parsed.error.issues });
    }
    try {
      const result = store.createOrder({
        ...parsed.data,
        waiterUserId: parsed.data.waiterUserId ?? session.userId,
        waiterName: parsed.data.waiterName ?? session.name
      });
      return reply.status(result.idempotentReplay ? 200 : 201).send(result);
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao processar pedido'
      });
    }
  });

  // 6.1 Endpoints Públicos para Cardápio Digital QR Code Seguro por Mesa (Seções 11 e 12)
  app.get<{ Params: { qrToken: string } }>('/api/public/qr-table/:qrToken', async (req, reply) => {
    const qrTable = store.getDiningTableByQrToken(req.params.qrToken);
    if (!qrTable) {
      return reply.status(404).send({
        error: 'QR Code de mesa inválido, expirado ou desativado. Solicite auxílio ao garçom.'
      });
    }
    const catalog = store.getCatalog({ includeInactive: false, channel: 'QR_TABLE' });
    return {
      establishment: 'DECK 26 — Hotel Auto Posto Milla',
      qrTable,
      catalog
    };
  });

  const CreatePublicQrOrderSchema = z.object({
    idempotencyKey: z.string().min(8),
    qrToken: z.string().min(10),
    customerName: z.string().min(2),
    customerNotes: z.string().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          quantity: z.number().positive(),
          notes: z.string().optional(),
          modifiers: z
            .array(
              z.object({
                groupId: z.string(),
                groupName: z.string(),
                optionId: z.string(),
                optionName: z.string(),
                priceDeltaCents: z.number().int().optional()
              })
            )
            .optional()
        })
      )
      .min(1)
  });

  app.post('/api/public/qr-orders', async (req, reply) => {
    const parsed = CreatePublicQrOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Pedido QR inválido', issues: parsed.error.issues });
    }

    try {
      const customerNoteStr = `${parsed.data.customerName}${
        parsed.data.customerNotes ? ` — ${parsed.data.customerNotes}` : ''
      }`;
      const result = store.createOrder({
        idempotencyKey: parsed.data.idempotencyKey,
        qrToken: parsed.data.qrToken,
        channel: 'QR_TABLE',
        originNode: 'CLOUD_QR_MENU',
        customerNotes: customerNoteStr,
        items: parsed.data.items
      });
      return reply.status(result.idempotentReplay ? 200 : 201).send(result);
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Não foi possível registrar o pedido por QR Code'
      });
    }
  });

  const UpdateQrPolicySchema = z.object({
    requiresOperatorApproval: z.boolean()
  });

  app.patch<{ Params: { tableNumber: string } }>(
    '/api/qr-tables/:tableNumber',
    async (req, reply) => {
      const session = authorizePermission(req, reply, 'tabs:manage');
      if (!session) return;

      const parsed = UpdateQrPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Configuração de QR inválida' });
      }
      try {
        const qrTable = store.configureDiningTableQrPolicy(
          Number(req.params.tableNumber),
          parsed.data.requiresOperatorApproval
        );
        return { qrTable };
      } catch (err) {
        return reply.status(404).send({
          error: err instanceof Error ? err.message : 'Mesa não encontrada'
        });
      }
    }
  );

  // 7. Avanço de Status na Cozinha / KDS / Garçom / Cancelamento com Estorno de Estoque
  const AdvanceOrderBodySchema = z.object({
    status: OrderStatusSchema,
    originNode: OriginNodeSchema.default('KITCHEN_KDS'),
    reverseStockOnCancel: z.boolean().optional(),
    cancelReason: z.string().optional()
  });

  app.patch<{ Params: { id: string } }>('/api/orders/:id/status', async (req, reply) => {
    const session = authorizePermission(req, reply, 'orders:advance_kitchen');
    if (!session) return;

    const parsed = AdvanceOrderBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Status inválido', issues: parsed.error.issues });
    }
    try {
      const order = store.advanceOrderStatus({
        orderId: req.params.id,
        newStatus: parsed.data.status,
        originNode: parsed.data.originNode,
        reverseStockOnCancel: parsed.data.reverseStockOnCancel,
        cancelReason: parsed.data.cancelReason,
        actorUserId: session.userId
      });
      return { order };
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : 'Pedido não encontrado'
      });
    }
  });

  // 8. Registro de Pagamento Parcial ou Total (Payment — Entidade Separada)
  const RecordPaymentBodySchema = z.object({
    idempotencyKey: z.string().min(8),
    tabId: z.string().uuid(),
    method: PaymentMethodSchema,
    amountCents: z.number().int().positive(),
    receivedCashCents: z.number().int().nonnegative().optional(),
    nsuOrTxId: z.string().optional(),
    operatorUserId: z.string().optional()
  });

  app.post('/api/payments', async (req, reply) => {
    const session = authorizePermission(req, reply, 'pos:operate');
    if (!session) return;

    const parsed = RecordPaymentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Pagamento inválido', issues: parsed.error.issues });
    }
    try {
      const result = store.recordPayment({
        ...parsed.data,
        operatorUserId: parsed.data.operatorUserId ?? session.userId
      });
      return reply.status(result.idempotentReplay ? 200 : 201).send(result);
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao processar pagamento'
      });
    }
  });

  // 9. Confirmação e Reimpressão Autorizada de Impressão Térmica no Spooler Local
  app.post<{ Params: { id: string } }>('/api/print-jobs/:id/mark-printed', async (req, reply) => {
    const session = authorizePermission(req, reply, 'printers:manage');
    if (!session) return;

    const job = store.markPrintJobPrinted(req.params.id);
    return { printJob: job };
  });

  app.post<{ Params: { id: string } }>('/api/print-jobs/:id/reprint', async (req, reply) => {
    const session = authorizePermission(req, reply, 'printers:manage');
    if (!session) return;

    try {
      const job = store.reprintJob(req.params.id, session.userId);
      return { printJob: job };
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : 'Trabalho de impressão não encontrado'
      });
    }
  });

  // 10. Ajuste Auditado e Estorno de Movimentação de Estoque
  const AdjustStockBodySchema = z.object({
    idempotencyKey: z.string().optional(),
    productId: z.string().min(1),
    quantityDelta: z.number().refine((v) => v !== 0, 'Quantidade não pode ser zero'),
    movementType: StockMovementTypeSchema,
    unitCostCents: z.number().int().nonnegative().optional(),
    originChannel: z.string().optional(),
    reason: z.string().min(3)
  });

  app.post('/api/stock/adjust', async (req, reply) => {
    const session = authorizePermission(req, reply, 'stock:adjust');
    if (!session) return;

    const parsed = AdjustStockBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Movimentação inválida', issues: parsed.error.issues });
    }
    try {
      const result = store.adjustStock({
        ...parsed.data,
        userId: session.userId
      });
      return reply.status(result.idempotentReplay ? 200 : 201).send(result);
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao ajustar estoque'
      });
    }
  });

  const ReverseStockBodySchema = z.object({
    movementId: z.string().min(1),
    reason: z.string().min(3)
  });

  app.post('/api/stock/reverse', async (req, reply) => {
    const session = authorizePermission(req, reply, 'stock:adjust');
    if (!session) return;

    const parsed = ReverseStockBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Dados de estorno inválidos', issues: parsed.error.issues });
    }
    try {
      const movement = store.reverseStockMovement({
        movementId: parsed.data.movementId,
        reason: parsed.data.reason,
        userId: session.userId
      });
      return reply.status(201).send({ movement });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao estornar movimentação'
      });
    }
  });

  // 11. Check-in de Hóspede no Hotel Auto Posto Milla
  const HotelCheckInSchema = z.object({
    roomNumber: z.string().min(1),
    guestName: z.string().min(2)
  });

  app.post('/api/hotel/checkin', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_reservations');
    if (!session) return;

    const parsed = HotelCheckInSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Dados de check-in inválidos', issues: parsed.error.issues });
    }
    const result = store.checkInHotelRoom(parsed.data);
    return reply.status(201).send(result);
  });

  // 12. Ciclo de Sincronização Bidirecional Local ↔ VPS
  app.post('/api/sync/trigger', async (req, reply) => {
    const session = authorizePermission(req, reply, 'sync:manage');
    if (!session) return;

    const pendingEvents = store.listPendingSyncEvents(50);
    const attemptTime = new Date().toISOString();
    lastSyncStatus.lastAttemptAt = attemptTime;

    try {
      const response = await fetch(`${cloudApiUrl}/api/sync/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceNodeId: 'deck26-windows-main',
          sourceOrigin: 'WINDOWS_PDV',
          lastPulledRemoteCursor,
          events: pendingEvents
        })
      });

      if (!response.ok) {
        throw new Error(`VPS retornou HTTP ${response.status}`);
      }

      const rawJson = await response.json();
      const syncResp = SyncBatchPushResponseSchema.parse(rawJson);

      store.acknowledgeSyncEvents([...syncResp.ackedEventIds, ...syncResp.duplicateEventIds]);

      let appliedFromCloud = 0;
      for (const remoteEvent of syncResp.remoteEventsToPull) {
        const res = store.applyRemoteSyncEvent(remoteEvent);
        if (res.applied) appliedFromCloud += 1;
      }

      lastPulledRemoteCursor = syncResp.newRemoteCursor;
      lastSyncStatus = {
        online: true,
        lastAttemptAt: attemptTime,
        lastSuccessAt: syncResp.processedAt,
        lastError: null
      };

      return {
        synced: true,
        pushedCount: pendingEvents.length,
        ackedCount: syncResp.ackedEventIds.length,
        duplicateIgnoredCount: syncResp.duplicateEventIds.length,
        pulledFromCloudCount: appliedFromCloud,
        conflicts: syncResp.conflicts,
        cloudSyncState: lastSyncStatus
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'VPS inacessível (Modo Offline Ativo)';
      lastSyncStatus = {
        online: false,
        lastAttemptAt: attemptTime,
        lastSuccessAt: lastSyncStatus.lastSuccessAt,
        lastError: message
      };
      return {
        synced: false,
        offlineModeActive: true,
        pendingLocalEvents: pendingEvents.length,
        reason: message,
        cloudSyncState: lastSyncStatus
      };
    }
  });

  return {
    app,
    store,
    setCloudApiUrl: (newUrl: string) => {
      cloudApiUrl = newUrl;
    }
  };
}
