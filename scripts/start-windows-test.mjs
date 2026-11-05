// Explicitly isolated test environment. Never loads the operational .env.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { buildLocalServer } from '../apps/local-server/src/server.ts';

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
process.env.DECK26_ALLOWED_ORIGINS='http://tauri.localhost,tauri://localhost,http://localhost:5276,http://127.0.0.1:5276';
const {app,store}=await buildLocalServer({dbPath:path.join(directory,'deck26-test.sqlite'),demoMode:true,requireStrictAuth:true});
app.addHook('onSend',async(req,_reply,payload)=>{
  if(req.url==='/api/health'&&typeof payload==='string')return JSON.stringify({...JSON.parse(payload),testEnvironment:true});
  return payload;
});
const stop=async()=>{await app.close();store.close();process.exit(0);};
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
try {await app.listen({port:4700,host:'127.0.0.1'});console.log('DECK 26 TESTE: API local na porta 4700. Dados fictícios persistentes em '+directory);}
catch(error){store.close();throw error;}
