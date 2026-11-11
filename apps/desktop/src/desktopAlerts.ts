import {hasPermission,type Order,type PrintJob,type UserRole} from '@deck26/contracts';

type Stock = {productId:string;productName:string;currentQuantity:number;lowStockAlert?:boolean};
type AlertSnapshot = {
  orders: Order[];
  printJobs: PrintJob[];
  publicDeliveryPendingCount?: number;
  stock: { balances: Stock[] };
  catalog: {products: {id:string;active:boolean;trackStock?:boolean}[]};
};
export type DesktopAlert = {title:string; detail?:string; tone:'info'|'warning'|'error'};

export function alertBaseline(snapshot:AlertSnapshot,role:UserRole) {
  const kitchen=hasPermission(role,'orders:advance_kitchen')&&role==='KITCHEN';
  const orders=new Map<string,boolean>();
  if(kitchen||hasPermission(role,'tabs:manage')){
    for(const order of snapshot.orders){
      if(kitchen)orders.set(order.id,order.status==='RECEIVED');
      else if(order.originNode==='WAITER_MOBILE'||order.channel==='QR_TABLE'){
        orders.set(order.id,order.status==='PENDING_APPROVAL'||order.status==='RECEIVED');
      }
    }
  }
  const failed=new Map<string,string>();
  if(hasPermission(role,'printers:manage')){
    for(const job of snapshot.printJobs){
      if(job.status==='FAILED'||job.status==='UNKNOWN_OUTCOME')failed.set(job.id,(job.copyNumber??1)+':'+job.status);
    }
  }
  const stock=new Map<string,Stock>();
  if(hasPermission(role,'stock:adjust')){
    const tracked=new Set(snapshot.catalog.products.filter(product=>product.active&&product.trackStock).map(product=>product.id));
    for(const balance of snapshot.stock.balances){
      if(tracked.has(balance.productId))stock.set(balance.productId,balance);
    }
  }
  return {orders,failed,stock,kitchen,delivery:hasPermission(role,'delivery:manage_orders')?(snapshot.publicDeliveryPendingCount??0):0};
}

export function alertsSince(previous:ReturnType<typeof alertBaseline>,current:ReturnType<typeof alertBaseline>):DesktopAlert[] {
  const alerts:DesktopAlert[]=[];
  const orders=[...current.orders].filter(([id,ready])=>ready&&(current.kitchen?!previous.orders.get(id):!previous.orders.has(id))).length;
  if(orders)alerts.push({tone:'info',title:orders===1?'Novo pedido recebido':orders+' novos pedidos recebidos',detail:current.kitchen?'Confira a fila de preparo.':'Confira o salão e os pedidos por QR.'});
  const delivery=current.delivery-previous.delivery;
  if(delivery>0)alerts.push({tone:'info',title:delivery===1?'Novo pedido online':delivery+' novos pedidos online',detail:'Confira os pedidos aguardando aceite.'});
  const print=[...current.failed].filter(([id,status])=>previous.failed.get(id)!==status).length;
  if(print)alerts.push({tone:'error',title:print===1?'Via de impressão precisa de atenção':print+' vias precisam de atenção',detail:'Confira a fila de impressão antes de autorizar outra via.'});
  const stock=[...current.stock.values()].filter(balance=>{
    const before=previous.stock.get(balance.productId);
    return before&&((before.currentQuantity>0&&balance.currentQuantity<=0)||(!before.lowStockAlert&&balance.lowStockAlert));
  });
  if(stock.length===1){
    const item=stock[0]!;
    alerts.push({tone:'warning',title:item.currentQuantity<=0?'Estoque esgotado':'Estoque no mínimo',detail:item.productName});
  }else if(stock.length>1){
    alerts.push({tone:'warning',title:stock.length+' itens precisam de reposição',detail:'Confira os saldos no estoque.'});
  }
  return alerts;
}
