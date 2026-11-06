// Operational database: never uses the demonstration/test database or .env.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import fastifyStatic from '@fastify/static';
import {buildLocalServer} from '../apps/local-server/src/server.ts';
import {renderThermalPreview,thermalModels} from '../apps/local-server/src/thermal-preview.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.resolve(process.env.DECK26_OPERATION_DATA_DIR??path.join(os.homedir(),'Deck26','DadosOperacionais'));
const ui=path.resolve(process.env.DECK26_OPERATION_UI_DIR??path.join(root,'apps','desktop','dist'));
if(!fs.existsSync(path.join(ui,'deck26-operation.json')))throw Error('A interface operacional não foi instalada. Execute a compilação e o instalador local.');
fs.mkdirSync(directory,{recursive:true});
const secretFile=path.join(directory,'segredos-locais.json');
let secrets;
if(fs.existsSync(secretFile))secrets=JSON.parse(fs.readFileSync(secretFile,'utf8'));
else {secrets={auth:crypto.randomBytes(32).toString('hex'),qr:crypto.randomBytes(32).toString('hex'),control:crypto.randomBytes(32).toString('hex')};fs.writeFileSync(secretFile,JSON.stringify(secrets),{mode:0o600});}
if(!secrets.control){secrets.control=crypto.randomBytes(32).toString('hex');fs.writeFileSync(secretFile,JSON.stringify(secrets),{mode:0o600});}
const networks=Object.values(os.networkInterfaces()).flat().filter(item=>item?.family==='IPv4'&&!item.internal&&/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address));
const numeric=ip=>ip.split('.').reduce((sum,part)=>(sum*256+Number(part))>>>0,0);
process.env.NODE_ENV='production';process.env.DECK26_DEMO_MODE='false';process.env.DECK26_OPERATIONAL='true';
process.env.DECK26_OPERATION_DATA_DIR=directory;process.env.DECK26_AUTH_SECRET=secrets.auth;process.env.DECK26_QR_SEED_SECRET=secrets.qr;
process.env.PORT='4800';process.env.DECK26_CLOUD_API_URL='http://127.0.0.1:4799';
delete process.env.DECK26_BOOTSTRAP_PIN;delete process.env.DECK26_SYNC_SECRET;
process.env.DECK26_ALLOWED_ORIGINS=['http://tauri.localhost','tauri://localhost','http://localhost:4800','http://127.0.0.1:4800',...networks.map(item=>'http://'+item.address+':4800')].join(',');
const {app,store}=await buildLocalServer({dbPath:path.join(directory,'deck26-operacao.sqlite'),demoMode:false,requireStrictAuth:true});
app.addHook('onRequest',async(req,reply)=>{
  const ip=req.ip.replace(/^::ffff:/,'');if(['127.0.0.1','::1'].includes(ip))return;
  if(!networks.some(item=>(numeric(ip)&numeric(item.netmask))===(numeric(item.address)&numeric(item.netmask))))return reply.code(403).send({error:'Acesso disponível somente na rede local do estabelecimento.'});
});
app.addHook('onSend',async(req,_reply,payload)=>req.url==='/api/health'&&typeof payload==='string'?JSON.stringify({...JSON.parse(payload),operationalEnvironment:true,testEnvironment:false}):payload);
app.post('/api/_local/stop',async(req,reply)=>{
  const remote=req.ip.replace(/^::ffff:/,'');if(!['127.0.0.1','::1'].includes(remote))return reply.code(403).send({error:'Controle disponível somente no PC.'});
  const actual=Buffer.from(String(req.headers['x-deck26-control']||'')),expected=Buffer.from(secrets.control);
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return reply.code(401).send({error:'Controle local não autorizado.'});
  reply.send({stopping:true});setTimeout(()=>{void app.close();},100);
});
await app.register(fastifyStatic,{root:ui,index:'index.html',dotfiles:'deny'});
const models=path.join(directory,'modelos-de-impressao');fs.mkdirSync(models,{recursive:true});
for(const [key,text] of Object.entries(thermalModels))for(const width of [58,80])fs.writeFileSync(path.join(models,key+'-'+width+'mm.html'),renderThermalPreview(text,width,key==='kitchen'?'Cozinha':'Caixa'),'utf8');
const backups=path.join(directory,'backups');fs.mkdirSync(backups,{recursive:true});
const automaticBackup=(closing=false)=>{if(!(store.db.prepare('SELECT COUNT(*) AS count FROM users').get()).count)return;const label=closing?'encerramento-'+new Date().toISOString().replace(/[:.]/g,'-'):'diario-'+new Date().toISOString().slice(0,10);const target=path.join(backups,label+'.sqlite');if(!fs.existsSync(target))store.db.prepare('VACUUM INTO ?').run(target);};
try{automaticBackup();}catch(error){console.error('Não foi possível criar o backup automático:',error.message);}
const backupTimer=setInterval(()=>{try{automaticBackup();}catch(error){console.error('Backup automático:',error.message);}},3600000);backupTimer.unref();
app.addHook('onClose',async()=>{clearInterval(backupTimer);try{automaticBackup(true);}catch(error){console.error('Backup no encerramento:',error.message);}finally{try{store.close();}catch{}}});
const stop=async()=>{await app.close();process.exit(0);};process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
await app.listen({port:4800,host:'0.0.0.0'});
console.log('DECK 26 · OPERAÇÃO LOCAL · http://127.0.0.1:4800');
for(const item of networks)console.log('Garçom: http://'+item.address+':4800/?terminal=garcom');
for(const item of networks)console.log('Delivery cliente: http://'+item.address+':4800/?delivery=1');
console.log('Dados operacionais: '+directory);
