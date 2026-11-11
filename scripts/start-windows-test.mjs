// Explicitly isolated test environment. Never loads the operational .env.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { buildLocalServer, getLanIpv4Addresses } from '../apps/local-server/src/server.ts';

const shareMenu=process.env.DECK26_TEST_LAN==='true';
const ui=fileURLToPath(new URL('../apps/desktop/dist/',import.meta.url));
const lan=shareMenu?getLanIpv4Addresses().filter(ip=>/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)):[];
if(shareMenu&&!fs.existsSync(path.join(ui,'index.html')))throw Error('Compile a interface antes de compartilhar o cardápio de teste.');
if(shareMenu&&!lan.length)throw Error('Conecte o computador à rede local antes de compartilhar o cardápio.');
const directory=path.resolve(process.env.DECK26_TEST_DATA_DIR ?? path.join(os.homedir(),'AppData','Local','Deck26','Teste'));
fs.mkdirSync(directory,{recursive:true});
const settingsPath=path.join(directory,'test-secrets.json');
let secrets;
if(fs.existsSync(settingsPath))secrets=JSON.parse(fs.readFileSync(settingsPath,'utf8'));
else {secrets={auth:crypto.randomBytes(32).toString('hex'),qr:crypto.randomBytes(32).toString('hex')};fs.writeFileSync(settingsPath,JSON.stringify(secrets),{mode:0o600});}
process.env.NODE_ENV='development';
process.env.DECK26_AUTH_SECRET=secrets.auth;
process.env.DECK26_QR_SEED_SECRET=secrets.qr;
delete process.env.DECK26_BOOTSTRAP_PIN;
process.env.DECK26_CLOUD_API_URL='http://127.0.0.1:4799';
delete process.env.DECK26_SYNC_SECRET;
process.env.DECK26_ALLOWED_ORIGINS=['http://tauri.localhost','tauri://localhost','https://tauri.localhost','http://localhost:5276','http://127.0.0.1:5276','http://127.0.0.1:4700','http://localhost:4700',...lan.map(ip=>'http://'+ip+':4700')].join(',');
const {app,store}=await buildLocalServer({dbPath:path.join(directory,'deck26-test.sqlite'),demoMode:true,requireStrictAuth:true});
if(shareMenu){
  app.addHook('onRequest',async(request,reply)=>{
    if(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip))return;
    const url=new URL(request.url,'http://localhost');
    const publicApi=url.pathname.startsWith('/api/public/');
    const asset=url.pathname.startsWith('/assets/')||url.pathname.startsWith('/brand/');
    const menu=(url.pathname==='/'||url.pathname==='/index.html')&&(url.searchParams.has('qr')||url.searchParams.has('delivery'));
    if(!publicApi&&!asset&&!menu)return reply.code(403).send({error:'Somente o cardápio de teste está disponível na rede.'});
  });
  await app.register(fastifyStatic,{root:ui,index:'index.html',dotfiles:'deny'});
}
app.addHook('onSend',async(req,_reply,payload)=>{
  if(req.url==='/api/health'&&typeof payload==='string')return JSON.stringify({...JSON.parse(payload),testEnvironment:true});
  return payload;
});
const stop=async()=>{await app.close();store.close();process.exit(0);};
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
try {
  await app.listen({port:4700,host:shareMenu?'0.0.0.0':'127.0.0.1'});
  console.log('DECK 26 TESTE: API local na porta 4700. Dados fictícios persistentes em '+directory);
  for(const ip of lan)console.log('Cardápio de teste na rede: http://'+ip+':4700/?delivery');
}
catch(error){store.close();throw error;}
