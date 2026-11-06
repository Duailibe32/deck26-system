import { z } from 'zod';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LocalOperationalStore } from './store.js';
import type { Actor } from './operation-extensions.js';
import type { Permission } from '@deck26/contracts';
type Auth = (req: FastifyRequest, reply: FastifyReply, permission: Permission) => Actor | null;
const quantity = z.number().finite().min(0).max(1000000).refine(v => Math.abs(v * 1000 - Math.round(v * 1000)) < 0.00001, 'Use até três casas decimais.');
export const quickStockSchema = z.object({
  idempotencyKey: z.string().regex(/^stock-ui-[a-f0-9]{32}$/),
  productId: z.string().min(1).max(100),
  mode: z.enum(['ENTRY', 'LOSS', 'INTERNAL', 'COUNT']),
  quantity,
  expectedQuantity: z.number().finite(),
  unitCostCents: z.number().int().min(0).max(100000000).optional(),
  reason: z.string().trim().min(3).max(280)
}).strict().refine(v => v.mode === 'COUNT' || v.quantity > 0, 'Informe uma quantidade maior que zero.').refine(v => v.mode === 'ENTRY' || v.unitCostCents === undefined, 'Custo só pode ser informado na entrada.');
export function quickStock(store: LocalOperationalStore, raw: unknown, actor: Actor) {
  const data = quickStockSchema.parse(raw),
    hash = crypto.createHash('sha256').update(JSON.stringify({
      data,
      actorId: actor.userId
    })).digest('hex');
  return store.runOperationalTransaction(() => {
    const previous = store.db.prepare("SELECT metadata_json FROM audit_logs WHERE entity_type='STOCK_QUICK' AND entity_id=? AND action='STOCK_QUICK_RECORDED'").get(data.idempotencyKey) as {
      metadata_json: string;
    } | undefined;
    if (previous) {
      const metadata = JSON.parse(previous.metadata_json);
      if (metadata.hash !== hash) throw Error('Este reenvio mudou de conteúdo. Consulte o movimento original.');
      return {
        ...metadata.result,
        idempotentReplay: true
      };
    }
    const product = store.getProductById(data.productId);
    if (!product?.active || !product.trackStock) throw Error('Escolha um produto ativo com controle de estoque.');
    const current = store.getProductStockQuantity(product.id);
    if (Math.abs(current - data.expectedQuantity) > 0.000001) throw Error('O saldo mudou durante a conferência. Atualize e revise a quantidade antes de reenviar.');
    const delta = Math.round((data.mode === 'COUNT' ? data.quantity - current : data.mode === 'LOSS' || data.mode === 'INTERNAL' ? -data.quantity : data.quantity) * 1000) / 1000;
    if (current + delta < -0.000001) throw Error('Saída maior que o saldo disponível. Confira o inventário.');
    const movement = delta === 0 ? null : store.adjustStock({
      idempotencyKey: data.idempotencyKey,
      productId: product.id,
      quantityDelta: delta,
      movementType: data.mode === 'ENTRY' ? 'PURCHASE_ENTRY' : data.mode === 'COUNT' ? 'INVENTORY_ADJUST' : data.mode === 'LOSS' ? 'WASTE_OR_LOSS' : 'INTERNAL_USE',
      unitCostCents: data.unitCostCents,
      reason: data.reason,
      userId: actor.userId,
      originChannel: 'STOCK_QUICK'
    }).movement;
    const result = {
      productId: product.id,
      previousQuantity: current,
      currentQuantity: Math.round((current + delta) * 1000) / 1000,
      delta,
      movement,
      idempotentReplay: false
    };
    store.recordAuditLog({
      actorUserId: actor.userId,
      action: 'STOCK_QUICK_RECORDED',
      entityType: 'STOCK_QUICK',
      entityId: data.idempotencyKey,
      metadata: {
        hash,
        result,
        mode: data.mode,
        reason: data.reason
      }
    });
    return result;
  });
}
/** Only locally compressed JPEGs are stored. No external URL or SVG is accepted. */
export function decodeProductPhoto(value: string) {
  if (!value.startsWith('data:image/jpeg;base64,') || value.length > 850000) throw Error('Use uma foto JPEG de até 600 KB.');
  const encoded = value.slice(23);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw Error('Foto inválida.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > 600000 || bytes.length < 50 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw Error('Arquivo JPEG inválido.');
  let offset = 2,
    dimensions = false;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 255) break;
    const marker = bytes[offset + 1]!;
    if (marker === 0xda) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) throw Error('Estrutura JPEG inválida.');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const height = bytes.readUInt16BE(offset + 5),
        width = bytes.readUInt16BE(offset + 7);
      if (!width || !height || width > 2000 || height > 2000) throw Error('A foto deve ter até 2000 pixels por lado.');
      dimensions = true;
      break;
    }
    offset += length + 2;
  }
  if (!dimensions) throw Error('Não foi possível validar as dimensões da foto.');
  return bytes;
}
export function registerStockExperienceRoutes(app: FastifyInstance, store: LocalOperationalStore, auth: Auth) {
  app.post('/api/ops/stock-quick', (req, reply) => {
    const actor = auth(req, reply, 'stock:adjust');
    if (!actor) return;
    try {
      return quickStock(store, req.body, actor);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof z.ZodError ? error.issues.map(v => v.message).join('; ') : (error as Error).message
      });
    }
  });
  app.post('/api/ops/product-photo', (req, reply) => {
    const actor = auth(req, reply, 'catalog:manage');
    if (!actor) return;
    try {
      const data = z.object({
        productId: z.string().min(1).max(100),
        dataUrl: z.string().max(850000).nullable()
      }).strict().parse(req.body);
      const product = store.getProductById(data.productId);
      if (!product?.active) throw Error('Produto ativo não encontrado.');
      const jpeg = data.dataUrl === null ? null : decodeProductPhoto(data.dataUrl);
      const digest = jpeg ? crypto.createHash('sha256').update(product.id).update(jpeg).digest('hex') : null;
      store.runOperationalTransaction(() => {
        if (jpeg) store.db.prepare('INSERT INTO product_photos VALUES(?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET digest=excluded.digest,jpeg=excluded.jpeg,updated_at=excluded.updated_at').run(product.id, digest, jpeg, new Date().toISOString());else store.db.prepare('DELETE FROM product_photos WHERE product_id=?').run(product.id);
        store.updateCatalogProduct(product.id, {
          imageUrl: digest ? '/api/public/product-photos/' + digest + '.jpg' : null
        });
        store.recordAuditLog({
          actorUserId: actor.userId,
          action: jpeg ? 'PRODUCT_PHOTO_UPDATED' : 'PRODUCT_PHOTO_REMOVED',
          entityType: 'CATALOG_PRODUCT',
          entityId: product.id,
          metadata: {
            bytes: jpeg?.length ?? 0
          }
        });
      });
      return {
        saved: true,
        imageUrl: digest ? '/api/public/product-photos/' + digest + '.jpg' : null
      };
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message
      });
    }
  });
  app.get('/api/public/product-photos/:file', (req, reply) => {
    const file = (req.params as {
      file: string;
    }).file;
    if (!/^[a-f0-9]{64}\.jpg$/.test(file)) return reply.code(404).send({
      error: 'Foto não encontrada.'
    });
    const photo = store.db.prepare('SELECT f.jpeg FROM product_photos f JOIN catalog_products p ON p.id=f.product_id WHERE f.digest=? AND p.active=1').get(file.slice(0, -4)) as {
      jpeg: Uint8Array;
    } | undefined;
    if (!photo) return reply.code(404).send({
      error: 'Foto não encontrada.'
    });
    return reply.header('Content-Type', 'image/jpeg').header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'public,max-age=3600').send(Buffer.from(photo.jpeg));
  });
}
