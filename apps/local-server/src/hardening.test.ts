import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { buildLocalServer, signSessionToken, verifySessionToken } from './server.js';
import { buildCloudApiServer } from '../../cloud-api/src/server.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });
async function local(strict = true, demoMode = true) {
  const result = await buildLocalServer({dbPath:':memory:',requireStrictAuth:strict,demoMode});
  cleanup.push(async()=>{await result.app.close();result.store.close();});
  return result;
}
async function cloud() {
  const result = await buildCloudApiServer({dbPath:':memory:',syncSecret:'isolated-sync-secret'});
  cleanup.push(async()=>{await result.app.close();result.closeDb();});
  return result;
}
const token = (role: 'OWNER'|'WAITER'|'RECEPTIONIST' = 'OWNER') => 'Bearer '+signSessionToken({userId:role==='OWNER'?'usr-owner-01':role==='WAITER'?'usr-waiter-01':'usr-reception-01',name:'Teste',role,issuedAt:Date.now()});
const day = () => new Date().toISOString().slice(0,10);
const actor = {operatorUserId:'usr-owner-01',operatorName:'Teste'};
async function stayFixture() {
  const server=await local();const guest=server.store.createHotelGuest({fullName:'Pessoa fictícia',documentNumber:'00000000000',...actor});
  const stay=server.store.checkInHotelStay({roomNumber:'101',guestId:guest.id,checkInAt:day()+'T12:00:00Z',checkOutScheduledAt:new Date(Date.now()+86400000).toISOString(),dailyRateCents:13000,...actor}).stay;
  return {...server,stay,guest};
}

describe('Regressões independentes de segurança, financeiro e PMS',()=>{
  it('dashboard financeiro exige permissão, completa sete dias e não duplica entregas',async()=>{
    const {app,store}=await local();
    expect((await app.inject('/api/finance/dashboard/charts')).statusCode).toBe(401);
    expect((await app.inject({url:'/api/finance/dashboard/charts',headers:{authorization:token('WAITER')}})).statusCode).toBe(403);
    const order=store.createDeliveryOrder({customerName:'Teste',customerPhone:'00000000000',deliveryType:'DELIVERY',origin:'SITE_WEB',deliveryZoneId:'zone-centro',items:[{productId:'prd-caldo-macaxeira',quantity:2}],paymentMethodDeclared:'PIX'}).deliveryOrder;
    store.updateDeliveryOrderStatus(order.id,'ENTREGUE','usr-owner-01');
    store.updateDeliveryOrderStatus(order.id,'ENTREGUE','usr-owner-01');
    const response=await app.inject({url:'/api/finance/dashboard/charts',headers:{authorization:token()}});
    expect(response.statusCode).toBe(200);const data=response.json();
    store.createDeliveryOrder({customerName:'Pendente',customerPhone:'00000000000',deliveryType:'DELIVERY',origin:'SITE_WEB',deliveryZoneId:'zone-centro',items:[{productId:'prd-caldo-macaxeira',quantity:1}],paymentMethodDeclared:'PIX'});
    expect(store.getExecutiveDashboardMetrics().todaySalesCents).toBe(2500);
    expect(data.dailySales).toHaveLength(7);
    expect(data.dailySales.at(-1)).toEqual({date:day(),salesCents:2500});
    expect(data.dailySales.slice(0,-1).every((point:{salesCents:number})=>point.salesCents===0)).toBe(true);
    expect(data.occupancy.reduce((sum:number,point:{value:number})=>sum+point.value,0)).toBe(24);
    expect(data.occupancy.find((point:{name:string})=>point.name==='Indisponíveis / obras').value).toBe(12);
    expect((await app.inject({url:'/api/catalog',headers:{authorization:token('WAITER')}})).json().products[0]).not.toHaveProperty('costPriceCents');
  });
  it('capital inicial no primeiro dia e novas contas conciliam a equação do fluxo',async()=>{
    const {store}=await local();
    store.db.prepare("UPDATE financial_accounts SET initial_balance_cents=10000,created_at='2026-01-02' WHERE id='acc-caixa-geral'").run();
    store.db.prepare("UPDATE financial_accounts SET initial_balance_cents=7000,created_at='2026-01-03' WHERE id='acc-conta-pix'").run();
    const flow=store.generateCashFlowRealized({startDate:'2026-01-02',endDate:'2026-01-04'});
    expect(flow.openingBalanceCents).toBe(10000);expect(flow.totalInflowsCents).toBe(7000);
    expect(flow.openingBalanceCents+flow.netCashFlowCents).toBe(flow.closingBalanceCents);
  });
  it('nega snapshots anônimos e oculta dados pessoais/financeiros do garçom',async()=>{
    const {app,store}=await local();store.createHotelGuest({fullName:'Segredo fictício',documentNumber:'00000000000',...actor});
    expect((await app.inject('/api/state')).statusCode).toBe(401);
    expect((await app.inject('/api/finance/accounts')).statusCode).toBe(401);
    const response=await app.inject({url:'/api/state',headers:{authorization:token('WAITER')}});
    expect(response.statusCode).toBe(200);const state=response.json();
    expect(state.hotelGuests).toEqual([]);expect(state.financialAccounts).toEqual([]);expect(state.executiveMetrics).toBeUndefined();
    expect((await app.inject({url:'/api/finance/accounts',headers:{authorization:token('WAITER')}})).statusCode).toBe(403);
  });
  it('não concede OWNER ao tráfego LAN ou a tokens inválidos no modo de testes',async()=>{
    const {app}=await local(false);
    expect((await app.inject({url:'/api/state',remoteAddress:'192.168.1.45'})).statusCode).toBe(401);
    expect((await app.inject({url:'/api/state',headers:{authorization:'Bearer falso'}})).statusCode).toBe(401);
  });
  it('expira sessões e revoga o acesso quando o usuário é desativado',async()=>{
    const {app,store}=await local();
    expect(verifySessionToken(signSessionToken({userId:'usr-owner-01',role:'OWNER',name:'Teste',issuedAt:0}))).toBeNull();
    const authorization=token();store.db.prepare("UPDATE users SET active=0 WHERE id='usr-owner-01'").run();
    expect((await app.inject({url:'/api/state',headers:{authorization}})).statusCode).toBe(401);
  });
  it('limita tentativas de PIN e migra hash legado após login válido',async()=>{
    const {app,store}=await local();
    const logged=await app.inject({method:'POST',url:'/api/auth/login',payload:{pin:'2626'}});expect(logged.statusCode).toBe(200);
    expect((store.db.prepare("SELECT pin_hash FROM users WHERE id='usr-owner-01'").get() as {pin_hash:string}).pin_hash).toMatch(/^scrypt:/);
    for(let i=0;i<10;i++) await app.inject({method:'POST',url:'/api/auth/login',payload:{pin:'999999'}});
    expect((await app.inject({method:'POST',url:'/api/auth/login',payload:{pin:'999999'}})).statusCode).toBe(429);
  });
  it('banco operacional novo não recebe saldos, hóspedes, quartos ou fornecedores demonstrativos',async()=>{
    const {store}=await local(true,false);
    expect(store.listHotelRooms()).toHaveLength(0);expect(store.listSuppliers()).toHaveLength(0);
    expect(store.listFinancialAccounts().every(a=>a.currentBalanceCents===0)).toBe(true);
    expect(store.authenticateByPin('2626')).toBeNull();
  });
  it('recebimento de restaurante entra no razão uma vez e estorno reverte o saldo',async()=>{
    const {store}=await local();const start=store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents;
    const tab=store.openOrGetTab({code:'HARDEN-CASH',type:'COUNTER',openedByUserId:'usr-owner-01'});
    store.createOrder({idempotencyKey:'hardening-order-cash',tabId:tab.id,channel:'COUNTER_PDV',originNode:'WINDOWS_PDV',items:[{productId:'prd-caldo-macaxeira',quantity:1}]});
    const input={idempotencyKey:'hardening-payment',tabId:tab.id,method:'CASH' as const,amountCents:1000};
    const payment=store.recordPayment(input).payment;store.recordPayment(input);
    expect(store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents).toBe(start+1000);
    expect(store.generateCashFlowRealized({startDate:day(),endDate:day(),accountId:'acc-caixa-geral'}).totalInflowsCents).toBe(1000);
    expect(()=>store.recordPayment({...input,amountCents:999})).toThrow(/diferentes/);
    store.refundPayment({paymentId:payment.id,reason:'Teste de estorno',actorUserId:'usr-owner-01',actorRole:'OWNER'});
    expect(store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents).toBe(start);
  });
  it('custódia de delivery sai da carteira para o caixa e acerto repetido é recusado',async()=>{
    const {store}=await local();const start=store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents;
    const order=store.createDeliveryOrder({customerName:'Teste',customerPhone:'00000000000',deliveryType:'DELIVERY',origin:'SITE_WEB',deliveryZoneId:'zone-centro',items:[{productId:'prd-caldo-macaxeira',quantity:2}],paymentMethodDeclared:'CASH'}).deliveryOrder;
    const courier=store.listDeliveryCouriers()[0]!;store.dispatchDeliveryOrder(order.id,courier.id,'usr-owner-01');store.updateDeliveryOrderStatus(order.id,'ENTREGUE','usr-owner-01');
    expect(store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents).toBe(start);
    expect(store.getFinancialAccountById('acc-carteira-motoboys')!.currentBalanceCents).toBe(2500);
    const params={courierId:courier.id,financialAccountId:'acc-caixa-geral',deliveryOrderIds:[order.id],actorUserId:'usr-owner-01'};
    store.settleCourierDeliveries(params);
    expect(store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents).toBe(start+2000);
    expect(store.getFinancialAccountById('acc-carteira-motoboys')!.currentBalanceCents).toBe(0);
    expect(()=>store.settleCourierDeliveries(params)).toThrow(/acertado/);
    expect(store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents).toBe(start+2000);
  });
  it('pagamento de folio atualiza tesouraria e reenvio não duplica',async()=>{
    const {store,stay}=await stayFixture();const before=store.getFinancialAccountById('acc-conta-pix')!.currentBalanceCents;
    const input={stayId:stay.id,entryType:'PAYMENT' as const,description:'PIX fictício',amountCents:-13000,paymentMethod:'PIX' as const,idempotencyKey:'folio-payment-retry',...actor};
    const first=store.addFolioEntry(input);expect(store.addFolioEntry(input).id).toBe(first.id);
    expect(store.getFinancialAccountById('acc-conta-pix')!.currentBalanceCents).toBe(before+13000);
  });
  it('recebimento em dinheiro do hotel entra também na conferência do turno',async()=>{
    const {store,stay}=await stayFixture();const before=store.getCashierOperationalSummary().activeSession!.expectedCashCents;
    store.addFolioEntry({stayId:stay.id,entryType:'PAYMENT',description:'Dinheiro fictício',amountCents:-13000,...actor});
    expect(store.getCashierOperationalSummary().activeSession!.expectedCashCents).toBe(before+13000);
  });
  it('fluxo histórico não usa o saldo atual nem inclui recebimentos futuros',async()=>{
    const {store}=await local();store.db.prepare("UPDATE financial_accounts SET initial_balance_cents=10000,created_at='2026-01-01' WHERE id='acc-caixa-geral'").run();
    for (let i=0;i<2;i++) {const tab=store.openOrGetTab({code:'HISTORY-'+i,type:'COUNTER'});store.createOrder({idempotencyKey:'history-order-'+i,tabId:tab.id,channel:'COUNTER_PDV',originNode:'WINDOWS_PDV',items:[{productId:'prd-caldo-macaxeira',quantity:1}]});const p=store.recordPayment({idempotencyKey:'history-payment-'+i,tabId:tab.id,method:'CASH',amountCents:1000}).payment;store.db.prepare('UPDATE financial_transactions SET settlement_date=? WHERE reference_id=?').run(i===0?'2026-01-02':'2026-01-10',p.id);}
    const flow=store.generateCashFlowRealized({startDate:'2026-01-02',endDate:'2026-01-02',accountId:'acc-caixa-geral'});expect(flow.openingBalanceCents).toBe(10000);expect(flow.closingBalanceCents).toBe(11000);expect(flow.totalInflowsCents).toBe(1000);
  });
  it('produção recusa segredo ausente e PIN demonstrativo',async()=>{
    vi.stubEnv('NODE_ENV','production');vi.stubEnv('DECK26_AUTH_SECRET','');
    await expect(buildLocalServer({dbPath:':memory:'})).rejects.toThrow(/AUTH_SECRET/);
    vi.stubEnv('DECK26_AUTH_SECRET','segredo-apenas-para-teste-de-producao');const {store}=await local();expect(store.authenticateByPin('2626')).toBeNull();
  });
  it('impede edição ou exclusão silenciosa da trilha de auditoria',async()=>{
    const {store}=await local();store.recordAuditLog({actorUserId:'usr-owner-01',action:'TESTE',entityType:'TESTE',entityId:'test'});
    expect(()=>store.db.prepare("DELETE FROM audit_logs WHERE action='TESTE'").run()).toThrow(/somente acréscimo/);
  });
  it('check-out com dívida exige gerente e justificativa e falha intermediária reverte tudo',async()=>{
    const {app,store,stay}=await stayFixture();
    const denied=await app.inject({method:'POST',url:'/api/hotel/checkout',headers:{authorization:token('RECEPTIONIST')},payload:{stayId:stay.id,allowOverrideWithAudit:true,notes:'Motivo suficiente mas sem gerente'}});expect(denied.statusCode).toBe(400);
    expect(()=>store.checkOutHotelStay(stay.id,{...actor,allowOverrideWithAudit:true})).toThrow(/justificativa/);
    store.db.exec("CREATE TRIGGER fail_checkout BEFORE UPDATE ON hotel_rooms WHEN NEW.occupancy_status = 'LIVRE' BEGIN SELECT RAISE(ABORT,'falha simulada'); END;");
    expect(()=>store.checkOutHotelStay(stay.id,{...actor,allowOverrideWithAudit:true,notes:'Falha controlada de teste'})).toThrow(/falha simulada/);
    expect(store.getHotelStayById(stay.id)!.status).toBe('ACTIVE');expect(store.getHotelRoomByNumber('101')!.occupancyStatus).toBe('OCUPADO');
  });
  it('DRE atribui venda ao restaurante e mantém custos de outro centro isolados',async()=>{
    const {store}=await local();const tab=store.openOrGetTab({code:'HARDEN-DRE',type:'COUNTER',openedByUserId:'usr-owner-01'});
    store.createOrder({idempotencyKey:'hardening-order-dre',tabId:tab.id,channel:'COUNTER_PDV',originNode:'WINDOWS_PDV',items:[{productId:'prd-caldo-macaxeira',quantity:1}]});store.recordPayment({idempotencyKey:'hardening-dre-pay',tabId:tab.id,method:'CASH',amountCents:1000});
    const all=store.generateDreStatement({startDate:day(),endDate:day()});expect(all.revenueByCostCenter.REST).toBe(1000);expect(all.revenueByCostCenter.BAR).toBe(0);
    const hotel=store.generateDreStatement({startDate:day(),endDate:day(),costCenterId:'HOTEL'});expect(hotel.grossRevenueCents).toBe(0);expect(hotel.directCostsCents).toBe(0);
    expect((store.db.prepare('PRAGMA ignore_check_constraints').get() as {ignore_check_constraints:number}).ignore_check_constraints).toBe(0);
  });
  it('nuvem exige autenticação e rejeita checksum adulterado',async()=>{
    const {app,getLedger}=await cloud();const batch={sourceNodeId:'teste',sourceOrigin:'WINDOWS_PDV',lastPulledRemoteCursor:0,events:[{id:crypto.randomUUID(),idempotencyKey:'checksum-test-key',originNode:'WINDOWS_PDV',entityType:'CATALOG_PRODUCT',entityId:'prd-caldo-macaxeira',operation:'UPSERT',entityVersion:1,hlcTimestamp:new Date().toISOString(),payloadJson:'{}',checksumSha256:'invalid-hash-000',status:'PENDING',retryCount:0,createdAt:new Date().toISOString()}]};
    expect((await app.inject({method:'POST',url:'/api/sync/batch',payload:batch})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/api/sync/batch',headers:{authorization:'Bearer isolated-sync-secret'},payload:batch})).statusCode).toBe(400);expect(getLedger()).toHaveLength(0);
    expect((await app.inject('/api/owner/overview')).statusCode).toBe(401);
  });
  it('pedido público rejeita adicional desconhecido e devolve o mesmo pedido no reenvio',async()=>{
    const {app,getLedger}=await cloud();const payload={idempotencyKey:'public-order-retry',channel:'DELIVERY',customerName:'Cliente fictício',items:[{productId:'prd-caldo-macaxeira',quantity:1}]};
    const bad=await app.inject({method:'POST',url:'/api/public/orders',payload:{...payload,items:[{...payload.items[0],modifiers:[{groupId:'x',groupName:'x',optionId:'x',optionName:'x',priceDeltaCents:-9999}]}]}});expect(bad.statusCode).toBe(400);expect(getLedger()).toHaveLength(0);
    const first=await app.inject({method:'POST',url:'/api/public/orders',payload});const second=await app.inject({method:'POST',url:'/api/public/orders',payload});expect(first.statusCode).toBe(201);expect(second.json().order.id).toBe(first.json().order.id);expect(getLedger()).toHaveLength(1);
  });
});
