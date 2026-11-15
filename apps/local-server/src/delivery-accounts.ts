import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {LocalOperationalStore} from './store.js';

const derive=promisify(scrypt);
const credentials=z.object({
  phone:z.string().max(24).transform(value=>value.replace(/\D/g,'')).pipe(z.string().regex(/^\d{10,11}$/)),
  password:z.string().min(8).max(128)
});
const registration=credentials.extend({name:z.string().trim().min(2).max(80)});
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const tokenOf=(req:FastifyRequest)=>/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization??'')?.[1];
const secureRequest=(req:FastifyRequest)=>{
  if(req.protocol==='https')return true;
  const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.ip);
  return local&&(/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host??'')||
    req.headers['x-forwarded-proto']==='https');
};

export function registerDeliveryAccounts(app:FastifyInstance,store:LocalOperationalStore){
  const db=store.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_accounts (
      phone TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS delivery_account_sessions (
      token_hash TEXT PRIMARY KEY, phone TEXT NOT NULL REFERENCES delivery_accounts(phone), expires INTEGER NOT NULL
    );
  `);
  const attempts=new Map<string,{count:number;until:number}>();
  const dummySalt=randomBytes(16).toString('hex');
  let inFlight=0;
  const allowed=(key:string,limit:number)=>{
    const now=Date.now(),entry=attempts.get(key);
    if(attempts.size>=2000)for(const [id,item] of attempts)if(item.until<=now)attempts.delete(id);
    if(!entry&&attempts.size>=2000)return false;
    if(entry&&entry.until>now){if(entry.count>=limit)return false;entry.count++;return true;}
    attempts.set(key,{count:1,until:now+600000});return true;
  };
  const session=(phone:string,name:string)=>{
    const token=randomBytes(32).toString('hex');
    const now=Date.now();
    db.prepare('DELETE FROM delivery_account_sessions WHERE expires<=?').run(now);
    db.prepare('INSERT INTO delivery_account_sessions VALUES(?,?,?)').run(digest(token),phone,now+8*60*60*1000);
    return {token,customer:{name,phone}};
  };
  app.post<{Params:{action:string}}>('/api/public/delivery/account/:action',async(req,reply)=>{
    reply.header('Cache-Control','no-store');
    if(!secureRequest(req))return reply.code(403).send({error:'A conta do delivery requer uma conexão HTTPS.'});
    const action=req.params.action;
    if(action==='logout'){
      const token=tokenOf(req);
      if(token)db.prepare('DELETE FROM delivery_account_sessions WHERE token_hash=?').run(digest(token));
      return {ok:true};
    }
    if(action!=='register'&&action!=='login')return reply.code(404).send({error:'Operação indisponível.'});
    const parsed=(action==='register'?registration:credentials).safeParse(req.body);
    if(!parsed.success)return reply.code(400).send({error:'Informe o telefone com DDD e uma senha de pelo menos 8 caracteres.'});
    const {phone,password}=parsed.data;
    if(inFlight>=4||!allowed('ip:'+req.ip,30)||!allowed(action+':'+req.ip+':'+phone,8))
      return reply.code(429).send({error:'Muitas tentativas. Aguarde alguns minutos.'});
    inFlight++;
    try{
      if(action==='register'){
        const {name}=registration.parse(req.body);
        const salt=randomBytes(16).toString('hex');
        const key=await derive(password,salt,64) as Buffer;
        const result=db.prepare('INSERT OR IGNORE INTO delivery_accounts VALUES(?,?,?,?)').run(phone,name,salt,key.toString('hex'));
        if(!result.changes)return reply.code(409).send({error:'Não foi possível criar a conta. Se já possui cadastro, entre com sua senha.'});
        return session(phone,name);
      }
      const account=db.prepare('SELECT name,salt,password_hash FROM delivery_accounts WHERE phone=?').get(phone);
      const key=await derive(password,String(account?.salt??dummySalt),64) as Buffer;
      if(!account||!timingSafeEqual(key,Buffer.from(String(account.password_hash),'hex')))
        return reply.code(401).send({error:'Telefone ou senha inválidos.'});
      return session(phone,String(account.name));
    }finally{inFlight--;}
  });
  app.get('/api/public/delivery/account', (req,reply)=>{
    reply.header('Cache-Control','no-store');
    if(!secureRequest(req))return reply.code(403).send({error:'A conta do delivery requer uma conexão HTTPS.'});
    const token=tokenOf(req);
    const customer=token&&db.prepare(`SELECT a.name,a.phone FROM delivery_account_sessions s
      JOIN delivery_accounts a ON a.phone=s.phone WHERE s.token_hash=? AND s.expires>?`).get(digest(token),Date.now());
    if(!customer)return reply.code(401).send({error:'Entre na sua conta para continuar.'});
    return {customer};
  });
}
