import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

// Chat de imágenes: se conversa con la IA como en ChatGPT. Se suben fotos, logos o referencias dentro de la conversación y la IA las entiende;
// cada imagen que sale se puede descargar, guardar en la galería o enviar a la historia de un proyecto / a la galería de un plano.
// Las conversaciones se guardan solas y se pueden retomar. Usa el motor de /estudio-ideas/chat.
const ETIQUETAS = [['foto', 'Foto'], ['logo', 'Logo'], ['ref', 'Referencia'], ['plano', 'Plano'], ['vista', 'Vista 3D']];
const NOMBRE_ET = { foto: 'la foto del producto o del espacio', logo: 'el LOGO oficial (colócalo exactamente así, sin redibujarlo)', ref: 'una imagen de referencia de estilo', plano: 'un plano', vista: 'una captura de mi modelo 3D actual (respeta su arquitectura, distribución, objetos y materiales; cambia solo lo que te pida)' };
const uid = () => Math.random().toString(36).slice(2, 10);

const comprimir = (file, maxLado = 1800) => new Promise((ok, ko) => {
  const fr = new FileReader();
  fr.onerror = () => ko(new Error('No se pudo leer la imagen'));
  fr.onload = () => {
    const img = new Image();
    img.onerror = () => ko(new Error('Imagen no válida'));
    img.onload = () => {
      const k = Math.min(1, maxLado / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9));
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
});
const reducir = (dataUrl, maxLado = 1600) => new Promise(ok => {
  const img = new Image(); img.onerror = () => ok(dataUrl);
  img.onload = () => { const k = Math.min(1, maxLado / Math.max(img.width, img.height)); if (k >= 1) return ok(dataUrl); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.88)); };
  img.src = dataUrl;
});
const aDataUrl = async (url) => {
  const b = await (await fetch(url)).blob();
  return new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = ko; fr.readAsDataURL(b); });
};
const descarga = async (url, nombre) => {
  try { const b = await (await fetch(url)).blob(), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  catch { window.open(url, '_blank'); }
};

const CSS = `
.ci{display:grid;grid-template-columns:270px minmax(0,1fr);height:100%;color:#fff;font-family:inherit;min-height:0}
.ci *{box-sizing:border-box}
.ci-lado{border-right:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;min-height:0;padding:14px 12px;gap:10px;background:rgba(0,0,0,.18)}
.ci-nuevo{border:1px solid rgba(201,164,108,.5);background:rgba(201,164,108,.1);color:#e8d3b0;border-radius:12px;padding:10px 12px;font-weight:700;cursor:pointer;font-family:inherit;font-size:.88rem;text-align:left}
.ci-nuevo:hover{background:rgba(201,164,108,.2)}
.ci-tabs{display:flex;gap:6px}
.ci-tab{flex:1;border:none;background:rgba(255,255,255,.05);color:rgba(255,255,255,.7);border-radius:9px;padding:7px;font-size:.78rem;cursor:pointer;font-family:inherit}
.ci-tab.on{background:rgba(255,255,255,.14);color:#fff;font-weight:700}
.ci-lista{overflow:auto;display:flex;flex-direction:column;gap:3px;min-height:0;flex:1}
.ci-it{display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:10px;cursor:pointer;border:1px solid transparent;position:relative}
.ci-it:hover{background:rgba(255,255,255,.06)}
.ci-it.on{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.1)}
.ci-it img{width:34px;height:34px;border-radius:7px;object-fit:cover;background:#222;flex-shrink:0}
.ci-it .ph{width:34px;height:34px;border-radius:7px;background:rgba(255,255,255,.07);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.9rem}
.ci-it b{display:block;font-size:.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-it small{color:rgba(255,255,255,.45);font-size:.7rem}
.ci-it .mx{margin-left:auto;opacity:0;border:none;background:none;color:rgba(255,255,255,.6);cursor:pointer;font-size:.9rem}
.ci-it:hover .mx{opacity:1}
.ci-central{display:flex;flex-direction:column;min-height:0;min-width:0}
.ci-cab{display:flex;align-items:center;gap:10px;padding:12px 22px;border-bottom:1px solid rgba(255,255,255,.07)}
.ci-cab input.t{background:none;border:none;color:#fff;font-size:1.02rem;font-weight:700;font-family:inherit;min-width:0;flex:1;padding:4px 6px;border-radius:8px}
.ci-cab input.t:focus{outline:none;background:rgba(255,255,255,.07)}
.ci-sel{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:9px;padding:6px 9px;font-size:.8rem;font-family:inherit}
.ci-msgs{flex:1;overflow:auto;padding:22px 0;min-height:0}
.ci-col{max-width:820px;margin:0 auto;padding:0 22px;display:flex;flex-direction:column;gap:18px}
.ci-m{display:flex;flex-direction:column;gap:8px;max-width:92%}
.ci-m.yo{align-self:flex-end;align-items:flex-end}
.ci-m.ia{align-self:flex-start}
.ci-b{padding:11px 15px;border-radius:18px;font-size:.92rem;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.ci-m.yo .ci-b{background:#8a6d4d;color:#fff;border-bottom-right-radius:6px}
.ci-m.ia .ci-b{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);border-bottom-left-radius:6px}
.ci-imgs{display:flex;flex-wrap:wrap;gap:8px}
.ci-img{position:relative;border-radius:14px;overflow:hidden;background:#14171c;border:1px solid rgba(255,255,255,.1)}
.ci-m.yo .ci-img{width:150px;height:150px}
.ci-m.ia .ci-img{width:min(420px,100%)}
.ci-img img{display:block;width:100%;height:100%;object-fit:cover;cursor:zoom-in}
.ci-m.ia .ci-img img{height:auto;object-fit:contain}
.ci-et{position:absolute;left:6px;top:6px;background:rgba(0,0,0,.7);color:#e8d3b0;font-size:.66rem;font-weight:700;border-radius:999px;padding:2px 8px}
.ci-acc{display:flex;flex-wrap:wrap;gap:6px}
.ci-btn{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:rgba(255,255,255,.9);border-radius:999px;padding:6px 12px;font-size:.76rem;cursor:pointer;font-family:inherit}
.ci-btn:hover{border-color:rgba(201,164,108,.7)}
.ci-btn.ok{background:rgba(120,190,130,.18);border-color:rgba(120,190,130,.5);color:#bfe6c5}
.ci-vacio{margin:auto;text-align:center;color:rgba(255,255,255,.5);padding:40px 20px;max-width:560px}
.ci-vacio h3{color:#fff;font-size:1.25rem;margin:0 0 8px}
.ci-sug{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:16px}
.ci-comp{border-top:1px solid rgba(255,255,255,.07);padding:14px 22px 18px}
.ci-cc{max-width:820px;margin:0 auto}
.ci-caja{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:10px 12px;transition:border-color .12s}
.ci-caja.arrastra{border-color:#c9a46c;background:rgba(201,164,108,.1)}
.ci-caja textarea{width:100%;background:none;border:none;color:#fff;font-size:.95rem;font-family:inherit;resize:none;max-height:180px;padding:4px 4px 6px}
.ci-caja textarea:focus{outline:none}
.ci-adj{display:flex;flex-wrap:wrap;gap:8px;padding:2px 2px 8px}
.ci-a{position:relative;width:78px}
.ci-a img{width:78px;height:78px;border-radius:10px;object-fit:cover;display:block;border:1px solid rgba(255,255,255,.15)}
.ci-a button.x{position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:#000;color:#fff;cursor:pointer;font-size:.7rem;line-height:1}
.ci-a select{width:100%;margin-top:4px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:7px;font-size:.68rem;padding:2px}
.ci-bar{display:flex;align-items:center;gap:8px}
.ci-clip{width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#fff;cursor:pointer;font-size:1.05rem}
.ci-clip:hover{border-color:#c9a46c}
.ci-chk{display:flex;align-items:center;gap:6px;font-size:.76rem;color:rgba(255,255,255,.7);cursor:pointer}
.ci-env{margin-left:auto;width:38px;height:38px;border-radius:50%;border:none;background:#c9a46c;color:#1e1b18;font-size:1.1rem;font-weight:800;cursor:pointer}
.ci-env:disabled{opacity:.4;cursor:default}
.ci-pen{display:flex;gap:6px;align-items:center;color:rgba(255,255,255,.6);font-size:.85rem}
.ci-pen i{width:7px;height:7px;border-radius:50%;background:#c9a46c;animation:cip 1s infinite ease-in-out}
.ci-pen i:nth-child(2){animation-delay:.15s}.ci-pen i:nth-child(3){animation-delay:.3s}
@keyframes cip{0%,80%,100%{opacity:.25}40%{opacity:1}}
.ci-err{color:#ff9b8a;font-size:.82rem;margin:6px 0 0}
.ci.compacto{grid-template-columns:1fr;position:relative;border-radius:14px;background:#1b1815;border:1px solid rgba(255,255,255,.12);overflow:hidden}
.ci.compacto .ci-lado{position:absolute;z-index:5;left:0;top:0;bottom:0;width:250px;background:#1b1815;display:none;box-shadow:6px 0 24px rgba(0,0,0,.5)}
.ci.compacto .ci-lado.abierto{display:flex}
.ci.compacto .ci-cab{padding:10px 12px}.ci.compacto .ci-col{padding:0 12px}.ci.compacto .ci-comp{padding:10px 12px 12px}.ci.compacto .ci-m{max-width:100%}
.ci.compacto .ci-m.ia .ci-img{width:100%}.ci.compacto .ci-b{font-size:.86rem}.ci.compacto .ci-gal{padding:12px}
.ci-gal{overflow:auto;padding:22px;min-height:0;flex:1}
.ci-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.ci-gi{border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#14171c}
.ci-gi img{display:block;width:100%;aspect-ratio:1;object-fit:cover;cursor:zoom-in}
.ci-gi .p{padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.ci-modal{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px}
.ci-modal .c{background:#1e1b18;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:20px;width:min(460px,100%);max-height:90vh;overflow:auto;display:flex;flex-direction:column;gap:10px}
.ci-modal h4{margin:0 0 4px;font-size:1.05rem}
.ci-modal label{font-size:.76rem;color:rgba(255,255,255,.65);display:flex;flex-direction:column;gap:4px}
.ci-modal input,.ci-modal select,.ci-modal textarea{background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:9px;padding:8px 10px;font-size:.85rem;font-family:inherit}
.ci-grande{position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:2100;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px}
.ci-grande img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px}
@media(max-width:900px){.ci{grid-template-columns:1fr}.ci-lado{display:none}}
`;

export default function ChatImagenes({ compacto = false, capturarVista = null, obtenerContexto = null, onCerrar = null }) {
  const [chats, setChats] = useState([]), [chatId, setChatId] = useState(null), [titulo, setTitulo] = useState('Conversación nueva'), [mensajes, setMensajes] = useState([]), [previo, setPrevio] = useState(null);
  const [texto, setTexto] = useState(''), [adj, setAdj] = useState([]), [trabajando, setTrabajando] = useState(false), [error, setError] = useState(''), [soloImg, setSoloImg] = useState(false);
  const [marcas, setMarcas] = useState([]), [marcaId, setMarcaId] = useState(''), [vista, setVista] = useState('chats'), [galeria, setGaleria] = useState([]), [grande, setGrande] = useState(null);
  const [envio, setEnvio] = useState(null), [arrastra, setArrastra] = useState(false), [guardadas, setGuardadas] = useState({}), [menu, setMenu] = useState(false), [usarCtx, setUsarCtx] = useState(true);
  const fin = useRef(null), fichero = useRef(null), area = useRef(null);

  const cargaChats = () => api.get('/ia-chats').then(r => setChats(r.data?.chats || [])).catch(() => {});
  const cargaGaleria = () => api.get('/ia-chats/galeria').then(r => setGaleria(r.data?.items || [])).catch(() => {});
  useEffect(() => { cargaChats(); cargaGaleria(); api.get('/estudio-ideas/marcas').then(r => setMarcas(r.data?.marcas || [])).catch(() => {}); }, []);
  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [mensajes, trabajando]);
  useEffect(() => { const t = area.current; if (t) { t.style.height = 'auto'; t.style.height = Math.min(180, t.scrollHeight) + 'px'; } }, [texto]);

  const nueva = () => { setMenu(false); setChatId(null); setTitulo('Conversación nueva'); setMensajes([]); setPrevio(null); setAdj([]); setTexto(''); setError(''); setVista('chats'); };
  const abre = async (id) => {
    setMenu(false);
    try { const r = await api.get('/ia-chats/' + id); setChatId(r.data.id); setTitulo(r.data.titulo); setMensajes((r.data.mensajes || []).map(m => ({ ...m, id: uid() }))); setPrevio(r.data.previo || null); setMarcaId(r.data.marcaId || ''); setError(''); setVista('chats'); }
    catch { setError('No se pudo abrir la conversación'); }
  };
  const borra = async (id, e) => { e.stopPropagation(); if (!window.confirm('¿Borrar esta conversación? Las imágenes que guardaste en la galería se quedan.')) return; try { await api.delete('/ia-chats/' + id); if (id === chatId) nueva(); cargaChats(); } catch { setError('No se pudo borrar'); } };
  const renombra = async () => { if (!chatId) return; try { await api.put('/ia-chats/' + chatId + '/titulo', { titulo }); cargaChats(); } catch { /* se queda como estaba */ } };

  const adjunta = async (lista) => {
    try {
      const nuevas = []; for (const f of Array.from(lista || []).slice(0, 4)) if (/^image\//.test(f.type)) nuevas.push({ id: uid(), url: await comprimir(f), et: adj.length + nuevas.length === 0 ? 'foto' : 'ref' });
      if (nuevas.length) setAdj(a => [...a, ...nuevas].slice(0, 4));
    } catch (e) { setError(e.message); }
  };
  const usaVista = async () => { try { const u0 = await capturarVista(), u = u0 ? await reducir(u0) : null; if (u) setAdj(a => [...a, { id: uid(), url: u, et: 'vista' }].slice(0, 4)); else setError('No se pudo coger la vista del 3D'); } catch { setError('No se pudo coger la vista del 3D'); } };
  const alPegar = (e) => { const fs = Array.from(e.clipboardData?.files || []).filter(f => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); adjunta(fs); } };
  const alSoltar = (e) => { e.preventDefault(); setArrastra(false); adjunta(e.dataTransfer?.files); };

  const guarda = async (msgs, prev, id, tit) => {
    try {
      const r = await api.post('/ia-chats/guardar', { id: id || undefined, titulo: tit && tit !== 'Conversación nueva' ? tit : undefined, mensajes: msgs.map(m => ({ rol: m.rol, texto: m.texto, imagenes: m.imagenes, etiquetas: m.etiquetas, idResp: m.idResp })), previo: prev, marcaId }, { timeout: 120000 });
      setChatId(r.data.id); setTitulo(r.data.titulo);
      setMensajes(cur => cur.map((m, i) => ({ ...m, imagenes: r.data.mensajes?.[i]?.imagenes || m.imagenes }))); // ya subidas: se sustituyen los datos por sus direcciones
      cargaChats(); return r.data.id;
    } catch { setError('La conversación no se pudo guardar (se mantiene en pantalla).'); return id; }
  };

  const enviar = async (textoForzado) => {
    const t = (textoForzado ?? texto).trim(); if ((!t && !adj.length) || trabajando) return;
    const etiquetas = Object.fromEntries(adj.map((a, i) => [i, a.et]));
    const lista = adj.length ? 'Imágenes adjuntas en este mensaje: ' + adj.map((a, i) => (i + 1) + ' = ' + NOMBRE_ET[a.et]).join('; ') + '.' : '';
    const delUsuario = { id: uid(), rol: 'yo', texto: t, imagenes: adj.map(a => a.url), etiquetas };
    const nuevos = [...mensajes, delUsuario];
    setMensajes(nuevos); setTexto(''); setAdj([]); setError(''); setTrabajando(true);
    let contexto; if (obtenerContexto && usarCtx) { try { contexto = (await obtenerContexto())?.texto; } catch { contexto = undefined; } }
    const cuerpo = (extra = {}) => ({ contexto, texto: [t, lista].filter(Boolean).join('\n\n'), imagenes: delUsuario.imagenes, previousResponseId: previo || undefined, soloDiseno: soloImg, marcaId: marcaId || undefined, modo: 'respetar', ...extra });
    try {
      let r;
      try { r = await api.post('/estudio-ideas/chat', cuerpo(), { timeout: 290000 }); }
      catch (e) {
        // si la conversación guardada ya no está en el servidor de la IA, se continúa desde la última imagen generada
        const ultima = [...mensajes].reverse().find(m => m.rol === 'ia' && m.imagenes?.length);
        if (previo && /previous|response|not found/i.test(String(e.response?.data?.error || '')) && ultima) { const base = await aDataUrl(ultima.imagenes[0]); r = await api.post('/estudio-ideas/chat', cuerpo({ previousResponseId: undefined, imagenes: [base, ...delUsuario.imagenes].slice(0, 4), texto: [t, 'Continúa trabajando sobre la primera imagen adjunta (es lo último que hicimos).', lista].filter(Boolean).join('\n\n') }), { timeout: 290000 }); }
        else throw e;
      }
      const nuevosIa = r.data.propuestas?.length ? r.data.propuestas : [r.data];
      const ia = nuevosIa.map(p => ({ id: uid(), rol: 'ia', texto: p.texto || '', imagenes: p.imagenes || [], idResp: p.id }));
      const prev = nuevosIa[0].id || previo, todos = [...nuevos, ...ia];
      setMensajes(todos); setPrevio(prev); setTrabajando(false);
      await guarda(todos, prev, chatId, titulo);
    } catch (e) {
      console.error('chat imágenes:', e);
      const det = e.response ? 'el servidor respondió ' + e.response.status + (e.response.status === 504 || e.response.status === 502 ? ' (tardó demasiado: prueba con una imagen más pequeña o en dos pasos)' : '') : e.code === 'ECONNABORTED' ? 'tardó más de 5 minutos' : e.message === 'Network Error' ? 'se cortó la conexión con el servidor (suele ser por tiempo: prueba otra vez o en dos pasos)' : String(e.message || 'error desconocido').slice(0, 120);
      setError(e.response?.data?.error || 'No se pudo contestar: ' + det + '.'); setTrabajando(false);
    }
  };

  const aGaleria = async (url) => {
    try { await api.post('/ia-chats/galeria', { url, chatId: chatId || undefined, nombre: titulo }); setGuardadas(g => ({ ...g, [url]: true })); cargaGaleria(); }
    catch (e) { setError(e.response?.data?.error || 'Todavía no se puede guardar: espera a que la conversación se guarde.'); }
  };
  const retocar = (url) => { aDataUrl(url).then(d => { setAdj(a => [...a, { id: uid(), url: d, et: 'foto' }].slice(0, 4)); area.current?.focus(); }).catch(() => setError('No se pudo coger la imagen')); };

  const SUG = ['Mockup de este producto con el logo grabado', 'Una idea para esta pared a partir de la foto', 'Quita el fondo y déjalo recortado'];
  const urlsOk = (u) => typeof u === 'string' && u.startsWith('http');

  return (
    <div className={'ci' + (compacto ? ' compacto' : '')}>
      <style>{CSS}</style>
      <aside className={'ci-lado' + (menu ? ' abierto' : '')}>
        <button type="button" className="ci-nuevo" onClick={nueva}>＋ Nueva conversación</button>
        <div className="ci-tabs">
          <button type="button" className={'ci-tab' + (vista === 'chats' ? ' on' : '')} onClick={() => setVista('chats')}>Conversaciones</button>
          <button type="button" className={'ci-tab' + (vista === 'galeria' ? ' on' : '')} onClick={() => { setVista('galeria'); cargaGaleria(); }}>Galería ({galeria.length})</button>
        </div>
        <div className="ci-lista">
          {vista === 'chats' && chats.map(c => (
            <div key={c.id} className={'ci-it' + (c.id === chatId ? ' on' : '')} onClick={() => abre(c.id)}>
              {c.portada ? <img src={c.portada} alt="" /> : <div className="ph">💬</div>}
              <div style={{ minWidth: 0 }}><b>{c.titulo}</b><small>{new Date(c.actualizado).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · {c.n} mensajes</small></div>
              <button type="button" className="mx" title="Borrar" onClick={e => borra(c.id, e)}>✕</button>
            </div>
          ))}
          {vista === 'chats' && !chats.length && <small style={{ color: 'rgba(255,255,255,.4)', padding: 8 }}>Todavía no hay conversaciones. Empieza una y se guarda sola.</small>}
          {vista === 'galeria' && <small style={{ color: 'rgba(255,255,255,.5)', padding: 8 }}>Las imágenes que guardas con ⭐ aparecen aquí, a la derecha.</small>}
        </div>
      </aside>

      <section className="ci-central">
        {vista === 'galeria' ? (
          <div className="ci-gal">
            <h3 style={{ margin: '0 0 14px' }}>Galería</h3>
            {!galeria.length && <div className="ci-vacio"><h3>Aún no has guardado nada</h3>En el chat, pulsa «⭐ Guardar en galería» debajo de una imagen.</div>}
            <div className="ci-grid">
              {galeria.map(it => (
                <div key={it.id} className="ci-gi">
                  <img src={it.url} alt="" onClick={() => setGrande(it.url)} />
                  <div className="p">
                    <small style={{ color: 'rgba(255,255,255,.55)' }}>{it.nombre || 'Imagen'} · {new Date(it.creado).toLocaleDateString('es-ES')}</small>
                    <div className="ci-acc">
                      <button type="button" className="ci-btn" onClick={() => setEnvio({ url: it.url, titulo: it.nombre || '' })}>📤 Enviar a proyecto</button>
                      <button type="button" className="ci-btn" onClick={() => descarga(it.url, 'imagen-ia.png')}>⬇</button>
                      <button type="button" className="ci-btn" onClick={async () => { await api.delete('/ia-chats/galeria/' + it.id).catch(() => {}); cargaGaleria(); }}>Quitar</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="ci-cab">
              {compacto && <button type="button" className="ci-btn" onClick={() => setMenu(m => !m)} title="Conversaciones y galería">☰</button>}
              <input className="t" value={titulo} onChange={e => setTitulo(e.target.value)} onBlur={renombra} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} title="Pulsa para cambiar el nombre" />
              <select className="ci-sel" value={marcaId} onChange={e => setMarcaId(e.target.value)} title="La IA aplica los colores, el tono y el logo de esta marca"><option value="">Sin marca</option>{marcas.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
              {compacto && onCerrar && <button type="button" className="ci-btn" onClick={onCerrar} title="Cerrar">✕</button>}
            </div>
            <div className="ci-msgs">
              <div className="ci-col">
                {!mensajes.length && !trabajando && (
                  <div className="ci-vacio">
                    <h3>¿Qué quieres crear?</h3>
                    Escríbeme lo que necesitas y adjunta fotos, el logo o una referencia con el clip (o pegándolas). Yo las entiendo y trabajo con ellas. Después te digo si lo guardas, lo mandas a un proyecto o lo retocamos.
                    <div className="ci-sug">{SUG.map(s => <button key={s} type="button" className="ci-btn" onClick={() => setTexto(s)}>{s}</button>)}</div>
                  </div>
                )}
                {mensajes.map((m, i) => (
                  <div key={m.id || i} className={'ci-m ' + m.rol}>
                    {m.imagenes?.length > 0 && (
                      <div className="ci-imgs">
                        {m.imagenes.map((u, k) => (
                          <div key={k} className="ci-img">
                            <img src={u} alt="" onClick={() => setGrande(u)} />
                            {m.rol === 'yo' && m.etiquetas?.[k] && <span className="ci-et">{(ETIQUETAS.find(e => e[0] === m.etiquetas[k]) || [])[1]}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {m.texto && <div className="ci-b">{m.texto}</div>}
                    {m.rol === 'ia' && m.imagenes?.length > 0 && (
                      <div className="ci-acc">
                        {m.imagenes.map((u, k) => urlsOk(u) ? (
                          <span key={k} style={{ display: 'contents' }}>
                            <button type="button" className={'ci-btn' + (guardadas[u] ? ' ok' : '')} onClick={() => aGaleria(u)}>{guardadas[u] ? '✓ En la galería' : '⭐ Guardar en galería'}</button>
                            <button type="button" className="ci-btn" onClick={() => setEnvio({ url: u, titulo: titulo })}>📤 Enviar a proyecto…</button>
                            <button type="button" className="ci-btn" onClick={() => descarga(u, 'imagen-ia.png')}>⬇ Descargar</button>
                            <button type="button" className="ci-btn" onClick={() => retocar(u)}>✏️ Retocar</button>
                          </span>
                        ) : <small key={k} style={{ color: 'rgba(255,255,255,.45)' }}>Guardando la imagen…</small>)}
                      </div>
                    )}
                  </div>
                ))}
                {trabajando && <div className="ci-m ia"><div className="ci-b ci-pen"><i /><i /><i /><span style={{ marginLeft: 6 }}>Pensando… las imágenes pueden tardar un minuto o dos.</span></div></div>}
                <div ref={fin} />
              </div>
            </div>
            <div className="ci-comp">
              <div className="ci-cc">
                <div className={'ci-caja' + (arrastra ? ' arrastra' : '')} onDragOver={e => { e.preventDefault(); setArrastra(true); }} onDragLeave={() => setArrastra(false)} onDrop={alSoltar}>
                  {adj.length > 0 && (
                    <div className="ci-adj">
                      {adj.map(a => (
                        <div key={a.id} className="ci-a">
                          <img src={a.url} alt="" />
                          <button type="button" className="x" onClick={() => setAdj(l => l.filter(x => x.id !== a.id))}>✕</button>
                          <select value={a.et} onChange={e => setAdj(l => l.map(x => (x.id === a.id ? { ...x, et: e.target.value } : x)))} title="Dile qué es esta imagen">{ETIQUETAS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea ref={area} rows={1} value={texto} placeholder="Escribe aquí… (Enter envía, Mayús+Enter salto de línea). Puedes pegar o arrastrar imágenes." onChange={e => setTexto(e.target.value)} onPaste={alPegar}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }} />
                  <div className="ci-bar">
                    <input ref={fichero} type="file" accept="image/*" multiple hidden onChange={e => { adjunta(e.target.files); e.target.value = ''; }} />
                    <button type="button" className="ci-clip" title="Adjuntar fotos, logo o referencias" onClick={() => fichero.current?.click()}>📎</button>
                    {capturarVista && <button type="button" className="ci-clip" title="Adjuntar la vista actual del 3D" onClick={usaVista}>🖼</button>}
                    {obtenerContexto && <label className="ci-chk" title="La IA recibe una descripción de tu modelo (espacio, medidas, acabados y equipos) y no inventa lo que no le pidas"><input type="checkbox" checked={usarCtx} onChange={e => setUsarCtx(e.target.checked)} /> 🧠 Conoce el modelo</label>}
                    <label className="ci-chk" title="La IA devuelve solo el dibujo o producto, sin escena ni fondo de ambiente"><input type="checkbox" checked={soloImg} onChange={e => setSoloImg(e.target.checked)} /> Solo la imagen, sin escena</label>
                    <button type="button" className="ci-env" disabled={trabajando || (!texto.trim() && !adj.length)} onClick={() => enviar()} title="Enviar">↑</button>
                  </div>
                </div>
                {error && <p className="ci-err">{error}</p>}
              </div>
            </div>
          </>
        )}
      </section>

      {grande && <div className="ci-grande" onClick={() => setGrande(null)}><img src={grande} alt="" /></div>}
      {envio && <EnviarAProyecto datos={envio} onCerrar={() => setEnvio(null)} />}
    </div>
  );
}

// Ventana para mandar una imagen a la historia de un proyecto del cliente o a la galería de uno de sus planos
function EnviarAProyecto({ datos, onCerrar }) {
  const [proyectos, setProyectos] = useState(null), [pid, setPid] = useState(''), [info, setInfo] = useState(null), [destino, setDestino] = useState('historia');
  const [cap, setCap] = useState('nuevo'), [tituloCap, setTituloCap] = useState('Imágenes con IA'), [plano, setPlano] = useState(''), [titulo, setTitulo] = useState(datos.titulo || ''), [nota, setNota] = useState('');
  const [estado, setEstado] = useState(''), [ok, setOk] = useState('');
  useEffect(() => { api.get('/ia-chats/destinos').then(r => setProyectos(r.data?.proyectos || [])).catch(() => setProyectos([])); }, []);
  useEffect(() => { setInfo(null); if (pid) api.get('/ia-chats/destinos/' + pid).then(r => { setInfo(r.data); setPlano(r.data?.planos?.[0]?.id || ''); setCap('nuevo'); }).catch(() => setInfo({ capitulos: [], planos: [] })); }, [pid]);
  const manda = async () => {
    setEstado('Enviando…');
    try { const r = await api.post('/ia-chats/enviar', { url: datos.url, proyectoId: pid, destino, capituloId: cap, tituloCapitulo: tituloCap, planoId: plano, titulo, nota }); setOk('Enviada a ' + r.data.donde + '.'); setEstado(''); }
    catch (e) { setEstado(e.response?.data?.error || 'No se pudo enviar'); }
  };
  return (
    <div className="ci-modal" onClick={onCerrar}>
      <div className="c" onClick={e => e.stopPropagation()}>
        <h4>Enviar a un proyecto</h4>
        <img src={datos.url} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 10, background: '#111' }} />
        {ok ? (
          <><p style={{ color: '#bfe6c5', margin: '6px 0' }}>✓ {ok}</p><button type="button" className="ci-btn" onClick={onCerrar}>Cerrar</button></>
        ) : (
          <>
            <label>Proyecto<select value={pid} onChange={e => setPid(e.target.value)}><option value="">{proyectos === null ? 'Cargando…' : 'Elige un proyecto…'}</option>{(proyectos || []).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
            {pid && info && (
              <>
                <label>Dónde<select value={destino} onChange={e => setDestino(e.target.value)}><option value="historia">Historia del cliente (capítulo)</option><option value="plano" disabled={!info.planos.length}>Galería de un plano 3D{info.planos.length ? '' : ' (no hay planos)'}</option></select></label>
                {destino === 'historia' ? (
                  <>
                    <label>Capítulo<select value={cap} onChange={e => setCap(e.target.value)}><option value="nuevo">➕ Capítulo nuevo</option>{info.capitulos.map(c => <option key={c.id} value={c.id}>{c.titulo}</option>)}</select></label>
                    {cap === 'nuevo' && <label>Nombre del capítulo nuevo<input value={tituloCap} onChange={e => setTituloCap(e.target.value)} /></label>}
                    <label>Título de la imagen<input value={titulo} onChange={e => setTitulo(e.target.value)} /></label>
                    <label>Texto (opcional)<textarea rows={2} value={nota} onChange={e => setNota(e.target.value)} /></label>
                    <small style={{ color: 'rgba(255,255,255,.5)' }}>Entra oculta: el cliente no la ve hasta que la muestres en el editor de su historia.</small>
                  </>
                ) : (
                  <>
                    <label>Plano<select value={plano} onChange={e => setPlano(e.target.value)}>{info.planos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
                    <label>Nombre<input value={titulo} onChange={e => setTitulo(e.target.value)} /></label>
                  </>
                )}
              </>
            )}
            {estado && <p className="ci-err" style={{ margin: 0 }}>{estado}</p>}
            <div className="ci-acc"><button type="button" className="ci-btn" style={{ background: '#c9a46c', color: '#1e1b18', fontWeight: 700 }} disabled={!pid || (destino === 'plano' && !plano)} onClick={manda}>Enviar</button><button type="button" className="ci-btn" onClick={onCerrar}>Cancelar</button></div>
          </>
        )}
      </div>
    </div>
  );
}
