import { z } from 'zod';
import type { DeliveryOrder } from '@deck26/contracts';
export const deliveryServiceSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['AUTO', 'CLOSED']).default('AUTO'),
  pausedUntil: z.iso.datetime().nullable().default(null),
  notice: z.string().trim().max(200).default(''),
  hours: z.array(z.object({
    day: z.number().int().min(0).max(6),
    open: z.number().int().min(0).max(1439),
    close: z.number().int().min(0).max(1439)
  }).strict().refine(v => v.open !== v.close, 'Abertura e fechamento devem ser diferentes.')).max(28).default([]),
  closedDates: z.array(z.iso.date()).max(180).default([]),
  suggestionIds: z.array(z.string().min(1).max(100)).max(8).default([]),
  slaMinutes: z.number().int().min(5).max(240).default(30)
}).strict();
export type DeliveryService = z.infer<typeof deliveryServiceSchema>;
export function deliveryAvailability(config: DeliveryService, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short'
  }).formatToParts(at);
  const part = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday')),
    minute = Number(part('hour')) * 60 + Number(part('minute'));
  const date = part('year') + '-' + part('month') + '-' + part('day');
  const result = (open: boolean, reason: string, message: string) => ({
    open,
    reason,
    message,
    notice: config.notice,
    pausedUntil: config.pausedUntil
  });
  if (config.mode === 'CLOSED') return result(false, 'MANUAL', 'Pedidos online encerrados por enquanto.');
  if (config.pausedUntil && Date.parse(config.pausedUntil) > at.getTime()) return result(false, 'PAUSED', 'Pedidos pausados · retorno às ' + new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(config.pausedUntil)));
  if (config.closedDates.includes(date)) return result(false, 'EXCEPTION', 'Não recebemos pedidos online nesta data.');
  if (!config.enabled) return result(true, 'OPEN', 'Recebendo pedidos online');
  const open = config.hours.some(h => h.open < h.close ? day === h.day && minute >= h.open && minute < h.close : day === h.day && minute >= h.open || day === (h.day + 1) % 7 && minute < h.close);
  return open ? result(true, 'OPEN', 'Recebendo pedidos online') : result(false, 'SCHEDULE', 'Fora do horário de pedidos online.');
}
export function deliveryStageAge(order: Pick<DeliveryOrder, 'createdAt' | 'updatedAt'>, at = Date.now()) {
  return Math.max(0, Math.floor((at - Date.parse(order.updatedAt || order.createdAt)) / 60000));
}
export function packageLabel(order: DeliveryOrder, items: Array<{
  productName: string;
  quantity: number;
  notes?: string;
  modifiers?: Array<{
    optionName: string;
  }>;
}>) {
  const clean = (v: unknown) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 200);
  return ['DECK 26 · EXPEDIÇÃO', 'PEDIDO #' + order.orderNumber, 'Cliente: ' + clean(order.customerName), order.deliveryType === 'TAKEOUT' ? 'RETIRADA NO BALCÃO' : 'ENTREGA', ...(order.deliveryAddress ? ['Endereço: ' + clean(order.deliveryAddress.street) + ', ' + clean(order.deliveryAddress.number), 'Bairro: ' + clean(order.deliveryAddress.neighborhood), 'Referência: ' + clean(order.deliveryAddress.reference)] : []), '--------------------------------', ...items.flatMap(i => [i.quantity + 'x ' + clean(i.productName), ...(i.modifiers ?? []).map(m => '  + ' + clean(m.optionName)), ...(i.notes ? ['  OBS: ' + clean(i.notes)] : [])]), '--------------------------------', 'Conferido por: __________________', 'Volumes: ____ de ____', 'SIMULAÇÃO · SEM VALIDADE FISCAL'].join('\n');
}
