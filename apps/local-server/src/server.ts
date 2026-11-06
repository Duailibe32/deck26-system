import {registerExtensionRoutes} from './extension-routes.js';
import {stayOptionsSchema,extensionSettings} from './extension-models.js';
import {registerDesktopRoutes} from './desktop-routes.js';
import {registerFiscalPreparationRoutes} from './fiscal-preparation-routes.js';
import {registerOperationRoutes} from './operation-routes.js';
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
  hasPermission,
  // Etapa 6: Delivery e Gestão Financeira
  AccountsPayableStatus,
  AccountsReceivableStatus,
  DeliveryCourierStatus,
  DeliveryCourierStatusSchema,
  DeliveryOrderStatus,
  DeliveryOrderStatusSchema,
  DeliveryOriginSchema,
  DeliveryTypeSchema,
  FinancialAccountTypeSchema,
  PaymentMethod,
  FiscalDocumentTypeSchema,
  RoomCommercialStatusSchema,
  RoleSchema
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
  const parts = clean.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const supplied = Buffer.from(sig);
  const expected = Buffer.from(expectedSig);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const session = z.object({ userId: z.string().min(1), name: z.string(), role: RoleSchema, issuedAt: z.number().int() })
      .parse(JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')));
    const age = Date.now() - session.issuedAt;
    if (age < -60000 || age > 8 * 60 * 60 * 1000) return null;
    return session;
  } catch {
    return null;
  }
}

export function getLanIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal && (process.env.DECK26_OPERATIONAL!=='true'||/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(net.address))) {
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
  demoMode?: boolean;
}): Promise<{
  app: FastifyInstance;
  store: LocalOperationalStore;
  setCloudApiUrl: (newUrl: string) => void;
}> {
  const app = Fastify({ logger: false });
  resolveTokenSecret(); // Fail before opening a production database or listener.

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
        allowedOrigins.includes(origin)
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

  const requireStrictAuth =
    options?.requireStrictAuth ??
    (dbPath !== ':memory:' || process.env.NODE_ENV === 'production' || process.env.DECK26_STRICT_AUTH === 'true');
  const store = new LocalOperationalStore(dbPath, options?.demoMode);
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
    if (verified) {
      const user = store.db.prepare('SELECT name, role FROM users WHERE id = ? AND active = 1').get(verified.userId) as {name: string; role: UserRole} | undefined;
      const revocation=store.db.prepare('SELECT revoked_at FROM user_session_revocations WHERE user_id=?').get(verified.userId) as {revoked_at:number}|undefined;
      return user && user.role === verified.role && (!revocation||verified.issuedAt>revocation.revoked_at) ? { ...verified, name: user.name } : null;
    }
    if (!requireStrictAuth && !authHeader && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)) {
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

  const publicRequests=new Map<string,{count:number;until:number}>();
  app.addHook('onRequest',async(req,reply)=>{if(req.method!=='POST'||!req.url.startsWith('/api/public/'))return;const now=Date.now();let entry=publicRequests.get(req.ip);if(!entry||now>entry.until){for(const [key,value] of publicRequests)if(now>value.until)publicRequests.delete(key);if(publicRequests.size>=5000)return reply.code(429).send({error:'Tente novamente em instantes.'});entry={count:0,until:now+60000};publicRequests.set(req.ip,entry);}if(++entry.count>60)return reply.code(429).send({error:'Muitos pedidos. Aguarde um minuto.'});});
  // Every internal endpoint requires a session, including GET snapshots. Route
  // handlers still apply their narrower mutation permissions.
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0] ?? '';
    if (!url.startsWith('/api/')) return;
    if (req.method === 'OPTIONS' || url === '/api/_local/stop' || url === '/api/setup/status' || url === '/api/setup/owner' || url === '/api/health' || url === '/api/auth/login' || url.startsWith('/api/public/')) return;
    const session = resolveSession(req);
    if (!session) return reply.code(401).send({error: 'Sessão ausente ou expirada. Entre com seu PIN.'});
    let permission: Permission | undefined;
    if (url.startsWith('/api/finance/') && req.method === 'GET') {
      permission = url.includes('/payables') ? 'finance:manage_payables' : url.includes('/receivables') ? 'finance:manage_receivables' : url.includes('/suppliers') || url.includes('/purchases') ? 'finance:manage_suppliers' : url.includes('/reconciliations') ? 'finance:reconcile' : url.includes('/transactions') || url.includes('/transfers') ? 'finance:view_dre' : 'finance:view_overview';
    }
    if (url === '/api/recipes' && req.method === 'GET') permission='stock:adjust';
    if (url === '/api/cash-sessions/summary') permission='pos:operate';
    if (url.startsWith('/api/delivery/') && !url.endsWith('/zones')) permission = 'delivery:manage_orders';
    if (url === '/api/events/stream' || url === '/api/notifications') permission = 'sync:manage';
    if (permission && !hasPermission(session.role, permission)) return reply.code(403).send({error: 'Seu perfil não permite consultar estes dados.'});
  });

  const loginAttempts = new Map<string, {count: number; resetAt: number}>();

  app.post('/api/auth/login', async (req, reply) => {
    const now = Date.now();
    let attempts = loginAttempts.get(req.ip);
    if (!attempts || now > attempts.resetAt) {
      if (loginAttempts.size > 10000) for (const [ip, value] of loginAttempts) if (now > value.resetAt) loginAttempts.delete(ip);
      attempts = {count: 0, resetAt: now + 15 * 60 * 1000};
      loginAttempts.set(req.ip, attempts);
    }
    if (++attempts.count > 10) return reply.code(429).header('Retry-After', '900').send({error: 'Muitas tentativas. Tente novamente em 15 minutos.'});
    const parsed = LoginPinSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Formato de PIN inválido.' });
    }
    const user = store.authenticateByPin(parsed.data.pin);
    if (!user) {
      return reply.status(401).send({ error: 'PIN incorreto ou colaborador inativo.' });
    }
    loginAttempts.delete(req.ip);
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
      bindMode: process.env.DECK26_OPERATIONAL==='true'?'Rede local autorizada':process.env.HOST ?? '127.0.0.1 (Loopback Seguro)',
      lanAddresses: lanIps,
      waiterUrlHint: `http://${lanIps[0]}:${process.env.DECK26_OPERATIONAL==='true'?'4800':'5173'}/?terminal=garcom`,
      kitchenUrlHint: `http://${lanIps[0]}:${process.env.DECK26_OPERATIONAL==='true'?'4800':'5173'}/?terminal=cozinha`,
      pendingSyncEvents: pendingSync,
      cloudSyncState: lastSyncStatus,
      timestamp: new Date().toISOString()
    };
  });

  // 3. Estado Consolidado para Dashboard, PDV, Mesas, Cozinha, Catálogo, Estoque, Hotel e Impressoras
  app.get('/api/state', async (req, reply) => {
    const session = resolveSession(req);
    if (!session) return reply.code(401).send({error: 'Não autenticado'});
    const can = (permission: Permission) => hasPermission(session.role, permission);
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
    const deliveryZones = store.listDeliveryZones(false);
    const deliveryCouriers = store.listDeliveryCouriers();
    const deliveryOrders = store.listDeliveryOrders();
    const deliveryCustomers = store.listDeliveryCustomers();
    const costCenters = store.listCostCenters();
    const financialCategories = store.listFinancialCategories();
    const financialAccounts = store.listFinancialAccounts();
    const suppliers = store.listSuppliers();
    const accountsReceivable = store.listAccountsReceivable();
    const accountsPayable = store.listAccountsPayable();
    const executiveMetrics = store.getExecutiveDashboardMetrics();

    return {
      lanAddresses: getLanIpv4Addresses(),
      cloudSyncState: lastSyncStatus,
      catalog: can('catalog:manage') ? catalog : {...catalog,products:catalog.products.filter(p=>p.active).map(p=>({...p,costPriceCents:undefined,internalNotes:''}))},
      recipes: can('stock:adjust') ? recipes : [],
      qrTables: can('tabs:manage') ? qrTables : [],
      publicDeliveryPendingCount:can('delivery:manage_orders')?Number((store.db.prepare("SELECT COUNT(*) AS count FROM public_delivery_requests WHERE status='PENDING'").get() as any).count):0,
      serviceCalls: can('tabs:manage') ? store.listTableServiceCalls() : [],
      tabs: can('tabs:manage') ? tabs.filter(tab => tab.type !== 'HOTEL_FOLIO' || can('hotel:view_pii')) : [],
      orders: orders.filter(order => order.channel !== 'HOTEL_ROOM' || can('hotel:view_pii')).map(order => can('tabs:manage') ? order : {...order, customerNotes: undefined}),
      payments: can('pos:operate') ? payments : [],
      printJobs: can('printers:manage') ? printJobs : [],
      stock: can('stock:adjust') ? stock : { balances: [], recentMovements: [] },
      hotelRooms: can('hotel:view_pii') ? hotelRooms : hotelRooms.map(room => ({...room, currentGuestName: null, currentGuestId: null, activeStayId: null, activeTabId: null, internalNotes: ''})),
      hotelGuests: can('hotel:view_pii') ? hotelGuests : [],
      hotelReservations: can('hotel:manage_reservations') ? hotelReservations : [],
      hotelStays: can('hotel:view_pii') ? hotelStays : [],
      hotelServices,
      hotelMetrics: can('hotel:reports') ? hotelMetrics : undefined,
      syncEvents: can('sync:manage') ? syncEvents : [],
      notifications: can('sync:manage') ? notifications : [],
      kdsSlaConfig,
      cashierSummary: can('pos:operate') ? cashierSummary : undefined,
      auditLogs: can('staff:manage') ? auditLogs : [],
      deliveryZones,
      deliveryCouriers: can('delivery:manage_orders') ? deliveryCouriers : [],
      deliveryOrders: can('delivery:manage_orders') ? deliveryOrders : [],
      deliveryCustomers: can('delivery:manage_orders') ? deliveryCustomers : [],
      costCenters,
      financialCategories,
      financialAccounts: can('finance:view_overview') ? financialAccounts : [],
      suppliers: can('finance:manage_suppliers') ? suppliers : [],
      accountsReceivable: can('finance:manage_receivables') ? accountsReceivable : [],
      accountsPayable: can('finance:manage_payables') ? accountsPayable : [],
      executiveMetrics: can('finance:view_dre') ? executiveMetrics : undefined
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
      const catalog = store.getCatalog({ includeInactive, channel });
      const session = resolveSession(req);
      if (session && hasPermission(session.role, 'catalog:manage')) return catalog;
      return {...catalog, products:catalog.products.map(product=>({...product,costPriceCents:undefined,internalNotes:undefined}))};
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
    channelPricesCents: z.partialRecord(SalesChannelSchema, z.number().int().nonnegative()).optional(),
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

  app.post<{ Params: { id: string } }>('/api/tabs/:id/pre-conta', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:manage');
    if (!session) return;
    try {
      const result = store.requestPreConta(req.params.id, session.userId);
      return reply.send(result);
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : 'Não foi possível emitir pré-conta de conferência'
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
        actorUserId: session.userId,
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
      qrTable:{tableNumber:qrTable.tableNumber,label:qrTable.label,requiresOperatorApproval:qrTable.requiresOperatorApproval},
      catalog:{...catalog,products:catalog.products.map(product=>({...product,costPriceCents:undefined,internalNotes:undefined}))}
    };
  });

  const CreatePublicQrOrderSchema = z.object({
    idempotencyKey: z.string().min(8),
    qrToken: z.string().min(10),
    customerName: z.string().min(2).max(80),
    customerNotes: z.string().max(280).optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          quantity: z.number().int().positive().max(100),
          notes: z.string().max(280).optional(),
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
      .min(1).max(100)
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
    const status=(req.body as {status?:string})?.status;
    const serviceTransition=status==='RECEIVED'||status==='DELIVERED';
    const session = authorizePermission(req, reply, serviceTransition?'orders:create':'orders:advance_kitchen');
    if (!session) return;
    const existing=store.getOrderById(req.params.id);
    if(serviceTransition&&existing&&!hasPermission(session.role,'orders:advance_kitchen')&&!(status==='RECEIVED'&&['PENDING_APPROVAL','RECEIVED'].includes(existing.status))&&!(status==='DELIVERED'&&(extensionSettings(store.db).kitchenWorkflow==='PAPER'?['RECEIVED','IN_PREPARATION','READY','DELIVERED']:['READY','DELIVERED']).includes(existing.status)))return reply.code(403).send({error:'O garçom pode aprovar pedidos pendentes ou confirmar pedidos prontos.'});

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
        operatorUserId: session.userId
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
    const q = req.query as { activeOnly?: string; occupancyStatus?: string; housekeepingStatus?: string; commercialStatus?: string };
    const rooms = store.listHotelRooms({
      activeOnly: q.activeOnly === 'true',
      occupancyStatus: q.occupancyStatus as any,
      housekeepingStatus: q.housekeepingStatus as any,
      commercialStatus: q.commercialStatus as any
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
    name: z.string().optional(),
    photos: z.array(z.string()).optional(),
    commercialStatus: RoomCommercialStatusSchema.optional(),
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
    options:stayOptionsSchema.optional(),
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
          options:parsed.data.options,
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
    const stay = store.getHotelStayById(req.params.id);
    if (!stay) return reply.code(404).send({error:'Estadia não encontrada.'});
    const folioTab = store.getTabById(stay.tabId);
    if (!folioTab) return reply.code(409).send({error:'A comanda desta estadia não está disponível. Confira o vínculo antes de continuar.'});
    const entries = store.listFolioEntriesByStayId(stay.id);
    const totals = calculateStayFolioTotals(entries);
    return reply.send({ stay:{id:stay.id,tabId:stay.tabId,roomNumber:stay.roomNumber,status:stay.status}, folioTab:{id:folioTab.id,type:folioTab.type,status:folioTab.status}, entries, totals });
  });

  const AddFolioEntrySchema = z.object({
    entryType: HotelFolioEntryTypeSchema,
    description: z.string().min(1),
    amountCents: z.number().int(),
    sourceReferenceType: z.string().optional(),
    sourceReferenceId: z.string().optional(),
    sourceDetailsJson: z.string().optional(),
    paymentMethod: PaymentMethodSchema.optional(),
    idempotencyKey: z.string().min(12).optional()
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
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (process.env.DECK26_SYNC_SECRET ?? '') },
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


  // ============================================================================
  // ETAPA 6: ROTAS DE DELIVERY PRÓPRIO
  // ============================================================================

  app.get('/api/delivery/zones', async () => {
    return store.listDeliveryZones(false);
  });

  app.post('/api/delivery/zones', async (req, reply) => {
    const session = authorizePermission(req, reply, 'delivery:manage_orders');
    if (!session) return;
    const Schema = z.object({
      name: z.string().min(1),
      feeCents: z.number().int().nonnegative(),
      minimumOrderCents: z.number().int().nonnegative().default(0),
      estimatedMinutes: z.number().int().positive().default(40),
      active: z.boolean().default(true)
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    const zone = store.createDeliveryZone(parsed.data);
    return reply.status(201).send(zone);
  });

  app.put<{ Params: { id: string } }>('/api/delivery/zones/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'delivery:manage_orders');
    if (!session) return;
    const Schema = z.object({
      name: z.string().optional(),
      feeCents: z.number().int().nonnegative().optional(),
      minimumOrderCents: z.number().int().nonnegative().optional(),
      estimatedMinutes: z.number().int().positive().optional(),
      active: z.boolean().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const updated = store.updateDeliveryZone(req.params.id, parsed.data);
      return reply.send(updated);
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { status?: DeliveryCourierStatus } }>('/api/delivery/couriers', async (req) => {
    return store.listDeliveryCouriers(req.query.status);
  });

  app.post('/api/delivery/couriers', async (req, reply) => {
    const session = authorizePermission(req, reply, 'delivery:manage_couriers');
    if (!session) return;
    const Schema = z.object({
      name: z.string().min(1),
      phone: z.string().min(8),
      vehicleType: z.enum(['MOTO', 'BICICLETA', 'CARRO', 'OUTRO']).default('MOTO'),
      vehiclePlate: z.string().nullable().optional(),
      feePerDeliveryCents: z.number().int().nonnegative().default(500),
      status: DeliveryCourierStatusSchema.default('DISPONIVEL'),
      active: z.boolean().default(true)
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    const courier = store.createDeliveryCourier(parsed.data);
    return reply.status(201).send(courier);
  });

  app.patch<{ Params: { id: string } }>('/api/delivery/couriers/:id/status', async (req, reply) => {
    const session = authorizePermission(req, reply, 'delivery:manage_couriers');
    if (!session) return;
    const Schema = z.object({ status: DeliveryCourierStatusSchema });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const updated = store.updateDeliveryCourierStatus(req.params.id, parsed.data.status);
      return reply.send(updated);
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  app.put<{ Params: { id: string } }>('/api/delivery/couriers/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'delivery:manage_couriers');
    if (!session) return;
    const Schema = z.object({
      name: z.string().optional(),
      phone: z.string().optional(),
      vehicleType: z.enum(['MOTO', 'BICICLETA', 'CARRO', 'OUTRO']).optional(),
      vehiclePlate: z.string().nullable().optional(),
      feePerDeliveryCents: z.number().int().nonnegative().optional(),
      status: DeliveryCourierStatusSchema.optional(),
      active: z.boolean().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const updated = store.updateDeliveryCourier(req.params.id, parsed.data);
      return reply.send(updated);
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { search?: string } }>('/api/delivery/customers', async (req) => {
    return store.listDeliveryCustomers(req.query.search);
  });

  app.post('/api/delivery/customers', async (req, reply) => {
    const Schema = z.object({
      name: z.string().min(1),
      phone: z.string().min(8),
      document: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      notes: z.string().nullable().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    const customer = store.createOrUpdateDeliveryCustomer(parsed.data);
    return reply.status(201).send(customer);
  });

  app.post<{ Params: { id: string } }>('/api/delivery/customers/:id/addresses', async (req, reply) => {
    const Schema = z.object({
      street: z.string().min(1),
      number: z.string().min(1),
      complement: z.string().nullable().optional(),
      neighborhood: z.string().min(1),
      city: z.string().default('Santa Inês'),
      reference: z.string().nullable().optional(),
      deliveryZoneId: z.string().nullable().optional(),
      isDefault: z.boolean().default(false)
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const addr = store.addDeliveryAddress(req.params.id, parsed.data);
      return reply.status(201).send(addr);
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { status?: DeliveryOrderStatus; courierId?: string; customerId?: string; date?: string } }>(
    '/api/delivery/orders',
    async (req) => store.listDeliveryOrders(req.query)
  );

  app.get<{ Params: { id: string } }>('/api/delivery/orders/:id', async (req, reply) => {
    const order = store.getDeliveryOrderById(req.params.id);
    if (!order) return reply.status(404).send({ error: `Pedido '${req.params.id}' não encontrado.` });
    return reply.send(order);
  });

  app.post('/api/delivery/orders', async (req, reply) => {
    const Schema = z.object({
      customerId: z.string().optional(),
      customerName: z.string().min(1),
      customerPhone: z.string().min(8),
      customerDocument: z.string().optional(),
      customerEmail: z.string().optional(),
      deliveryType: DeliveryTypeSchema,
      origin: DeliveryOriginSchema,
      deliveryAddress: z.object({
        street: z.string().min(1),
        number: z.string().min(1),
        complement: z.string().nullable().optional(),
        neighborhood: z.string().min(1),
        city: z.string().default('Santa Inês'),
        reference: z.string().nullable().optional(),
        deliveryZoneId: z.string().nullable().optional(),
        isDefault: z.boolean().default(false)
      }).optional(),
      deliveryZoneId: z.string().optional(),
      items: z.array(z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
        notes: z.string().optional(),
        modifiers: z.array(z.object({
          groupId: z.string(),
          groupName: z.string(),
          optionId: z.string(),
          optionName: z.string(),
          priceDeltaCents: z.number().int().optional()
        })).optional()
      })).min(1),
      paymentMethodDeclared: PaymentMethodSchema,
      changeForCents: z.number().int().nullable().optional(),
      notes: z.string().optional(),
      courierId: z.string().optional()
    });

    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });

    const session = resolveSession(req);
    try {
      const result = store.createDeliveryOrder({
        ...parsed.data,
        waiterId: session?.userId ?? 'usr-cashier-01'
      });
      return reply.status(201).send(result);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.patch<{ Params: { id: string } }>('/api/delivery/orders/:id/status', async (req, reply) => {
    const session = authorizePermission(req, reply, 'delivery:manage_orders');
    if (!session) return;
    const Schema = z.object({
      status: DeliveryOrderStatusSchema,
      reason: z.string().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const updated = store.updateDeliveryOrderStatus(req.params.id, parsed.data.status, session.userId, parsed.data.reason);
      return reply.send(updated);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/delivery/orders/:id/dispatch', async (req, reply) => {
    const session = authorizePermission(req, reply, 'delivery:manage_orders');
    if (!session) return;
    const Schema = z.object({ courierId: z.string().min(1) });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const updated = store.dispatchDeliveryOrder(req.params.id, parsed.data.courierId, session.userId);
      return reply.send(updated);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/delivery/orders/:id/deliver', async (req, reply) => {
    const session = authorizePermission(req, reply, 'delivery:manage_orders');
    if (!session) return;
    try {
      const updated = store.updateDeliveryOrderStatus(req.params.id, 'ENTREGUE', session.userId);
      return reply.send(updated);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/delivery/orders/:id/cancel', async (req, reply) => {
    const session = authorizePermission(req, reply, 'delivery:manage_orders');
    if (!session) return;
    const Schema = z.object({ reason: z.string().min(1) });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const updated = store.updateDeliveryOrderStatus(req.params.id, 'CANCELADO', session.userId, parsed.data.reason);
      return reply.send(updated);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { courierId?: string } }>('/api/delivery/settlements', async (req) => {
    return store.listDeliverySettlements(req.query.courierId);
  });

  app.post('/api/delivery/settlements', async (req, reply) => {
    const session = authorizePermission(req, reply, 'delivery:settle');
    if (!session) return;
    const Schema = z.object({
      courierId: z.string().min(1),
      financialAccountId: z.string().default('acc-caixa-geral'),
      deliveryOrderIds: z.array(z.string()).min(1),
      shiftId: z.string().optional(),
      notes: z.string().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const settlement = store.settleCourierDeliveries({
        ...parsed.data,
        actorUserId: session.userId
      });
      return reply.status(201).send(settlement);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // ============================================================================
  // ETAPA 6: ROTAS DE GESTÃO FINANCEIRA, CONTAS E TESOURARIA
  // ============================================================================

  app.get('/api/finance/cost-centers', async () => store.listCostCenters());
  app.get('/api/finance/categories', async () => store.listFinancialCategories());
  app.get('/api/finance/accounts', async () => store.listFinancialAccounts());

  app.post('/api/finance/accounts', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:manage_accounts');
    if (!session) return;
    const Schema = z.object({
      name: z.string().min(1),
      type: FinancialAccountTypeSchema,
      bankName: z.string().nullable().optional(),
      accountNumber: z.string().nullable().optional(),
      pixKey: z.string().nullable().optional(),
      initialBalanceCents: z.number().int().default(0),
      active: z.boolean().default(true)
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    const acc = store.createFinancialAccount({ ...parsed.data, currentBalanceCents: parsed.data.initialBalanceCents });
    return reply.status(201).send(acc);
  });

  app.put<{ Params: { id: string } }>('/api/finance/accounts/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:manage_accounts');
    if (!session) return;
    const Schema = z.object({
      name: z.string().optional(),
      type: FinancialAccountTypeSchema.optional(),
      bankName: z.string().nullable().optional(),
      accountNumber: z.string().nullable().optional(),
      pixKey: z.string().nullable().optional(),
      active: z.boolean().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const updated = store.updateFinancialAccount(req.params.id, parsed.data);
      return reply.send(updated);
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  app.get('/api/finance/suppliers', async () => store.listSuppliers());

  app.post('/api/finance/suppliers', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:manage_suppliers');
    if (!session) return;
    const Schema = z.object({
      name: z.string().min(1),
      tradeName: z.string().nullable().optional(),
      document: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      contactPerson: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      active: z.boolean().default(true)
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    const sup = store.createSupplier(parsed.data);
    return reply.status(201).send(sup);
  });

  app.put<{ Params: { id: string } }>('/api/finance/suppliers/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:manage_suppliers');
    if (!session) return;
    const Schema = z.object({
      name: z.string().optional(),
      tradeName: z.string().nullable().optional(),
      document: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      contactPerson: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      active: z.boolean().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const updated = store.updateSupplier(req.params.id, parsed.data);
      return reply.send(updated);
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { status?: AccountsReceivableStatus; costCenterId?: string; startDate?: string; endDate?: string } }>(
    '/api/finance/receivables',
    async (req) => store.listAccountsReceivable(req.query)
  );

  app.post('/api/finance/receivables', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:manage_receivables');
    if (!session) return;
    const Schema = z.object({
      description: z.string().min(1),
      origin: z.enum(['TAB', 'DELIVERY', 'HOTEL_FOLIO', 'DIRECT_SALE', 'MANUAL']).default('MANUAL'),
      originReferenceId: z.string().optional(),
      costCenterId: z.string().min(1),
      categoryId: z.string().min(1),
      totalAmountCents: z.number().int().positive(),
      accrualDate: z.string(),
      dueDate: z.string(),
      status: z.enum(['PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELED']).default('PENDING'),
      customerName: z.string().optional(),
      notes: z.string().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    const ar = store.createAccountReceivable(parsed.data);
    return reply.status(201).send(ar);
  });

  app.post<{ Params: { id: string } }>('/api/finance/receivables/:id/pay', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:manage_receivables');
    if (!session) return;
    const Schema = z.object({
      amountCents: z.number().int().positive(),
      financialAccountId: z.string().min(1),
      paymentMethod: PaymentMethodSchema,
      settlementDate: z.string().optional(),
      notes: z.string().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const result = store.payAccountReceivable(req.params.id, {
        ...parsed.data,
        actorUserId: session.userId
      });
      return reply.send(result);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { status?: AccountsPayableStatus; costCenterId?: string; supplierId?: string; startDate?: string; endDate?: string } }>(
    '/api/finance/payables',
    async (req) => store.listAccountsPayable(req.query)
  );

  app.post('/api/finance/payables', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:manage_payables');
    if (!session) return;
    const Schema = z.object({
      description: z.string().min(1),
      origin: z.enum(['PURCHASE_INVOICE', 'OPERATIONAL_EXPENSE', 'PAYROLL', 'MAINTENANCE', 'UTILITY', 'MANUAL']).default('MANUAL'),
      originReferenceId: z.string().optional(),
      supplierId: z.string().optional(),
      supplierName: z.string().optional(),
      costCenterId: z.string().min(1),
      categoryId: z.string().min(1),
      totalAmountCents: z.number().int().positive(),
      accrualDate: z.string(),
      dueDate: z.string(),
      status: z.enum(['PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELED']).default('PENDING'),
      invoiceNumber: z.string().optional(),
      barcode: z.string().optional(),
      notes: z.string().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    const ap = store.createAccountPayable(parsed.data);
    return reply.status(201).send(ap);
  });

  app.post<{ Params: { id: string } }>('/api/finance/payables/:id/pay', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:manage_payables');
    if (!session) return;
    const Schema = z.object({
      amountCents: z.number().int().positive(),
      financialAccountId: z.string().min(1),
      paymentMethod: PaymentMethodSchema,
      settlementDate: z.string().optional(),
      notes: z.string().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const result = store.payAccountPayable(req.params.id, {
        ...parsed.data,
        actorUserId: session.userId
      });
      return reply.send(result);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { financialAccountId?: string; startDate?: string; endDate?: string } }>(
    '/api/finance/transactions',
    async (req) => store.listFinancialTransactions(req.query)
  );

  app.post('/api/finance/transfers', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:transfers');
    if (!session) return;
    const Schema = z.object({
      fromAccountId: z.string().min(1),
      toAccountId: z.string().min(1),
      amountCents: z.number().int().positive(),
      reason: z.string().min(1)
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const result = store.createFinancialTransfer({
        ...parsed.data,
        actorUserId: session.userId
      });
      return reply.status(201).send(result);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/finance/transfers', async () => store.listFinancialTransfers());

  app.get('/api/finance/purchases', async () => store.listPurchaseInvoices());

  app.post('/api/finance/purchases', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:manage_suppliers');
    if (!session) return;
    const Schema = z.object({
      invoiceNumber: z.string().min(1),
      supplierId: z.string().min(1),
      costCenterId: z.string().min(1),
      issueDate: z.string(),
      dueDate: z.string().optional(),
      items: z.array(z.object({
        productId: z.string().min(1),
        quantity: z.number().positive(),
        unitCostCents: z.number().int().nonnegative(),
        unitOfMeasure: z.string().optional()
      })).min(1),
      notes: z.string().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const result = store.createPurchaseInvoice({
        ...parsed.data,
        actorUserId: session.userId
      });
      return reply.status(201).send(result);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/finance/reconcile', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:reconcile');
    if (!session) return;
    const Schema = z.object({
      financialAccountId: z.string().min(1),
      reconciliationDate: z.string(),
      declaredPhysicalBalanceCents: z.number().int(),
      adjustBalance: z.boolean().default(false),
      notes: z.string().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });
    try {
      const result = store.reconcileFinancialAccount({
        ...parsed.data,
        actorUserId: session.userId
      });
      return reply.status(201).send(result);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { financialAccountId?: string } }>('/api/finance/reconciliations', async (req) => {
    return store.listAccountReconciliations(req.query.financialAccountId);
  });

  app.get('/api/finance/dashboard/charts', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:view_dre');
    if (!session) return;
    const updatedAt = new Date();
    const dailySales = Array.from({length: 7}, (_, index) => {
      const day = new Date(updatedAt); day.setUTCDate(day.getUTCDate() - (6-index));
      const date = day.toISOString().slice(0,10);
      return {date, salesCents: store.generateDreStatement({startDate:date,endDate:date}).grossRevenueCents};
    });
    const occupancy = [
      {name:'Ocupados',value:0,color:'#f72585'},
      {name:'Livres',value:0,color:'#4ade80'},
      {name:'Em limpeza',value:0,color:'#93c5fd'},
      {name:'Indisponíveis / obras',value:0,color:'#facc15'},
      {name:'Reservados',value:0,color:'#ba82e0'}
    ];
    for (const room of store.listHotelRooms()) {
      if (!room.active) continue;
      const unavailable = room.commercialStatus !== 'OPERACIONAL' || room.maintenanceStatus !== 'DISPONIVEL' || room.occupancyStatus === 'BLOQUEADO';
      const bucket = unavailable ? 3 : room.occupancyStatus === 'OCUPADO' || room.status === 'OCCUPIED' ? 0 : room.housekeepingStatus !== 'LIMPO' ? 2 : room.occupancyStatus === 'RESERVADO' || room.status === 'RESERVED' ? 4 : 1;
      occupancy[bucket]!.value++;
    }
    return {dailySales,occupancy,updatedAt:updatedAt.toISOString()};
  });

  app.get<{ Querystring: { startDate?: string; endDate?: string; costCenterId?: string } }>('/api/finance/dre', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:view_dre');
    if (!session) return;
    const start = req.query.startDate || new Date().toISOString().slice(0, 7) + '-01';
    const end = req.query.endDate || new Date().toISOString().slice(0, 10);
    return store.generateDreStatement({ startDate: start, endDate: end, costCenterId: req.query.costCenterId });
  });

  app.get<{ Querystring: { startDate?: string; endDate?: string; accountId?: string } }>('/api/finance/cash-flow/realized', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:view_dre');
    if (!session) return;
    const start = req.query.startDate || new Date().toISOString().slice(0, 7) + '-01';
    const end = req.query.endDate || new Date().toISOString().slice(0, 10);
    return store.generateCashFlowRealized({ startDate: start, endDate: end, accountId: req.query.accountId });
  });

  app.get<{ Querystring: { startDate?: string; endDate?: string } }>('/api/finance/cash-flow/projected', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:view_dre');
    if (!session) return;
    const start = req.query.startDate || new Date().toISOString().slice(0, 10);
    const end = req.query.endDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    return store.generateCashFlowProjected({ startDate: start, endDate: end });
  });

  app.get('/api/finance/dashboard', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:view_dre');
    if (!session) return;
    return store.getExecutiveDashboardMetrics();
  });

  app.get<{ Querystring: { type: string; startDate?: string; endDate?: string } }>('/api/finance/export/csv', async (req, reply) => {
    const session = authorizePermission(req, reply, 'finance:export_reports');
    if (!session) return;
    const reportType = (req.query.type || 'sales') as any;
    const csvData = store.exportReportCsv(reportType, req.query as Record<string, string>);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="deck26_${reportType}_${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(csvData);
  });

  // ============================================================================
  // 14. MÓDULO FISCAL PREPARATÓRIO — NFC-E / NF-E / NFS-E / MULTI-ESTABELECIMENTO
  // ============================================================================

  app.get('/api/fiscal/establishments', async (req, reply) => {
    const session = authorizePermission(req, reply, 'fiscal:configure');
    if (!session) return;
    return reply.send({ establishments: store.listFiscalEstablishments() });
  });

  app.post('/api/fiscal/establishments', async (req, reply) => {
    const session = authorizePermission(req, reply, 'fiscal:configure');
    if (!session) return;
    try {
      const establishment = store.saveFiscalEstablishment(req.body as any);
      return reply.status(201).send({ establishment });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao salvar dados fiscais do estabelecimento' });
    }
  });

  const SimulateFiscalEmissionSchema = z.object({
    establishmentId: z.string().optional(),
    documentType: FiscalDocumentTypeSchema.optional(),
    originReferenceType: z.enum(['TAB', 'STAY', 'DELIVERY_ORDER']),
    originReferenceId: z.string().min(1),
    customerTaxId: z.string().optional(),
    customerDocument: z.string().optional(),
    customerName: z.string().optional()
  });

  app.post('/api/fiscal/simulate', async (req, reply) => {
    if(process.env.DECK26_OPERATIONAL==='true')return reply.code(409).send({error:'Emissão fiscal não configurada. A operação local não gera documentos fiscais simulados.'});
    const session = authorizePermission(req, reply, 'pos:operate');
    if (!session) return;
    const parsed = SimulateFiscalEmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Parâmetros inválidos para emissão fiscal', issues: parsed.error.issues });
    }
    try {
      const doc = store.simulateFiscalDocumentEmission({
        ...parsed.data,
        customerTaxId: parsed.data.customerTaxId || parsed.data.customerDocument,
        operatorUserId: session.userId
      });
      return reply.status(201).send({ fiscalDocument: doc });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao simular emissão de documento fiscal' });
    }
  });

  app.get('/api/fiscal/documents', async (req, reply) => {
    const session = authorizePermission(req, reply, 'reports:view');
    if (!session) return;
    const q = req.query as { establishmentId?: string; documentType?: string; status?: string };
    const documents = store.listFiscalDocuments({
      establishmentId: q.establishmentId,
      documentType: q.documentType as any,
      status: q.status as any
    });
    return reply.send({ documents });
  });

  app.get<{ Params: { id: string } }>('/api/fiscal/documents/:id', async (req, reply) => {
    const session = authorizePermission(req, reply, 'reports:view');
    if (!session) return;
    const doc = store.getFiscalDocumentById(req.params.id);
    if (!doc) return reply.status(404).send({ error: 'Documento fiscal não encontrado' });
    return reply.send({ fiscalDocument: doc });
  });

  app.post<{ Params: { id: string } }>('/api/fiscal/documents/:id/cancel', async (req, reply) => {
    const session = authorizePermission(req, reply, 'tabs:discount_or_void');
    if (!session) return;
    const body = (req.body || {}) as { justification?: string; reason?: string };
    const reason = body.justification || body.reason || 'Cancelamento solicitado pelo operador';
    try {
      const doc = store.cancelFiscalDocument(req.params.id, reason, session.userId);
      return reply.send({ fiscalDocument: doc });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Erro ao cancelar documento fiscal' });
    }
  });

  registerExtensionRoutes(app,store,authorizePermission);
  registerDesktopRoutes(app,store,authorizePermission,resolveSession);
  registerOperationRoutes(app,store,authorizePermission);
  registerFiscalPreparationRoutes(app,store,authorizePermission);
  return {
    app,
    store,
    setCloudApiUrl: (newUrl: string) => {
      cloudApiUrl = newUrl;
    }
  };
}
