import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as THREE from 'three';
import api from '../services/api';

// Tour 360° para el cliente (enlace público, solo lectura): se mira alrededor, se camina de una parada a otra con las flechas del suelo
// o con el minimapa, y cada parada es una panorámica ya renderizada. Orientación: el centro de la imagen mira hacia donde estaba la cámara
// (yaw); el azimut del mundo θ = atan2(x, z) se corresponde con la longitud del visor lon = π + yaw − θ (comprobado con una escena de prueba).
const OSCURO = '#141210', ORO = '#c9a46c';
const LAT_FLECHA = -0.3;
// Visor fijo, sin deformaciones: apertura constante (no hay zoom), mirada limitada para no llegar a los polos de la panorámica (donde se estira) y transición de «caminar»
const LAT_MAX = 0.5, HFOV = 80 * Math.PI / 180;

export function TourPublico() {
  const { id, firma } = useParams();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [actual, setActual] = useState(0);
  const [cargando, setCargando] = useState(true);
  const cont = useRef(null), vis = useRef({}), hot = useRef({}), actualRef = useRef(0), cono = useRef(null);

  useEffect(() => {
    api.get('/tour-publico/' + encodeURIComponent(id) + '/' + encodeURIComponent(firma))
      .then(r => setDatos(r.data)).catch(e => setError(e.response?.data?.error || 'No se pudo abrir el tour'));
  }, [id, firma]);

  const vecinos = useMemo(() => {
    if (!datos) return [];
    const c = datos.paradas[actual];
    return datos.paradas.map((p, i) => ({ p, i, d: Math.hypot(p.x - c.x, p.z - c.z) })).filter(v => v.i !== actual).sort((a, b) => a.d - b.d).slice(0, 6);
  }, [datos, actual]);

  const ir = (i, desde) => {
    if (!datos || i === actualRef.current) return;
    const c = datos.paradas[actualRef.current], p = datos.paradas[i];
    // al avanzar se mira hacia donde se camina; al saltar desde el minimapa o la barra, hacia el frente de la panorámica
    const lon = desde ? Math.PI + p.yaw - Math.atan2(p.x - c.x, p.z - c.z) : Math.PI;
    const de = actualRef.current; actualRef.current = i; setActual(i); setCargando(true);
    vis.current.mostrar?.(i, lon, desde ? { caminar: true, lonA: Math.PI + c.yaw - Math.atan2(p.x - c.x, p.z - c.z), de } : { caminar: false, de }).then(() => setCargando(false));
  };

  useEffect(() => {
    if (!datos || !cont.current) return;
    const el = cont.current, w0 = el.clientWidth || 800, h0 = el.clientHeight || 450;
    const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(w0, h0); r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;transition:opacity .35s;cursor:grab';
    el.appendChild(r.domElement);
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(75, w0 / h0, 0.1, 1100);
    const g = new THREE.SphereGeometry(500, 64, 40); g.scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000 }); sc.add(new THREE.Mesh(g, mat));
    const matB = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }), esferaB = new THREE.Mesh(g, matB); esferaB.scale.setScalar(0.99); esferaB.renderOrder = 1; esferaB.visible = false; sc.add(esferaB);
    const fovFijo = () => { const asp = Math.max(0.3, cam.aspect || 1.6), v = 2 * Math.atan(Math.tan(HFOV / 2) / asp); return Math.max(45, Math.min(78, v * 180 / Math.PI)); };
    cam.fov = fovFijo(); cam.updateProjectionMatrix();
    const cache = new Map();
    const cargaTex = url => {
      if (!cache.has(url)) cache.set(url, new Promise((ok, ko) => new THREE.TextureLoader().load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; ok(t); }, undefined, ko)));
      return cache.get(url);
    };
    let lon = Math.PI, lat = 0, drag = null, vivo = true, seq = 0;
    let animando = false;
    const anima = (ms, fn) => new Promise(ok => { const t0 = performance.now(); const paso = () => { if (!vivo) return ok(); const k = Math.min(1, (performance.now() - t0) / ms); fn(k * k * (3 - 2 * k)); if (k < 1) requestAnimationFrame(paso); else ok(); }; paso(); });
    const difAng = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
    // viaje: { caminar: true } = se gira hacia donde se va y se avanza (zoom suave + fundido); si no, fundido simple. En los dos casos el visor vuelve a su apertura fija al terminar
    vis.current.mostrar = async (i, lonIni, viaje) => {
      const mia = ++seq, canvas = r.domElement;
      if (!viaje) {
        canvas.style.opacity = '0';
        const [t] = await Promise.all([cargaTex(datos.paradas[i].url).catch(() => null), new Promise(ok => setTimeout(ok, 320))]);
        if (mia !== seq || !vivo) return;
        if (t) { mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true; }
        lon = lonIni; lat = 0; canvas.style.opacity = '1';
      } else {
        const t = await cargaTex(datos.paradas[i].url).catch(() => null);
        if (mia !== seq || !vivo) return;
        if (!t) { actualRef.current = viaje.de; return; }
        animando = true; const fov0 = fovFijo();
        if (viaje.caminar) { const l0 = lon, dl = difAng(l0, viaje.lonA), lat0 = lat; await anima(380, e => { lon = l0 + dl * e; lat = lat0 * (1 - e); }); }
        const lonA = lon;
        matB.map = t; matB.needsUpdate = true; matB.opacity = 0; esferaB.rotation.y = lonIni - lonA; esferaB.visible = true;
        await anima(viaje.caminar ? 900 : 550, e => { matB.opacity = e; if (viaje.caminar) { cam.fov = fov0 * (1 - 0.32 * e); cam.updateProjectionMatrix(); } });
        mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true; esferaB.visible = false; esferaB.rotation.y = 0; matB.opacity = 0;
        lon = lonIni; lat = 0; cam.fov = fov0; cam.updateProjectionMatrix(); animando = false;
        if (mia !== seq) return;
      }
      // se van descargando ya las paradas de al lado para que el salto sea inmediato
      const c = datos.paradas[i];
      datos.paradas.map((p, k) => ({ p, k, d: Math.hypot(p.x - c.x, p.z - c.z) })).filter(v => v.k !== i).sort((a, b) => a.d - b.d).slice(0, 3).forEach(v => cargaTex(v.p.url).catch(() => {}));
    };
    const dn = e => { drag = [e.clientX, e.clientY]; r.domElement.style.cursor = 'grabbing'; };
    const mv = e => { if (!drag || animando) return; const k = 0.2 * (Math.PI / 180) * (cam.fov / 75); lon -= (e.clientX - drag[0]) * k; lat = Math.max(-LAT_MAX, Math.min(LAT_MAX, lat + (e.clientY - drag[1]) * k)); drag = [e.clientX, e.clientY]; };
    const up = () => { drag = null; r.domElement.style.cursor = 'grab'; };
    const wh = e => { e.preventDefault(); }; // sin zoom: la apertura es fija para que la imagen no se deforme
    r.domElement.addEventListener('pointerdown', dn); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); r.domElement.addEventListener('wheel', wh, { passive: false });
    const v = new THREE.Vector3();
    const bucle = () => {
      if (!vivo) return; requestAnimationFrame(bucle);
      cam.lookAt(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)); r.render(sc, cam);
      const W = r.domElement.clientWidth, H = r.domElement.clientHeight, c = datos.paradas[actualRef.current];
      for (const [k, e] of Object.entries(hot.current)) {
        if (!e) continue;
        const p = datos.paradas[k], lo = Math.PI + c.yaw - Math.atan2(p.x - c.x, p.z - c.z);
        v.set(Math.cos(LAT_FLECHA) * Math.cos(lo), Math.sin(LAT_FLECHA), Math.cos(LAT_FLECHA) * Math.sin(lo)).multiplyScalar(10).project(cam);
        if (v.z > 1) { e.style.display = 'none'; continue; }
        e.style.display = 'flex'; e.style.transform = 'translate(' + ((v.x * 0.5 + 0.5) * W).toFixed(1) + 'px,' + ((-v.y * 0.5 + 0.5) * H).toFixed(1) + 'px) translate(-50%,-50%)';
      }
      if (cono.current) { const th = Math.PI + c.yaw - lon; cono.current.setAttribute('x2', (Math.sin(th) * 14).toFixed(1)); cono.current.setAttribute('y2', (Math.cos(th) * 14).toFixed(1)); }
    };
    bucle();
    const ajusta = () => { const W = el.clientWidth, H = el.clientHeight; if (W && H) { r.setSize(W, H); cam.aspect = W / H; if (!animando) cam.fov = fovFijo(); cam.updateProjectionMatrix(); } };
    window.addEventListener('resize', ajusta);
    vis.current.mostrar(0, Math.PI).then(() => setCargando(false));
    return () => { vivo = false; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('resize', ajusta); r.dispose(); g.dispose(); cache.forEach(p => p.then(t => t.dispose()).catch(() => {})); if (r.domElement.parentNode) r.domElement.parentNode.removeChild(r.domElement); };
  }, [datos]);

  // minimapa: las paradas por su posición en el plano
  const mapa = useMemo(() => {
    if (!datos) return null;
    const xs = datos.paradas.map(p => p.x), zs = datos.paradas.map(p => p.z), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const W = 150, H = 110, pad = 16, k = Math.min((W - pad * 2) / Math.max(0.01, x1 - x0), (H - pad * 2) / Math.max(0.01, z1 - z0), 60);
    const ox = (W - (x1 - x0) * k) / 2, oz = (H - (z1 - z0) * k) / 2;
    return { W, H, pt: p => [ox + (p.x - x0) * k, oz + (p.z - z0) * k] };
  }, [datos]);

  if (error) return <div style={{ minHeight: '100vh', background: OSCURO, color: '#fff', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}><div><div style={{ fontSize: 22, marginBottom: 8 }}>Ranuse Design</div><div style={{ opacity: 0.75 }}>{error}</div></div></div>;
  if (!datos) return <div style={{ minHeight: '100vh', background: OSCURO, color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif' }}>Cargando el tour…</div>;
  const par = datos.paradas[actual];
  return (
    <div style={{ position: 'fixed', inset: 0, background: OSCURO, color: '#fff', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>
      <div ref={cont} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {vecinos.map(({ p, i, d }) => (
          <button key={p.id} ref={e => { if (e) hot.current[i] = e; else delete hot.current[i]; }} onClick={() => ir(i, true)} title={'Ir a ' + p.nombre}
            style={{ position: 'absolute', left: 0, top: 0, display: 'none', flexDirection: 'column', alignItems: 'center', gap: 4, pointerEvents: 'auto', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}>
            <span style={{ width: 46, height: 46, borderRadius: '50%', border: '3px solid #fff', background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', fontSize: 22, boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>➤</span>
            <span style={{ fontSize: 12, background: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}>{p.nombre} · {d.toFixed(1)} m</span>
          </button>
        ))}
      </div>
      <a href={'/recorrido/' + encodeURIComponent(id) + '/' + encodeURIComponent(firma)} style={{ position: 'absolute', right: 14, top: 14, background: 'rgba(0,0,0,0.55)', color: '#fff', textDecoration: 'none', borderRadius: 20, padding: '8px 14px', fontSize: 13 }}>Caminar libremente</a>
      {cargando && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: '8px 16px', fontSize: 14 }}>Cargando…</div>}
      <div style={{ position: 'absolute', left: 16, top: 14, right: 16, pointerEvents: 'none', textShadow: '0 1px 6px rgba(0,0,0,0.7)' }}>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: ORO }}>Ranuse Design · {datos.titulo}</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{par.nombre}</div>
        {par.nota && <div style={{ fontSize: 14, opacity: 0.9, maxWidth: 520, marginTop: 4 }}>{par.nota}</div>}
      </div>
      <svg width={mapa.W} height={mapa.H} style={{ position: 'absolute', right: 14, bottom: 64, background: 'rgba(0,0,0,0.45)', borderRadius: 10 }}>
        {datos.paradas.map((p, i) => { const [x, y] = mapa.pt(p); return (
          <g key={p.id} transform={'translate(' + x + ',' + y + ')'} style={{ cursor: 'pointer' }} onClick={() => ir(i, false)}>
            <title>{p.nombre}</title>
            {i === actual && <line ref={cono} x1="0" y1="0" x2="0" y2="14" stroke={ORO} strokeWidth="3" strokeLinecap="round" />}
            <circle r={i === actual ? 6 : 5} fill={i === actual ? ORO : '#fff'} stroke="#000" strokeOpacity="0.5" />
            <circle r="13" fill="transparent" />
          </g>
        ); })}
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '8px 12px 12px', display: 'flex', gap: 8, overflowX: 'auto', background: 'linear-gradient(transparent, rgba(0,0,0,0.65))' }}>
        {datos.paradas.map((p, i) => (
          <button key={p.id} onClick={() => ir(i, false)} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, background: i === actual ? ORO : 'rgba(255,255,255,0.14)', color: i === actual ? '#000' : '#fff', border: 'none', borderRadius: 20, padding: '4px 12px 4px 4px', cursor: 'pointer', fontSize: 13 }}>
            <img src={p.thumb} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />{p.nombre}
          </button>
        ))}
      </div>
    </div>
  );
}
