import {afterEach,describe,expect,it,vi} from 'vitest';
import {buildLocalServer} from './server.js';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const clean:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const f of clean.splice(0).reverse())await f();vi.unstubAllEnvs();});
async function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'deck26-pos-tests-'));vi.stubEnv('DECK26_OPERATION_DATA_DIR',directory);const {app,store}=await buildLocalServer({dbPath:':memory:',demoMode:false,requireStrictAuth:true});clean.push(async()=>{await app.close();store.close();if(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'deck26-pos-tests-'))fs.rmSync(directory,{recursive:true,force:true});});store.initializeLocalOperation({name:'Responsável fixture',pin:'536821',importCatalog:true,actorIp:'127.0.0.1'});const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{pin:'536821'}});const token=login.json().token;const user=store.db.prepare("SELECT id FROM users WHERE role='OWNER'").get() as {id:string};store.db.prepare('UPDATE catalog_products SET track_stock=0').run();return {app,store,actor:user.id,token,headers:{authorization:'Bearer '+token}};}
describe('PDV por função, chamados QR e transferência confirmada',()=>{
 it('rejeita transferências com comanda de origem desatualizada ou incorreta',async()=>{
   const {app,store,headers,actor}=await fixture();
   const from=store.openTable({tableNumber:1}).tab;
   const wrong=store.openTable({tableNumber:2}).tab;
   const target=store.openTable({tableNumber:3}).tab;
   const product=store.getCatalog().products.find(item=>!item.modifierGroups.length)!;
   const {order}=store.createOrder({tabId:from.id,tableNumber:1,actorUserId:actor,
     idempotencyKey:'pos-transfer-source-check',channel:'DINE_IN',originNode:'WINDOWS_PDV',
     items:[{productId:product.id,quantity:1}]});
   const item=await app.inject({method:'POST',url:'/api/tabs/'+wrong.id+'/transfer-item',headers,
     payload:{orderItemId:order.items[0]!.id,targetTabId:target.id,reason:'Troca solicitada'}});
   expect(item.statusCode).toBe(400);
   expect(item.json().error).toContain('não pertence');
   const table=await app.inject({method:'POST',url:'/api/tables/transfer',headers,
     payload:{fromTableNumber:1,toTableNumber:4,expectedTabId:wrong.id,reason:'Troca solicitada'}});
   expect(table.statusCode).toBe(400);
   expect(table.json().error).toContain('comanda de origem mudou');
   expect(store.getDiningTableByNumber(1)?.activeTabId).toBe(from.id);
   expect(store.getTabById(target.id)?.totalCents).toBe(0);
   const valid=await app.inject({method:'POST',url:'/api/tabs/'+from.id+'/transfer-item',headers,
     payload:{orderItemId:order.items[0]!.id,targetTabId:target.id,reason:'Troca solicitada'}});
   expect(valid.statusCode,valid.body).toBe(200);
   expect(store.getTabById(target.id)?.totalCents).toBeGreaterThan(0);
 });
 it('preserva pedido e pagamento quando a comanda recebe dinheiro antes do cancelamento no PDV',async()=>{
   const {app,store,headers,actor}=await fixture();
   store.openCashRegisterSession({openingBalanceCents:0,openedByUserId:actor});
   const {tab}=store.openTable({tableNumber:1});
   const product=store.getCatalog().products.find(item=>!item.modifierGroups.length)!;
   const {order}=store.createOrder({tabId:tab.id,tableNumber:1,actorUserId:actor,
     idempotencyKey:'pos-cancel-paid-tab-order',channel:'DINE_IN',originNode:'WINDOWS_PDV',
     items:[{productId:product.id,quantity:1}]});
   store.recordPayment({tabId:tab.id,amountCents:100,receivedCashCents:100,method:'CASH',
     operatorUserId:actor,idempotencyKey:'pos-cancel-paid-tab-payment'});
   const response=await app.inject({method:'PATCH',url:'/api/orders/'+order.id+'/status',headers,
     payload:{status:'CANCELLED',originNode:'WINDOWS_PDV',expectedTabId:tab.id,cancelReason:'Pedido duplicado'}});
   expect(response.statusCode).toBe(400);
   expect(response.json().error).toContain('tem recebimentos');
   expect(store.getOrderById(order.id)?.status).toBe('RECEIVED');
   expect(store.getTabById(tab.id)?.paidCents).toBe(100);
 });
 it('pedido de conta QR é idempotente, sinaliza a mesa e nunca registra pagamento',async()=>{const {app,store,headers}=await fixture();const opened=store.openTable({tableNumber:1});const payload={qrToken:opened.table.qrToken,kind:'BILL',paymentPreference:'PIX'};const first=await app.inject({method:'POST',url:'/api/public/qr-service-call',payload});expect(first.statusCode).toBe(200);const second=await app.inject({method:'POST',url:'/api/public/qr-service-call',payload});expect(second.json().id).toBe(first.json().id);expect(store.listPayments()).toHaveLength(0);const state=(await app.inject({url:'/api/state',headers})).json();expect(state.serviceCalls).toHaveLength(1);expect(state.qrTables.find((table:any)=>table.tableNumber===1).physicalStatus).toBe('AGUARDANDO_PAGAMENTO');const resolve=()=>app.inject({method:'POST',url:'/api/pos/service-calls/'+first.json().id+'/resolve',headers,payload:{}});expect((await resolve()).statusCode).toBe(200);expect((await resolve()).statusCode).toBe(200);expect(store.listTableServiceCalls()).toHaveLength(0);});
 it('logs e transferência exigem autenticação e uma confirmação autorizada recente',async()=>{const {app,store,headers}=await fixture();expect((await app.inject('/api/desktop/audit')).statusCode).toBe(401);expect((await app.inject('/api/pos/events')).statusCode).toBe(401);expect((await app.inject({method:'POST',url:'/api/pos/transfer-to-room',headers,payload:{}})).statusCode).toBe(401);const audit=await app.inject({url:'/api/desktop/audit?limit=20',headers});expect(audit.statusCode).toBe(200);expect(JSON.stringify(audit.json())).not.toContain('536821');expect((await app.inject({url:'/api/desktop/audit?limit=10000',headers})).statusCode).toBe(400);expect(store.listPayments()).toHaveLength(0);});
 it('transfere saldo ao quarto uma única vez, mantém dinheiro zerado e envia mesa à limpeza',async()=>{const {app,store,actor,headers,token}=await fixture();store.openCashRegisterSession({openingBalanceCents:0,openedByUserId:actor});const guest=store.createHotelGuest({fullName:'Hóspede fictício da conferência',documentType:'CPF',documentNumber:'52998224725',operatorUserId:actor});const room=store.listHotelRooms().find(item=>item.commercialStatus==='OPERACIONAL')!;const checkInAt=new Date().toISOString(),checkOutScheduledAt=new Date(Date.now()+86400000).toISOString();const {stay}=store.checkInHotelStay({guestId:guest.id,roomNumber:room.number,checkInAt,checkOutScheduledAt,dailyRateCents:10000,operatorUserId:actor,operatorName:'Responsável fixture'});const {tab}=store.openTable({tableNumber:2});const product=store.getCatalog().products.find(item=>!item.modifierGroups.length)!;store.createOrder({tabId:tab.id,tableNumber:2,channel:'DINE_IN',originNode:'WINDOWS_PDV',actorUserId:actor,idempotencyKey:'pos-transfer-fixture-order',items:[{productId:product.id,quantity:1}]});const current=store.getTabById(tab.id)!;const payload={tabId:tab.id,roomNumber:room.number,expectedRemainingCents:current.totalCents,idempotencyKey:'pos-transfer-fixture-key'};const transfer=()=>app.inject({method:'POST',url:'/api/pos/transfer-to-room',headers:{...headers,'x-deck26-confirmation':token},payload});const first=await transfer();expect(first.statusCode,first.body).toBe(200);expect((await transfer()).json().idempotentReplay).toBe(true);expect(store.listPayments().filter(payment=>payment.tabId===tab.id)).toHaveLength(1);expect(store.listPayments()[0]!.method).toBe('ROOM_CHARGE');const state=(await app.inject({url:'/api/state',headers})).json();expect(state.qrTables.find((table:any)=>table.tableNumber===2).physicalStatus).toBe('LIMPEZA');expect(state.qrTables.find((table:any)=>table.tableNumber===2).activeTabId).toBeNull();const folio=(await app.inject({url:'/api/hotel/stays/'+stay.id+'/folio',headers})).json();expect(folio.entries.filter((entry:any)=>entry.sourceReferenceType==='TAB')).toHaveLength(1);expect(store.listFinancialAccounts().every(account=>account.currentBalanceCents===0)).toBe(true);const conflict=await app.inject({method:'POST',url:'/api/pos/transfer-to-room',headers:{...headers,'x-deck26-confirmation':token},payload:{...payload,expectedRemainingCents:current.totalCents+1}});expect(conflict.statusCode).toBe(409);});
});
