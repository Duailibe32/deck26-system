import React, { useEffect, useState } from 'react';
import type { CatalogProduct } from '@deck26/contracts';
export function ProductPicture({
  product,
  className,
  fallback
}: {
  product: Pick<CatalogProduct, 'imageUrl' | 'name'>;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product.imageUrl]);
  const safe = product.imageUrl?.startsWith('/api/public/product-photos/') && /^\/api\/public\/product-photos\/[a-f0-9]{64}\.jpg$/.test(product.imageUrl);
  return safe && !failed ? <img className={className} src={product.imageUrl!} alt={product.name} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <div className={className} aria-hidden="true">{fallback ?? '🍽️'}</div>;
}
async function compressPhoto(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw Error('Escolha uma foto JPG, PNG ou WebP de até 10 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40000000) throw Error('A foto é grande demais. Reduza a resolução antes de enviar.');
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('O navegador não conseguiu preparar a foto.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let quality = .84,
      value = canvas.toDataURL('image/jpeg', quality);
    while (value.length > 790000 && quality > .35) {
      quality -= .1;
      value = canvas.toDataURL('image/jpeg', quality);
    }
    if (value.length > 790000) throw Error('A foto ainda está grande demais. Escolha uma imagem menor.');
    return value;
  } finally {
    bitmap.close();
  }
}
export function ProductPhotoManager({
  api,
  headers,
  products,
  refresh
}: {
  api: string;
  headers: () => Record<string, string>;
  products: CatalogProduct[];
  refresh: () => Promise<void>;
}) {
  const [search, setSearch] = useState(''),
    [productId, setProductId] = useState(''),
    [preview, setPreview] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const selected = products.find(p => p.id === productId);
  const save = async (dataUrl: string | null) => {
    if (!selected || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch(api + '/api/ops/product-photo', {
        method: 'POST',
        headers: {
          ...headers(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          productId: selected.id,
          dataUrl
        })
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'Não foi possível salvar a foto.');
      setPreview(null);
      await refresh();
      setMessage(dataUrl ? 'Foto salva. O cardápio do cliente receberá a atualização.' : 'Foto removida do cardápio.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <section className="d26-product-photos"><h3>Seu cardápio com fotos de verdade</h3><p>Escolha o produto e envie uma foto do seu prato. A imagem fica no banco local e acompanha o backup do sistema. Sem foto, o cardápio continua usando seu ícone de categoria.</p><label>Buscar produto<input type="search" value={search} disabled={busy} onChange={e => {
        setSearch(e.target.value);
        setProductId('');
        setPreview(null);
      }} /></label><label>Produto da foto<select value={productId} disabled={busy} onChange={e => {
        setProductId(e.target.value);
        setPreview(null);
        setMessage('');
      }}><option value="">Selecione o produto</option>{products.filter(p => p.active && p.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).map(p => <option value={p.id} key={p.id}>{p.name}{p.imageUrl ? ' · com foto' : ''}</option>)}</select></label>{selected && <><div className="d26-photo-preview">{preview ? <img src={preview} alt={'Prévia de ' + selected.name} /> : <ProductPicture product={selected} />}</div><label>Selecionar foto (JPG, PNG ou WebP)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async e => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setMessage('');
          try {
            setPreview(await compressPhoto(file));
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
            e.target.value = '';
          }
        }} /></label><div className="d26-stock-actions"><button className="primary" disabled={busy || !preview} onClick={() => void save(preview)}>Salvar foto no cardápio</button>{selected.imageUrl && <button disabled={busy} onClick={() => {
          if (confirm('Remover a foto deste produto?')) void save(null);
        }}>Remover foto</button>}</div></>}{message && <p role="status" className="d26-stock-message">{message}</p>}</section>;
}
