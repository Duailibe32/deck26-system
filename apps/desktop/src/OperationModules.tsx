import React,{useEffect,useState} from 'react';
import type {PrintJob,UserRole} from '@deck26/contracts';
import './operation.css';
type Headers=()=>Record<string,string>;
const roles:UserRole[]=['OWNER','MANAGER','CASHIER','WAITER','KITCHEN','RECEPTIONIST','STOCK_CLERK'];
const labels:Record<UserRole,string>={OWNER:'Proprietário',MANAGER:'Gerente',CASHIER:'Caixa',WAITER:'Garçom',KITCHEN:'Cozinha',RECEPTIONIST:'Recepção',STOCK_CLERK:'Estoque'};
interface Operator{id:string;name:string;role:UserRole;active:number}
async function request(api:string,url:string,headers:Headers,body?:unknown){const r=await fetch(api+url,{method:body?'POST':'GET',headers:headers(),body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'Operação indisponível.');return data;}
export function StaffModule({api,headers}:{api:string;headers:Headers}){
  const [users,setUsers]=useState<Operator[]>([]),[id,setId]=useState(''),[name,setName]=useState(''),[role,setRole]=useState<UserRole>('WAITER'),[active,setActive]=useState(true),[pin,setPin]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const reload=()=>request(api,'/api/operation/operators',headers).then(setUsers).catch(e=>setMessage(e.message));useEffect(()=>{void reload();},[api]);
  return <section className="d26-operation-grid"><div className="d26-card"><h2>Operadores e permissões</h2><p>Cada pessoa deve usar um PIN próprio. Alterações de acesso encerram sessões antigas.</p><div className="d26-operator-list">{users.map(user=><button key={user.id} onClick={()=>{setId(user.id);setName(user.name);setRole(user.role);setActive(!!user.active);setPin('');setMessage('');}}><strong>{user.name}</strong><span>{labels[user.role]} · {user.active?'Ativo':'Desativado'}</span></button>)}</div><button className="d26-btn d26-btn-secondary" onClick={()=>{setId('');setName('');setPin('');setRole('WAITER');setActive(true);}}>Novo operador</button></div><form className="d26-card d26-operation-form" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await request(api,'/api/operation/operators',headers,{id:id||undefined,name,role,pin:pin||undefined,active});setMessage('Operador salvo.');setPin('');await reload();}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}}><h2>{id?'Editar operador':'Cadastrar operador'}</h2><label>Nome<input required minLength={2} className="d26-input" value={name} onChange={e=>setName(e.target.value)}/></label><label>Cargo<select className="d26-input" value={role} onChange={e=>setRole(e.target.value as UserRole)}>{roles.map(item=><option key={item} value={item}>{labels[item]}</option>)}</select></label><label>{id?'Novo PIN (opcional)':'PIN próprio'}<input type="password" inputMode="numeric" pattern="[0-9]{6,12}" minLength={6} maxLength={12} required={!id} autoComplete="new-password" className="d26-input" value={pin} onChange={e=>setPin(e.target.value)}/></label><label><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Operador ativo</label><p role="status">{message}</p><button disabled={busy} className="d26-btn d26-btn-primary">{busy?'Salvando…':'Salvar operador'}</button></form></section>;
}
export function AdministrationModule({api,headers}:{api:string;headers:Headers}){
  const [settings,setSettings]=useState<any>(null),[network,setNetwork]=useState<any>(null),[audit,setAudit]=useState<any[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[confirmShutdown,setConfirmShutdown]=useState(false);
  useEffect(()=>{void Promise.all([request(api,'/api/operation/settings',headers).then(setSettings),request(api,'/api/operation/audit',headers).then(setAudit),request(api,'/api/operation/network',headers).then(setNetwork)]).catch(e=>setMessage(e.message));},[api]);
  if(!settings)return <p role="status">{message||'Carregando administração…'}</p>;
  return <><section className="d26-operation-grid"><form className="d26-card d26-operation-form" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const r=await fetch(api+'/api/operation/settings',{method:'PUT',headers:headers(),body:JSON.stringify(settings)});const data=await r.json();if(!r.ok)throw Error(data.error);setMessage('Configuração salva.');}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}}><h2>Seu estabelecimento</h2>{[['restaurantName','Nome do estabelecimento'],['address','Endereço para as vias'],['phone','Telefone']].map(([field='',label])=><label key={field}>{label}<input className="d26-input" value={settings[field]} onChange={e=>setSettings({...settings,[field]:e.target.value})}/></label>)}{[['cashierWidth','Bobina do caixa'],['kitchenWidth','Bobina da cozinha']].map(([field='',label])=><label key={field}>{label}<select className="d26-input" value={settings[field]} onChange={e=>setSettings({...settings,[field]:Number(e.target.value)})}><option value={80}>80 mm</option><option value={58}>58 mm</option></select></label>)}<p>Impressão atual: simulador. Nenhum equipamento físico é acionado.</p><button className="d26-btn d26-btn-primary" disabled={busy}>Salvar configuração</button></form><div className="d26-card d26-operation-form"><h2>Acesso e continuidade</h2><p>Terminal do garçom — use o celular na mesma rede Wi‑Fi:</p>{network?.waiterUrls?.map((url:string)=><div key={url}><code className="d26-lan-link">{url}</code><button className="d26-btn d26-btn-secondary" onClick={()=>{void navigator.clipboard.writeText(url).then(()=>setMessage('Link copiado.')).catch(()=>setMessage('Copie o endereço exibido na tela.'));}}>Copiar link</button></div>)}<p>Delivery para o cliente — mesmo Wi‑Fi:</p>{network?.waiterUrls?.map((url:string)=><div key={'delivery-'+url}><code className="d26-lan-link">{url.replace('?terminal=garcom','?delivery=1')}</code><button className="d26-btn d26-btn-secondary" onClick={()=>void navigator.clipboard.writeText(url.replace('?terminal=garcom','?delivery=1')).then(()=>setMessage('Link do cliente copiado.')).catch(()=>setMessage('Copie o endereço exibido.'))}>Copiar link do cliente</button></div>)}<p>O servidor precisa continuar ligado. Ao encerrar a operação local, os terminais perdem a conexão.</p><OperationDiagnostics api={api} headers={headers}/><small>Dados locais: {settings.dataDirectory}</small><button className="d26-btn d26-btn-secondary" onClick={()=>setConfirmShutdown(true)}>Encerrar servidor local</button>{confirmShutdown&&<div role="dialog" aria-modal="true" aria-label="Encerrar operação" className="d26-card"><h3>Encerrar o acesso local?</h3><p>Os lançamentos ficam salvos. Os celulares serão desconectados e precisarão aguardar a reabertura pelo atalho.</p><button className="d26-btn d26-btn-primary" onClick={async()=>{try{await request(api,'/api/operation/shutdown',headers,{});setMessage('Servidor encerrado. Feche esta janela e use o atalho para reabrir.');setConfirmShutdown(false);}catch(error){setMessage((error as Error).message);}}}>Confirmar encerramento</button><button className="d26-btn d26-btn-secondary" onClick={()=>setConfirmShutdown(false)}>Continuar atendendo</button></div>}</div></section><p role="status" className="d26-operation-message">{message}</p><section className="d26-card"><h2>Últimas ações auditadas</h2><div className="d26-audit-list">{audit.map(item=><div key={item.id}><time>{new Date(item.createdAt).toLocaleString('pt-BR')}</time><strong>{item.action}</strong><span>{item.entityType} · {item.entityId}</span></div>)}</div></section></>;
}

type Diagnostics = {
  operational: boolean;
  serverTime: string;
  printerMode: 'SIMULATOR';
  devices: { id: string; name: string; width: number }[];
  local: boolean;
  backups: { name: string; bytes: number; createdAt: string }[];
};
function OperationDiagnostics({api,headers}:{api:string;headers:Headers}) {
  const [data,setData]=useState<Diagnostics|null>(null),[selected,setSelected]=useState('');
  const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
  const load=async()=>{
    try { setData(await request(api,'/api/operation/diagnostics',headers)); }
    catch (error) { setData(null);setStatus((error as Error).message); }
  };
  useEffect(()=>{ void load(); },[api]);
  const backup=data?.backups.find(entry=>entry.name===selected)??data?.backups[0];
  const run=async(verify:boolean)=>{
    setBusy(true);setStatus('');
    try {
      if(verify&&backup){
        const result=await request(api,'/api/operation/backup/verify',headers,{name:backup.name});
        setStatus('Cópia isolada aprovada. '+result.counts.orders+' pedidos, '+result.counts.payments+' pagamentos e '+result.counts.hotel_stays+' hospedagens encontrados.');
      }else{
        await request(api,'/api/operation/backup',headers,{});
        setSelected('');await load();setStatus('Backup consistente criado.');
      }
    }catch(error){setStatus((error as Error).message);}finally{setBusy(false);}
  };
  return <section className="d26-operation-diagnostics" aria-label="Diagnóstico e backup">
    <h3>Diagnóstico e backup</h3>
    <p>{data?'Servidor respondeu às '+new Date(data.serverTime).toLocaleTimeString('pt-BR')+' · '+(data.operational?'Operação local':'Ambiente de teste'):'Aguardando diagnóstico do servidor.'}</p>
    {data&&<p>{data.devices.map(device=>device.name+' '+device.width+' mm').join(' · ')} · Simulador</p>}
    <button className="d26-btn d26-btn-secondary" onClick={()=>void load()} disabled={busy}>Atualizar diagnóstico</button>
    {data?.local&&<>
      <p>{data.backups.length?'Último backup em '+new Date(data.backups[0]!.createdAt).toLocaleString('pt-BR'):'Nenhum backup encontrado.'}</p>
      <button className="d26-btn d26-btn-primary" disabled={busy} onClick={()=>void run(false)}>Criar backup agora</button>
      {backup&&<>
        <label>Cópia para validar<select className="d26-input" value={backup.name} disabled={busy} onChange={event=>setSelected(event.target.value)}>
          {data.backups.map(entry=><option key={entry.name} value={entry.name}>{new Date(entry.createdAt).toLocaleString('pt-BR')} · {entry.name}</option>)}
        </select></label>
        <button className="d26-btn d26-btn-secondary" disabled={busy} onClick={()=>void run(true)}>Ensaiar restauração</button>
        <small>O ensaio abre uma cópia temporária e confere a integridade e os registros do banco.</small>
      </>}
    </>}
    {status&&<p role="status">{status}</p>}
  </section>;
}

const printStatus:Record<PrintJob['status'],string>={
  QUEUED:'Na fila',PENDING:'Na fila',PRINTING:'Em processamento',SENDING:'Encaminhando',
  PRINTED:'Impressão registrada',FAILED:'Falhou',UNKNOWN_OUTCOME:'Resultado desconhecido',CANCELLED:'Cancelada'
};
const problem=(job:PrintJob)=>job.status==='FAILED'||job.status==='UNKNOWN_OUTCOME';
const printerName=(job:PrintJob)=>job.targetPrinter==='PRINTER_CASHIER'?'Caixa':job.targetPrinter==='PRINTER_BAR'?'Bar':'Cozinha';
export function PrintingModule({api,headers,jobs,onRefresh,initialJobId}:{api:string;headers:Headers;jobs:PrintJob[];onRefresh:()=>Promise<void>;initialJobId?:string}){
  const [simulations,setSimulations]=useState<{job_id:string;copy_number:number}[]>([]);
  const [html,setHtml]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [filter,setFilter]=useState('all'),[device,setDevice]=useState('all');
  const [confirm,setConfirm]=useState<PrintJob|null>(null);
  const [focusedJob,setFocusedJob]=useState(initialJobId);
  const reload=async()=>{
    try {setSimulations((await request(api,'/api/operation/printers',headers)).simulations);}
    catch(error){setMessage((error as Error).message);}
  };
  useEffect(()=>{
    void reload();
    const timer=setInterval(()=>void reload(),5000);
    return ()=>clearInterval(timer);
  },[api]);
  const simulated=(job:PrintJob)=>simulations.some(item=>item.job_id===job.id&&item.copy_number===(job.copyNumber??1));
  const groups={queue:jobs.filter(job=>['QUEUED','PENDING','PRINTING','SENDING'].includes(job.status)&&!simulated(job)),
    failures:jobs.filter(problem),completed:jobs.filter(job=>job.status==='PRINTED'||simulated(job)&&!problem(job)&&job.status!=='CANCELLED')};
  const visible=(filter==='all'?jobs:groups[filter as keyof typeof groups]).filter(job=>(!focusedJob||job.id===focusedJob)&&(device==='all'||printerName(job)===device));
  const run=async(job:PrintJob,reprint=false)=>{
    setBusy(true);setMessage('');
    try {
      if(reprint){
        const result=await request(api,'/api/print-jobs/'+job.id+'/reprint',headers,{expectedCopyNumber:job.copyNumber??1});
        setMessage('Cópia '+result.printJob.copyNumber+' autorizada e registrada na fila.');
        setConfirm(null);
      }else{
        const result=await request(api,'/api/operation/print-jobs/'+job.id+'/simulate',headers,{});
        setHtml(result.html);setMessage('Prévia simulada gerada.');
      }
      await Promise.all([reload(),onRefresh()]);
    }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
  };
  return <>
    <div className="d26-card"><h2>Fila de impressão</h2><p>Caixa, cozinha e bar. As prévias em simulador geram arquivos para conferência.</p>
      {focusedJob&&<button className="d26-btn d26-btn-secondary" onClick={()=>setFocusedJob(undefined)}>Mostrar todas as vias</button>}
      <div className="d26-print-models" aria-label="Filtrar vias">
        {Object.entries({all:'Todas',queue:'Na fila · '+groups.queue.length,failures:'Falhas · '+groups.failures.length,completed:'Concluídas · '+groups.completed.length}).map(([value,label])=>
          <button key={value} className="d26-btn d26-btn-secondary" aria-pressed={filter===value} onClick={()=>{setFocusedJob(undefined);setFilter(value);}}>{label}</button>)}
        <label>Destino<select className="d26-input" value={device} onChange={event=>setDevice(event.target.value)}>
          {['all','Cozinha','Caixa','Bar'].map(value=><option key={value} value={value}>{value==='all'?'Todos':value}</option>)}
        </select></label>
      </div>
    </div>
    {message&&<p role="status" className="d26-operation-message">{message}</p>}
    <section className="d26-operation-grid">
      <div className="d26-card"><h2>Vias da operação</h2>{!visible.length&&<p>Nenhuma via neste filtro.</p>}
        {visible.map(job=><article key={job.id} className="d26-print-row">
          <strong>{printerName(job)} · {job.jobType}{job.isReprint?' · 2ª via (cópia '+job.copyNumber+')':''}</strong>
          <span className={problem(job)?'d26-print-error':''}>{problem(job)||!simulated(job)?printStatus[job.status]:'Via simulada'} · {new Date(job.createdAt).toLocaleString('pt-BR')}</span>
          {problem(job)&&job.lastError&&<small>{job.lastError}</small>}
          <div>
            <button className="d26-btn d26-btn-primary" disabled={busy||job.status==='CANCELLED'} onClick={()=>void run(job)}>Ver / simular via</button>
            <button className="d26-btn d26-btn-secondary" disabled={busy||job.status==='CANCELLED'} onClick={()=>setConfirm(job)}>Autorizar 2ª via</button>
          </div>
          {confirm?.id===job.id&&<div role="group" aria-label="Confirmar reimpressão">
            <p>Confira se a via anterior saiu na impressora antes de autorizar outra cópia.</p>
            <button className="d26-btn d26-btn-primary" disabled={busy} onClick={()=>void run(job,true)}>Confirmar 2ª via</button>
            <button className="d26-btn d26-btn-secondary" disabled={busy} onClick={()=>setConfirm(null)}>Voltar</button>
          </div>}
        </article>)}
      </div>
      <div className="d26-card"><h2>Prévia térmica</h2>
        <div className="d26-print-models">{[['kitchen','Produção'],['bill','Pré-conta'],['payment','Recibo'],['closing','Fechamento']].map(([model,label])=>
          <button key={model} className="d26-btn d26-btn-secondary" onClick={async()=>{try{
            setHtml((await request(api,'/api/operation/print-models/'+model,headers)).html);setMessage('Modelo de exemplo.');
          }catch(error){setMessage((error as Error).message);}}}>{label}</button>)}</div>
        {html?<iframe title="Prévia da via térmica" sandbox="" srcDoc={html} className="d26-thermal-frame"/>:<p>Escolha um modelo ou uma via da operação.</p>}
      </div>
    </section>
  </>;
}
