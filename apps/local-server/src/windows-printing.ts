import {spawn} from 'node:child_process';
import path from 'node:path';
import {z} from 'zod';
import type {PrintJob} from '@deck26/contracts';
import type {LocalOperationalStore} from './store.js';
import {correctionTicketHeader} from './order-correction.js';
import {wrapThermalLine} from './thermal-preview.js';

const queueName=z.string().trim().min(1).max(220);
export const WindowsPrintConfigurationSchema=z.object({
  PRINTER_CASHIER:queueName.optional(),
  PRINTER_KITCHEN:queueName.optional(),
  PRINTER_KITCHEN_HOT:queueName.optional(),
  PRINTER_KITCHEN_COLD:queueName.optional(),
  PRINTER_GRIDDLE:queueName.optional(),
  PRINTER_BAR:queueName.optional()
}).strict();
export type WindowsPrintTargets=Partial<Record<PrintJob['targetPrinter'],string>>;

export function resolveWindowsPrintTargets(configuration:z.infer<typeof WindowsPrintConfigurationSchema>):WindowsPrintTargets {
  const {PRINTER_KITCHEN:kitchen,...targets}=configuration;
  if(kitchen){
    for(const target of ['PRINTER_KITCHEN_HOT','PRINTER_KITCHEN_COLD','PRINTER_GRIDDLE','PRINTER_BAR'] as const){
      targets[target]??=kitchen;
    }
  }
  return Object.fromEntries(Object.entries(targets).filter(([,printer])=>printer));
}
type Request={mode:'submit'|'inspect';printer:string;title:string;bytes?:string;spoolId?:number};
const resultSchema=z.object({
  state:z.enum(['REJECTED','ACCEPTED','WAITING','PRINTED','UNKNOWN']),
  message:z.string().nullish(),
  jobId:z.number().int().positive().nullish()
});
type Result=z.infer<typeof resultSchema>;
type Dispatch={job_id:string;copy_number:number;printer_name:string;spool_id:number|null;safe_retry:number};
export type WindowsPrintTransport=(request:Request)=>Promise<Result>;

export function windowsPrintTransport(script:string):WindowsPrintTransport {
  return request=>new Promise((resolve,reject)=>{
    const executable=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=spawn(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    const timer=setTimeout(()=>child.kill(),10000);
    let output='';
    child.stdout.setEncoding('utf8').on('data',chunk=>{output+=chunk;if(output.length>16000)child.kill();});
    child.stdin.on('error',()=>{});
    child.once('error',reject);
    child.once('close',code=>{
      clearTimeout(timer);
      try {
        if(code!==0)throw Error('O Windows não respondeu à consulta de impressão.');
        resolve(resultSchema.parse(JSON.parse(output)));
      }catch(error){reject(error);}
    });
    // ASCII on stdin preserves names in Windows PowerShell regardless of its OEM code page.
    child.stdin.end(JSON.stringify(request).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));
  });
}

export function thermalBytes(job:PrintJob,width:58|80):string {
  const columns=width===58?32:48;
  const isCorrection=job.payloadText.split('\n').includes(correctionTicketHeader);
  const text=job.payloadText.normalize('NFD').replace(/\p{M}/gu,'').replace(/\r/g,'')
    .replace(/[^\x20-\x7e\n]/g,' ').split('\n').map(line=>{
      const wrapped=wrapThermalLine(line,columns).join('\n');
      if(!isCorrection)return wrapped;
      if(line==='CORRECAO DE PEDIDO')return '\x1ba\x01\x1bE\x01\x1d!\x01'+wrapped+'\n\x1d!\x00\x1bE\x00\x1ba\x00';
      if(/^(CANCELAR PREPARO|NOVA OBSERVACAO|PREPARAR SUBSTITUICAO|ITEM JA EM PRODUCAO|NAO PREPARAR|MANTER )/.test(line)){
        return '\x1bE\x01'+wrapped+'\x1bE\x00';
      }
      return wrapped;
    }).join('\n');
  return Buffer.from('\x1b@'+text+'\n\n\n\x1dV\x00','ascii').toString('base64');
}

export function createWindowsPrintQueue(store:LocalOperationalStore,targets:WindowsPrintTargets,send:WindowsPrintTransport,widthFor:(job:PrintJob)=>58|80,enabledSince:string) {
  const configured=Object.entries(targets) as [PrintJob['targetPrinter'],string][];
  const destinations=new Map<string,PrintJob['targetPrinter'][]>();
  for(const [target,printer] of configured)destinations.set(printer,[...(destinations.get(printer)??[]),target]);
  const title=(id:string,copy:number)=>'DECK26 '+id+' / '+copy;
  let tick:Promise<void>|undefined;
  const reconcile=async(dispatch:Dispatch)=>{
    const job=store.getPrintJob(dispatch.job_id);
    if(!job||job.status!=='SENDING'||(job.copyNumber??1)!==dispatch.copy_number)return;
    let result:Result;
    if(dispatch.spool_id===null){
      result={state:'UNKNOWN',message:'Envio interrompido. Confira a fila do Windows e a via antes de repetir.'};
    }else{
      try{result=await send({mode:'inspect',printer:dispatch.printer_name,title:title(job.id,dispatch.copy_number),spoolId:dispatch.spool_id});}
      catch{result={state:'WAITING',message:'Sem resposta da fila do Windows. A via permanece pendente.'};}
    }
    const current=store.getPrintJob(job.id);
    if(current?.status!=='SENDING'||(current.copyNumber??1)!==dispatch.copy_number)return;
    if(result.state==='PRINTED'||result.state==='UNKNOWN'){
      store.updatePrintJobStatus({jobId:job.id,status:result.state==='PRINTED'?'PRINTED':'UNKNOWN_OUTCOME',errorMsg:result.message??undefined});
    }else if(result.state==='WAITING'&&(result.message??null)!==current.lastError){
      store.db.prepare('UPDATE print_jobs SET last_error=? WHERE id=?').run(result.message??null,job.id);
      if(result.message)store.createNotification({eventType:'PRINT_FAILED',title:'Impressora requer atenção',message:result.message});
    }
  };
  const submit=async(job:PrintJob,printer:string)=>{
    const copy=job.copyNumber??1;
    const bytes=thermalBytes(job,widthFor(job));
    store.runOperationalTransaction(()=>{
      store.db.prepare('INSERT INTO windows_print_dispatches(job_id,copy_number,printer_name) VALUES (?,?,?)').run(job.id,copy,printer);
      store.updatePrintJobStatus({jobId:job.id,status:'SENDING',errorMsg:''});
    });
    let result:Result;
    try{result=await send({mode:'submit',printer,title:title(job.id,copy),bytes});}
    catch{result={state:'UNKNOWN',message:'O envio não foi confirmado pelo Windows. Confira a fila antes de repetir.'};}
    const current=store.getPrintJob(job.id);
    if(current?.status!=='SENDING'||(current.copyNumber??1)!==copy)return;
    store.runOperationalTransaction(()=>{
      if(result.state==='ACCEPTED'&&result.jobId){
        store.db.prepare('UPDATE windows_print_dispatches SET spool_id=? WHERE job_id=? AND copy_number=?').run(result.jobId,job.id,copy);
      }else if(result.state==='REJECTED'){
        store.db.prepare('UPDATE windows_print_dispatches SET safe_retry=1 WHERE job_id=? AND copy_number=?').run(job.id,copy);
        store.updatePrintJobStatus({jobId:job.id,status:'FAILED',errorMsg:result.message??'O Windows recusou a via antes de aceitar o envio.'});
      }else{
        store.updatePrintJobStatus({jobId:job.id,status:'UNKNOWN_OUTCOME',errorMsg:result.message??'Confirme o resultado na fila do Windows.'});
      }
    });
  };
  const poll=async()=>{
    const active=store.db.prepare(`
      SELECT d.* FROM windows_print_dispatches d JOIN print_jobs j ON j.id=d.job_id AND j.copy_number=d.copy_number
      WHERE j.status='SENDING' ORDER BY j.created_at
    `).all() as Dispatch[];
    await Promise.all(active.map(reconcile));
    const busyPrinters=new Set(active.map(entry=>entry.printer_name));
    for(const [printer,stations] of destinations){
      if(busyPrinters.has(printer))continue;
      const next=store.db.prepare(`
        SELECT j.id FROM print_jobs j WHERE j.target_printer IN (${stations.map(()=>'?').join(',')}) AND j.status IN ('QUEUED','PENDING')
          AND (j.created_at>=? OR EXISTS(SELECT 1 FROM audit_logs a WHERE a.entity_id=j.id
            AND a.action IN ('PRINT_JOB_REPRINTED','PRINT_JOB_REQUEUED') AND a.created_at>=?))
          AND NOT EXISTS(SELECT 1 FROM print_simulations s WHERE s.job_id=j.id AND s.copy_number=j.copy_number)
          AND NOT EXISTS(SELECT 1 FROM windows_print_dispatches d WHERE d.job_id=j.id AND d.copy_number=j.copy_number)
        ORDER BY j.created_at,j.rowid LIMIT 1
      `).get(...stations,enabledSince,enabledSince);
      const job=next&&store.getPrintJob(String(next.id));
      if(job){busyPrinters.add(printer);await submit(job,printer);}
    }
  };
  return {
    poll:()=>tick??=(poll().finally(()=>{tick=undefined;})),
    close:()=>tick,
    retry(jobId:string,copy:number,actorId:string){
      return store.runOperationalTransaction(()=>{
        const job=store.getPrintJob(jobId);
        if(job?.status!=='FAILED'||(job.copyNumber??1)!==copy||!targets[job.targetPrinter])throw Error('Esta via não pode ser reenviada.');
        const deletion=store.db.prepare('DELETE FROM windows_print_dispatches WHERE job_id=? AND copy_number=? AND safe_retry=1 AND spool_id IS NULL').run(jobId,copy);
        if(!deletion.changes)throw Error('Confira a via anterior. O reenvio automático poderia duplicar a impressão.');
        const updated=store.updatePrintJobStatus({jobId,status:'QUEUED',errorMsg:''});
        store.recordAuditLog({actorUserId:actorId,action:'PRINT_JOB_REQUEUED',entityType:'PRINT_JOB',entityId:jobId,metadata:{copyNumber:copy}});
        return updated;
      });
    }
  };
}
