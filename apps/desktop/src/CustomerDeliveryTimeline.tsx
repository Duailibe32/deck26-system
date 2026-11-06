import React from 'react';
export function CustomerDeliveryTimeline({
  events
}: {
  events: Array<{
    status: string;
    at: string;
  }>;
}) {
  const names: Record<string, string> = {
    PENDING: 'Recebido · aguardando conferência',
    ACCEPTED: 'Aceito pela equipe',
    NOVO: 'Registrado',
    CONFIRMADO: 'Confirmado',
    EM_PREPARO: 'Em preparo',
    PRONTO: 'Pronto',
    SAIU_PARA_ENTREGA: 'Saiu para entrega',
    ENTREGUE: 'Entrega ou retirada concluída',
    REJECTED: 'Não confirmado pela equipe',
    CANCELADO: 'Pedido cancelado'
  };
  const unique = events.filter((e, i, a) => a.findIndex(v => v.status === e.status) === i);
  return <ol className="d26-customer-timeline" aria-label="Etapas registradas do pedido">{unique.map(e => <li key={e.status}><strong>{names[e.status] ?? 'Atualização do pedido'}</strong><small>{new Date(e.at).toLocaleString('pt-BR', {
          timeZone: 'America/Fortaleza',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })}</small></li>)}</ol>;
}
