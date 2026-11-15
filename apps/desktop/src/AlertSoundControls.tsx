import React from 'react';
import {MenuIcon} from './MenuIcon.js';
import type {useServiceSound} from './useServiceSound.js';
import {alertSoundLabels} from './useServiceSound.js';
import type {AlertKind} from './desktopAlerts.js';

export function AlertSoundControls({audio,kinds=['waiter','bill','order','delivery','print','stock']}:{audio:ReturnType<typeof useServiceSound>;kinds?:AlertKind[]}){
  return <div className="d26-alert-audio">
    <button type="button" className="d26-btn d26-btn-secondary" aria-pressed={audio.enabled}
      onClick={()=>void audio.toggle()}><MenuIcon name={audio.enabled?'volume':'mute'}/>
      {audio.enabled?'Silenciar alertas':'Ativar som dos alertas'}
    </button>
    {audio.enabled&&<details>
      <summary>Ajustar som</summary>
      <label>Volume <input type="range" min="0" max="100" value={audio.volume} onChange={event=>audio.setVolume(Number(event.target.value))}/></label>
      <button type="button" onClick={()=>audio.sound('bill',true)}>Testar toque</button>
      <fieldset><legend>Sons deste terminal</legend>{kinds.map(kind=><label key={kind}>
        <input type="checkbox" checked={audio.preferences[kind]!==false} onChange={event=>audio.setPreference(kind,event.target.checked)}/>
        {alertSoundLabels[kind]}
      </label>)}</fieldset>
    </details>}
    <small role="status">{audio.feedback}</small>
  </div>;
}
