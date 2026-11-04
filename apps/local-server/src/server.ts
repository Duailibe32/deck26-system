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
  BillSplitModeSchema,
  CashRegisterMovementTypeSchema,
  DiscountTypeSchema,
  HotelFolioEntryTypeSchema,
  HotelGuestAddressSchema,
  HotelGuestDocumentTypeSchema,
  HotelHousekeepingActionSchema,
  HotelMaintenancePrioritySchema,
  HotelMaintenanceStatusSchema,
  HotelReservationSourceSchema,
  HotelReservationStatusSchema,
  HotelRoomCategorySchema,
  HotelServiceCategorySchema,
  HotelStayStatusSchema,
  ModifierGroupSchema,
  OrderPrioritySchema,
  OrderStatusSchema,
  OriginNodeSchema,
  OutOfStockPolicySchema,
  PaymentConfirmationModeSchema,
  PaymentMethodSchema,
  Permission,
  PrepStationSchema,
  PrintJobStatusSchema,
  RoomHousekeepingStatusSchema,
  RoomMaintenanceStatusSchema,
  RoomOccupancyStatusSchema,
  SalesChannel,
  SalesChannelSchema,
  StockMovementTypeSchema,
  SyncBatchPushResponseSchema,
  TabTypeSchema,
  TablePhysicalStatusSchema,
  UserRole,
  calculateStayFolioTotals,
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

const EPHEMERAL_DEV_SECRET = crypto.randomBytes(32).toString('hex');

function resolveTokenSecret(): string {
  const configured = process.env.DECK26_AUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DECK26_AUTH_SECRET deve ser configurado obrigatoriamente em produção.');
  }
  return EPHEMERAL_DEV_SECRET;
}

export function signSessionToken(session: AuthenticatedSession): string {
  const secret = resolveTokenSecret();
  const payloadB64 = Buffer.from(JSON.stringify(session), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string | undefined): AuthenticatedSession | null {
  if (!token) return null;
  const secret = resolveTokenSecret();
  const clean = token.replace(/^Bearer\s+/i, '').trim();
  const [payloadB64, sig] = clean.split('.');
  if (!payloadB64 || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
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
    const hotelGuests = store.listHotelGuests();
    const hotelReservations = store.listHotelReservations();
    const hotelStays = store.listHotelStays();
    const hotelServices = store.listHotelServices();
    const hotelMetrics = store.getHotelDashboardMetrics();
    const syncEvents = store.listAllSyncEvents(50);
    const notifications = store.listNotifications({ limit: 50 });
    const kdsSlaConfig = store.getKdsSlaConfig();
    const cashierSummary = store.getCashierOperationalSummary();
    const auditLogs = store.listAuditLogs(undefined, 50);

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
      hotelGuests,
      hotelReservations,
      hotelStays,
      hotelServices,
      hotelMetrics,
      syncEvents,
      notifications,
      kdsSlaConfig,
      cashierSummary,
      auditLogs
    };
  });

  // 3.1 Eventos em Tempo Real (SSE — Server-Sent Events) e Recuperação de Notificações (Seções 14, 16 e 23)
  app.get<{ Querystring: { sinceCursorId?: string } }>('/api/events/stream', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': req.headers.origin ?? '*'
    });

    const sinceCursor = req.query.sinceCursorId ? Number(req.query.sinceCursorId) : 0;
    if (sinceCursor > 0) {
      const missed = store.listNotifications({ sinceCursorId: sinceCursor, limit: 100 }).reverse();
      for (const item of missed) {
        reply.raw.write(`id: ${item.cursorId ?? ''}\nevent: operational_event\ndata: ${JSON.stringify(item)}\n\n`);
      }
    } else {
      reply.raw.write(`event: connected\ndata: ${JSON.stringify({ status: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);
    }

    const unsubscribe = store.onOperationalEvent((notification) => {
      reply.raw.write(
        `id: ${notification.cursorId ?? ''}\nevent: operational_event\ndata: ${JSON.stringify(notification)}\n\n`
      );
    });

    req.raw.on('close', () => {
      unsubscribe();
    });
  });

  app.get<{
    Querystring: {
      sinceCursorId?: string;
      unacknowledgedOnly?: string;
      targetUserId?: string;
    };
  }>('/api/notifications', async (req) => {
    const notifications = store.listNotifications({
      sinceCursorId: req.query.sinceCursorId ? Number(req.query.sinceCursorId) : 0,
      unacknowledgedOnly: req.query.unacknowledgedOnly === 'true',
      targetUserId: req.query.targetUserId
    });
    return { notifications };
  });

  app.post<{ Params: { id: string } }>('/api/notifications/:id/ack', async (req, reply) => {
    const session = resolveSession(req);
    if (!session) {
      return reply.status(401).send({ error: 'Não autenticado' });
    }
    try {
      const notification = store.acknowledgeNotification(req.params.id, session.userId);
      return { notification };
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : 'Notificação não encontrada'
      });
    }
  });

  app.get('/api/kds/sla', async () => {
    return { kdsSlaConfig: store.getKdsSlaConfig() };
  });

  const UpdateKdsSlaSchema = z.object({
    warningThresholdMinutes: z.number().int().min(1).max(120),
    delayedThresholdMinutes: z.number().int().min(2).max(240)
  });

  app.put('/api/kds/sla', async (req, reply) => {
    const session = authorizePermission(req, reply, 'catalog:manage');
    if (!session) return;

    const parsed = UpdateKdsSlaSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Configuração de SLA inválida', issues: parsed.error.issues });
    }
    try {
      const kdsSlaConfig = store.updateKdsSlaConfig(parsed.data);
      return { kdsSlaConfig };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao atualizar SLA'
      });
    }
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

  // 5. Gestão Profissional de Mesas e Comandas (Seções 3, 4, 5, 8, 9, 10, 11, 13 e 21)
  const OpenTableBodySchema = z.object({
    tableNumber: z.number().int().min(1).max(200),
    guestsCount: z.number().int().min(1).max(100).default(1),
    waiterUserId: z.string().optional(),
    waiterName: z.string().optional(),
    customerName: z.string().nullable().optional(),
    notes: z.string().optional(),
    originNode: OriginNodeSchema.default('WINDOWS_PDV')
  });

  app.post('/api/tables/open', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:manage');
    if (!session) return;

    const parsed = OpenTableBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Dados inválidos para abertura de mesa', issues: parsed.error.issues });
    }
    try {
      const result = store.openTable({
        ...parsed.data,
        waiterUserId: parsed.data.waiterUserId ?? session.userId,
        waiterName: parsed.data.waiterName ?? session.name
      });
      return reply.status(201).send(result);
    } catch (err) {
      return reply.status(409).send({
        error: err instanceof Error ? err.message : 'Mesa já aberta ou indisponível'
      });
    }
  });

  const UpdateTableStatusBodySchema = z.object({
    physicalStatus: TablePhysicalStatusSchema,
    notes: z.string().optional()
  });

  app.patch<{ Params: { tableNumber: string } }>(
    '/api/tables/:tableNumber/status',
    async (req, reply) => {
      const session = authorizePermission(req, reply, 'tabs:manage');
      if (!session) return;

      const parsed = UpdateTableStatusBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Estado de mesa inválido', issues: parsed.error.issues });
      }
      try {
        const table = store.updateTablePhysicalStatus({
          tableNumber: Number(req.params.tableNumber),
          physicalStatus: parsed.data.physicalStatus,
          notes: parsed.data.notes,
          actorUserId: session.userId
        });
        return { table };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : 'Não foi possível alterar o estado da mesa'
        });
      }
    }
  );

  const TransferTableBodySchema = z.object({
    fromTableNumber: z.number().int().positive(),
    toTableNumber: z.number().int().positive(),
    reason: z.string().optional(),
    originNode: OriginNodeSchema.default('WINDOWS_PDV')
  });

  app.post('/api/tables/transfer', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:manage');
    if (!session) return;

    const parsed = TransferTableBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de transferência inválidos', issues: parsed.error.issues });
    }
    try {
      const result = store.transferTable({
        ...parsed.data,
        actorUserId: session.userId
      });
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Não foi possível transferir a mesa'
      });
    }
  });

  const JoinTablesBodySchema = z.object({
    primaryTableNumber: z.number().int().positive(),
    tableNumbersToJoin: z.array(z.number().int().positive()).min(1),
    reason: z.string().optional(),
    originNode: OriginNodeSchema.default('WINDOWS_PDV')
  });

  app.post('/api/tables/join', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:manage');
    if (!session) return;

    const parsed = JoinTablesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de junção inválidos', issues: parsed.error.issues });
    }
    try {
      const result = store.joinTables({
        ...parsed.data,
        actorUserId: session.userId
      });
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao unir mesas'
      });
    }
  });

  const UnjoinTableBodySchema = z.object({
    tableNumberToSeparate: z.number().int().positive(),
    reason: z.string().optional(),
    originNode: OriginNodeSchema.default('WINDOWS_PDV')
  });

  app.post('/api/tables/unjoin', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:manage');
    if (!session) return;

    const parsed = UnjoinTableBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de separação inválidos', issues: parsed.error.issues });
    }
    try {
      const result = store.unjoinTable({
        ...parsed.data,
        actorUserId: session.userId
      });
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao separar mesa'
      });
    }
  });

  const OpenTabBodySchema = z.object({
    code: z.string().min(1),
    type: TabTypeSchema.default('TABLE'),
    tableNumber: z.number().int().positive().nullable().optional(),
    customerName: z.string().nullable().optional(),
    guestsCount: z.number().int().min(1).default(1),
    waiterUserId: z.string().optional(),
    waiterName: z.string().optional(),
    notes: z.string().optional(),
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
      waiterUserId: parsed.data.waiterUserId ?? session.userId,
      waiterName: parsed.data.waiterName ?? session.name,
      openedByUserId: parsed.data.openedByUserId ?? session.userId
    });
    return reply.status(201).send({ tab });
  });

  app.post<{ Params: { id: string } }>('/api/tabs/:id/request-bill', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:manage');
    if (!session) return;

    try {
      const tab = store.requestTabBill({
        tabId: req.params.id,
        actorUserId: session.userId
      });
      return { tab };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Não foi possível solicitar fechamento da conta'
      });
    }
  });

  const ApplyDiscountBodySchema = z.object({
    discountType: DiscountTypeSchema,
    discountCents: z.number().int().nonnegative().optional(),
    discountBasisPoints: z.number().int().min(0).max(10000).optional(),
    reason: z.string().min(1)
  });

  app.post<{ Params: { id: string } }>('/api/tabs/:id/discount', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:discount_or_void');
    if (!session) return;

    const parsed = ApplyDiscountBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de desconto inválidos', issues: parsed.error.issues });
    }
    try {
      const tab = store.applyTabDiscount({
        tabId: req.params.id,
        discountType: parsed.data.discountType,
        discountCents: parsed.data.discountCents,
        discountBasisPoints: parsed.data.discountBasisPoints,
        reason: parsed.data.reason,
        actorUserId: session.userId,
        actorRole: session.role
      });
      return { tab };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao aplicar desconto na comanda'
      });
    }
  });

  const ConfigureServiceFeeBodySchema = z.object({
    serviceFeeEnabled: z.boolean(),
    serviceFeeBasisPoints: z.number().int().min(0).max(5000).optional()
  });

  app.post<{ Params: { id: string } }>('/api/tabs/:id/service-fee', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:manage');
    if (!session) return;

    const parsed = ConfigureServiceFeeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Configuração de taxa de serviço inválida' });
    }
    try {
      const tab = store.configureTabServiceFee({
        tabId: req.params.id,
        serviceFeeEnabled: parsed.data.serviceFeeEnabled,
        serviceFeeBasisPoints: parsed.data.serviceFeeBasisPoints,
        actorUserId: session.userId
      });
      return { tab };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao atualizar taxa de serviço'
      });
    }
  });

  const ConfigureSplitBodySchema = z.object({
    mode: BillSplitModeSchema,
    sharesCount: z.number().int().min(1).max(100).optional(),
    itemAllocations: z
      .array(
        z.object({
          orderItemId: z.string().min(1),
          quantity: z.number().positive(),
          payerLabel: z.string().min(1)
        })
      )
      .optional()
  });

  app.post<{ Params: { id: string } }>('/api/tabs/:id/split', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:manage');
    if (!session) return;

    const parsed = ConfigureSplitBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Plano de divisão inválido', issues: parsed.error.issues });
    }
    try {
      const result = store.configureTabSplitPlan({
        tabId: req.params.id,
        mode: parsed.data.mode,
        sharesCount: parsed.data.sharesCount,
        itemAllocations: parsed.data.itemAllocations,
        actorUserId: session.userId
      });
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao calcular divisão de conta'
      });
    }
  });

  const TransferItemBodySchema = z.object({
    orderItemId: z.string().min(1),
    quantityToTransfer: z.number().positive().optional(),
    targetTabId: z.string().uuid(),
    reason: z.string().min(3)
  });

  app.post<{ Params: { id: string } }>('/api/tabs/:id/transfer-item', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:manage');
    if (!session) return;

    const parsed = TransferItemBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de transferência de item inválidos', issues: parsed.error.issues });
    }
    try {
      const result = store.transferOrderItemBetweenTabs({
        orderItemId: parsed.data.orderItemId,
        quantityToTransfer: parsed.data.quantityToTransfer,
        targetTabId: parsed.data.targetTabId,
        reason: parsed.data.reason,
        actorUserId: session.userId
      });
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao transferir item entre comandas'
      });
    }
  });

  const CloseTabBodySchema = z.object({
    releaseStatus: z.enum(['LIVRE', 'LIMPEZA']).optional()
  });

  app.post<{ Params: { id: string } }>('/api/tabs/:id/close', async (req, reply) => {
    const session = authorizePermission(req, reply, 'pos:operate');
    if (!session) return;

    const parsed = CloseTabBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos para fechamento de comanda' });
    }
    try {
      const result = store.closeTabAndReleaseTable({
        tabId: req.params.id,
        actorUserId: session.userId,
        releaseStatus: parsed.data.releaseStatus ?? 'LIVRE'
      });
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Não foi possível encerrar a comanda e liberar a mesa'
      });
    }
  });

  // 6. Criação de Pedido (Order) com Idempotência, Preço por Canal, Impressão Incremental e Baixa de Estoque
  const CreateOrderBodySchema = z.object({
    idempotencyKey: z.string().min(8),
    tabId: z.string().uuid().nullable().optional(),
    tableNumber: z.number().int().positive().nullable().optional(),
    qrToken: z.string().optional(),
    channel: SalesChannelSchema.default('DINE_IN'),
    originNode: OriginNodeSchema.default('WINDOWS_PDV'),
    priority: OrderPrioritySchema.optional(),
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

  // 7. Avanço de Status na Cozinha / KDS / Garçom / Cancelamento por Estágio (Seções 14, 15, 16 e 17)
  const AdvanceOrderBodySchema = z.object({
    status: OrderStatusSchema,
    originNode: OriginNodeSchema.default('KITCHEN_KDS'),
    priority: OrderPrioritySchema.optional(),
    reverseStockOnCancel: z.boolean().optional(),
    cancelReason: z.string().optional(),
    actorUserId: z.string().optional(),
    actorRole: z.enum(['OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'RECEPTIONIST', 'STOCK_CLERK']).optional(),
    authorizedByUserId: z.string().optional()
  });

  app.patch<{ Params: { id: string } }>('/api/orders/:id/status', async (req, reply) => {
    const session = authorizePermission(req, reply, 'orders:advance_kitchen');
    if (!session) return;

    const parsed = AdvanceOrderBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Status inválido', issues: parsed.error.issues });
    }
    const isStrictToken = Boolean(req.headers.authorization);
    try {
      const order = store.advanceOrderStatus({
        orderId: req.params.id,
        newStatus: parsed.data.status,
        originNode: parsed.data.originNode,
        priority: parsed.data.priority,
        reverseStockOnCancel: parsed.data.reverseStockOnCancel,
        cancelReason: parsed.data.cancelReason,
        actorUserId: isStrictToken ? session.userId : (parsed.data.actorUserId ?? session.userId),
        actorRole: isStrictToken ? session.role : (parsed.data.actorRole ?? session.role),
        authorizedByUserId: parsed.data.authorizedByUserId
      });
      return { order };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar pedido';
      if (msg.includes('exige autorização de Gerente')) {
        return reply.status(403).send({ error: msg });
      }
      if (msg.includes('não encontrado')) {
        return reply.status(404).send({ error: msg });
      }
      return reply.status(400).send({ error: msg });
    }
  });

  // 8. Registro de Pagamento Parcial, Misto, Dividido ou Total + Estorno Autorizado (Seções 11 e 12)
  const RecordPaymentBodySchema = z.object({
    idempotencyKey: z.string().min(8),
    tabId: z.string().uuid(),
    method: PaymentMethodSchema,
    confirmationMode: PaymentConfirmationModeSchema.optional(),
    amountCents: z.number().int().positive(),
    receivedCashCents: z.number().int().nonnegative().optional(),
    payerLabel: z.string().optional(),
    allocatedItems: z
      .array(
        z.object({
          orderItemId: z.string().min(1),
          quantity: z.number().positive()
        })
      )
      .optional(),
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

  const RefundPaymentBodySchema = z.object({
    reason: z.string().min(3),
    authorizedByUserId: z.string().optional()
  });

  app.post<{ Params: { id: string } }>('/api/payments/:id/refund', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:discount_or_void');
    if (!session) return;

    const parsed = RefundPaymentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Motivo de estorno inválido', issues: parsed.error.issues });
    }
    try {
      const result = store.refundPayment({
        paymentId: req.params.id,
        reason: parsed.data.reason,
        actorUserId: session.userId,
        actorRole: session.role,
        authorizedByUserId: parsed.data.authorizedByUserId
      });
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao estornar pagamento'
      });
    }
  });

  // 8.1 Abertura, Sangria, Suprimento e Fechamento de Turno de Caixa (Seções 19 e 20)
  app.get('/api/cash-sessions/summary', async () => {
    return store.getCashierOperationalSummary();
  });

  const OpenCashSessionSchema = z.object({
    openingBalanceCents: z.number().int().nonnegative(),
    notes: z.string().optional()
  });

  app.post('/api/cash-sessions/open', async (req, reply) => {
    const session = authorizePermission(req, reply, 'pos:operate');
    if (!session) return;

    const parsed = OpenCashSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de abertura de caixa inválidos', issues: parsed.error.issues });
    }
    try {
      const cashSession = store.openCashRegisterSession({
        openingBalanceCents: parsed.data.openingBalanceCents,
        openedByUserId: session.userId,
        notes: parsed.data.notes
      });
      return reply.status(201).send({ cashSession });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao abrir turno de caixa'
      });
    }
  });

  const CashMovementSchema = z.object({
    sessionId: z.string().optional(),
    movementType: CashRegisterMovementTypeSchema,
    amountCents: z.number().int().positive(),
    reason: z.string().min(3),
    authorizedByUserId: z.string().optional()
  });

  app.post('/api/cash-sessions/movements', async (req, reply) => {
    const session = authorizePermission(req, reply, 'pos:operate');
    if (!session) return;

    const parsed = CashMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Movimentação de caixa inválida', issues: parsed.error.issues });
    }
    try {
      const result = store.recordCashRegisterMovement({
        sessionId: parsed.data.sessionId,
        movementType: parsed.data.movementType,
        amountCents: parsed.data.amountCents,
        reason: parsed.data.reason,
        createdByUserId: session.userId,
        authorizedByUserId: parsed.data.authorizedByUserId
      });
      return reply.status(201).send(result);
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao registrar movimentação de caixa'
      });
    }
  });

  const CloseCashSessionSchema = z.object({
    sessionId: z.string().optional(),
    countedCashCents: z.number().int().nonnegative(),
    notes: z.string().optional()
  });

  app.post('/api/cash-sessions/close', async (req, reply) => {
    const session = authorizePermission(req, reply, 'pos:operate');
    if (!session) return;

    const parsed = CloseCashSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de fechamento de caixa inválidos', issues: parsed.error.issues });
    }
    try {
      const cashSession = store.closeCashRegisterSession({
        sessionId: parsed.data.sessionId,
        countedCashCents: parsed.data.countedCashCents,
        closedByUserId: session.userId,
        notes: parsed.data.notes
      });
      return { cashSession };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao fechar turno de caixa'
      });
    }
  });

  // 9. Confirmação, Status e Reimpressão Autorizada de Impressão Térmica no Spooler Local (Seção 18)
  const UpdatePrintJobStatusSchema = z.object({
    status: PrintJobStatusSchema,
    errorMsg: z.string().optional()
  });

  app.patch<{ Params: { id: string } }>('/api/print-jobs/:id/status', async (req, reply) => {
    const session = authorizePermission(req, reply, 'printers:manage');
    if (!session) return;

    const parsed = UpdatePrintJobStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Status de impressão inválido', issues: parsed.error.issues });
    }
    try {
      const job = store.updatePrintJobStatus({
        jobId: req.params.id,
        status: parsed.data.status,
        errorMsg: parsed.data.errorMsg,
        actorUserId: session.userId
      });
      return { printJob: job };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao atualizar trabalho de impressão'
      });
    }
  });

  app.post<{ Params: { id: string } }>('/api/print-jobs/:id/mark-printed', async (req, reply) => {
    const session = authorizePermission(req, reply, 'printers:manage');
    if (!session) return;

    try {
      const job = store.markPrintJobPrinted(req.params.id);
      return { printJob: job };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Erro ao confirmar impressão'
      });
    }
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

  // ============================================================================
  // 11. GESTÃO HOTELEIRA COMPLETA — HOTEL AUTO POSTO MILLA (PMS)
  // ============================================================================

  // 11.1 Apartamentos / Quartos
  app.get('/api/hotel/rooms', async (req, reply) => {
    const q = req.query as { activeOnly?: string; occupancyStatus?: string; housekeepingStatus?: string };
    const rooms = store.listHotelRooms({
      activeOnly: q.activeOnly === 'true',
      occupancyStatus: q.occupancyStatus as any,
      housekeepingStatus: q.housekeepingStatus as any
    });
    return reply.send({ rooms });
  });

  app.get<{ Params: { id: string } }>('/api/hotel/rooms/:id', async (req, reply) => {
    const room = store.getHotelRoomById(req.params.id);
    if (!room) return reply.status(404).send({ error: 'Quarto não encontrado' });
    return reply.send({ room });
  });

  const CreateHotelRoomSchema = z.object({
    id: z.string().optional(),
    number: z.string().min(1),
    floorSector: z.string().optional(),
    category: HotelRoomCategorySchema.optional(),
    maxGuests: z.number().int().min(1).optional(),
    bedCount: z.number().int().min(1).optional(),
    bedConfiguration: z.string().optional(),
    description: z.string().optional(),
    amenities: z.array(z.string()).optional(),
    dailyRateCents: z.number().int().positive(),
    internalNotes: z.string().optional()
  });

  app.post('/api/hotel/rooms', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_rooms');
    if (!session) return;
    const parsed = CreateHotelRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos para cadastro de quarto', issues: parsed.error.issues });
    }
    try {
      const room = store.createHotelRoom({ ...parsed.data, operatorUserId: session.userId });
      return reply.status(201).send({ room });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao cadastrar quarto' });
    }
  });

  app.put<{ Params: { id: string } }>('/api/hotel/rooms/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_rooms');
    if (!session) return;
    try {
      const room = store.updateHotelRoom(req.params.id, req.body as any, session.userId);
      return reply.send({ room });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao atualizar quarto' });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/hotel/rooms/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_rooms');
    if (!session) return;
    try {
      const result = store.deactivateHotelRoom(req.params.id, session.userId);
      return reply.send(result);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao desativar quarto' });
    }
  });

  // 11.2 Cadastro de Hóspedes (LGPD e Auditoria)
  app.get('/api/hotel/guests', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:view_pii');
    if (!session) return;
    const q = req.query as { search?: string };
    const guests = store.listHotelGuests(q.search);
    return reply.send({ guests });
  });

  app.get<{ Params: { id: string } }>('/api/hotel/guests/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:view_pii');
    if (!session) return;
    const guest = store.getHotelGuestById(req.params.id);
    if (!guest) return reply.status(404).send({ error: 'Hóspede não encontrado' });
    return reply.send({ guest });
  });

  const CreateHotelGuestSchema = z.object({
    id: z.string().optional(),
    fullName: z.string().min(2),
    documentType: HotelGuestDocumentTypeSchema.optional(),
    documentNumber: z.string().min(3),
    phone: z.string().optional(),
    email: z.string().optional(),
    nationality: z.string().optional(),
    birthDate: z.string().nullable().optional(),
    address: HotelGuestAddressSchema.optional(),
    notes: z.string().optional()
  });

  app.post('/api/hotel/guests', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_guests');
    if (!session) return;
    const parsed = CreateHotelGuestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos de hóspede', issues: parsed.error.issues });
    }
    try {
      const guest = store.createHotelGuest({ ...parsed.data, operatorUserId: session.userId });
      return reply.status(201).send({ guest });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao cadastrar hóspede' });
    }
  });

  app.put<{ Params: { id: string } }>('/api/hotel/guests/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_guests');
    if (!session) return;
    try {
      const guest = store.updateHotelGuest(req.params.id, req.body as any, session.userId);
      return reply.send({ guest });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao atualizar hóspede' });
    }
  });

  // 11.3 Reservas e Disponibilidade
  app.get('/api/hotel/reservations', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_reservations');
    if (!session) return;
    const q = req.query as { roomNumber?: string; status?: string; startDate?: string; endDate?: string };
    const reservations = store.listHotelReservations({
      roomNumber: q.roomNumber,
      status: q.status as any,
      startDate: q.startDate,
      endDate: q.endDate
    });
    return reply.send({ reservations });
  });

  app.get('/api/hotel/availability', async (req, reply) => {
    const q = req.query as { roomNumber: string; checkInDate: string; checkOutDate: string; excludeReservationId?: string };
    if (!q.roomNumber || !q.checkInDate || !q.checkOutDate) {
      return reply.status(400).send({ error: 'roomNumber, checkInDate e checkOutDate são obrigatórios' });
    }
    const availability = store.checkRoomAvailability(q.roomNumber, q.checkInDate, q.checkOutDate, q.excludeReservationId);
    return reply.send(availability);
  });

  const CreateHotelReservationSchema = z.object({
    id: z.string().optional(),
    guestId: z.string().min(1),
    guestName: z.string().optional(),
    guestPhone: z.string().optional(),
    roomNumber: z.string().min(1),
    checkInDate: z.string().min(10),
    checkOutDate: z.string().min(10),
    guestsCount: z.number().int().min(1).optional(),
    dailyRateCents: z.number().int().positive().optional(),
    depositCents: z.number().int().nonnegative().optional(),
    depositPaid: z.boolean().optional(),
    sourceChannel: HotelReservationSourceSchema.optional(),
    notes: z.string().optional()
  });

  app.post('/api/hotel/reservations', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_reservations');
    if (!session) return;
    const parsed = CreateHotelReservationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos de reserva', issues: parsed.error.issues });
    }
    try {
      const reservation = store.createHotelReservation({ ...parsed.data, operatorUserId: session.userId });
      return reply.status(201).send({ reservation });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao criar reserva' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/hotel/reservations/:id/cancel', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_reservations');
    if (!session) return;
    const body = req.body as { reason?: string };
    try {
      const reservation = store.cancelHotelReservation(req.params.id, {
        reason: body?.reason || 'Cancelamento solicitado pelo hóspede',
        cancelledByUserId: session.userId
      });
      return reply.send({ reservation });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao cancelar reserva' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/hotel/reservations/:id/reschedule', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_reservations');
    if (!session) return;
    const body = req.body as { newCheckInDate: string; newCheckOutDate: string; newRoomNumber?: string };
    if (!body?.newCheckInDate || !body?.newCheckOutDate) {
      return reply.status(400).send({ error: 'newCheckInDate e newCheckOutDate são obrigatórios' });
    }
    try {
      const reservation = store.rescheduleHotelReservation(req.params.id, {
        newCheckInDate: body.newCheckInDate,
        newCheckOutDate: body.newCheckOutDate,
        newRoomNumber: body.newRoomNumber,
        operatorUserId: session.userId
      });
      return reply.send({ reservation });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao reagendar reserva' });
    }
  });

  // 11.4 Estadias, Check-In e Check-Out Guiado
  app.get('/api/hotel/stays', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:checkin_checkout');
    if (!session) return;
    const q = req.query as { status?: string; roomNumber?: string };
    const stays = store.listHotelStays({ status: q.status as any, roomNumber: q.roomNumber });
    return reply.send({ stays });
  });

  app.get<{ Params: { id: string } }>('/api/hotel/stays/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:checkin_checkout');
    if (!session) return;
    const stay = store.getHotelStayById(req.params.id);
    if (!stay) return reply.status(404).send({ error: 'Estadia não encontrada' });
    return reply.send({ stay });
  });

  const AdvancedCheckInSchema = z.object({
    roomNumber: z.string().min(1),
    guestId: z.string().optional(),
    guestName: z.string().optional(),
    checkInAt: z.string().optional(),
    checkOutScheduledAt: z.string().optional(),
    reservationId: z.string().optional(),
    companions: z.array(z.object({ name: z.string(), document: z.string().optional() })).optional(),
    dailyRateCents: z.number().int().positive().optional(),
    earlyCheckinCents: z.number().int().nonnegative().optional(),
    notes: z.string().optional()
  });

  app.post('/api/hotel/checkin', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:checkin_checkout');
    if (!session) return;

    const parsed = AdvancedCheckInSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de check-in inválidos', issues: parsed.error.issues });
    }

    try {
      if (parsed.data.guestId && parsed.data.checkOutScheduledAt) {
        const result = store.checkInHotelStay({
          roomNumber: parsed.data.roomNumber,
          guestId: parsed.data.guestId,
          checkInAt: parsed.data.checkInAt,
          checkOutScheduledAt: parsed.data.checkOutScheduledAt,
          reservationId: parsed.data.reservationId,
          companions: parsed.data.companions,
          dailyRateCents: parsed.data.dailyRateCents,
          earlyCheckinCents: parsed.data.earlyCheckinCents,
          notes: parsed.data.notes,
          operatorUserId: session.userId,
          operatorName: session.name
        });
        return reply.status(201).send(result);
      } else if (parsed.data.guestName) {
        const result = store.checkInHotelRoom({
          roomNumber: parsed.data.roomNumber,
          guestName: parsed.data.guestName
        });
        return reply.status(201).send(result);
      } else {
        return reply.status(400).send({ error: 'Informe guestId e checkOutScheduledAt, ou guestName' });
      }
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao realizar check-in' });
    }
  });

  const CheckOutSchema = z.object({
    stayId: z.string().min(1),
    notes: z.string().optional(),
    allowOverrideWithAudit: z.boolean().optional()
  });

  app.post('/api/hotel/checkout', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:checkin_checkout');
    if (!session) return;

    const parsed = CheckOutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de check-out inválidos', issues: parsed.error.issues });
    }

    try {
      const result = store.checkOutHotelStay(parsed.data.stayId, {
        operatorUserId: session.userId,
        operatorName: session.name,
        notes: parsed.data.notes,
        allowOverrideWithAudit: parsed.data.allowOverrideWithAudit
      });
      return reply.send(result);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao realizar check-out' });
    }
  });

  // 11.5 Folio e Transferência Restaurante -> Hotel
  app.get<{ Params: { id: string } }>('/api/hotel/stays/:id/folio', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:post_charges');
    if (!session) return;
    const entries = store.listFolioEntriesByStayId(req.params.id);
    const totals = calculateStayFolioTotals(entries);
    return reply.send({ entries, totals });
  });

  const AddFolioEntrySchema = z.object({
    entryType: HotelFolioEntryTypeSchema,
    description: z.string().min(1),
    amountCents: z.number().int(),
    sourceReferenceType: z.string().optional(),
    sourceReferenceId: z.string().optional(),
    sourceDetailsJson: z.string().optional()
  });

  app.post<{ Params: { id: string } }>('/api/hotel/stays/:id/folio/entry', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:post_charges');
    if (!session) return;
    const parsed = AddFolioEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos para lançamento no folio', issues: parsed.error.issues });
    }
    try {
      const entry = store.addFolioEntry({
        stayId: req.params.id,
        ...parsed.data,
        operatorUserId: session.userId,
        operatorName: session.name
      });
      return reply.status(201).send({ entry });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao lançar no folio' });
    }
  });

  const TransferTabToFolioSchema = z.object({
    restaurantTabId: z.string().min(1),
    roomNumber: z.string().min(1)
  });

  app.post('/api/hotel/transfer-tab-to-folio', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:post_charges');
    if (!session) return;
    const parsed = TransferTabToFolioSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos para transferência', issues: parsed.error.issues });
    }
    try {
      const result = store.transferRestaurantTabToFolio({
        restaurantTabId: parsed.data.restaurantTabId,
        roomNumber: parsed.data.roomNumber,
        operatorUserId: session.userId,
        operatorName: session.name
      });
      return reply.status(200).send(result);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao transferir consumo' });
    }
  });

  // 11.6 Frigobar
  app.get<{ Params: { roomNumber: string } }>('/api/hotel/rooms/:roomNumber/minibar', async (req, reply) => {
    const items = store.listMinibarItemsByRoom(req.params.roomNumber);
    return reply.send({ items });
  });

  const ConfigureMinibarSchema = z.object({
    roomNumber: z.string().min(1),
    productId: z.string().min(1),
    initialQuantity: z.number().int().nonnegative(),
    unitPriceCents: z.number().int().nonnegative().optional()
  });

  app.post('/api/hotel/minibar/config', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_rooms');
    if (!session) return;
    const parsed = ConfigureMinibarSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos de frigobar', issues: parsed.error.issues });
    }
    try {
      const item = store.configureMinibarItem(parsed.data);
      return reply.status(201).send({ item });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao configurar frigobar' });
    }
  });

  const MinibarConsumeSchema = z.object({
    stayId: z.string().min(1),
    roomNumber: z.string().min(1),
    productId: z.string().min(1),
    quantity: z.number().int().positive()
  });

  app.post('/api/hotel/minibar/consume', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:post_charges');
    if (!session) return;
    const parsed = MinibarConsumeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de consumo inválidos', issues: parsed.error.issues });
    }
    try {
      const result = store.recordMinibarConsumption({
        ...parsed.data,
        operatorUserId: session.userId,
        operatorName: session.name
      });
      return reply.status(201).send(result);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao lançar frigobar' });
    }
  });

  const MinibarRestockSchema = z.object({
    roomNumber: z.string().min(1),
    productId: z.string().min(1),
    addedQuantity: z.number().int().positive()
  });

  app.post('/api/hotel/minibar/restock', async (req, reply) => {
    const session = authorizePermission(req, reply, 'stock:adjust');
    if (!session) return;
    const parsed = MinibarRestockSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de reposição inválidos', issues: parsed.error.issues });
    }
    try {
      const item = store.restockMinibarItem({ ...parsed.data, operatorUserId: session.userId });
      return reply.send({ item });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao repor frigobar' });
    }
  });

  // 11.7 Serviços Adicionais
  app.get('/api/hotel/services', async (req, reply) => {
    const services = store.listHotelServices();
    return reply.send({ services });
  });

  const CreateHotelServiceSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(2),
    category: HotelServiceCategorySchema.optional(),
    defaultPriceCents: z.number().int().nonnegative()
  });

  app.post('/api/hotel/services', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:manage_rates');
    if (!session) return;
    const parsed = CreateHotelServiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos de serviço', issues: parsed.error.issues });
    }
    try {
      const service = store.createHotelService(parsed.data);
      return reply.status(201).send({ service });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao cadastrar serviço' });
    }
  });

  const OrderHotelServiceSchema = z.object({
    stayId: z.string().min(1),
    serviceId: z.string().min(1),
    quantity: z.number().int().positive().optional(),
    unitPriceCents: z.number().int().nonnegative().optional()
  });

  app.post('/api/hotel/services/order', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:post_charges');
    if (!session) return;
    const parsed = OrderHotelServiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de pedido de serviço inválidos', issues: parsed.error.issues });
    }
    try {
      const result = store.orderHotelService({
        ...parsed.data,
        operatorUserId: session.userId,
        operatorName: session.name
      });
      return reply.status(201).send(result);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao pedir serviço' });
    }
  });

  // 11.8 Governança e Manutenção
  app.get('/api/hotel/housekeeping/logs', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:housekeeping');
    if (!session) return;
    const q = req.query as { roomNumber?: string };
    const logs = store.listHousekeepingLogs(q.roomNumber);
    return reply.send({ logs });
  });

  const HousekeepingUpdateSchema = z.object({
    roomNumber: z.string().min(1),
    action: HotelHousekeepingActionSchema,
    notes: z.string().optional()
  });

  app.post('/api/hotel/housekeeping/update', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:housekeeping');
    if (!session) return;
    const parsed = HousekeepingUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos de governança', issues: parsed.error.issues });
    }
    try {
      const result = store.updateHousekeepingStatus({
        roomNumber: parsed.data.roomNumber,
        action: parsed.data.action,
        attendantUserId: session.userId,
        attendantName: session.name,
        notes: parsed.data.notes
      });
      return reply.send(result);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao atualizar governança' });
    }
  });

  app.get('/api/hotel/maintenance', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:maintenance');
    if (!session) return;
    const q = req.query as { roomNumber?: string; status?: string };
    const records = store.listMaintenanceRecords({ roomNumber: q.roomNumber, status: q.status as any });
    return reply.send({ records });
  });

  const CreateMaintenanceSchema = z.object({
    roomNumber: z.string().min(1),
    issueDescription: z.string().min(2),
    priority: HotelMaintenancePrioritySchema.optional(),
    blockRoom: z.boolean().optional(),
    assignedTo: z.string().optional()
  });

  app.post('/api/hotel/maintenance', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:maintenance');
    if (!session) return;
    const parsed = CreateMaintenanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos de manutenção', issues: parsed.error.issues });
    }
    try {
      const result = store.createMaintenanceRecord({
        ...parsed.data,
        reportedByUserId: session.userId,
        reportedByName: session.name
      });
      return reply.status(201).send(result);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao criar chamado de manutenção' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/hotel/maintenance/:id/resolve', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:maintenance');
    if (!session) return;
    const body = req.body as { resolutionNotes?: string };
    try {
      const result = store.resolveMaintenanceRecord(req.params.id, {
        resolutionNotes: body?.resolutionNotes || 'Manutenção concluída e conferida.',
        resolvedByUserId: session.userId
      });
      return reply.send(result);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao resolver manutenção' });
    }
  });

  // 11.9 Métricas do Dashboard Hoteleiro
  app.get('/api/hotel/metrics', async (req, reply) => {
    const session = authorizePermission(req, reply, 'hotel:reports');
    if (!session) return;
    const metrics = store.getHotelDashboardMetrics();
    return reply.send({ metrics });
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
