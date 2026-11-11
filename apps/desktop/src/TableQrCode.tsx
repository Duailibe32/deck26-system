import React, { useRef } from 'react';
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
    <QRCodeSVG ref={qr} value={url} title={'QR Code do cardápio da Mesa ' + table} size={160} marginSize={4} level="M" />
    <div>
      <a href={url} target="_blank" rel="noreferrer">Abrir cardápio da Mesa {table} ↗</a>
      <button type="button" className="d26-btn d26-btn-secondary" aria-label={'Baixar QR da Mesa ' + table} onClick={download}>Baixar QR</button>
    </div>
  </div>;
}
