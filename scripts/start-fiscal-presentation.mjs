// Presentation-only process. Binds loopback; never opens the operational database.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import fastifyStatic from '@fastify/static';import {buildLocalServer} from '../apps/local-server/src/server.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(os.homedir(),'Deck26','EnsaioFiscal');fs.mkdirSync(directory,{recursive:true});
const ui=path.join(root,'apps','desktop','dist');if(!fs.existsSync(path.join(ui,'deck26-operation.json')))throw Error('Compile a interface operacional antes de abrir o ensaio.');
process.env.NODE_ENV='production';process.env.DECK26_AUTH_SECRET=crypto.randomBytes(32).toString('hex');process.env.DECK26_QR_SEED_SECRET=crypto.randomBytes(32).toString('hex');process.env.DECK26_DEMO_MODE='false';process.env.DECK26_OPERATIONAL='false';process.env.DECK26_OPERATION_DATA_DIR=directory;process.env.DECK26_ALLOWED_ORIGINS='http://127.0.0.1:4802,http://localhost:4802';process.env.PORT='4802';delete process.env.DECK26_BOOTSTRAP_PIN;delete process.env.DECK26_SYNC_SECRET;
const {app,store}=await buildLocalServer({dbPath:path.join(directory,'ensaio-fiscal.sqlite'),demoMode:false,requireStrictAuth:true});
if(!(store.db.prepare('SELECT COUNT(*) AS count FROM users').get()).count){store.initializeLocalOperation({name:'Apresentação fiscal · exemplo',pin:'536821',importCatalog:true,actorIp:'127.0.0.1'});const product=store.getCatalog().products.find(item=>!item.modifierGroups.length);if(product){store.db.prepare('UPDATE catalog_products SET track_stock=0 WHERE id=?').run(product.id);const table=store.openTable({tableNumber:20});store.createOrder({tabId:table.tab.id,tableNumber:20,originNode:'WINDOWS_PDV',channel:'DINE_IN',idempotencyKey:'fiscal-presentation-initial',items:[{productId:product.id,quantity:1}]});}}
app.addHook('onSend',async(req,_reply,payload)=>req.url==='/api/health'&&typeof payload==='string'?JSON.stringify({...JSON.parse(payload),status:'FISCAL_REHEARSAL_ONLY',fiscalPresentation:true,operationalEnvironment:false}):payload);
await app.register(fastifyStatic,{root:ui,index:'index.html',dotfiles:'deny'});app.addHook('onClose',async()=>{store.close();});
const stop=async()=>{await app.close();process.exit(0);};process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
await app.listen({port:4802,host:'127.0.0.1'});
console.log('ENSAIO FISCAL LOCAL — SEM VALIDADE FISCAL — http://127.0.0.1:4802');console.log('PIN exclusivamente de apresentação: 536821');console.log('Dados isolados: '+directory);
