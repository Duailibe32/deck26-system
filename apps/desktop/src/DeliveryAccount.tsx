import React,{useEffect,useState} from 'react';

type Customer={name:string;phone:string};
const storageKey='deck26:delivery-account';
const endpoint='/api/public/delivery/account';
export function DeliveryAccount({onCustomer}:{onCustomer:(customer:Customer|null)=>void}){
  const [customer,setCustomer]=useState<Customer|null>(null);
  const [register,setRegister]=useState(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [token,setToken]=useState(()=>sessionStorage.getItem(storageKey)??'');
  const secure=window.isSecureContext;
  useEffect(()=>{
    if(!token||!secure)return;
    let active=true;
    void fetch(endpoint,{headers:{Authorization:'Bearer '+token}}).then(async response=>{
      if(!active)return;
      if(response.status===401){sessionStorage.removeItem(storageKey);setToken('');return;}
      if(!response.ok)throw Error();
      const data=await response.json();
      if(active){setCustomer(data.customer);onCustomer(data.customer);}
    }).catch(()=>{if(active)setMessage('Não foi possível consultar sua conta.');});
    return()=>{active=false;};
  },[token,secure,onCustomer]);
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const fields=new FormData(event.currentTarget);
    setBusy(true);setMessage('');
    try{
      const response=await fetch(endpoint+(register?'/register':'/login'),{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.fromEntries(fields))});
      const data=await response.json();
      if(!response.ok)throw Error(data.error);
      sessionStorage.setItem(storageKey,data.token);
      setToken(data.token);setCustomer(data.customer);onCustomer(data.customer);
    }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
  };
  return <section className="d26-customer-checkout d26-account">
    <h2>{customer?'Minha conta':register?'Criar conta':'Entrar no delivery'}</h2>
    {message&&<p role="status">{message}</p>}
    {!secure?<p>Abra o delivery por HTTPS para entrar com sua senha. Você pode fazer o pedido como visitante nesta rede.</p>:customer?
      <><p><strong>{customer.name}</strong></p><p>{customer.phone}</p><button className="d26-customer-primary" disabled={busy} onClick={async()=>{
        setBusy(true);setMessage('');
        try {
          const response=await fetch(endpoint+'/logout',{method:'POST',headers:{Authorization:'Bearer '+token}});
          if(!response.ok)throw Error();
        }catch{setMessage('A revogação no servidor não foi confirmada. A sessão foi apagada desta aba.');}
        finally{
          sessionStorage.removeItem(storageKey);setToken('');setCustomer(null);onCustomer(null);setBusy(false);
        }
      }}>Sair da conta</button></>:
      <><form onSubmit={submit}>
        {register&&<label>Nome<input name="name" autoComplete="name" required minLength={2} maxLength={80}/></label>}
        <label>Telefone com DDD<input name="phone" autoComplete="tel-national" type="tel" required maxLength={24}/></label>
        <label>Senha<input name="password" type="password" autoComplete={register?'new-password':'current-password'} required minLength={8} maxLength={128}/></label>
        <button className="d26-customer-primary" disabled={busy}>{register?'Criar minha conta':'Entrar'}</button>
      </form><button className="d26-customer-quiet" disabled={busy} onClick={()=>{setRegister(!register);setMessage('');}}>{register?'Já tenho uma conta':'Criar uma conta'}</button></>}
  </section>;
}
