import React from 'react';
import {MenuIcon} from './MenuIcon.js';
import type {useServiceSound} from './useServiceSound.js';

export function AlertSoundControls({audio}:{audio:ReturnType<typeof useServiceSound>}){
  return <div className="d26-alert-audio">
    <button type="button" className="d26-btn d26-btn-secondary" aria-pressed={audio.enabled}
      onClick={()=>void audio.toggle()}><MenuIcon name={audio.enabled?'volume':'mute'}/>
      {audio.enabled?'Silenciar alertas':'Ativar som dos alertas'}
    </button>
    {audio.enabled&&<details>
      <summary>Ajustar som</summary>
      <label>Volume <input type="range" min="0" max="100" value={audio.volume} onChange={event=>audio.setVolume(Number(event.target.value))}/></label>
      <button type="button" onClick={()=>audio.sound('bill')}>Testar toque</button>
    </details>}
    <small role="status">{audio.feedback}</small>
  </div>;
}
