import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';

// ============================================================================
// DECK 26 — PREPARAÇÃO FISCAL (MÓDULO ESTRUTURAL & MULTI-ESTABELECIMENTO)
// ============================================================================

export const FiscalEstablishmentSegmentSchema = z.enum(['RESTAURANT', 'HOTEL', 'MIXED']);
export type FiscalEstablishmentSegment = z.infer<typeof FiscalEstablishmentSegmentSchema>;

export const FiscalTaxRegimeSchema = z.enum(['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL']);
export type FiscalTaxRegime = z.infer<typeof FiscalTaxRegimeSchema>;

export const FiscalEstablishmentSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1), // Ex: "RESTAURANTE", "HOTEL"
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve conter 14 dígitos numéricos'),
  razaoSocial: z.string().min(1),
  nomeFantasia: z.string().min(1),
  inscricaoEstadual: z.string().default(''),
  inscricaoMunicipal: z.string().default(''),
  cnae: z.string().default(''),
  taxRegime: FiscalTaxRegimeSchema.default('SIMPLES_NACIONAL'),
  segment: FiscalEstablishmentSegmentSchema.default('RESTAURANT'),
  addressStreet: z.string().default(''),
  addressNumber: z.string().default(''),
  addressCity: z.string().default(''),
  addressState: z.string().length(2).default('MA'),
  addressPostalCode: z.string().default(''),
  active: z.boolean().default(true),
  updatedAt: IsoDateTimeSchema
});
export type FiscalEstablishment = z.infer<typeof FiscalEstablishmentSchema>;

export const FiscalDocumentTypeSchema = z.enum([
  'NFCE', // Nota Fiscal Consumidor Eletrônica (Mod 65 - Restaurante / Bar / Delivery)
  'NFE',  // Nota Fiscal Eletrônica (Mod 55 - B2B / Transferências / Atacado)
  'NFSE', // Nota Fiscal de Serviços Eletrônica (Municipal - Diárias Hotel)
  'PRE_CONTA', // Conferência não-fiscal para mesa/hóspede
  'COMPROVANTE_PAGAMENTO' // Comprovante não-fiscal de transação TEF/Dinheiro/PIX
]);
export type FiscalDocumentType = z.infer<typeof FiscalDocumentTypeSchema>;

export const FiscalDocumentStatusSchema = z.enum([
  'SIMULATED_DEMO',
  'DRAFT',
  'EMITTED',
  'CANCELED',
  'REJECTED'
]);
export type FiscalDocumentStatus = z.infer<typeof FiscalDocumentStatusSchema>;

export const FiscalItemTaxSummarySchema = z.object({
  productId: z.string().optional(),
  name: z.string(),
  quantity: z.number().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  ncm: z.string().default('2106.90.90'),
  cfop: z.string().default('5.102'),
  csosn: z.string().default('102')
});
export type FiscalItemTaxSummary = z.infer<typeof FiscalItemTaxSummarySchema>;

export const FiscalDocumentRecordSchema = z.object({
  id: z.string().min(1),
  documentType: FiscalDocumentTypeSchema,
  establishmentId: z.string().min(1),
  establishmentCnpj: z.string(),
  series: z.number().int().default(1),
  number: z.number().int().positive(),
  accessKey: z.string().default(''),
  originReferenceType: z.enum(['TAB', 'STAY', 'DELIVERY_ORDER']),
  originReferenceId: z.string().min(1),
  customerName: z.string().default('Consumidor Final'),
  customerTaxId: z.string().default(''),
  grossTotalCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative().default(0),
  netTotalCents: z.number().int().nonnegative(),
  taxSummary: z.object({
    icmsCents: z.number().int().default(0),
    pisCents: z.number().int().default(0),
    cofinsCents: z.number().int().default(0),
    issCents: z.number().int().default(0),
    approximateTaxesCents: z.number().int().default(0)
  }),
  itemsSummary: z.array(FiscalItemTaxSummarySchema).default([]),
  status: FiscalDocumentStatusSchema.default('SIMULATED_DEMO'),
  isSimulated: z.boolean().default(true),
  watermark: z.string().default('SEM VALIDADE FISCAL - DEMO'),
  qrCodeUrl: z.string().default(''),
  simulatedXml: z.string().default(''),
  simulatedDanfeText: z.string().default(''),
  cancellationReason: z.string().optional(),
  canceledAt: IsoDateTimeSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});
export type FiscalDocumentRecord = z.infer<typeof FiscalDocumentRecordSchema>;

export const DECK26_INITIAL_FISCAL_ESTABLISHMENTS: FiscalEstablishment[] = [
  {
    id: 'est-restaurante',
    code: 'RESTAURANTE',
    cnpj: '12345678000190',
    razaoSocial: 'DECK 26 RESTAURANTE E EVENTOS LTDA',
    nomeFantasia: 'DECK 26 RESTAURANTE & BAR',
    inscricaoEstadual: '123456789',
    inscricaoMunicipal: '987654',
    cnae: '5611-2/01',
    taxRegime: 'SIMPLES_NACIONAL',
    segment: 'RESTAURANT',
    addressStreet: 'Rodovia BR-135, Km 26',
    addressNumber: 'S/N',
    addressCity: 'São Luís',
    addressState: 'MA',
    addressPostalCode: '65000-000',
    active: true,
    updatedAt: '2026-11-05T00:00:00.000Z'
  },
  {
    id: 'est-hotel',
    code: 'HOTEL',
    cnpj: '12345678000271',
    razaoSocial: 'HOTEL AUTO POSTO MILLA LTDA',
    nomeFantasia: 'HOTEL AUTO POSTO MILLA',
    inscricaoEstadual: '123456789',
    inscricaoMunicipal: '554433',
    cnae: '5510-8/01',
    taxRegime: 'SIMPLES_NACIONAL',
    segment: 'HOTEL',
    addressStreet: 'Rodovia BR-135, Km 26',
    addressNumber: 'S/N',
    addressCity: 'São Luís',
    addressState: 'MA',
    addressPostalCode: '65000-000',
    active: true,
    updatedAt: '2026-11-05T00:00:00.000Z'
  }
];
