import type { TablePhysicalStatus } from '@deck26/contracts';

/** Physical state drives the signal: an unpaid open tab alone is not a payment request. */
export function tableSignal(status: TablePhysicalStatus) {
  switch(status){
    case 'LIVRE': return {tone:'free',label:'Livre',icon:'✓'} as const;
    case 'AGUARDANDO_PAGAMENTO': return {tone:'payment',label:'Aguardando pagamento',icon:'$'} as const;
    case 'LIMPEZA': return {tone:'cleaning',label:'Em limpeza',icon:'↻'} as const;
    case 'INDISPONIVEL': return {tone:'unavailable',label:'Indisponível',icon:'×'} as const;
    default: return {tone:'occupied',label:status==='AGUARDANDO_PEDIDO'?'Aguardando pedido':status==='EM_ATENDIMENTO'?'Em atendimento':'Ocupada',icon:'●'} as const;
  }
}
