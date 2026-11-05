/** Preparation only. No real signer, SOAP sender or SEFAZ authorization is provided. */
import {z} from 'zod';
import crypto from 'node:crypto';
import type {LocalOperationalStore} from './store.js';
import {formatBrlCents} from '@deck26/contracts';
import {renderThermalPreview} from './thermal-preview.js';
export const emitterSchema=z.object({
 segment:z.enum(['RESTAURANT','HOTEL']),environment:z.enum(['HOMOLOGACAO','PRODUCAO']).default('HOMOLOGACAO'),
 cnpj:z.string().regex(/^(\d{14})?$/).default(''),legalName:z.string().trim().max(100).default(''),stateRegistration:z.string().trim().max(30).default(''),
 uf:z.string().regex(/^([A-Z]{2})?$/).default(''),taxRegime:z.enum(['','SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL']).default(''),
 series:z.number().int().min(1).max(999).default(1),nextNumber:z.number().int().min(1).max(999999999).default(1)
}).strict();
export const reviewSchema=z.object({ncm:z.string().regex(/^(\d{8})?$/).default(''),cfop:z.string().regex(/^(\d{4})?$/).default(''),csosn:z.string().regex(/^(\d{3})?$/).default(''),cst:z.string().regex(/^(\d{2,3})?$/).default(''),status:z.enum(['PENDING_REVIEW','ENTERED_FOR_REVIEW']).default('PENDING_REVIEW')}).strict();
export const scenarioSchema=z.enum(['APPROVED','REJECTED','TIMEOUT','OFFLINE']);
export type Scenario=z.infer<typeof scenarioSchema>;
export const statusLabels:Record<string,string>={REHEARSAL_APPROVED:'Aprovado no simulador',REHEARSAL_REJECTED:'Rejeitado no simulador',UNKNOWN_OUTCOME:'Resposta desconhecida — consultar',OFFLINE_REHEARSAL:'Sem conexão — ensaio offline',CANCELED_REHEARSAL:'Ensaio cancelado'};
export function validCpf(value:string){if(!/^\d{11}$/.test(value)||/^(\d)\1{10}$/.test(value))return false;for(const length of [9,10]){let sum=0;for(let i=0;i<length;i++)sum+=Number(value[i])*(length+1-i);const digit=(sum*10)%11%10;if(digit!==Number(value[length]))return false;}return true;}
export function readiness(store:LocalOperationalStore){
 const rows=store.db.prepare('SELECT json FROM fiscal_preparation_settings ORDER BY segment').all() as {json:string}[];
 const emitters=rows.map(row=>emitterSchema.parse(JSON.parse(row.json)));
 const catalog=store.getCatalog().products;const reviews=store.db.prepare('SELECT product_id,json FROM fiscal_product_reviews').all() as {product_id:string;json:string}[];
 const products=catalog.map(product=>({id:product.id,name:product.name,review:reviewSchema.parse(JSON.parse(reviews.find(row=>row.product_id===product.id)?.json??'{}'))}));
 return {mode:'PREPARATION_ONLY',realEmissionEnabled:false,certificateConfigured:false,transportImplemented:false,emitters,products,blockers:[
 'Certificado A1 e armazenamento seguro ainda não integrados.',
 'Credenciamento, CSC e endereços da SEFAZ da UF não configurados.',
 'Assinatura XML, validação XSD e transmissão SOAP/mTLS ainda não implementadas.',
 'Dados do emitente, tributação e regras vigentes precisam de revisão contábil.',
 'Homologação real, eventos fiscais e contingência oficial ainda pendentes.'
 ],reviewedProducts:products.filter(product=>product.review.status==='ENTERED_FOR_REVIEW').length};
}
export function checkoutPreview(store:LocalOperationalStore,tabId:string,cpf=''){
 if(cpf&&!validCpf(cpf))throw Error('CPF inválido. Informe 11 dígitos ou deixe vazio.');
 const tab=store.getTabById(tabId);if(!tab)throw Error('Comanda não encontrada.');if(tab.type==='HOTEL_FOLIO')throw Error('Conta do hotel: NFS-e deve permanecer separada da NFC-e do restaurante.');
 const orders=store.listOrdersByTab(tab.id);if(orders.some(order=>order.status==='PENDING_APPROVAL'))throw Error('Aprove ou recuse os pedidos pendentes antes da conferência.');
 const items=orders.filter(order=>order.status!=='CANCELLED').flatMap(order=>order.items.filter(item=>item.status!=='CANCELLED'&&!item.transferredToTabId).map(item=>({name:item.productName,quantity:item.quantity,totalCents:item.totalItemCents})));
 const sum=items.reduce((total,item)=>total+item.totalCents,0);if(sum!==tab.subtotalCents)throw Error('Os itens divergem do subtotal da comanda. Atualize e confira antes de continuar.');
 const text=['DECK 26 · CONFERÊNCIA FISCAL','PRÉVIA INTERNA — NÃO É DANFE','NENHUMA NOTA EMITIDA',tab.code,...items.map(item=>`${item.quantity} x ${item.name} = ${formatBrlCents(item.totalCents)}`),'SUBTOTAL '+formatBrlCents(tab.subtotalCents),'DESCONTO '+formatBrlCents(tab.discountCents),'SERVIÇO '+formatBrlCents(tab.serviceFeeCents),'TOTAL DA CONTA '+formatBrlCents(tab.totalCents),'RECEBIDO '+formatBrlCents(tab.paidCents),'Tratamento fiscal de descontos/serviço pendente de revisão.','Todos os itens incluídos na conferência.','SEM CHAVE · SEM PROTOCOLO SEFAZ'].join('\n');
 return {tabId:tab.id,code:tab.code,items,subtotalCents:tab.subtotalCents,discountCents:tab.discountCents,serviceFeeCents:tab.serviceFeeCents,totalCents:tab.totalCents,paidCents:tab.paidCents,consumer:cpf?'CPF validado, não armazenado':'Consumidor não identificado',realEmissionEnabled:false,html:renderThermalPreview(text,80,'Conferência fiscal — sem validade fiscal')};
}
export const sample={label:'CONSUMO DE EXEMPLO · SEM VENDA',items:[{name:'Prato de exemplo',quantity:1,totalCents:4000},{name:'Bebida de exemplo',quantity:2,totalCents:1000}],totalCents:5000};
/** Deterministic transport double. Never performs any network request. */
export class MockSefazTransport {
 send(scenario:Scenario){return {status:scenario==='APPROVED'?'REHEARSAL_APPROVED':scenario==='REJECTED'?'REHEARSAL_REJECTED':scenario==='TIMEOUT'?'UNKNOWN_OUTCOME':'OFFLINE_REHEARSAL',message:scenario==='APPROVED'?'Resposta aprovada pelo simulador; nenhuma SEFAZ consultada.':scenario==='REJECTED'?'Rejeição de exemplo: classificação tributária incompleta.':scenario==='TIMEOUT'?'Resposta desconhecida. Consulte o mesmo ensaio antes de repetir.':'Ensaio offline guardado. Isto não é contingência fiscal válida.'};}
 consult(){return {status:'REHEARSAL_APPROVED',message:'Consulta simulada resolveu a resposta desconhecida. Nenhuma transmissão real.'};}
}
export function createRehearsal(store:LocalOperationalStore,key:string,scenario:Scenario,actor:string){
 const hash=crypto.createHash('sha256').update(JSON.stringify({scenario,sample})).digest('hex');
 const previous=store.db.prepare('SELECT * FROM fiscal_rehearsals WHERE idempotency_key=?').get(key) as Record<string,unknown>|undefined;
 if(previous){if(previous.request_hash!==hash)throw Error('A identificação já foi usada em outro cenário.');return rehearsalView(previous);}
 const response=new MockSefazTransport().send(scenario),id=crypto.randomUUID(),now=new Date().toISOString();
 store.db.prepare('INSERT INTO fiscal_rehearsals VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,key,hash,scenario,response.status,JSON.stringify(sample),JSON.stringify([{at:now,...response}]),actor,now,now);
 store.recordAuditLog({actorUserId:actor,action:'FISCAL_REHEARSAL_CREATED',entityType:'FISCAL_REHEARSAL',entityId:id,metadata:{scenario}});
 return rehearsalView(store.db.prepare('SELECT * FROM fiscal_rehearsals WHERE id=?').get(id) as Record<string,unknown>);
}
export function rehearsalView(row:Record<string,unknown>){const payload=JSON.parse(String(row.payload_json));const history=JSON.parse(String(row.history_json));return {id:row.id,scenario:row.scenario,status:row.status,label:statusLabels[String(row.status)],createdAt:row.created_at,history,payload,html:renderThermalPreview(['DECK 26 · ENSAIO FISCAL','NÃO É DANFE · NÃO É NOTA FISCAL','SEM TRANSMISSÃO À SEFAZ',...payload.items.map((item:{name:string;quantity:number;totalCents:number})=>`${item.quantity} x ${item.name} ${formatBrlCents(item.totalCents)}`),'TOTAL DE EXEMPLO '+formatBrlCents(payload.totalCents),statusLabels[String(row.status)]??'', 'SEM CHAVE · SEM QR FISCAL · SEM PROTOCOLO','NENHUMA VENDA OU COBRANÇA GERADA'].join('\n'),80,'Ensaio — sem validade fiscal')};}
export function transitionRehearsal(store:LocalOperationalStore,id:string,action:'consult'|'cancel',actor:string){const row=store.db.prepare('SELECT * FROM fiscal_rehearsals WHERE id=?').get(id) as Record<string,unknown>|undefined;if(!row)throw Error('Ensaio não encontrado.');if(action==='consult'&&row.status!=='UNKNOWN_OUTCOME')throw Error('Somente resposta desconhecida permite consulta neste ensaio.');if(action==='cancel'&&row.status!=='REHEARSAL_APPROVED')throw Error('Somente um ensaio aprovado pode ser cancelado.');const response=action==='consult'?new MockSefazTransport().consult():{status:'CANCELED_REHEARSAL',message:'Cancelamento apenas do ensaio, sem evento SEFAZ.'};const now=new Date().toISOString(),history=JSON.parse(String(row.history_json));history.push({at:now,...response});store.db.prepare('UPDATE fiscal_rehearsals SET status=?,history_json=?,updated_at=? WHERE id=?').run(response.status,JSON.stringify(history),now,id);store.recordAuditLog({actorUserId:actor,action:'FISCAL_REHEARSAL_'+action.toUpperCase(),entityType:'FISCAL_REHEARSAL',entityId:id});return rehearsalView(store.db.prepare('SELECT * FROM fiscal_rehearsals WHERE id=?').get(id) as Record<string,unknown>);}
