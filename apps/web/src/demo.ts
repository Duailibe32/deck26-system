import { DECK26_STAGE7A_MENU_93 as menu, DECK26_INITIAL_ROOMS_24 as rooms, calculateTabTotals, type Order } from '@deck26/contracts';

export type Item = { productId:string; name:string; unitPriceCents:number; quantity:number };
export type Sale = { id:string; label:string; center:'REST'|'HOTEL'|'DELIV'; totalCents:number; method:string; createdAt:string };
export type RoomUse = { id:string; roomNumber:string; nights:number; rate:number; consumptionCents:number; guestLabel:string };
export type Delivery = {id:string; number:number; items:Item[]; totalCents:number; feeCents:number; status:'NOVO'|'EM_PREPARO'|'SAIU_PARA_ENTREGA'|'ENTREGUE'|'CANCELADO'};
export type Document = {id:string; label:string; type:'NFCE'|'NFSE'; totalCents:number; status:'SIMULADO'|'CANCELADO';createdAt:string};
export type DemoState = {version:3; tables:Record<string,{items:Item[];paidCents:number}>; sales:Sale[]; stays:RoomUse[]; deliveries:Delivery[]; documents:Document[]};
export const storageKey='deck26-demo-v3';
export const uid=()=>crypto.randomUUID();
export function itemFor(id:string):Item { const p=menu.find(p=>p.id===id);if(!p) throw Error('Produto indisponível.');return {productId:p.id,name:p.name,unitPriceCents:p.priceCents,quantity:1}; }
export function totals(items:Item[],paidCents=0) {
  const order:Order={id:'demo',tabId:null,channel:'DINE_IN',originNode:'WINDOWS_PDV',idempotencyKey:'demo-preview',status:'RECEIVED',items:[],totalOrderCents:items.reduce((n,i)=>n+i.unitPriceCents*i.quantity,0),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1};
  return calculateTabTotals({orders:[order],serviceFeeEnabled:true,paidCents});
}
export function initialState():DemoState {
  const tables:DemoState['tables']={};for(let i=1;i<=12;i++)tables[i]={items:[],paidCents:0};
  tables['1']={items:[{...itemFor(menu[0]!.id),quantity:2},itemFor(menu[1]!.id)],paidCents:0};
  tables['4']={items:[itemFor(menu[40]!.id),{...itemFor(menu[80]!.id),quantity:2}],paidCents:0};
  const sales:Sale[]=[];
  for(let i=0;i<7;i++){const date=new Date();date.setDate(date.getDate()-(6-i));date.setHours(12,0,0,0);for(const [center,amount] of [['REST',185000+i*13000],['HOTEL',104000+i*6000],['DELIV',62000+i*4000]] as const)sales.push({id:uid(),label:'Movimento ilustrativo',center,totalCents:amount,method:'PIX',createdAt:date.toISOString()});}
  return {version:3,tables,sales,stays:rooms.filter(r=>r.commercialStatus==='OPERACIONAL').slice(0,3).map((r,i)=>({id:uid(),roomNumber:r.number,nights:2,rate:r.dailyRateCents,consumptionCents:0,guestLabel:'Hóspede exemplo '+(i+1)})),deliveries:[],documents:[]};
}
export function addItem(state:DemoState,table:string,item:Item):DemoState {
  const current=state.tables[table];if(!current)throw Error('Mesa inválida.');if(current.paidCents>0)throw Error('Finalize os recebimentos desta comanda antes de adicionar itens.');
  const exists=current.items.some(i=>i.productId===item.productId);
  const items=exists?current.items.map(i=>i.productId===item.productId?{...i,quantity:i.quantity+1}:i):[...current.items,item];
  return {...state,tables:{...state.tables,[table]:{...current,items}}};
}
export function receiveTable(state:DemoState,table:string,amountCents:number,method:string):DemoState {
  const current=state.tables[table];if(!current)throw Error('Mesa inválida.');const balance=totals(current.items,current.paidCents).remainingCents;
  if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>balance)throw Error('Informe um valor positivo até o saldo pendente.');
  const paid=current.paidCents+amountCents;return {...state,tables:{...state.tables,[table]:paid===totals(current.items).totalCents?{items:[],paidCents:0}:{...current,paidCents:paid}},sales:[...state.sales,{id:uid(),label:'Mesa '+table,center:'REST',totalCents:amountCents,method,createdAt:new Date().toISOString()}]};
}
export function transferToRoom(state:DemoState,table:string,stayId:string):DemoState {
  const current=state.tables[table];const stay=state.stays.find(s=>s.id===stayId);if(!current||!stay)throw Error('Escolha uma hospedagem ativa.');
  const amount=totals(current.items,current.paidCents).remainingCents;if(amount<=0)throw Error('Mesa sem saldo para transferir.');
  return {...state,tables:{...state.tables,[table]:{items:[],paidCents:0}},stays:state.stays.map(s=>s.id===stayId?{...s,consumptionCents:s.consumptionCents+amount}:s)};
}
export function checkIn(state:DemoState,roomNumber:string,nights:number):DemoState {
  const room=rooms.find(r=>r.number===roomNumber);if(!room||room.commercialStatus!=='OPERACIONAL')throw Error('Unidade em obras: hospedagem indisponível.');
  if(state.stays.some(s=>s.roomNumber===roomNumber))throw Error('Apartamento já ocupado.');
  if(!Number.isInteger(nights)||nights<1||nights>30)throw Error('Informe entre 1 e 30 noites.');
  return {...state,stays:[...state.stays,{id:uid(),roomNumber,nights,rate:room.dailyRateCents,consumptionCents:0,guestLabel:'Hóspede demonstração'}]};
}
export function checkOut(state:DemoState,stayId:string):DemoState {
  const stay=state.stays.find(s=>s.id===stayId);if(!stay)throw Error('Hospedagem já encerrada.');const now=new Date().toISOString();
  const sales:Sale[]=[...state.sales,{id:uid(),label:'Diárias · Apto '+stay.roomNumber,center:'HOTEL',totalCents:stay.rate*stay.nights,method:'PIX',createdAt:now}];
  if(stay.consumptionCents)sales.push({id:uid(),label:'Consumo · Apto '+stay.roomNumber,center:'REST',totalCents:stay.consumptionCents,method:'PIX',createdAt:now});
  return {...state,stays:state.stays.filter(s=>s.id!==stayId),sales};
}
export function advanceDelivery(state:DemoState,id:string):DemoState {
  const d=state.deliveries.find(d=>d.id===id);if(!d||d.status==='ENTREGUE'||d.status==='CANCELADO')throw Error('Entrega já encerrada.');
  const flow=['NOVO','EM_PREPARO','SAIU_PARA_ENTREGA','ENTREGUE'] as const;const next=flow[flow.indexOf(d.status)+1]!;
  return {...state,deliveries:state.deliveries.map(d=>d.id===id?{...d,status:next}:d),sales:next==='ENTREGUE'?[...state.sales,{id:uid(),label:'Delivery #'+d.number,center:'DELIV',totalCents:d.totalCents,method:'CASH',createdAt:new Date().toISOString()}]:state.sales};
}
