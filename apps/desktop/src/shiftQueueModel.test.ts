import { describe, expect, it } from 'vitest';
import type { DiningTableQr, Order, PrintJob, Tab, TableServiceCall } from '@deck26/contracts';
import { restaurantQueue } from './shiftQueueModel.js';

describe('Pendências do turno',()=>{
  const since='2026-11-11T15:00:00.000Z';
  const now=Date.parse(since)+660_000;
  const table=(number:number,status:DiningTableQr['physicalStatus'])=>({
    tableNumber:number,active:true,activeTabId:'tab-'+number,physicalStatus:status,openedAt:since
  } as DiningTableQr);
  const tab=(number:number)=>({id:'tab-'+number,status:'OPEN',subtotalCents:0,openedAt:since} as Tab);
  const bill={id:'bill',kind:'BILL',tableNumber:1,tabId:'tab-1',requestedAt:since} as TableServiceCall;
  const failed: PrintJob={id:'failure',status:'FAILED',targetPrinter:'PRINTER_KITCHEN_HOT',
    createdAt:since,jobType:'PRODUCTION_TICKET',referenceEntityType:'ORDER',referenceEntityId:'order',
    payloadText:'Via de preparo',attempts:1};

  it('agrupa só pendências válidas e elimina a duplicação da conta solicitada',()=>{
    const state={qrTables:[table(1,'AGUARDANDO_PAGAMENTO'),table(2,'OCUPADA'),table(3,'OCUPADA')],
      tabs:[tab(1),tab(2),tab(3)],orders:[{tabId:'tab-3',status:'PENDING_APPROVAL'} as Order],
      serviceCalls:[bill,{...bill,id:'antigo',tabId:'comanda-anterior'}],printJobs:[failed],publicDeliveryPendingCount:3};
    expect(restaurantQueue(state,'CASHIER',now).map(task=>task.id)).toEqual(['bill','failure','delivery','first-2']);
    expect(restaurantQueue(state,'WAITER',now).map(task=>task.id)).toEqual(['bill','first-2']);
    expect(restaurantQueue(state,'CASHIER',now).find(task=>task.id==='delivery')?.count).toBe(3);
    expect(restaurantQueue({...state,serviceCalls:[],printJobs:[],publicDeliveryPendingCount:0},'CASHIER',now).map(task=>task.id))
      .toEqual(['bill-1','first-2']);
  });
});
