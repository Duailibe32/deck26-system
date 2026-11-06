import { z } from 'zod';
import {deliveryServiceSchema} from './delivery-service.js';
import type { DatabaseSync } from 'node:sqlite';
import type { CatalogProduct, SalesChannel } from '@deck26/contracts';
import { resolveChannelPriceCents } from '@deck26/contracts';
export const localDate = (date: Date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Fortaleza',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(date);
export function localClock(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return {
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    minute: Number(get('hour')) * 60 + Number(get('minute'))
  };
}
export function inSchedule(weekdays: number[], startMinute: number, endMinute: number, at: Date) {
  const {
    day,
    minute
  } = localClock(at);
  return startMinute <= endMinute ? weekdays.includes(day) && minute >= startMinute && minute <= endMinute : minute >= startMinute ? weekdays.includes(day) : minute <= endMinute && weekdays.includes((day + 6) % 7);
}
export const promotionSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  name: z.string().min(2).max(100),
  active: z.boolean(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  discountBps: z.number().int().min(1).max(10000),
  productIds: z.array(z.string()).min(1).max(200),
  channels: z.array(z.enum(['DINE_IN', 'COUNTER_PDV', 'QR_TABLE', 'DELIVERY', 'PICKUP', 'HOTEL_ROOM'])).min(1).max(6)
}).strict();
export function promotionalPrice(db: DatabaseSync, product: CatalogProduct, channel: SalesChannel, at: Date = new Date()) {
  const base = resolveChannelPriceCents(product, channel);
  const rows = db.prepare('SELECT json FROM promotion_rules').all() as {
    json: string;
  }[];
  const rules = rows.map(row => promotionSchema.parse(JSON.parse(row.json))).filter(rule => rule.active && rule.productIds.includes(product.id) && rule.channels.includes(channel) && inSchedule(rule.weekdays, rule.startMinute, rule.endMinute, at));
  const discount = Math.max(0, ...rules.map(rule => rule.discountBps));
  return {
    priceCents: Math.max(0, Math.round(base * (10000 - discount) / 10000)),
    originalPriceCents: base,
    discountBps: discount
  };
}
export const settingsSchema = z.object({
  deliveryService: deliveryServiceSchema.default(()=>deliveryServiceSchema.parse({})),
  kitchenWorkflow: z.enum(['PAPER', 'KDS']).default('PAPER'),
  deliveryBaseMin: z.number().int().min(5).max(240).default(30),
  deliveryBaseMax: z.number().int().min(5).max(300).default(45),
  deliveryBusyThreshold: z.number().int().min(1).max(100).default(12),
  deliveryBusyExtra: z.number().int().min(0).max(180).default(20),
  breakfastPrintMinute: z.number().int().min(0).max(1439).default(360),
  breakfastServiceEnd: z.number().int().min(0).max(1439).default(630),
  cover: z.object({
    enabled: z.boolean().default(false),
    weekdays: z.array(z.number().int().min(0).max(6)).default([5, 6]),
    startMinute: z.number().int().min(0).max(1439).default(1200),
    endMinute: z.number().int().min(0).max(1439).default(1439),
    unitCents: z.number().int().min(0).max(100000).default(0),
    notice: z.string().max(400).default('')
  }).default({
    enabled: false,
    weekdays: [5, 6],
    startMinute: 1200,
    endMinute: 1439,
    unitCents: 0,
    notice: ''
  })
});
export function extensionSettings(db: DatabaseSync) {
  const row = db.prepare('SELECT json FROM extension_settings WHERE id=1').get() as {
    json: string;
  } | undefined;
  return settingsSchema.parse(row ? JSON.parse(row.json) : {});
}
export const stayOptionsSchema = z.object({
  plan: z.enum(['NIGHT', 'DAILY', 'DAY_USE_4H', 'DAY_USE_6H']).default('DAILY'),
  breakfastIncluded: z.boolean().default(false),
  breakfastGuests: z.number().int().min(1).max(20).default(1),
  breakfastAllowanceCents: z.number().int().min(0).max(100000).default(0),
  vehiclePlate: z.string().trim().max(15).default(''),
  vehicleModel: z.string().trim().max(80).default('')
}).superRefine((value, context) => {
  if (value.breakfastIncluded && !value.breakfastAllowanceCents) context.addIssue({
    code: 'custom',
    path: ['breakfastAllowanceCents'],
    message: 'Informe o crédito de café por pessoa/dia.'
  });
});
export type StayOptions = z.infer<typeof stayOptionsSchema>;
export function saveStayOptions(db: DatabaseSync, stay: {
  id: string;
  checkInAt: string;
  checkOutScheduledAt: string;
}, raw: unknown) {
  const data = stayOptionsSchema.parse(raw);
  db.prepare('INSERT INTO hotel_stay_options VALUES(?,?) ON CONFLICT(stay_id) DO UPDATE SET json=excluded.json').run(stay.id, JSON.stringify(data));
  if (!data.breakfastIncluded) return;
  const start = new Date(localDate(new Date(stay.checkInAt)) + 'T06:00:00-03:00');
  for (let index = 0; index < 367; index++) {
    const day = new Date(start.getTime() + index * 86400000);
    if (day.getTime() > Date.parse(stay.checkOutScheduledAt)) break;
    const endOfBreakfast = day.getTime() + (extensionSettings(db).breakfastServiceEnd - 360) * 60000;
    if (endOfBreakfast < Date.parse(stay.checkInAt)) continue;
    for (let guest = 1; guest <= data.breakfastGuests; guest++) db.prepare('INSERT OR IGNORE INTO breakfast_vouchers(id,stay_id,service_date,guest_index,allowance_cents) VALUES(lower(hex(randomblob(16))),?,?,?,?)').run(stay.id, localDate(day), guest, data.breakfastAllowanceCents);
  }
}
export function plannedCheckout(raw: {
  checkInAt?: string;
  checkOutScheduledAt: string;
  options?: unknown;
}) {
  const options = stayOptionsSchema.parse(raw.options ?? {});
  if (options.plan === 'DAY_USE_4H' || options.plan === 'DAY_USE_6H') return new Date(Date.parse(raw.checkInAt ?? new Date().toISOString()) + (options.plan === 'DAY_USE_4H' ? 4 : 6) * 3600000).toISOString();
  return raw.checkOutScheduledAt;
}
export function activeCover(db: DatabaseSync, guests: number, at: Date = new Date()) {
  const rule = extensionSettings(db).cover;
  return rule.enabled && rule.unitCents > 0 && rule.notice.trim() && inSchedule(rule.weekdays, rule.startMinute, rule.endMinute, at) ? {
    unitCents: rule.unitCents,
    totalCents: rule.unitCents * guests,
    notice: rule.notice
  } : null;
}
