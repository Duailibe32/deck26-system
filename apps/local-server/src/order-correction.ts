import {z} from 'zod';

const singleLine=(value:string)=>value.replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
const shortText=z.string().max(280).transform(singleLine);
const details=z.discriminatedUnion('action',[
  z.object({action:z.literal('REMOVE'),quantity:z.number().int().min(1).max(99)}),
  z.object({action:z.literal('NOTE'),notes:shortText}),
  z.object({action:z.literal('REPLACE'),quantity:z.number().int().min(1).max(99),productId:z.string().min(1).max(100),
    notes:shortText.optional(),options:z.array(z.object({groupId:z.string(),optionId:z.string()})).max(40)})
]);
export const orderCorrectionSchema=z.object({
  tabId:z.string().uuid(),itemId:z.string().uuid(),reason:shortText.refine(reason=>reason.length>=3),
  change:details
}).strict();
export const orderCorrectionCommitSchema=orderCorrectionSchema.extend({
  requestId:z.string().regex(/^[a-f0-9]{32}$/),
  tabVersion:z.number().int().positive(),orderVersion:z.number().int().positive(),
  expectedTotalCents:z.number().int().nonnegative()
});
export type OrderCorrectionInput=z.infer<typeof orderCorrectionSchema>;
export type OrderCorrectionCommit=z.infer<typeof orderCorrectionCommitSchema>;

export const correctionTicketHeader='CORREÇÃO DE PEDIDO';
export function correctionTicket(input:{
  action:'REMOVE'|'NOTE'|'REPLACE'|'PREPARE';code:string;orderId:string;operator:string;reason:string;
  product:string;quantity:number;remaining?:number;notes?:string;replacement?:string;options?:string[];wasReady?:boolean;at:string;
}):string {
  const lines=[
    'DECK 26 · COZINHA',correctionTicketHeader,
    singleLine(input.code)+' · PEDIDO '+input.orderId.slice(0,8).toUpperCase(),
    new Date(input.at).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'}),
    '--------------------------------'
  ];
  if(input.action==='PREPARE'){
    lines.push('PREPARAR SUBSTITUIÇÃO',input.quantity+' x '+singleLine(input.product),
      ...(input.options??[]).map(option=>'+ '+singleLine(option)),
      'OBS: '+(input.notes?singleLine(input.notes):'Sem observação'));
  }else if(input.action==='NOTE'){
    lines.push('NOVA OBSERVAÇÃO',input.quantity+' x '+singleLine(input.product),
      'OBS: '+(input.notes?singleLine(input.notes):'Retirar a observação anterior'));
  }else{
    lines.push('CANCELAR PREPARO',input.quantity+' x '+singleLine(input.product),
      input.remaining?'MANTER '+input.remaining+' x '+singleLine(input.product):'NÃO PREPARAR ESTE ITEM');
    if(input.replacement)lines.push('Troca: '+singleLine(input.replacement),'Siga a via de substituição.');
  }
  if(input.wasReady)lines.push('ITEM JÁ EM PRODUÇÃO','Confirme com o caixa o que foi preparado.');
  lines.push('--------------------------------','Motivo: '+singleLine(input.reason),'Operador: '+singleLine(input.operator),'VIA DE PRODUÇÃO · NÃO FISCAL');
  return lines.join('\n');
}
