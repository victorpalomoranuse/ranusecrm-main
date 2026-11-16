import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

// Generador de imágenes de producto (mockups): se sube el producto y el logo, se elige cómo se coloca y en qué escena, y salen varias propuestas.
// Usa el mismo motor que el Estudio de ideas (/estudio-ideas/chat): el producto va como imagen base y el logo se pide «exactamente así».
const COLOCACIONES = [
  { id: 'grabado', n: 'Grabado láser', t: 'grabado láser sobre el material, con un relieve muy sutil y sin añadir color' },
  { id: 'serigrafia', n: 'Serigrafía', t: 'impreso en serigrafía, plano y nítido, con los colores exactos del logo' },
  { id: 'relieve', n: 'Relieve', t: 'en relieve moldeado en el propio material, con sombras reales' },
  { id: 'placa', n: 'Placa o etiqueta', t: 'sobre una pequeña placa o etiqueta fijada al producto' },
  { id: 'grande', n: 'Grande, al frente', t: 'grande, centrado y bien visible en el frente del producto' },
];
const ESCENAS = [
  { id: 'catalogo', n: 'Catálogo', d: 'Fondo blanco', t: 'fondo blanco puro de catálogo con una sombra suave bajo el producto' },
  { id: 'estudio', n: 'Estudio oscuro', d: 'Luz de contorno', t: 'estudio fotográfico con fondo gris oscuro degradado y luz de contorno' },
  { id: 'gimnasio', n: 'En un gimnasio', d: 'Suelo de caucho', t: 'dentro de un gimnasio moderno, suelo de caucho, luz cálida y el fondo desenfocado' },
  { id: 'madera', n: 'Sobre madera', d: 'Luz natural', t: 'sobre una superficie de madera clara con luz natural lateral' },
  { id: 'lifestyle', n: 'Lifestyle', d: 'Ambiente real', t: 'escena de estilo de vida deportiva, realista, con profundidad de campo' },
];
const ANGULOS = ['Ángulo frontal.', 'Ángulo de tres cuartos.', 'Vista cenital, plano cenital.', 'Primer plano cercano de la zona del logo.'];

const comprimir = (file, maxLado = 1600) => new Promise((ok, ko) => {
  const fr = new FileReader();
  fr.onerror = () => ko(new Error('No se pudo leer la imagen'));
  fr.onload = () => {
    const img = new Image();
    img.onerror = () => ko(new Error('Imagen no válida'));
    img.onload = () => { const k = Math.min(1, maxLado / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL('image/png')); };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
});

const CSS = `
.gi{display:grid;grid-template-columns:390px minmax(0,1fr);gap:22px;padding:22px 28px 40px;height:100%;box-sizing:border-box;color:#fff;font-family:inherit}
.gi *{box-sizing:border-box}
.gi-panel{overflow:auto;display:flex;flex-direction:column;gap:14px;padding-right:8px;min-height:0}
.gi-h{margin:0;font-size:1.5rem;font-weight:700;letter-spacing:-.02em}
.gi-sub{margin:4px 0 4px;color:rgba(255,255,255,.55);font-size:.86rem;line-height:1.45}
.gi-card{background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.025));border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:16px}
.gi-t{display:flex;align-items:center;gap:8px;font-size:.74rem;letter-spacing:.09em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:10px;font-weight:600}
.gi-n{width:20px;height:20px;border-radius:50%;background:#c9a46c;color:#1e1b18;font-size:.7rem;display:inline-flex;align-items:center;justify-content:center;font-weight:800}
.gi-drop{position:relative;aspect-ratio:16/10;border:1.5px dashed rgba(255,255,255,.22);border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;overflow:hidden;background:rgba(0,0,0,.18);color:rgba(255,255,255,.55);font-size:.82rem;text-align:center;padding:10px;transition:border-color .15s,background .15s}
.gi-drop:hover,.gi-drop.on{border-color:#c9a46c;background:rgba(201,164,108,.07)}
.gi-drop img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff}
.gi-drop.logo img{background:repeating-conic-gradient(#d8d4cc 0% 25%,#f4f1ec 0% 50%) 50%/16px 16px}
.gi-x{position:absolute;top:8px;right:8px;z-index:2;width:26px;height:26px;border-radius:50%;border:none;background:rgba(0,0,0,.65);color:#fff;cursor:pointer;font-size:.9rem;line-height:1}
.gi-chips{display:flex;flex-wrap:wrap;gap:7px}
.gi-chip{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:rgba(255,255,255,.85);border-radius:999px;padding:7px 13px;font-size:.8rem;cursor:pointer;transition:all .12s;font-family:inherit}
.gi-chip:hover{border-color:rgba(201,164,108,.6)}
.gi-chip.on{background:#c9a46c;border-color:#c9a46c;color:#1e1b18;font-weight:700}
.gi-esc{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.gi-escb{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.035);border-radius:12px;padding:10px 12px;text-align:left;cursor:pointer;color:#fff;font-family:inherit;transition:all .12s}
.gi-escb b{display:block;font-size:.84rem}.gi-escb span{font-size:.72rem;color:rgba(255,255,255,.5)}
.gi-escb:hover{border-color:rgba(201,164,108,.6)}
.gi-escb.on{border-color:#c9a46c;background:rgba(201,164,108,.13)}
.gi-in{width:100%;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#fff;padding:9px 11px;font-size:.84rem;font-family:inherit;resize:vertical}
.gi-in:focus{outline:none;border-color:#c9a46c}
.gi-row{display:flex;gap:10px;align-items:center}
.gi-step{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.14);border-radius:10px;overflow:hidden}
.gi-step button{width:34px;height:34px;background:rgba(255,255,255,.05);border:none;color:#fff;font-size:1.1rem;cursor:pointer}
.gi-step span{min-width:34px;text-align:center;font-weight:700}
.gi-go{width:100%;border:none;border-radius:14px;padding:15px;font-size:1rem;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#d4b07a,#b98f55);color:#1e1b18;font-family:inherit;box-shadow:0 8px 24px rgba(185,143,85,.28);transition:transform .12s,opacity .12s}
.gi-go:hover{transform:translateY(-1px)}.gi-go:disabled{opacity:.5;cursor:default;transform:none}
.gi-err{color:#ff9b8a;font-size:.82rem;margin:0}
.gi-main{overflow:auto;min-height:0}
.gi-vacio{height:100%;min-height:380px;border:1.5px dashed rgba(255,255,255,.12);border-radius:22px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:rgba(255,255,255,.4);text-align:center;padding:30px}
.gi-vacio b{font-size:1.05rem;color:rgba(255,255,255,.7)}
.gi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}
.gi-res{position:relative;border-radius:18px;overflow:hidden;aspect-ratio:1;background:#14171c;border:1px solid rgba(255,255,255,.08)}
.gi-res img{width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in}
.gi-sk{background:linear-gradient(110deg,rgba(255,255,255,.04) 30%,rgba(255,255,255,.1) 50%,rgba(255,255,255,.04) 70%);background-size:200% 100%;animation:gishim 1.3s linear infinite;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.5);font-size:.84rem}
@keyframes gishim{to{background-position:-200% 0}}
.gi-acc{position:absolute;left:0;right:0;bottom:0;padding:34px 12px 12px;background:linear-gradient(transparent,rgba(0,0,0,.78));display:flex;gap:8px;opacity:0;transition:opacity .15s}
.gi-res:hover .gi-acc{opacity:1}
.gi-acc button{flex:1;border:1px solid rgba(255,255,255,.3);background:rgba(20,18,16,.7);color:#fff;border-radius:10px;padding:8px 6px;font-size:.78rem;cursor:pointer;font-family:inherit}
.gi-acc button:hover{background:#c9a46c;color:#1e1b18;border-color:#c9a46c}
.gi-lb{position:fixed;inset:0;z-index:10060;background:rgba(0,0,0,.86);display:flex;align-items:center;justify-content:center;padding:30px;cursor:zoom-out}
.gi-lb img{max-width:100%;max-height:100%;border-radius:12px;box-shadow:0 20px 80px rgba(0,0,0,.6)}
@media(max-width:980px){.gi{grid-template-columns:1fr;height:auto}.gi-panel{overflow:visible}}
`;

export default function GeneradorImagenes() {
  const [producto, setProducto] = useState(null), [logo, setLogo] = useState(null), [marcas, setMarcas] = useState([]), [marcaId, setMarcaId] = useState('');
  const [col, setCol] = useState('grabado'), [esc, setEsc] = useState('catalogo'), [acabado, setAcabado] = useState(''), [notas, setNotas] = useState(''), [n, setN] = useState(2);
  const [res, setRes] = useState([]), [trabajando, setTrabajando] = useState(false), [error, setError] = useState(''), [grande, setGrande] = useState(null);
  const refP = useRef(null), refL = useRef(null), panel = useRef(null);
  useEffect(() => { api.get('/estudio-ideas/marcas').then(r => setMarcas((r.data?.marcas || []).filter(m => m.logo))).catch(() => {}); }, []);

  const carga = async (file, set) => { if (!file) return; if (!/^image\//.test(file.type)) { setError('Sube una imagen (PNG, JPG o WebP)'); return; } try { set(await comprimir(file)); setError(''); } catch (e) { setError(e.message); } };
  const suelta = (e, set) => { e.preventDefault(); carga(e.dataTransfer.files?.[0], set); };
  const alPegar = (e) => { const f = Array.from(e.clipboardData?.files || []).find(x => /^image\//.test(x.type)); if (f) { e.preventDefault(); carga(f, producto ? setLogo : setProducto); } };

  const componeTexto = (i) => {
    const c = COLOCACIONES.find(x => x.id === col), s = ESCENAS.find(x => x.id === esc), conLogo = !!logo || !!marcaId;
    return 'Crea un MOCKUP FOTORREALISTA de producto. La primera imagen es el PRODUCTO: conserva su forma, proporciones y materiales. '
      + (logo ? 'La segunda imagen es el LOGO: úsalo EXACTAMENTE como está (misma forma, letras, proporciones y colores); está prohibido redibujarlo, deformarlo o inventar texto. ' : marcaId ? 'El logo que hay que usar es el oficial de la marca, que se adjunta: colócalo exactamente como es. ' : '')
      + (conLogo ? 'Colócalo así: ' + c.t + '. ' : '') + (acabado.trim() ? 'Acabado o material del producto: ' + acabado.trim() + '. ' : '')
      + 'Escena: ' + s.t + '. ' + (notas.trim() ? notas.trim() + '. ' : '') + ANGULOS[i % ANGULOS.length]
      + ' Resultado: fotografía profesional de producto, nítida, con iluminación realista, sin texto añadido ni marcas de agua.';
  };

  const genera = async () => {
    if (!producto) { setError('Sube primero la foto del producto'); return; }
    setError(''); setTrabajando(true);
    const ids = Array.from({ length: n }, (_, i) => Date.now() + '-' + i);
    setRes(r => [...ids.map(id => ({ id, estado: 'cargando' })), ...r]);
    await Promise.all(ids.map(async (id, i) => {
      try {
        const r = await api.post('/estudio-ideas/chat', { texto: componeTexto(i), imagenes: [producto, ...(logo ? [logo] : [])], marcaId: !logo && marcaId ? marcaId : undefined, modo: 'respetar' }, { timeout: 280000 });
        const url = (r.data?.imagenes || [])[0] || (r.data?.propuestas?.[0]?.imagenes || [])[0];
        setRes(l => l.map(x => (x.id === id ? (url ? { id, estado: 'ok', url } : { id, estado: 'error', err: r.data?.texto || 'No salió ninguna imagen' }) : x)));
      } catch (e) { setRes(l => l.map(x => (x.id === id ? { id, estado: 'error', err: e.response?.data?.error || 'No se pudo generar' } : x))); }
    }));
    setTrabajando(false);
  };
  const descarga = (url) => { const a = document.createElement('a'); a.href = url; a.download = 'mockup-ranuse.png'; a.click(); };
  const retoca = (url) => { setProducto(url); setError(''); panel.current?.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <div className="gi" onPaste={alPegar}>
      <style>{CSS}</style>
      <div className="gi-panel" ref={panel}>
        <div><h2 className="gi-h">Generador de imágenes</h2><p className="gi-sub">Sube un producto y tu logo, elige cómo se coloca y en qué escena, y salen varias propuestas. Puedes pegar imágenes con Ctrl+V.</p></div>

        <div className="gi-card">
          <div className="gi-t"><span className="gi-n">1</span> Producto</div>
          <div className="gi-drop" onClick={() => refP.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => suelta(e, setProducto)}>
            {producto ? <><img src={producto} alt="" /><button className="gi-x" onClick={e => { e.stopPropagation(); setProducto(null); }}>✕</button></> : <><b style={{ color: '#fff' }}>Arrastra aquí la foto</b><span>o haz clic para elegirla · por ejemplo, una mancuerna</span></>}
            <input ref={refP} type="file" accept="image/*" hidden onChange={e => { carga(e.target.files?.[0], setProducto); e.target.value = ''; }} />
          </div>
        </div>

        <div className="gi-card">
          <div className="gi-t"><span className="gi-n">2</span> Logo</div>
          {!marcaId && <div className="gi-drop logo" style={{ aspectRatio: '16/7' }} onClick={() => refL.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => suelta(e, setLogo)}>
            {logo ? <><img src={logo} alt="" /><button className="gi-x" onClick={e => { e.stopPropagation(); setLogo(null); }}>✕</button></> : <><b style={{ color: '#fff' }}>Sube el logo</b><span>PNG con fondo transparente, si lo tienes</span></>}
            <input ref={refL} type="file" accept="image/*" hidden onChange={e => { carga(e.target.files?.[0], setLogo); e.target.value = ''; }} />
          </div>}
          {marcas.length > 0 && <div style={{ marginTop: 10 }}>
            <select className="gi-in" value={marcaId} onChange={e => { setMarcaId(e.target.value); if (e.target.value) setLogo(null); }}><option value="">O usa el logo de una marca guardada…</option>{marcas.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
          </div>}
        </div>

        <div className="gi-card">
          <div className="gi-t"><span className="gi-n">3</span> Cómo se coloca el logo</div>
          <div className="gi-chips">{COLOCACIONES.map(c => <button key={c.id} className={'gi-chip' + (col === c.id ? ' on' : '')} onClick={() => setCol(c.id)}>{c.n}</button>)}</div>
        </div>

        <div className="gi-card">
          <div className="gi-t"><span className="gi-n">4</span> Escena</div>
          <div className="gi-esc">{ESCENAS.map(s => <button key={s.id} className={'gi-escb' + (esc === s.id ? ' on' : '')} onClick={() => setEsc(s.id)}><b>{s.n}</b><span>{s.d}</span></button>)}</div>
        </div>

        <div className="gi-card">
          <div className="gi-t"><span className="gi-n">5</span> Detalles (opcional)</div>
          <input className="gi-in" placeholder="Acabado o material: cromo, hierro negro mate, caucho…" value={acabado} onChange={e => setAcabado(e.target.value)} style={{ marginBottom: 8 }} />
          <textarea className="gi-in" rows={2} placeholder="Algo más: reflejos suaves, logo pequeño, más contraste…" value={notas} onChange={e => setNotas(e.target.value)} />
        </div>

        <div className="gi-row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: '.84rem', color: 'rgba(255,255,255,.7)' }}>Propuestas (cada una usa un ángulo distinto)</span>
          <span className="gi-step"><button onClick={() => setN(v => Math.max(1, v - 1))}>−</button><span>{n}</span><button onClick={() => setN(v => Math.min(4, v + 1))}>+</button></span>
        </div>
        {error && <p className="gi-err">{error}</p>}
        <button className="gi-go" onClick={genera} disabled={trabajando || !producto}>{trabajando ? 'Generando… (1-2 minutos)' : '✨ Generar ' + n + (n === 1 ? ' imagen' : ' imágenes')}</button>
      </div>

      <div className="gi-main">
        {!res.length ? (
          <div className="gi-vacio"><b>Aquí saldrán tus imágenes</b><span>Empieza subiendo la foto del producto a la izquierda.<br />Cuando una te guste, pasa el ratón por encima para descargarla o retocarla.</span></div>
        ) : (
          <div className="gi-grid">
            {res.map(r => (
              <div key={r.id} className={'gi-res' + (r.estado !== 'ok' ? ' gi-sk' : '')}>
                {r.estado === 'cargando' && <span>Creando la imagen…</span>}
                {r.estado === 'error' && <span style={{ padding: 18, textAlign: 'center', color: '#ff9b8a' }}>{r.err}</span>}
                {r.estado === 'ok' && <><img src={r.url} alt="" onClick={() => setGrande(r.url)} /><div className="gi-acc"><button onClick={() => descarga(r.url)}>Descargar</button><button onClick={() => retoca(r.url)} title="La usa como producto para volver a generar a partir de ella">Retocar</button><button onClick={() => setRes(l => l.filter(x => x.id !== r.id))}>Quitar</button></div></>}
              </div>
            ))}
          </div>
        )}
      </div>
      {grande && <div className="gi-lb" onClick={() => setGrande(null)}><img src={grande} alt="" /></div>}
    </div>
  );
}
