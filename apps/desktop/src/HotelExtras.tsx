import React, { useEffect, useState } from 'react';
import './operations-hub.css';
const hotelCache = new Map<string, {
  until: number;
  request: Promise<any>;
}>();
const readHotel = (api: string, headers: Record<string, string>) => {
  const key = api + ':' + headers.Authorization + ':' + headers.authorization;
  const old = hotelCache.get(key);
  if (old && old.until > Date.now()) return old.request;
  if (hotelCache.size > 32) hotelCache.clear();
  const request = fetch(api + '/api/ops/hotel', {
    headers
  }).then(r => r.ok ? r.json() : null);
  hotelCache.set(key, {
    until: Date.now() + 5000,
    request
  });
  return request;
};
export const defaultStayOptions = {
  plan: 'DAILY',
  breakfastIncluded: false,
  breakfastGuests: 1,
  breakfastAllowanceCents: 0,
  vehiclePlate: '',
  vehicleModel: ''
};
export function StayOptionsFields({
  value,
  onChange,
  rate,
  onRate
}: {
  value: typeof defaultStayOptions;
  onChange: (value: typeof defaultStayOptions) => void;
  rate: string;
  onRate: (value: string) => void;
}) {
  return <fieldset className="d26-checkin-options"><legend>Pacote, café e estacionamento</legend><label>Modalidade<select value={value.plan} onChange={e => onChange({
        ...value,
        plan: e.target.value
      })}><option value="DAILY">Diária completa</option><option value="NIGHT">Pernoite · valor informado na entrada</option><option value="DAY_USE_4H">Day use / descanso · 4 horas</option><option value="DAY_USE_6H">Day use / descanso · 6 horas</option></select></label><label>{value.plan === 'DAILY' ? 'Tarifa por diária (R$) · vazio usa cadastro' : 'Valor do pacote (R$) · obrigatório'}<input inputMode="decimal" value={rate} onChange={e => onRate(e.target.value)} placeholder="Informe o valor acordado" /></label><label className="d26-ops-check"><input type="checkbox" checked={value.breakfastIncluded} onChange={e => onChange({
        ...value,
        breakfastIncluded: e.target.checked
      })} />☕ Café da manhã incluso</label>{value.breakfastIncluded && <><label>Hóspedes com café<input type="number" min={1} max={20} value={value.breakfastGuests} onChange={e => onChange({
          ...value,
          breakfastGuests: Number(e.target.value)
        })} /></label><label>Crédito por hóspede por dia (R$)<input inputMode="decimal" value={value.breakfastAllowanceCents / 100 || ''} onChange={e => onChange({
          ...value,
          breakfastAllowanceCents: Math.round(Number(e.target.value.replace(',', '.')) * 100)
        })} /></label></>}<label>Placa do veículo<input maxLength={15} value={value.vehiclePlate} onChange={e => onChange({
        ...value,
        vehiclePlate: e.target.value.toUpperCase()
      })} /></label><label>Modelo / descrição do veículo<input maxLength={80} value={value.vehicleModel} onChange={e => onChange({
        ...value,
        vehicleModel: e.target.value
      })} /></label><small>Day use calcula a saída a partir da entrada. O aviso aparece 30 minutos antes, sem multa automática. Pernoite usa o horário de saída informado.</small></fieldset>;
}
export function RoomExtras({
  api,
  headers,
  roomNumber
}: {
  api: string;
  headers: () => Record<string, string>;
  roomNumber?: string;
}) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => readHotel(api, headers()).then(d => {
      if (active) setData(d);
    }).catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, roomNumber]);
  if (!data) return null;
  if (roomNumber) {
    const stay = data.stays.find((s: any) => s.roomNumber === roomNumber);
    return stay ? <div className="d26-room-extra"><small>{stay.options.breakfastIncluded ? '☕ Café incluso · ' + stay.options.breakfastGuests + ' pessoa(s)' : ''}</small><small>{stay.options.vehiclePlate ? '🚗 ' + stay.options.vehiclePlate + ' · ' + stay.options.vehicleModel : ''}</small>{stay.options.plan !== 'DAILY' && <small>{stay.options.plan === 'NIGHT' ? 'Pernoite' : 'Descanso ' + (stay.options.plan === 'DAY_USE_4H' ? '4h' : '6h')} · até {new Date(stay.checkOutScheduledAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        })}</small>}</div> : null;
  }
  return <>{data.stays.filter((s: any) => s.dayUseAlert).map((s: any) => <div className="d26-dayuse-alert" key={s.id}>⏱ Apto {s.roomNumber}: {s.minutesRemaining < 0 ? 'pacote vencido há ' + Math.abs(s.minutesRemaining) : 'descanso vence em ' + s.minutesRemaining} min</div>)}{data.maintenance.filter((p: any) => p.due).map((p: any) => <div className="d26-dayuse-alert" key={p.id}>🔧 Apto {p.roomNumber}: {p.name} · manutenção prevista para {p.nextDue}</div>)}</>;
}
