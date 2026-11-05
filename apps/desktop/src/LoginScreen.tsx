import React, { useEffect, useState } from 'react';
import { Deck26Logo } from '@deck26/ui';
import './login.css';

export function LoginScreen({pin,onChange,onSubmit,busy,error,testMode}:{
  pin:string;onChange:(pin:string)=>void;onSubmit:()=>void;busy:boolean;error:string;testMode:boolean;
}){
  const [clock,setClock]=useState(()=>new Date());
  useEffect(()=>{const timer=setInterval(()=>setClock(new Date()),1000);return()=>clearInterval(timer);},[]);
  return <main className="d26-login">
    <header className="d26-login-top"><Deck26Logo size={48} showHotelSubtitle/><span>{testMode?'AMBIENTE DE TESTES':'ESTAÇÃO DE TRABALHO'}</span></header>
    <div className="d26-login-layout">
      <section className="d26-login-welcome"><span className="d26-login-eyebrow">RESTAURANTE · BAR · HOTEL</span><h1>O cuidado começa<br/>em cada detalhe.</h1><p>Sua operação conectada, do primeiro pedido à última hospedagem.</p><div className="d26-login-clock"><strong>{clock.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</strong><span>{clock.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})}</span></div><small>{testMode?'Use somente dados fictícios. Os lançamentos ficam na base de testes e não têm validade fiscal.':'Acesso pessoal. Cada operador utiliza seu próprio PIN e suas permissões.'}</small></section>
      <section className="d26-login-card" aria-labelledby="login-title"><span className="d26-login-lock" aria-hidden="true">⌑</span><span className="d26-login-eyebrow">BEM-VINDO AO DECK 26</span><h2 id="login-title">Acesse sua estação.</h2><p>Entre com seu PIN para iniciar o atendimento.</p>
        <form onSubmit={event=>{event.preventDefault();onSubmit();}}>
          <label htmlFor="operator-pin">PIN do operador</label><input id="operator-pin" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={12} value={pin} onChange={event=>onChange(event.target.value.replace(/\D/g,''))} disabled={busy} aria-describedby="login-feedback" placeholder="Digite seu PIN"/>
          <div id="login-feedback" className="d26-login-feedback" aria-live="polite">{error?<span role="alert">{error}</span>:<span>Seu perfil será identificado após a autenticação.</span>}</div>
          <div className="d26-login-keypad" aria-label="Teclado numérico">{['1','2','3','4','5','6','7','8','9','Limpar','0','⌫'].map(key=><button key={key} type="button" disabled={busy} aria-label={key==='⌫'?'Apagar último dígito':key} onClick={()=>onChange(key==='Limpar'?'':key==='⌫'?pin.slice(0,-1):(pin+key).slice(0,12))}>{key}</button>)}</div>
          <button type="submit" className="d26-btn d26-btn-primary d26-login-submit" disabled={busy||pin.length<4}>{busy?'Verificando acesso…':'Entrar no sistema'}<span aria-hidden="true">→</span></button>
        </form><small>Precisa de acesso? Procure o responsável pelo estabelecimento.</small>
      </section>
    </div><footer>DECK 26 & Hotel Auto Posto Milla<span>{testMode?'TESTE LOCAL · SEM EMISSÃO FISCAL':'Gestão & Hospitalidade'}</span></footer>
  </main>;
}
