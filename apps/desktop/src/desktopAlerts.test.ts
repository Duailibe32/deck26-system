import {describe,expect,it} from 'vitest';
import type {Order,PrintJob} from '@deck26/contracts';
import {alertBaseline,alertsSince} from './desktopAlerts.js';

const date='2026-11-11T15:00:00.000Z';
const order:Order={
  id:'order',tabId:null,channel:'QR_TABLE',originNode:'CLOUD_QR_MENU',idempotencyKey:'qr-test-order',
  status:'PENDING_APPROVAL',priority:'NORMAL',items:[],totalOrderCents:0,createdAt:date,updatedAt:date,version:1
};
const via:PrintJob={
  id:'via',jobType:'PRODUCTION_TICKET',targetPrinter:'PRINTER_KITCHEN_HOT',status:'FAILED',
  referenceEntityType:'ORDER',referenceEntityId:order.id,payloadText:'Cozinha',attempts:1,createdAt:date
};
const previous={
  orders:[],printJobs:[],publicDeliveryPendingCount:0,catalog:{products:[{id:'coffee',active:true,trackStock:true}]},
  stock:{balances:[{productId:'coffee',productName:'Café',currentQuantity:3,lowStockAlert:false}]}
};
const next={...previous,orders:[order],printJobs:[via],publicDeliveryPendingCount:1,
  stock:{balances:[{productId:'coffee',productName:'Café',currentQuantity:0,lowStockAlert:true}]}};

describe('Avisos do desktop',()=>{
  it('gera avisos de mudança e ignora um estado repetido',()=>{
    const baseline=alertBaseline(next,'OWNER');
    expect(alertsSince(alertBaseline(previous,'OWNER'),baseline).map(item=>item.title))
      .toEqual(['Novo pedido recebido','Novo pedido online','Via de impressão precisa de atenção','Estoque esgotado']);
    expect(alertsSince(baseline,alertBaseline(next,'OWNER'))).toEqual([]);
  });
  it('limita avisos ao cargo e só avisa a cozinha depois que o QR entra em preparo',()=>{
    expect(alertsSince(alertBaseline(previous,'WAITER'),alertBaseline(next,'WAITER')).map(item=>item.title))
      .toEqual(['Novo pedido recebido']);
    const pending=alertBaseline(next,'KITCHEN');
    expect(alertsSince(alertBaseline(previous,'KITCHEN'),pending)).toEqual([]);
    const approved=alertBaseline({...next,orders:[{...order,status:'RECEIVED'}]},'KITCHEN');
    expect(alertsSince(pending,approved).map(item=>item.title)).toEqual(['Novo pedido recebido']);
  });
});
