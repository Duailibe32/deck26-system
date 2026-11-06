import React from 'react';
const iso = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Fortaleza',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(date);
export function HotelCalendar({
  data,
  start
}: {
  data: any;
  start: string;
}) {
  const first = Date.parse(start + 'T12:00:00-03:00');
  if (!Number.isFinite(first)) return <p>Selecione a data inicial.</p>;
  const days = Array.from({
      length: 7
    }, (_, i) => iso(new Date(first + i * 86400000))),
    last = days[6]!;
  return <div className="d26-hotel-calendar"><div className="d26-calendar-head"><strong>Apartamento</strong>{days.map(day => <strong key={day}>{new Date(day + 'T12:00:00-03:00').toLocaleDateString('pt-BR', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit'
        })}</strong>)}</div>{data.rooms.map((room: any) => {
      const events = [...data.stays.filter((s: any) => s.roomNumber === room.number).map((s: any) => ({
        id: s.id,
        name: s.guestName,
        start: iso(new Date(s.checkInAt)),
        end: iso(new Date(s.checkOutScheduledAt)),
        kind: 'stay'
      })), ...data.reservations.filter((r: any) => r.roomNumber === room.number && ['CONFIRMADA', 'PENDENTE'].includes(r.status)).map((r: any) => ({
        id: r.id,
        name: r.guestName,
        start: r.checkInDate,
        end: r.checkOutDate,
        kind: 'reservation'
      })), ...data.maintenance.filter((p: any) => p.active && p.roomNumber === room.number && p.blockStart && p.blockEnd).map((p: any) => ({
        id: p.id,
        name: p.name,
        start: p.blockStart,
        end: p.blockEnd,
        kind: 'maintenance'
      }))].filter((e: any) => e.start <= last && e.end >= start).sort((a: any, b: any) => a.start.localeCompare(b.start));
      return <div className="d26-calendar-room" key={room.id} style={{
        minHeight: Math.max(85, events.length * 45 + 35)
      }}><strong>Apto {room.number}</strong><div className="d26-calendar-track">{days.map(day => {
            const busy = events.some((e: any) => e.start <= day && (e.end > day || e.start === e.end));
            return <button type="button" className="d26-calendar-day" aria-label={'Apto ' + room.number + ' · ' + day + ' · ' + (busy ? 'ocupado' : 'abrir reserva')} key={day} disabled={busy} onClick={() => window.dispatchEvent(new CustomEvent('deck26:reserve-slot', {
              detail: {
                roomNumber: room.number,
                day
              }
            }))}>{busy ? '' : 'Livre'}</button>;
          })}{events.map((e: any, index: number) => {
            const from = Math.max(0, Math.floor((Date.parse(e.start + 'T12:00:00-03:00') - first) / 86400000)),
              until = Math.min(7, Math.max(from + 1, Math.ceil((Date.parse(e.end + 'T12:00:00-03:00') - first) / 86400000))),
              columnStart = from + 1,
              columnEnd = until + 1;
            return <div key={e.id} title={e.name + ' · ' + e.start + ' a ' + e.end} className={'d26-calendar-bar ' + e.kind + (e.start === iso(new Date()) ? ' arrival' : e.end === iso(new Date()) ? ' departure' : '')} style={{
              gridColumn: columnStart + '/' + columnEnd,
              top: 9 + index * 44
            }}><b>{e.kind === 'maintenance' ? '🔧 ' : e.kind === 'reservation' ? 'Reserva · ' : ''}{e.name}</b><small>{e.start === iso(new Date()) ? 'Entrada hoje · ' : e.end === iso(new Date()) ? 'Saída hoje · ' : ''}{e.end === iso(new Date(Date.now() + 86400000)) ? 'Saída amanhã · ' : ''}{e.start.slice(8)}/{e.start.slice(5, 7)} → {e.end.slice(8)}/{e.end.slice(5, 7)}</small></div>;
          })}</div></div>;
    })}</div>;
}
