import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {z} from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {RoleSchema,type Permission,type UserRole,type PrintJob} from '@deck26/contracts';
import type {LocalOperationalStore} from './store.js';
import {renderThermalPreview,thermalModels} from './thermal-preview.js';
import {createWindowsPrintQueue,type WindowsPrintTargets,type WindowsPrintTransport} from './windows-printing.js';

type Actor={userId:string;role:UserRole};
type Authorize=(req:FastifyRequest,reply:FastifyReply,permission:Permission)=>Actor|null;
const local=(req:FastifyRequest)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.ip);
const settingsSchema=z.object({restaurantName:z.string().min(2).max(100),address:z.string().max(200).default(''),phone:z.string().max(40).default(''),cashierWidth:z.union([z.literal(58),z.literal(80)]).default(80),kitchenWidth:z.union([z.literal(58),z.literal(80)]).default(80)});
export function registerOperationRoutes(app:FastifyInstance,store:LocalOperationalStore,authorize:Authorize,windows?:{targets:WindowsPrintTargets;send:WindowsPrintTransport;enabledSince:string}){
  const settings=()=>{const row=store.db.prepare('SELECT json FROM operational_settings WHERE id=1').get() as {json:string}|undefined;return settingsSchema.parse(row?JSON.parse(row.json):{restaurantName:'DECK 26',cashierWidth:80,kitchenWidth:80});};
  const baseDirectory=()=>process.env.DECK26_OPERATION_DATA_DIR||path.dirname((store.db.prepare('PRAGMA database_list').get() as {file:string}).file||path.resolve('data/local-operation'));
  const backupDirectory=()=>path.join(baseDirectory(),'backups');
  const backupName=/^(?:deck26|diario|encerramento)-[\dA-Za-z-]+\.sqlite$/;
  const listBackups=()=>{
    const directory=backupDirectory();
    if(!fs.existsSync(directory))return [];
    return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
      if(!entry.isFile()||!backupName.test(entry.name))return [];
      try {
        const stat=fs.lstatSync(path.join(directory,entry.name));
        return stat.isFile()?[{name:entry.name,bytes:stat.size,createdAt:stat.mtime.toISOString()}]:[];
      } catch(error) {
        if((error as NodeJS.ErrnoException).code==='ENOENT')return [];
        throw error;
      }
    }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  };
  const widthFor=(job:PrintJob)=>job.targetPrinter==='PRINTER_CASHIER'?settings().cashierWidth:settings().kitchenWidth;
  const queue=windows&&createWindowsPrintQueue(store,windows.targets,windows.send,widthFor,windows.enabledSince);
  const printerMode=windows&&Object.values(windows.targets).some(Boolean)?'WINDOWS':'SIMULATOR';
  const devices=()=>[
    {id:'CASHIER',name:'Caixa',width:settings().cashierWidth,queue:windows?.targets.PRINTER_CASHIER??null},
    {id:'KITCHEN',name:'Cozinha',width:settings().kitchenWidth,queue:[...new Set(
      [windows?.targets.PRINTER_KITCHEN_HOT,windows?.targets.PRINTER_KITCHEN_COLD,windows?.targets.PRINTER_GRIDDLE,windows?.targets.PRINTER_BAR].filter(Boolean)
    )].join(' / ')||null}
  ];
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
  app.get('/api/operation/settings',async(req,reply)=>{if(!authorize(req,reply,'admin:configure'))return;return {...settings(),printerMode,dataDirectory:baseDirectory()};});
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
    const directory=backupDirectory();fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'deck26-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,6)+'.sqlite');
    store.db.prepare('VACUUM INTO ?').run(file);store.recordAuditLog({actorUserId:actor.userId,action:'LOCAL_BACKUP_CREATED',entityType:'BACKUP',entityId:path.basename(file)});return {path:file,bytes:fs.statSync(file).size};
  });
  app.get('/api/operation/diagnostics',async(req,reply)=>{
    if(!authorize(req,reply,'admin:configure'))return;
    const isLocal=local(req);
    const backups=isLocal?listBackups():[];
    const verified=isLocal?store.db.prepare(`
      SELECT entity_id AS name, MAX(created_at) AS verifiedAt FROM audit_logs
      WHERE entity_type='BACKUP' AND action='LOCAL_BACKUP_RESTORE_VERIFIED'
      GROUP BY entity_id ORDER BY verifiedAt DESC
    `).all() as {name:string;verifiedAt:string}[]:[];
    const createdAtByName=new Map(backups.map(backup=>[backup.name,backup.createdAt]));
    const lastVerifiedBackup=verified.find(entry=>{
      const createdAt=createdAtByName.get(entry.name);
      return createdAt!==undefined&&createdAt<=entry.verifiedAt;
    })??null;
    return {
      operational:process.env.DECK26_OPERATIONAL==='true',serverTime:new Date().toISOString(),
      version:process.env.DECK26_RELEASE_VERSION??null,commit:process.env.DECK26_RELEASE_COMMIT??null,
      printerMode,devices:devices(),backups:backups.slice(0,20),lastVerifiedBackup,local:isLocal
    };
  });
  app.post('/api/operation/backup/verify',async(req,reply)=>{
    const actor=authorize(req,reply,'admin:configure');if(!actor)return;
    if(!local(req))return reply.code(403).send({error:'Valide a recuperação pelo computador principal.'});
    const body=z.object({name:z.string().max(100).regex(backupName)}).strict().safeParse(req.body);
    if(!body.success)return reply.code(400).send({error:'Selecione um backup da lista.'});
    const backup=listBackups().find(file=>file.name===body.data.name);
    if(!backup)return reply.code(404).send({error:'Backup não encontrado.'});
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'deck26-restore-check-'));
    try {
      const restored=path.join(directory,'restaurado.sqlite');
      fs.copyFileSync(path.join(backupDirectory(),backup.name),restored,fs.constants.COPYFILE_EXCL);
      const database=new DatabaseSync(restored,{readOnly:true});
      let counts:Record<string,number>;
      try {
        const integrity=database.prepare('PRAGMA integrity_check').all();
        if(integrity.length!==1||integrity[0]?.integrity_check!=='ok'||database.prepare('PRAGMA foreign_key_check').get()){
          return reply.code(422).send({error:'A cópia isolada apresentou falha de integridade.'});
        }
        counts=Object.fromEntries(['users','orders','payments','hotel_stays'].map(table=>[
          table, Number(database.prepare('SELECT COUNT(*) AS count FROM '+table).get()?.count)
        ]));
        if(!counts.users)return reply.code(422).send({error:'A cópia não contém operadores cadastrados.'});
      } finally { database.close(); }
      store.recordAuditLog({actorUserId:actor.userId,action:'LOCAL_BACKUP_RESTORE_VERIFIED',entityType:'BACKUP',entityId:backup.name});
      return {verified:true,backup:backup.name,counts};
    } catch(error) {
      app.log.warn({err:error},'Falha no ensaio de restauração do backup.');
      return reply.code(422).send({error:'Não foi possível abrir a cópia isolada como um banco do DECK 26.'});
    } finally {
      fs.rmSync(directory,{recursive:true,force:true});
    }
  });
  app.get('/api/operation/printers',async(req,reply)=>{
    if(!authorize(req,reply,'printers:manage'))return;
    const dispatches=store.db.prepare(`SELECT d.job_id,d.copy_number,d.safe_retry,d.printer_name
      FROM windows_print_dispatches d JOIN print_jobs j ON j.id=d.job_id AND j.copy_number=d.copy_number
      WHERE j.status IN ('SENDING','FAILED','UNKNOWN_OUTCOME')`).all();
    return {mode:printerMode,devices:devices(),dispatches,simulations:store.db.prepare('SELECT job_id, copy_number FROM print_simulations ORDER BY created_at DESC LIMIT 100').all()};
  });
  app.post<{Params:{id:string;action:string}}>('/api/operation/print-jobs/:id/windows/:action',async(req,reply)=>{
    const actor=authorize(req,reply,'printers:manage');if(!actor)return;
    if(!local(req))return reply.code(403).send({error:'Confirme a impressão pelo computador principal.'});
    const body=z.object({copy:z.number().int().positive()}).safeParse(req.body);
    if(!body.success)return reply.code(400).send({error:'Via inválida.'});
    const {id,action}=req.params,{copy}=body.data;
    try {
      if(action==='retry'&&queue)return {printJob:queue.retry(id,copy,actor.userId)};
      if(action==='confirm'){
        const printJob=store.runOperationalTransaction(()=>{
          const job=store.getPrintJob(id);
          const dispatch=store.db.prepare('SELECT 1 FROM windows_print_dispatches WHERE job_id=? AND copy_number=?').get(id,copy);
          if(!dispatch||job?.status!=='UNKNOWN_OUTCOME'||(job.copyNumber??1)!==copy)throw Error('A via já mudou. Atualize a fila.');
          const confirmed=store.updatePrintJobStatus({jobId:id,status:'PRINTED',errorMsg:''});
          store.recordAuditLog({actorUserId:actor.userId,action:'PRINT_JOB_OUTPUT_CONFIRMED',entityType:'PRINT_JOB',entityId:id,metadata:{copyNumber:copy}});
          return confirmed;
        });
        return {printJob};
      }
      return reply.code(409).send({error:'Ação indisponível para esta via.'});
    }catch(error){return reply.code(409).send({error:(error as Error).message});}
  });
  app.get<{Params:{model:string}}>('/api/operation/print-models/:model',async(req,reply)=>{if(!authorize(req,reply,'printers:manage'))return;const key=req.params.model as keyof typeof thermalModels;if(!Object.hasOwn(thermalModels,key))return reply.code(404).send({error:'Modelo não encontrado.'});const kitchen=key==='kitchen'||key==='correction';return {html:renderThermalPreview(thermalModels[key],kitchen?settings().kitchenWidth:settings().cashierWidth,kitchen?'Cozinha':'Caixa')};});
  app.post<{Params:{id:string}}>('/api/operation/print-jobs/:id/simulate',async(req,reply)=>{
    const actor=authorize(req,reply,'printers:manage');if(!actor)return;const job=store.getPrintJob(req.params.id);if(!job)return reply.code(404).send({error:'Trabalho não encontrado.'});if(job.status==='CANCELLED')return reply.code(409).send({error:'Trabalho cancelado.'});
    if(windows?.targets[job.targetPrinter])return {html:renderThermalPreview(job.payloadText,widthFor(job),job.targetPrinter==='PRINTER_CASHIER'?'Caixa':'Cozinha'),simulated:true,jobStatus:job.status};
    return simulate(job,actor.userId);
  });
  app.post('/api/operation/shutdown',async(req,reply)=>{if(!authorize(req,reply,'admin:configure'))return;if(!local(req))return reply.code(403).send({error:'Encerre pelo computador principal.'});if(process.env.DECK26_OPERATIONAL!=='true')return reply.code(409).send({error:'Este comando pertence à instalação operacional.'});reply.send({stopping:true});setTimeout(()=>{void app.close();},100);});
  app.get('/api/operation/network',async(req,reply)=>{if(!authorize(req,reply,'admin:configure'))return;const port=process.env.PORT||'4800';const hosts=Object.values(os.networkInterfaces()).flat().filter(item=>item?.family==='IPv4'&&!item.internal&&/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)).map(item=>item!.address);return {waiterUrls:hosts.map(host=>'http://'+host+':'+port+'/?terminal=garcom'),publicBaseUrls:hosts.map(host=>'http://'+host+':'+port)};});
  if(process.env.DECK26_OPERATIONAL==='true'){
    const timer=setInterval(()=>{
      void queue?.poll().catch(error=>app.log.error(error,'Falha ao acompanhar a fila do Windows.'));
      try{const owner=store.db.prepare("SELECT id FROM users WHERE role='OWNER' AND active=1 LIMIT 1").get() as {id:string}|undefined;if(!owner)return;for(const job of store.listPrintJobs()){if(windows?.targets[job.targetPrinter]||!['QUEUED','PENDING'].includes(job.status))continue;const prior=store.db.prepare('SELECT id FROM print_simulations WHERE job_id=? AND copy_number=?').get(job.id,job.copyNumber??1);if(!prior)simulate(job,owner.id,true);}}catch(error){app.log.error(error,'Falha na impressora virtual.');}
    },2500);
    timer.unref();app.addHook('preClose',async()=>{clearInterval(timer);await queue?.close()?.catch(error=>app.log.error(error));});
  }

}
