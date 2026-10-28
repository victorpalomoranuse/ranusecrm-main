import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import api from '../services/api';

// Visor 3D de un plano de Planos (lee su modelo3d). Pensado para gimnasios: paredes con puertas y ventanas,
// suelos por sala, pilares y máquinas como bloques con sus medidas. Las medidas del plano van en cm.
const CM = 0.01;

function color(hex, def) {
  try { return new THREE.Color(hex || def); } catch { return new THREE.Color(def); }
}

function muro(m, h0) {
  const [ax, ay] = m.a, [bx, by] = m.b;
  const L = Math.hypot(bx - ax, by - ay);
  if (L < 1) return null;
  const alto = (m.h || h0) ;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(L, 0); sh.lineTo(L, alto); sh.lineTo(0, alto); sh.closePath();
  for (const o of m.ab || []) {
    const x0 = Math.max(0.5, Math.min(L - 1, o.p - o.w / 2));
    const x1 = Math.max(x0 + 1, Math.min(L - 0.5, o.p + o.w / 2));
    const y0 = Math.max(0, o.sill || 0);
    const y1 = Math.min(alto - 0.5, y0 + (o.h || 210));
    if (y1 <= y0) continue;
    const hole = new THREE.Path();
    hole.moveTo(x0, y0); hole.lineTo(x1, y0); hole.lineTo(x1, y1); hole.lineTo(x0, y1); hole.closePath();
    sh.holes.push(hole);
  }
  const t = m.t || 12;
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  g.scale(CM, CM, CM);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: m.estado === 'new' ? 0xf1ece6 : 0xe4e0db, roughness: 0.95 }));
  // El plano va en (x, y); en 3D, y del plano es z. El muro se dibuja a lo largo de X local y se gira hasta a→b.
  mesh.position.set(ax * CM, 0, ay * CM);
  mesh.rotation.y = -Math.atan2(by - ay, bx - ax);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function suelo(s) {
  const pts = (s.pts || []).map(p => new THREE.Vector2(p[0] * CM, p[1] * CM));
  if (pts.length < 3) return null;
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
  g.rotateX(Math.PI / 2); // el plano XY pasa a XZ (mirando hacia arriba)
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: color(s.suelo?.c, '#cfc9c2'), roughness: 0.85, side: THREE.DoubleSide }));
  mesh.position.y = 0.002;
  mesh.receiveShadow = true;
  return mesh;
}

function maquina(e) {
  const w = (e.largo || e.w || 100) * CM, d = (e.fondo || e.d || 100) * CM, h = (e.alto || 110) * CM;
  const g = new THREE.Group();
  const cuerpo = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: e.estado === 'ex' ? 0xb8b8b8 : 0x3a3f46, roughness: 0.55, metalness: 0.2 })
  );
  cuerpo.position.y = h / 2;
  cuerpo.castShadow = cuerpo.receiveShadow = true;
  g.add(cuerpo);
  g.position.set(e.cx * CM, 0, e.cy * CM);
  g.rotation.y = -(e.rot || 0) * Math.PI / 180;
  g.userData.nombre = e.nombre;
  return g;
}

export function planta(m, z0) {
  const g = new THREE.Group();
  g.position.y = (z0 || 0) * CM;
  (m.salas || []).forEach(s => { const x = suelo(s); if (x) g.add(x); });
  (m.muros || []).forEach(w => { const x = muro(w, m.altura || 260); if (x) g.add(x); });
  (m.pilares || []).forEach(p => {
    const h = (m.altura || 260) * CM;
    const x = new THREE.Mesh(new THREE.BoxGeometry(p.w * CM, h, p.d * CM), new THREE.MeshStandardMaterial({ color: 0xd8d4cf, roughness: 0.9 }));
    x.position.set(p.cx * CM, h / 2, p.cy * CM); x.castShadow = x.receiveShadow = true; g.add(x);
  });
  (m.equipos || []).forEach(e => g.add(maquina(e)));
  return g;
}

export default function Visor3D() {
  const { id } = useParams();
  const navigate = useNavigate();
  const caja = useRef(null);
  const [estado, setEstado] = useState('cargando');
  const [titulo, setTitulo] = useState('');
  const [calidad, setCalidad] = useState(() => { try { return localStorage.getItem('visor3dCalidad') || 'media'; } catch { return 'media'; } });
  const api3d = useRef({});

  useEffect(() => { document.title = 'Vista 3D · Ranuse'; }, []);

  useEffect(() => {
    const el = caja.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    el.appendChild(renderer.domElement);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeeeae5);
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    const ctrl = new OrbitControls(cam, renderer.domElement);
    ctrl.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8bf, 1.1));
    const sol = new THREE.DirectionalLight(0xffffff, 1.6);
    sol.castShadow = true;
    scene.add(sol);
    const raiz = new THREE.Group();
    scene.add(raiz);
    let raf = 0, vivo = true;
    const ajustar = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    const bucle = () => { if (!vivo) return; raf = requestAnimationFrame(bucle); ctrl.update(); renderer.render(scene, cam); };
    ajustar(); bucle();
    window.addEventListener('resize', ajustar);
    api3d.current = { renderer, scene, cam, ctrl, sol, raiz };

    api.get('/medicion/' + id).then(r => {
      if (!vivo) return;
      const pl = r.data?.plano;
      setTitulo(pl?.nombre || 'Plano');
      const modelo = pl?.modelo3d;
      if (!modelo) { setEstado('sin-modelo'); return; }
      const plantas = modelo.plantas || [modelo];
      plantas.forEach(p => raiz.add(planta(p, p.z)));
      const caja3 = new THREE.Box3().setFromObject(raiz);
      const c = caja3.getCenter(new THREE.Vector3()), s = caja3.getSize(new THREE.Vector3());
      const R = Math.max(s.x, s.z, 4);
      ctrl.target.copy(c);
      cam.position.set(c.x + R * 0.9, Math.max(R * 0.8, 6), c.z + R * 0.9);
      sol.position.set(c.x + R, R * 1.5, c.z + R * 0.5);
      sol.target.position.copy(c); scene.add(sol.target);
      const k = R * 1.2;
      Object.assign(sol.shadow.camera, { left: -k, right: k, top: k, bottom: -k, near: 0.5, far: R * 5 });
      sol.shadow.camera.updateProjectionMatrix();
      setEstado('listo');
    }).catch(() => { if (vivo) setEstado('error'); });

    return () => { vivo = false; cancelAnimationFrame(raf); window.removeEventListener('resize', ajustar); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [id]);

  // Calidad: en ordenadores sin tarjeta gráfica potente se baja la resolución y las sombras
  useEffect(() => {
    const a = api3d.current; if (!a.renderer) return;
    const q = { baja: [1, 0, 512], media: [Math.min(window.devicePixelRatio, 1.5), 1, 1024], alta: [window.devicePixelRatio, 1, 2048] }[calidad];
    a.renderer.setPixelRatio(q[0]);
    a.renderer.shadowMap.enabled = !!q[1];
    a.sol.castShadow = !!q[1];
    a.sol.shadow.mapSize.set(q[2], q[2]);
    a.sol.shadow.map?.dispose(); a.sol.shadow.map = null;
    a.raiz.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    a.renderer.setSize(caja.current.clientWidth, caja.current.clientHeight);
    try { localStorage.setItem('visor3dCalidad', calidad); } catch {}
  }, [calidad, estado]);

  const vista = tipo => {
    const { cam, ctrl, raiz } = api3d.current;
    const b = new THREE.Box3().setFromObject(raiz), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const R = Math.max(s.x, s.z, 4);
    ctrl.target.copy(c);
    if (tipo === 'planta') cam.position.set(c.x, R * 1.6, c.z + 0.01);
    else cam.position.set(c.x + R * 0.9, Math.max(R * 0.8, 6), c.z + R * 0.9);
  };
  const captura = () => {
    const { renderer, scene, cam } = api3d.current;
    renderer.render(scene, cam);
    const a = document.createElement('a');
    a.href = renderer.domElement.toDataURL('image/png');
    a.download = (titulo || 'plano') + '-3d.png';
    a.click();
  };

  const btn = { background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 };
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#eeeae5' }}>
      <div ref={caja} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={btn} onClick={() => (window.history.length > 1 ? navigate(-1) : window.close())}>← Volver</button>
        <b style={{ color: '#222', marginRight: 'auto' }}>{titulo}</b>
        <button style={btn} onClick={() => vista('persp')}>Perspectiva</button>
        <button style={btn} onClick={() => vista('planta')}>Planta</button>
        <select style={btn} value={calidad} onChange={e => setCalidad(e.target.value)} title="Si va lento, baja la calidad">
          <option value="baja">Calidad baja</option><option value="media">Calidad media</option><option value="alta">Calidad alta</option>
        </select>
        <button style={btn} onClick={captura}>📷 Captura</button>
      </div>
      {estado === 'cargando' && <p style={{ position: 'absolute', top: '45%', width: '100%', textAlign: 'center', color: '#555' }}>Cargando…</p>}
      {estado === 'sin-modelo' && <p style={{ position: 'absolute', top: '45%', width: '100%', textAlign: 'center', color: '#555' }}>Este plano todavía no tiene modelo 3D: ábrelo en Planos, dibuja algo y se guarda solo.</p>}
      {estado === 'error' && <p style={{ position: 'absolute', top: '45%', width: '100%', textAlign: 'center', color: '#a33' }}>No se ha podido cargar el plano.</p>}
    </div>
  );
}
