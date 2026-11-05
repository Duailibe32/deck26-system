import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {buildLocalServer} from './server.js';
import {renderThermalPreview} from './thermal-preview.js';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.unstubAllEnvs();});
async function fixture(importCatalog=true){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'deck26-operacao-'));vi.stubEnv('DECK26_OPERATION_DATA_DIR',directory);
  const {app,store}=await buildLocalServer({dbPath:':memory:',demoMode:false,requireStrictAuth:true});
  cleanup.push(async()=>{await app.close();store.close();if(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'deck26-operacao-'))fs.rmSync(directory,{recursive:true,force:true});});
  const setup=await app.inject({method:'POST',url:'/api/setup/owner',payload:{name:'Responsável fixture',pin:'982173',importCatalog}});expect(setup.statusCode).toBe(200);
  const login=async(pin='982173')=>{const response=await app.inject({method:'POST',url:'/api/auth/login',payload:{pin}});expect(response.statusCode).toBe(200);return {authorization:'Bearer '+response.json().token};};
  return {app,store,login,headers:await login(),directory};
}
describe('Instalação operacional local, operadores e impressão virtual',()=>{
  it('pedido QR pendente não cobra nem imprime; garçom aprova e confirma entrega sem acessar a cozinha',async()=>{
    const {app,store,headers,login}=await fixture();
    const product=store.getCatalog().products[0]!;store.db.prepare('UPDATE catalog_products SET track_stock=0 WHERE id=?').run(product.id);
    const table=store.openTable({tableNumber:1});
    await app.inject({method:'POST',url:'/api/operation/operators',headers,payload:{name:'Garçom fixture',role:'WAITER',pin:'751923',active:true}});
    const waiter=await login('751923');
    const catalog=(await app.inject('/api/public/qr-table/'+table.table.qrToken)).json();expect(catalog.catalog.products[0]).not.toHaveProperty('costPriceCents');
    const result=await app.inject({method:'POST',url:'/api/public/qr-orders',payload:{idempotencyKey:'qr-pending-operation',qrToken:table.table.qrToken,customerName:'Fixture',items:[{productId:product.id,quantity:1}]}});
    expect(result.statusCode).toBe(201);const order=result.json().order;expect(order.status).toBe('PENDING_APPROVAL');
    expect(store.getTabById(table.tab.id)!.totalCents).toBe(0);expect(store.listPrintJobs()).toHaveLength(0);
    expect(()=>store.closeTabAndReleaseTable({tabId:table.tab.id,actorUserId:'usr-owner-01'})).toThrow(/pendentes/);
    const advance=(status:string,actor=waiter)=>app.inject({method:'PATCH',url:'/api/orders/'+order.id+'/status',headers:actor,payload:{status,originNode:'WAITER_MOBILE'}});
    expect((await advance('RECEIVED')).statusCode).toBe(200);expect((await advance('RECEIVED')).statusCode).toBe(200);
    expect(store.getTabById(table.tab.id)!.totalCents).toBe(product.priceCents+Math.round(product.priceCents*.1));
    expect((await advance('IN_PREPARATION')).statusCode).toBe(403);
    expect((await advance('IN_PREPARATION',headers)).statusCode).toBe(200);expect((await advance('READY',headers)).statusCode).toBe(200);
    expect((await advance('DELIVERED')).statusCode).toBe(200);expect((await advance('RECEIVED')).statusCode).toBe(403);
  });
  it('começa sem demonstrações e só permite configurar o responsável no computador principal',async()=>{
    const {app,store}=await buildLocalServer({dbPath:':memory:',demoMode:false,requireStrictAuth:true});cleanup.push(async()=>{await app.close();store.close();});
    expect((await app.inject('/api/setup/status')).json().needsOwner).toBe(true);
    const result=await app.inject({method:'POST',url:'/api/setup/owner',remoteAddress:'192.168.1.50',payload:{name:'Pessoa',pin:'982173',importCatalog:true}});
    expect(result.statusCode).toBe(403);expect(store.listStaffProfiles()).toHaveLength(0);
    expect(store.listFinancialAccounts().every(account=>account.currentBalanceCents===0)).toBe(true);
  });
  it('importa somente cadastros aprovados, sem hóspedes, caixa, recebimentos ou estoque fictícios',async()=>{
    const {app,store,headers}=await fixture();const data=(await app.inject({url:'/api/state',headers})).json();
    expect(data.catalog.products).toHaveLength(93);expect(data.hotelRooms).toHaveLength(24);expect(data.qrTables).toHaveLength(20);
    expect(data.hotelGuests).toHaveLength(0);expect(data.tabs).toHaveLength(0);expect(data.payments).toHaveLength(0);expect(data.cashierSummary.activeSession).toBeNull();
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM stock_balances WHERE current_quantity!=0').get()).toEqual({count:0});
    expect((await app.inject({method:'POST',url:'/api/setup/owner',payload:{name:'Outro',pin:'765431',importCatalog:false}})).statusCode).toBe(409);
  });
  it('permite uma instalação sem catálogo, mantendo infraestrutura financeira zerada',async()=>{
    const {store}=await fixture(false);expect(store.getCatalog().products).toHaveLength(0);expect(store.listHotelRooms()).toHaveLength(0);expect(store.listFinancialAccounts().every(item=>item.currentBalanceCents===0)).toBe(true);
  });
  it('cadastra operadores sem expor PIN/hash e recusa PIN repetido e remoção do último proprietário',async()=>{
    const {app,headers}=await fixture(false);
    const create=await app.inject({method:'POST',url:'/api/operation/operators',headers,payload:{name:'Garçom',role:'WAITER',pin:'751923',active:true}});expect(create.statusCode).toBe(200);
    const duplicate=await app.inject({method:'POST',url:'/api/operation/operators',headers,payload:{name:'Outro',role:'WAITER',pin:'751923',active:true}});expect(duplicate.statusCode).toBe(400);
    const list=(await app.inject({url:'/api/operation/operators',headers})).json();expect(list).toHaveLength(2);expect(JSON.stringify(list)).not.toMatch(/pin_hash|751923|scrypt/);
    expect((await app.inject({method:'POST',url:'/api/operation/operators',headers,payload:{id:'usr-owner-01',name:'Pessoa',role:'WAITER',active:true}})).statusCode).toBe(400);
  });
  it('trocar PIN revoga a sessão anterior e mantém o novo acesso válido',async()=>{
    const {app,headers,login}=await fixture(false);
    await app.inject({method:'POST',url:'/api/operation/operators',headers,payload:{id:'usr-owner-01',name:'Responsável',role:'OWNER',active:true,pin:'891734'}});
    expect((await app.inject({url:'/api/state',headers})).statusCode).toBe(401);
    await new Promise(resolve=>setTimeout(resolve,2));expect((await app.inject({url:'/api/state',headers:await login('891734')})).statusCode).toBe(200);
  });
  it('gerente não cria proprietário e garçom não acessa administração',async()=>{
    const {app,headers,login}=await fixture(false);
    await app.inject({method:'POST',url:'/api/operation/operators',headers,payload:{name:'Gerente',role:'MANAGER',pin:'751923',active:true}});
    expect((await app.inject({method:'POST',url:'/api/operation/operators',headers:await login('751923'),payload:{name:'Novo',role:'OWNER',pin:'861932',active:true}})).statusCode).toBe(400);
    await app.inject({method:'POST',url:'/api/operation/operators',headers,payload:{name:'Garçom',role:'WAITER',pin:'651923',active:true}});
    expect((await app.inject({url:'/api/operation/settings',headers:await login('651923')})).statusCode).toBe(403);
  });
  it('gera backup consistente restrito ao PC, sem usar cópia de um SQLite ativo',async()=>{
    const {app,headers}=await fixture(false);expect((await app.inject({method:'POST',url:'/api/operation/backup',headers,remoteAddress:'192.168.1.50'})).statusCode).toBe(403);
    const result=await app.inject({method:'POST',url:'/api/operation/backup',headers});expect(result.statusCode).toBe(200);
    const db=new DatabaseSync(result.json().path,{readOnly:true});try{expect(db.prepare('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});expect(db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({count:1});}finally{db.close();}
  });
  it('roteia produção à cozinha e simula cada cópia uma só vez sem marcar impressão física',async()=>{
    const {app,store,headers,directory}=await fixture();const product=store.getCatalog().products[0]!;store.db.prepare('UPDATE catalog_products SET track_stock=0 WHERE id=?').run(product.id);
    const table=store.openTable({tableNumber:1});store.createOrder({tabId:table.tab.id,tableNumber:1,originNode:'WAITER_MOBILE',channel:'DINE_IN',idempotencyKey:'operation-print-fixture',items:[{productId:product.id,quantity:1}]});
    const job=store.listPrintJobs()[0]!;expect(job).toBeDefined();const send=()=>app.inject({method:'POST',url:'/api/operation/print-jobs/'+job.id+'/simulate',headers});
    const first=(await send()).json(),again=(await send()).json();expect(first.id).toBe(again.id);expect(first.path.startsWith(directory)).toBe(true);expect(fs.readFileSync(first.path,'utf8')).toContain('NENHUMA IMPRESSORA ACIONADA');
    expect(store.listPrintJobs()[0]!.status).not.toBe('PRINTED');expect(store.db.prepare('SELECT COUNT(*) AS count FROM print_simulations').get()).toEqual({count:1});
    store.reprintJob(job.id,'usr-owner-01');await send();expect(store.db.prepare('SELECT COUNT(*) AS count FROM print_simulations').get()).toEqual({count:2});
  });
  it('modelos de 58/80 mm escapam conteúdo e não criam movimentos financeiros',async()=>{
    const {app,store,headers}=await fixture(false);const before=store.listFinancialTransactions().length;
    const model=await app.inject({url:'/api/operation/print-models/bill',headers});expect(model.json().html).toContain('SEM VALIDADE FISCAL');expect(store.listFinancialTransactions()).toHaveLength(before);
    const html=renderThermalPreview('<script>alert(1)</script>',58,'Caixa');expect(html).toContain('58mm');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
  });
});
