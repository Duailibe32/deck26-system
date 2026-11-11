import React, { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import './table-qr.css';

export const privateIpv4 = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function tableMenuBase(api: string, origin: string, lanAddresses: string[]) {
  const browser = new URL(origin);
  const local = ['localhost', '127.0.0.1', 'tauri.localhost'].includes(browser.hostname);
  if (!local && /^https?:$/.test(browser.protocol)) return browser.origin;

  const base = new URL(api);
  if (local && ['localhost', '127.0.0.1', 'tauri.localhost'].includes(base.hostname)) {
    const lan = lanAddresses.find(ip => privateIpv4.test(ip));
    if (lan) base.hostname = lan;
  }
  return base.origin;
}

export function TableQrCode({ number, url }: { number: number; url: string }) {
  const qr = useRef<SVGSVGElement>(null);
  const table = String(number).padStart(2, '0');
  const download = () => {
    if (!qr.current) return;
    const file = new Blob([new XMLSerializer().serializeToString(qr.current)], { type: 'image/svg+xml' });
    const href = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'deck26-mesa-' + table + '.svg';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  return <div className="d26-table-qr">
    <QRCodeSVG id={'d26-qr-table-' + number} ref={qr} value={url} title={'QR Code do cardápio da Mesa ' + table} size={160} marginSize={4} level="M" />
    <div>
      <a href={url} target="_blank" rel="noreferrer">Abrir cardápio da Mesa {table} ↗</a>
      <button type="button" className="d26-btn d26-btn-secondary" aria-label={'Baixar QR da Mesa ' + table} onClick={download}>Baixar QR</button>
    </div>
  </div>;
}

async function imageAsPng(src: string, width: number, height: number, logo = false) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Não foi possível preparar a imagem.');
  if (logo) {
    const side = img.naturalWidth / 1.52;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, side * .26, side * .96, side, side, 0, 0, width, height);
  } else {
    ctx.drawImage(img, 0, 0, width, height);
  }
  return canvas.toDataURL('image/png');
}

export function TableQrKit({ tables }: { tables: { number: number; url: string }[] }) {
  const [selection, setSelection] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = selection ?? tables.map(table => table.number);
  const selected = tables.filter(table => active.includes(table.number));
  const exportPdf = async () => {
    setBusy(true);
    setMessage('');
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ format: 'a4', unit: 'mm' });
      const logo = await imageAsPng('/brand/deck26-original.jpg', 120, 120, true);
      for (const [index, table] of selected.entries()) {
        const slot = index % 6;
        if (index && !slot) pdf.addPage();
        const x = 10 + (slot % 2) * 96;
        const y = 12 + Math.floor(slot / 2) * 91;
        const middle = x + 47;
        pdf.setDrawColor(180);
        pdf.roundedRect(x, y, 94, 87, 2, 2);
        pdf.addImage(logo, 'PNG', middle - 6, y + 3, 12, 12);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(20);
        pdf.text('MESA ' + String(table.number).padStart(2, '0'), middle, y + 23, { align: 'center' });
        const code = document.getElementById('d26-qr-table-' + table.number);
        if (!code) throw Error('QR da mesa indisponível. Atualize a lista e tente novamente.');
        const svg = new XMLSerializer().serializeToString(code);
        const qr = await imageAsPng('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), 360, 360);
        pdf.addImage(qr, 'PNG', middle - 23, y + 25, 46, 46);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.text(['Aponte a câmera para o QR Code', 'Abra o cardápio na rede do estabelecimento'], middle, y + 76, { align: 'center' });
      }
      pdf.save('deck26-placas-de-mesas.pdf');
      setMessage('PDF com ' + selected.length + ' mesa(s) preparado.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="d26-qr-kit" aria-label="Plaquinhas de mesa">
    <h3>Plaquinhas para imprimir</h3>
    <p>Selecione as mesas. O PDF A4 traz até seis plaquinhas por página.</p>
    <div>
      <button className="d26-btn d26-btn-secondary" disabled={busy} onClick={() => setSelection(null)}>Selecionar todas</button>
      <button className="d26-btn d26-btn-secondary" disabled={busy} onClick={() => setSelection([])}>Limpar seleção</button>
      <button className="d26-btn d26-btn-primary" disabled={busy || !selected.length} onClick={() => void exportPdf()}>
        {busy ? 'Preparando PDF…' : 'Baixar PDF · ' + selected.length + ' mesas'}
      </button>
    </div>
    <div className="d26-qr-kit-options">{tables.map(table => <label key={table.number}>
      <input type="checkbox" checked={active.includes(table.number)} disabled={busy} onChange={event => setSelection(event.target.checked ? [...active, table.number] : active.filter(number => number !== table.number))}/>
      Mesa {String(table.number).padStart(2, '0')}
    </label>)}</div>
    {message && <p role="status">{message}</p>}
  </section>;
}
