import { z } from 'zod';
import {lookupCep} from './delivery-cep.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { hasPermission, type Permission } from '@deck26/contracts';
import type { LocalOperationalStore } from './store.js';
import { OperationExtensions, type Actor, orderItemsSchema } from './operation-extensions.js';
import { extensionSettings } from './extension-models.js';
type Auth = (req: FastifyRequest, reply: FastifyReply, permission: Permission) => Actor | null;
export function registerExtensionRoutes(app: FastifyInstance, store: LocalOperationalStore, auth: Auth) {
  const ops = new OperationExtensions(store);
  const safe = (reply: FastifyReply, work: () => unknown) => {
    try {
      return work();
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof z.ZodError ? error.issues.map(i => i.message).join('; ') : (error as Error).message
      });
    }
  };
  const post = (url: string, permission: Permission, work: (body: any, actor: Actor) => unknown) => app.post(url, (req, reply) => {
    const actor = auth(req, reply, permission);
    if (!actor) return;
    return safe(reply, () => work(req.body, actor));
  });
  const get = (url: string, permission: Permission, work: (req: FastifyRequest, actor: Actor) => unknown) => app.get(url, (req, reply) => {
    const actor = auth(req, reply, permission);
    if (!actor) return;
    return safe(reply, () => work(req, actor));
  });
  get('/api/ops/settings', 'orders:create', () => ({
    kitchenWorkflow: extensionSettings(store.db).kitchenWorkflow,
    cover: extensionSettings(store.db).cover
  }));
  get('/api/ops/config', 'staff:manage', () => ({
    settings: extensionSettings(store.db),
    promotions: ops.jsonTable('promotion_rules')
  }));
  post('/api/ops/settings', 'staff:manage', (body, a) => ops.saveSettings(body, a));
  post('/api/ops/promotions', 'catalog:manage', (body, a) => ops.savePromotion(body, a));
  get('/api/ops/hotel', 'hotel:manage_rooms', () => ops.hotelOps());
  get('/api/ops/breakfast', 'orders:create', () => ops.hotelOps().breakfast.map(({
    guest_name,
    ...v
  }) => v));
  post('/api/ops/breakfast/redeem', 'orders:create', (body, a) => ops.breakfastRedeem(body, a));
  post('/api/ops/maintenance', 'hotel:maintenance', (body, a) => ops.saveMaintenance(body, a));
  post('/api/ops/maintenance/complete', 'hotel:maintenance', (body, a) => ops.completeMaintenance(z.object({
    id: z.string()
  }).parse(body).id, a));
  get('/api/ops/companies', 'hotel:post_charges', () => ops.companies());
  get('/api/ops/company-finance', 'finance:manage_receivables', () => ({
    companies: ops.companies(),
    charges: ops.rows('SELECT * FROM company_charges ORDER BY created_at DESC LIMIT 300'),
    invoices: ops.rows('SELECT i.*,a.description,a.remaining_amount_cents,a.due_date,a.status FROM company_invoices i JOIN accounts_receivable a ON a.id=i.receivable_id ORDER BY i.created_at DESC LIMIT 100')
  }));
  post('/api/ops/companies', 'finance:manage_accounts', (body, a) => ops.saveCompany(body, a));
  post('/api/ops/company-charge', 'hotel:post_charges', (body, a) => ops.chargeCompany(body, a));
  post('/api/ops/company-invoice', 'finance:manage_receivables', (body, a) => {
    const d = z.object({
      companyId: z.string(),
      start: z.iso.date(),
      end: z.iso.date()
    }).strict().parse(body);
    return ops.invoice(d.companyId, d.start, d.end, a);
  });
  get('/api/ops/stock', 'stock:adjust', () => ({
    shopping: ops.shopping(),
    margins: ops.margins(),
    suppliers: store.listSuppliers(),
    supplierLinks: ops.rows('SELECT * FROM product_suppliers'),
    production: ops.rows('SELECT * FROM production_batches ORDER BY created_at DESC LIMIT 30'),
    internalMeals: ops.rows('SELECT * FROM internal_meals ORDER BY created_at DESC LIMIT 30')
  }));
  post('/api/ops/production', 'stock:adjust', (body, a) => ops.production(body, a));
  post('/api/ops/staff-meal', 'tabs:discount_or_void', (body, a) => ops.staffMeal(body, a));
  post('/api/ops/margin', 'catalog:manage', (body, a) => {
    const d = z.object({
      productId: z.string(),
      targetBps: z.number().int().min(1).max(9999)
    }).strict().parse(body);
    ops.watchMargin(d.productId, d.targetBps, a);
    return {
      saved: true
    };
  });
  post('/api/ops/margin/apply', 'catalog:manage', (body, a) => {
    const d = z.object({
      productId: z.string(),
      expectedPriceCents: z.number().int().positive()
    }).strict().parse(body);
    ops.applySuggestedPrice(d.productId, d.expectedPriceCents, a);
    return {
      saved: true
    };
  });
  post('/api/ops/supplier-link', 'finance:manage_suppliers', (body, a) => {
    const d = z.object({
      productId: z.string(),
      supplierId: z.string()
    }).strict().parse(body);
    store.db.prepare('INSERT INTO product_suppliers VALUES(?,?) ON CONFLICT(product_id) DO UPDATE SET supplier_id=excluded.supplier_id').run(d.productId, d.supplierId);
    ops.audit(a, 'SUPPLIER_PRODUCT_LINKED', d.productId);
    return {
      saved: true
    };
  });
  post('/api/ops/executive-choices', 'catalog:manage', (body, a) => {
    ops.configureExecutive(z.object({
      productId: z.string()
    }).parse(body).productId, a);
    return {
      saved: true
    };
  });
  post('/api/ops/bucket', 'catalog:manage', (body, a) => {
    const d = z.object({
      productId: z.string(),
      ingredientId: z.string(),
      quantity: z.number().int().min(1).max(100)
    }).strict().parse(body);
    return ops.configureBucket(d.productId, d.ingredientId, d.quantity, a);
  });
  get('/api/ops/shift-summary', 'pos:open_close_register', req => ops.summary(z.object({
    day: z.iso.date().optional()
  }).parse(req.query).day));
  get('/api/ops/delivery-service','delivery:manage_orders',(_req,a)=>({config:ops.deliveryService(),canConfigure:hasPermission(a.role,'staff:manage')}));
  post('/api/ops/delivery-service','staff:manage',(body,a)=>ops.saveDeliveryService(body,a));
  get('/api/ops/delivery-label/:id','delivery:manage_orders',(req,a)=>ops.deliveryLabel(z.string().max(100).parse((req.params as any).id),a));
  get('/api/ops/delivery-inbox', 'delivery:manage_orders', () => ops.deliveryInbox());
  post('/api/ops/delivery-decision', 'delivery:manage_orders', (body, a) => {
    const d = z.object({
      id: z.string(),
      accept: z.boolean()
    }).strict().parse(body);
    return ops.decideDelivery(d.id, d.accept, a);
  });
  get('/api/ops/delivery-repeat', 'delivery:manage_orders', req => ops.repeatLast(z.object({
    phone: z.string().max(25)
  }).parse(req.query).phone));
  const cepCache=new Map<string,{at:number;value:Awaited<ReturnType<typeof lookupCep>>}>(),cepRate=new Map<string,{at:number;count:number}>();
  app.get('/api/public/delivery/cep/:cep',async(req,reply)=>{
    const now=Date.now();const parsed=z.string().regex(/^\d{8}$/).safeParse((req.params as any).cep);
    if(!parsed.success)return reply.code(400).send({error:'Informe um CEP com oito dígitos.'});
    const old=cepRate.get(req.ip);if(old&&now-old.at<60000&&old.count>=15)return reply.code(429).send({error:'Aguarde um minuto ou preencha o endereço manualmente.'});
    if(cepRate.size>=4096&&!old){for(const [key,value] of cepRate)if(now-value.at>60000)cepRate.delete(key);if(cepRate.size>=4096)return reply.code(429).send({error:'Tente novamente mais tarde.'});}
    cepRate.set(req.ip,old&&now-old.at<60000?{...old,count:old.count+1}:{at:now,count:1});
    const cached=cepCache.get(parsed.data);if(cached&&now-cached.at<86400000)return cached.value??reply.code(404).send({error:'CEP não encontrado. Preencha manualmente.'});
    try {const value=await lookupCep(parsed.data);if(cepCache.size>=500)cepCache.delete(cepCache.keys().next().value!);cepCache.set(parsed.data,{at:now,value});return value??reply.code(404).send({error:'CEP não encontrado. Preencha manualmente.'});}
    catch{return reply.code(503).send({error:'Consulta indisponível. Preencha o endereço manualmente.'});}
  });
  app.get('/api/public/delivery/catalog', (_req, reply) => safe(reply, () => ops.publicCatalog('DELIVERY')));
  app.post('/api/public/delivery/quote', (req, reply) => safe(reply, () => ops.deliveryQuote(z.object({
    items: orderItemsSchema,
    deliveryType: z.enum(['DELIVERY', 'PICKUP']),
    deliveryZoneId: z.string().optional(),
    deliveryAddress: z.any().optional()
  }).strict().parse(req.body))));
  const rate = new Map<string, {
    at: number;
    count: number;
  }>();
  app.post('/api/public/delivery/requests', (req, reply) => {
    const ip = req.ip;
    const prior = rate.get(ip);
    if (prior && Date.now() - prior.at < 60000 && prior.count >= 12) return reply.code(429).send({
      error: 'Aguarde um minuto antes de novos envios.'
    });
    if (rate.size >= 4096 && !rate.has(ip)) return reply.code(429).send({
      error: 'Muitas solicitações. Aguarde um minuto.'
    });
    if (rate.size > 3000) for (const [key, v] of rate) if (Date.now() - v.at > 60000) rate.delete(key);
    rate.set(ip, prior && Date.now() - prior.at < 60000 ? {
      ...prior,
      count: prior.count + 1
    } : {
      at: Date.now(),
      count: 1
    });
    return safe(reply, () => ops.submitDelivery(req.body));
  });
  app.get('/api/public/delivery/status/:key', (req, reply) => safe(reply, () => ops.deliveryStatus(z.string().regex(/^delivery-[a-f0-9]{32}$/).parse((req.params as any).key))));
  app.get('/api/public/menu/:token', (req, reply) => safe(reply, () => {
    const table = store.getDiningTableByQrToken(z.string().min(10).max(200).parse((req.params as any).token));
    if (!table) throw Error('QR da mesa não encontrado.');
    return {
      ...ops.publicCatalog('QR_TABLE'),
      table: {
        tableNumber: table.tableNumber,
        open: !!table.activeTabId
      }
    };
  }));
  const timer = setInterval(() => {
    try {
      ops.tick();
    } catch (error) {
      app.log.error({
        error: String(error)
      }, 'Rotina operacional não concluída; será reavaliada.');
    }
  }, 60000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
  app.addHook('onReady', async () => {
    try {
      ops.tick();
    } catch (error) {
      app.log.error({
        error: String(error)
      }, 'Rotina inicial não concluída.');
    }
  });
  return ops;
}
