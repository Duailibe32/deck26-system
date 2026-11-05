import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {z} from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {RoleSchema,type Permission,type UserRole,type PrintJob} from '@deck26/contracts';
import type {LocalOperationalStore} from './store.js';
import {renderThermalPreview,thermalModels} from './thermal-preview.js';

type Actor={userId:string;role:UserRole};
type Authorize=(req:FastifyRequest,reply:FastifyReply,permission:Permission)=>Actor|null;
const local=(req:FastifyRequest)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.ip);
const settingsSchema=z.object({restaurantName:z.string().min(2).max(100),address:z.string().max(200).default(''),phone:z.string().max(40).default(''),cashierWidth:z.union([z.literal(58),z.literal(80)]).default(80),kitchenWidth:z.union([z.literal(58),z.literal(80)]).default(80)});
export function registerOperationRoutes(app:FastifyInstance,store:LocalOperationalStore,authorize:Authorize){
  const settings=()=>{const row=store.db.prepare('SELECT json FROM operational_settings WHERE id=1').get() as {json:string}|undefined;return settingsSchema.parse(row?JSON.parse(row.json):{restaurantName:'DECK 26',cashierWidth:80,kitchenWidth:80});};
  const baseDirectory=()=>process.env.DECK26_OPERATION_DATA_DIR||path.dirname((store.db.prepare('PRAGMA database_list').get() as {file:string}).file||path.resolve('data/local-operation'));
  const simulate=(job:PrintJob,actorId:string,automatic=false)=>{
    const device=job.targetPrinter==='PRINTER_CASHIER'?'CASHIER':'KITCHEN',copy=job.copyNumber??1,width=device==='CASHIER'?settings().cashierWidth:settings().kitchenWidth;
    const existing=store.db.prepare('SELECT id,width_mm,payload_text FROM print_simulations WHERE job_id=? AND copy_number=?').get(job.id,copy) as {id:string;width_mm:58|80;payload_text:string}|undefined;const html=renderThermalPreview(existing?.payload_text??job.payloadText,existing?.width_mm??width,device==='CASHIER'?'Caixa':'Cozinha');
    const id=existing?.id??crypto.randomUUID(),directory=path.join(baseDirectory(),'impressoes-simuladas');fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,id+'.html');
    if(!existing){fs.writeFileSync(file,html,'utf8');store.db.prepare('INSERT INTO print_simulations(id,job_id,device,width_mm,payload_text,actor_user_id,created_at,copy_number) VALUES (?,?,?,?,?,?,?,?)').run(id,job.id,device,width,job.payloadText,actorId,new Date().toISOString(),copy);store.recordAuditLog({actorUserId:actorId,action:automatic?'PRINT_SIMULATED_AUTOMATIC':'PRINT_SIMULATED',entityType:'PRINT_JOB',entityId:job.id,metadata:{simulationId:id,device,copy}});}
    return {id,html,path:file,simulated:true,jobStatus:job.status};
  };
  app.get('/api/setup/status',async()=>({needsOwner:(store.db.prepare('SELECT COUNT(*) AS count FROM users').get() as {count:number}).count===0,operational:process.env.DECK26_OPERATIONAL==='true'}));
  app.post('/api/setup/owner',async(req,reply)=>{
    if(!local(req))return reply.code(403).send({error:'Crie o responsável no computador principal.'});
    const body=z.object({name:z.string().trim().min(2).max(80),pin:z.string().regex(/^\d{6,12}$/),importCatalog:z.boolean()}).safeParse(req.body);
    if(!body.success)return reply.code(400).send({error:'Informe seu nome, PIN próprio de 6 a 12 dígitos e a opção de cadastros.'});
    try{store.initializeLocalOperation({...body.data,actorIp:req.ip});return {ready:true};}catch(error){return reply.code(409).send({error:(error as Error).message});}
  });
  app.get('/api/operation/settings',async(req,reply)=>{if(!authorize(req,reply,'admin:configure'))return;return {...settings(),printerMode:'SIMULATOR',dataDirectory:baseDirectory()};});
  app.put('/api/operation/settings',async(req,reply)=>{const actor=authorize(req,reply,'admin:configure');if(!actor)return;const data=settingsSchema.safeParse(req.body);if(!data.success)return reply.code(400).send({error:'Configuração inválida.'});store.db.prepare('INSERT INTO operational_settings(id,json,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at').run(JSON.stringify(data.data),new Date().toISOString());store.recordAuditLog({actorUserId:actor.userId,action:'LOCAL_SETTINGS_UPDATED',entityType:'SETTINGS',entityId:'local'});return data.data;});
  app.get('/api/operation/operators',async(req,reply)=>{if(!authorize(req,reply,'staff:manage'))return;return store.db.prepare('SELECT id,name,role,active,created_at AS createdAt FROM users ORDER BY name').all();});
  app.post('/api/operation/operators',async(req,reply)=>{
    const actor=authorize(req,reply,'staff:manage');if(!actor)return;
    const data=z.object({id:z.string().optional(),name:z.string().trim().min(2).max(80),role:RoleSchema,pin:z.string().regex(/^\d{6,12}$/).optional(),active:z.boolean()}).safeParse(req.body);
    if(!data.success)return reply.code(400).send({error:'Confira nome, cargo e PIN de 6 a 12 dígitos.'});
    try{return store.manageOperator({...data.data,actorId:actor.userId,actorRole:actor.role});}catch(error){return reply.code(400).send({error:(error as Error).message});}
  });
  app.get('/api/operation/audit',async(req,reply)=>{if(!authorize(req,reply,'admin:configure'))return;return store.listAuditLogs(undefined,150);});
  app.post('/api/operation/backup',async(req,reply)=>{
    const actor=authorize(req,reply,'admin:configure');if(!actor)return;if(!local(req))return reply.code(403).send({error:'Crie backups pelo computador principal.'});
    const directory=path.join(baseDirectory(),'backups');fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'deck26-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,6)+'.sqlite');
    store.db.prepare('VACUUM INTO ?').run(file);store.recordAuditLog({actorUserId:actor.userId,action:'LOCAL_BACKUP_CREATED',entityType:'BACKUP',entityId:path.basename(file)});return {path:file,bytes:fs.statSync(file).size};
  });
  app.get('/api/operation/printers',async(req,reply)=>{if(!authorize(req,reply,'printers:manage'))return;return {mode:'SIMULATOR',devices:[{id:'CASHIER',name:'Caixa',width:settings().cashierWidth},{id:'KITCHEN',name:'Cozinha',width:settings().kitchenWidth}],simulations:store.db.prepare('SELECT * FROM print_simulations ORDER BY created_at DESC LIMIT 100').all()};});
  app.get<{Params:{model:string}}>('/api/operation/print-models/:model',async(req,reply)=>{if(!authorize(req,reply,'printers:manage'))return;const key=req.params.model as keyof typeof thermalModels;if(!thermalModels[key])return reply.code(404).send({error:'Modelo não encontrado.'});const device=key==='kitchen'?'Cozinha':'Caixa';return {html:renderThermalPreview(thermalModels[key],key==='kitchen'?settings().kitchenWidth:settings().cashierWidth,device)};});
  app.post<{Params:{id:string}}>('/api/operation/print-jobs/:id/simulate',async(req,reply)=>{
    const actor=authorize(req,reply,'printers:manage');if(!actor)return;const job=store.listPrintJobs().find(item=>item.id===req.params.id);if(!job)return reply.code(404).send({error:'Trabalho não encontrado.'});if(job.status==='CANCELLED')return reply.code(409).send({error:'Trabalho cancelado.'});
    return simulate(job,actor.userId);
  });
  app.post('/api/operation/shutdown',async(req,reply)=>{if(!authorize(req,reply,'admin:configure'))return;if(!local(req))return reply.code(403).send({error:'Encerre pelo computador principal.'});if(process.env.DECK26_OPERATIONAL!=='true')return reply.code(409).send({error:'Este comando pertence à instalação operacional.'});reply.send({stopping:true});setTimeout(()=>{void app.close();},100);});
  app.get('/api/operation/network',async(req,reply)=>{if(!authorize(req,reply,'admin:configure'))return;const port=process.env.PORT||'4800';const hosts=Object.values(os.networkInterfaces()).flat().filter(item=>item?.family==='IPv4'&&!item.internal&&/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)).map(item=>item!.address);return {waiterUrls:hosts.map(host=>'http://'+host+':'+port+'/?terminal=garcom'),publicBaseUrls:hosts.map(host=>'http://'+host+':'+port)};});
  if(process.env.DECK26_OPERATIONAL==='true'){
    const timer=setInterval(()=>{try{const owner=store.db.prepare("SELECT id FROM users WHERE role='OWNER' AND active=1 LIMIT 1").get() as {id:string}|undefined;if(!owner)return;for(const job of store.listPrintJobs()){if(!['QUEUED','PENDING'].includes(job.status))continue;const prior=store.db.prepare('SELECT id FROM print_simulations WHERE job_id=? AND copy_number=?').get(job.id,job.copyNumber??1);if(!prior)simulate(job,owner.id,true);}}catch(error){app.log.error(error,'Falha na impressora virtual.');}},2000);
    timer.unref();app.addHook('onClose',async()=>{clearInterval(timer);});
  }

}
