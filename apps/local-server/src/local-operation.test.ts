import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {buildLocalServer} from './server.js';
import {renderThermalPreview} from './thermal-preview.js';
import {createWindowsPrintQueue,thermalBytes,type WindowsPrintTransport} from './windows-printing.js';
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
  it('lista o backup e ensaia recuperação sem substituir a base ativa',async()=>{
    const {app,store,headers,directory}=await fixture(false);
    const created=await app.inject({method:'POST',url:'/api/operation/backup',headers});
    expect(created.statusCode).toBe(200);
    const name=path.basename(created.json().path);
    const diagnostics=await app.inject({url:'/api/operation/diagnostics',headers});
    expect(diagnostics.json().backups[0].name).toBe(name);
    expect(diagnostics.json().lastVerifiedBackup).toBeNull();
    store.openTable({tableNumber:1});
    const verify=(backup:string,remoteAddress?:string)=>app.inject({method:'POST',url:'/api/operation/backup/verify',headers,remoteAddress,payload:{name:backup}});
    const result=await verify(name);
    expect(result.statusCode,result.body).toBe(200);
    expect(result.json()).toMatchObject({verified:true,counts:{users:1,orders:0,payments:0,hotel_stays:0}});
    const updated=await app.inject({url:'/api/operation/diagnostics',headers});
    expect(updated.json().lastVerifiedBackup).toMatchObject({name,verifiedAt:expect.any(String)});
    const remote=await app.inject({url:'/api/operation/diagnostics',headers,remoteAddress:'192.168.1.50'});
    expect(remote.json()).toMatchObject({local:false,backups:[],lastVerifiedBackup:null});
    expect(store.getDiningTableByNumber(1)?.activeTabId).toBeTruthy();
    expect((await verify(name,'192.168.1.50')).statusCode).toBe(403);
    expect((await verify('../'+name)).statusCode).toBe(400);
    fs.writeFileSync(path.join(directory,'backups','deck26-invalid.sqlite'),'arquivo inválido');
    expect((await verify('deck26-invalid.sqlite')).statusCode).toBe(422);
  });
  it('roteia produção à cozinha e simula cada cópia uma só vez sem marcar impressão física',async()=>{
    const {app,store,headers,directory}=await fixture();const product=store.getCatalog().products[0]!;store.db.prepare('UPDATE catalog_products SET track_stock=0 WHERE id=?').run(product.id);
    const table=store.openTable({tableNumber:1});store.createOrder({tabId:table.tab.id,tableNumber:1,originNode:'WAITER_MOBILE',channel:'DINE_IN',idempotencyKey:'operation-print-fixture',items:[{productId:product.id,quantity:1}]});
    const job=store.listPrintJobs()[0]!;expect(job).toBeDefined();const send=()=>app.inject({method:'POST',url:'/api/operation/print-jobs/'+job.id+'/simulate',headers});
    const first=(await send()).json(),again=(await send()).json();expect(first.id).toBe(again.id);expect(first.path.startsWith(directory)).toBe(true);expect(fs.readFileSync(first.path,'utf8')).toContain('NENHUMA IMPRESSORA ACIONADA');
    expect(store.listPrintJobs()[0]!.status).not.toBe('PRINTED');expect(store.db.prepare('SELECT COUNT(*) AS count FROM print_simulations').get()).toEqual({count:1});
    store.updatePrintJobStatus({jobId:job.id,status:'FAILED',errorMsg:'Falha de impressora simulada'});
    const before=store.listOrders().length,stockBefore=store.getProductStockQuantity(product.id);
    const reprint=()=>app.inject({method:'POST',url:'/api/print-jobs/'+job.id+'/reprint',headers,payload:{expectedCopyNumber:1}});
    const authorized=await reprint();
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().printJob.payloadText).toContain('2a VIA');
    expect((await reprint()).statusCode).toBe(409);
    await send();expect(store.db.prepare('SELECT COUNT(*) AS count FROM print_simulations').get()).toEqual({count:2});
    expect(store.listOrders()).toHaveLength(before);
    expect(store.getProductStockQuantity(product.id)).toBe(stockBefore);
  });
  it('modelos de 58/80 mm escapam conteúdo e não criam movimentos financeiros',async()=>{
    const {app,store,headers}=await fixture(false);const before=store.listFinancialTransactions().length;
    const model=await app.inject({url:'/api/operation/print-models/bill',headers});expect(model.json().html).toContain('SEM VALIDADE FISCAL');expect(store.listFinancialTransactions()).toHaveLength(before);
    const html=renderThermalPreview('<script>alert(1)</script>',58,'Caixa');expect(html).toContain('58mm');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
  });
  it('reduz a quantidade, mantém o consumo de estoque e envia uma única correção com confirmação',async()=>{
    const {app,store,headers,login}=await fixture();
    const product=store.getCatalog().products.find(item=>item.prepStation!=='NONE'&&!item.modifierGroups.length)!;
    store.db.prepare('UPDATE catalog_products SET track_stock=0 WHERE id=?').run(product.id);
    const {tab}=store.openTable({tableNumber:8});
    const original=store.createOrder({tabId:tab.id,tableNumber:8,originNode:'WINDOWS_PDV',channel:'DINE_IN',idempotencyKey:'correction-reduce-fixture',
      items:[{productId:product.id,quantity:2}]});
    await app.inject({method:'POST',url:'/api/operation/operators',headers,payload:{name:'Cozinha fixture',role:'KITCHEN',pin:'771923',active:true}});
    const kitchen=await login('771923');
    const endpoint='/api/orders/'+original.order.id+'/corrections';
    const input={tabId:tab.id,itemId:original.order.items[0]!.id,reason:'Cliente pediu apenas uma porção',change:{action:'REMOVE',quantity:1}};
    const quote=await app.inject({method:'POST',url:endpoint+'/preview',headers,payload:input});
    expect(quote.statusCode,quote.body).toBe(200);
    const {tabVersion,orderVersion,expectedTotalCents}=quote.json();
    expect(expectedTotalCents).toBeLessThan(quote.json().currentTotalCents);
    const payload={...input,tabVersion,orderVersion,expectedTotalCents,requestId:'a'.repeat(32)};
    const send=(auth=headers,body=payload)=>app.inject({method:'POST',url:endpoint,headers:auth,payload:body});
    expect((await send(kitchen)).statusCode).toBe(403);
    expect((await send(headers,{...payload,tabVersion:tabVersion+1})).statusCode).toBe(409);
    const before=store.getProductStockQuantity(product.id);
    const saved=await send();
    expect(saved.statusCode,saved.body).toBe(200);
    expect((await send()).json()).toMatchObject({idempotentReplay:true,printJobIds:saved.json().printJobIds});
    expect(store.getOrderById(original.order.id)?.items[0]?.quantity).toBe(1);
    expect(store.getTabById(tab.id)?.totalCents).toBe(expectedTotalCents);
    expect(store.getProductStockQuantity(product.id)).toBe(before);
    const job=store.getPrintJob(saved.json().printJobIds[0])!;
    expect(job.targetPrinter).toBe(original.printJobs[0]?.targetPrinter);
    expect(job.payloadText).toContain('CANCELAR PREPARO');
    expect(job.payloadText).toContain('MANTER 1 x');
    expect(Buffer.from(thermalBytes(job,58),'base64').toString('ascii')).toContain('\x1d!\x01CORRECAO DE PEDIDO');
    expect(renderThermalPreview(job.payloadText,80,'Cozinha')).toContain('class="line correction-title"');
    expect(()=>store.reprintJob(original.printJobs[0]!.id,'usr-owner-01',1)).toThrow(/corrigido/);
    const list=(await app.inject({url:'/api/order-corrections',headers:kitchen})).json();
    expect(list[0]).toMatchObject({id:payload.requestId,acknowledgment:null});
    expect(list[0]).not.toHaveProperty('totalCents');
    const ack=await app.inject({method:'POST',url:'/api/order-corrections/'+payload.requestId+'/acknowledge',headers:kitchen,payload:{outcome:'ALREADY_PREPARED'}});
    expect(ack.statusCode,ack.body).toBe(200);
    const history=(await app.inject({url:'/api/order-corrections?tabId='+tab.id,headers})).json();
    expect(history[0].acknowledgment).toMatchObject({operator:'Cozinha fixture',outcome:'ALREADY_PREPARED'});
  });
  it('altera a observação e troca o item com duas instruções separadas para a produção',async()=>{
    const {app,store,headers}=await fixture();
    const [first,next]=store.getCatalog().products.filter(item=>item.prepStation!=='NONE'&&!item.modifierGroups.length&&item.availableChannels.includes('DINE_IN'));
    store.db.prepare('UPDATE catalog_products SET track_stock=0').run();
    const {tab}=store.openTable({tableNumber:9});
    const original=store.createOrder({tabId:tab.id,tableNumber:9,originNode:'WINDOWS_PDV',channel:'DINE_IN',idempotencyKey:'correction-replace-fixture',
      items:[{productId:first!.id,quantity:1,notes:'Com cebola'}]});
    const endpoint='/api/orders/'+original.order.id+'/corrections';
    const apply=async(change:Record<string,unknown>,key:string)=>{
      const input={tabId:tab.id,itemId:original.order.items[0]!.id,reason:'Mudança solicitada na mesa',change};
      const quote=await app.inject({method:'POST',url:endpoint+'/preview',headers,payload:input});
      expect(quote.statusCode,quote.body).toBe(200);
      const {tabVersion,orderVersion,expectedTotalCents}=quote.json();
      const result=await app.inject({method:'POST',url:endpoint,headers,payload:{...input,tabVersion,orderVersion,expectedTotalCents,requestId:key.repeat(32)}});
      expect(result.statusCode,result.body).toBe(200);
      return result.json();
    };
    const note=await apply({action:'NOTE',notes:'Sem cebola <alergia>'},'b');
    expect(store.getTabById(tab.id)?.totalCents).toBe(original.tab?.totalCents);
    const noteJob=store.getPrintJob(note.printJobIds[0])!;
    expect(renderThermalPreview(noteJob.payloadText,58,'Cozinha')).toContain('&lt;alergia&gt;');
    const swap=await apply({action:'REPLACE',quantity:1,productId:next!.id,notes:'Bem passado',options:[]},'c');
    expect(store.getOrderById(original.order.id)?.status).toBe('CANCELLED');
    expect(store.getOrderById(swap.replacementOrderId)?.items[0]?.productId).toBe(next!.id);
    expect(swap.printJobIds).toHaveLength(2);
    expect(store.getPrintJob(swap.printJobIds[0])?.payloadText).toContain('CANCELAR PREPARO');
    expect(store.getPrintJob(swap.printJobIds[1])?.payloadText).toContain('PREPARAR SUBSTITUIÇÃO');
  });
  it('preserva a via ao faltar papel e só permite repetir um envio recusado antes da entrega',async()=>{
    const {store}=await fixture();
    const product=store.getCatalog().products[0]!;
    store.db.prepare('UPDATE catalog_products SET track_stock=0 WHERE id=?').run(product.id);
    const table=store.openTable({tableNumber:1});
    store.createOrder({tabId:table.tab.id,tableNumber:1,originNode:'WAITER_MOBILE',channel:'DINE_IN',idempotencyKey:'windows-print-test',
      items:[{productId:product.id,quantity:1}]});
    const job=store.listPrintJobs()[0]!;
    const send=vi.fn<WindowsPrintTransport>()
      .mockResolvedValueOnce({state:'REJECTED',message:'Impressora indisponível'})
      .mockResolvedValueOnce({state:'ACCEPTED',jobId:12})
      .mockResolvedValueOnce({state:'WAITING',message:'Sem papel'})
      .mockResolvedValueOnce({state:'UNKNOWN'});
    const targets={[job.targetPrinter]:'Cozinha Windows'};
    const queue=createWindowsPrintQueue(store,targets,send,()=>80,'1970-01-01');
    await Promise.all([queue.poll(),queue.poll()]);
    expect(store.getPrintJob(job.id)).toMatchObject({status:'FAILED'});
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.retry(job.id,1,'usr-owner-01')).toMatchObject({status:'QUEUED',copyNumber:1});
    expect(()=>queue.retry(job.id,1,'usr-owner-01')).toThrow();
    await queue.poll();
    expect(send.mock.calls[0]?.[0].title).toBe(send.mock.calls[1]?.[0].title);
    const restarted=createWindowsPrintQueue(store,targets,send,()=>80,'1970-01-01');
    await restarted.poll();
    expect(send.mock.calls[2]?.[0]).toMatchObject({mode:'inspect',spoolId:12});
    expect(store.getPrintJob(job.id)).toMatchObject({status:'SENDING',lastError:'Sem papel'});
    expect(()=>store.reprintJob(job.id,'usr-owner-01',1)).toThrow();
    await restarted.poll();
    await restarted.poll();
    expect(store.getPrintJob(job.id)).toMatchObject({status:'UNKNOWN_OUTCOME',copyNumber:1});
    expect(()=>restarted.retry(job.id,1,'usr-owner-01')).toThrow();
    expect(send).toHaveBeenCalledTimes(4);
  });
});
