import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import api from '../services/api';

// Visor 3D de un plano de Planos (lee su modelo3d). Pensado para gimnasios: paredes con puertas y ventanas,
// suelos por sala, pilares y máquinas como bloques con sus medidas. Las medidas del plano van en cm.
const CM = 0.01;

// Texturas subidas: se descargan una vez y se reutilizan; la repetición se ajusta al tamaño real (cm) de cada textura
const cacheTex = new Map();
function texturaDe(t, uvEnCm) {
  const k = uvEnCm ? 1 / t.tam : 1 / (t.tam * CM);
  const clave = t.url + '|' + k;
  let x = cacheTex.get(clave);
  if (!x) {
    x = new THREE.TextureLoader().load(t.url);
    x.wrapS = x.wrapT = THREE.RepeatWrapping; x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = 4; x.repeat.set(k, k);
    cacheTex.set(clave, x);
  }
  return x;
}
// Aplica un color (#hex) o una textura ('tex:ID') a una malla; si no hay valor, vuelve a su color de origen
function pintar(mesh, valor, texturas, uvEnCm) {
  const u = mesh.userData;
  if (u.col0 === undefined) u.col0 = mesh.material.color.getHex();
  const t = valor && String(valor).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === valor) : null;
  if (t) { mesh.material.map = texturaDe(t, uvEnCm); mesh.material.color.setHex(0xffffff); }
  else { mesh.material.map = null; mesh.material.color.setHex(valor && /^#/.test(valor) ? parseInt(valor.slice(1), 16) : u.col0); }
  mesh.material.needsUpdate = true;
}

// Modelos 3D asignados a los productos: se descargan una vez y se reutilizan (se clonan) en cada copia
const cacheModelos = new Map();
function cargarModelo(m) {
  if (cacheModelos.has(m.url)) return cacheModelos.get(m.url);
  const t = String(m.tipo || '').toLowerCase();
  const p = new Promise((ok, mal) => {
    if (t === 'obj') new OBJLoader().load(m.url, ok, undefined, mal);
    else if (t === 'dae') new ColladaLoader().load(m.url, r => ok(r.scene), undefined, mal);
    else new GLTFLoader().load(m.url, r => ok(r.scene), undefined, mal);
  });
  p.catch(() => cacheModelos.delete(m.url));
  cacheModelos.set(m.url, p);
  return p;
}
// El modelo se escala (sin deformarlo) para que quepa en las medidas del objeto y se apoya en el suelo, centrado
function ajustarModelo(raw, w, d, h) {
  const g = raw.clone(true);
  const caja = new THREE.Box3().setFromObject(g);
  const s = caja.getSize(new THREE.Vector3());
  if (!(s.x > 0 && s.y > 0 && s.z > 0)) return null;
  const k = Math.min(w / s.x, h / s.y, d / s.z);
  const c = caja.getCenter(new THREE.Vector3());
  const envoltorio = new THREE.Group();
  g.position.set(-c.x, -caja.min.y, -c.z);
  envoltorio.add(g);
  envoltorio.scale.setScalar(k);
  envoltorio.traverse(x => { if (x.isMesh) { x.castShadow = x.receiveShadow = true; } });
  return envoltorio;
}

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
  mesh.userData = { capa: 'muros', muroId: m.id };
  // puertas y ventanas: marco y hoja (puerta) o cristal (ventana), en el hueco del muro (el muro está en metros y centrado en su grosor)
  for (const o of m.ab || []) {
    const x0 = Math.max(0.5, Math.min(L - 1, o.p - o.w / 2)), x1 = Math.max(x0 + 1, Math.min(L - 0.5, o.p + o.w / 2));
    const y0 = Math.max(0, o.sill || 0), y1 = Math.min(alto - 0.5, y0 + (o.h || 210));
    if (y1 <= y0) continue;
    const w = (x1 - x0) * CM, h = (y1 - y0) * CM, cx = ((x0 + x1) / 2) * CM, cy = ((y0 + y1) / 2) * CM, tt = (m.t || 12) * CM;
    const fr = 0.05, marco = new THREE.MeshStandardMaterial({ color: o.t === 'door' || o.tipo === 'door' ? 0x8a6a4a : 0xf2f2f2, roughness: 0.6 });
    const parte = (bw, bh, bd, px, py, mat, extra) => { const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat); b.position.set(px, py, 0); b.castShadow = true; b.userData = { capa: 'huecos', hueco: { muroId: m.id, id: o.id || null, p: o.p, w: o.w, h: o.h, sill: o.sill || 0, tipo: o.tipo || o.t }, ...(extra || {}) }; mesh.add(b); return b; };
    parte(w, fr, tt * 1.02, cx, y1 * CM - fr / 2, marco); parte(w, fr, tt * 1.02, cx, y0 * CM + fr / 2, marco);
    parte(fr, h, tt * 1.02, x0 * CM + fr / 2, cy, marco); parte(fr, h, tt * 1.02, x1 * CM - fr / 2, cy, marco);
    if ((o.tipo || o.t) === 'door') parte(w - fr * 2, h - fr * 2, 0.04, cx, cy, new THREE.MeshStandardMaterial({ color: 0xc9a77c, roughness: 0.55 }));
    else parte(w - fr * 2, h - fr * 2, 0.01, cx, cy, new THREE.MeshStandardMaterial({ color: 0xaed4ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35 }));
  }
  // El plano va en (x, y); en 3D, y del plano es z. El muro se dibuja a lo largo de X local y se gira hasta a→b.
  mesh.position.set(ax * CM, 0, ay * CM);
  mesh.rotation.y = -Math.atan2(by - ay, bx - ax);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function suelo(s, i) {
  const pts = (s.pts || []).map(p => new THREE.Vector2(p[0] * CM, p[1] * CM));
  if (pts.length < 3) return null;
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
  g.rotateX(Math.PI / 2); // el plano XY pasa a XZ (mirando hacia arriba)
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: color(s.suelo?.c, '#cfc9c2'), roughness: 0.85, side: THREE.DoubleSide }));
  mesh.position.y = 0.002;
  mesh.receiveShadow = true;
  mesh.userData = { capa: 'suelos', salaKey: s.idS || ('s' + i) };
  return mesh;
}

// Techo de una sala: una sola cara que mira hacia abajo, así desde arriba se ve el interior y desde dentro se ve el techo
function techo(s, i, alto) {
  const pts = (s.pts || []).map(p => new THREE.Vector2(p[0] * CM, p[1] * CM));
  if (pts.length < 3) return null;
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
  g.rotateX(Math.PI / 2);
  const h = ((s.techo && s.techo.h) || alto || 260) * CM;
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: color(s.techo?.c, '#f6f4f1'), roughness: 0.95, side: THREE.FrontSide }));
  mesh.position.y = h;
  mesh.receiveShadow = true;
  mesh.userData = { capa: 'techos', techoKey: s.idT || ('s' + i) };
  return mesh;
}

function maquina(e) {
  const w = (e.largo || e.w || 100) * CM, d = (e.fondo || e.d || 100) * CM, h = (e.alto || 110) * CM;
  const g = new THREE.Group();
  const cuerpo = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: e.estado === 'ex' ? 0xb8b8b8 : 0x2f6fa8, roughness: 0.5, metalness: 0.15 })
  );
  cuerpo.position.y = h / 2;
  cuerpo.castShadow = cuerpo.receiveShadow = true;
  g.add(cuerpo);
  g.position.set(e.cx * CM, 0, e.cy * CM);
  g.rotation.y = -(e.rot || 0) * Math.PI / 180;
  g.userData.capa = 'equipos';
  g.userData.equipo = e;
  g.userData.cuerpo = cuerpo;
  return g;
}

export function planta(m, z0) {
  const g = new THREE.Group();
  g.position.y = (z0 || 0) * CM;
  (m.salas || []).forEach((s, i) => { const x = suelo(s, i); if (x) g.add(x); const t = techo(s, i, m.altura); if (t) g.add(t); });
  (m.muros || []).forEach(w => { const x = muro(w, m.altura || 260); if (x) g.add(x); });
  (m.pilares || []).forEach(p => {
    const h = (m.altura || 260) * CM;
    const x = new THREE.Mesh(new THREE.BoxGeometry(p.w * CM, h, p.d * CM), new THREE.MeshStandardMaterial({ color: 0xd8d4cf, roughness: 0.9 }));
    x.position.set(p.cx * CM, h / 2, p.cy * CM); x.castShadow = x.receiveShadow = true; x.userData.capa = 'pilares'; g.add(x);
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
  const [seleccion, setSeleccion] = useState(null);
  const [objs, setObjs] = useState([]);            // objetos de la escena 3D
  const objsRef = useRef([]);
  const [selObj, setSelObj] = useState(null);      // id del objeto seleccionado
  const [herr, setHerr] = useState('sel');         // 'sel' | 'caja'
  const herrRef = useRef('sel');
  const [bibAbierta, setBibAbierta] = useState(false);
  const [biblioteca, setBiblioteca] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [guardado, setGuardado] = useState('');
  const cargadaEscena = useRef(false);
  const [acab, setAcab] = useState({ muros: {}, salas: {}, techos: {}, todosMuros: null, todosSuelos: null, todosTechos: null });
  const [texturas, setTexturas] = useState([]);
  const [selHueco, setSelHueco] = useState(null); // hueco del plano seleccionado, con sus medidas nuevas
  const [eqNuevo, setEqNuevo] = useState(null);     // medidas nuevas del equipo del plano seleccionado
  const [aviso, setAviso] = useState('');
  const [paleta, setPaleta] = useState([]);
  const [matAbierto, setMatAbierto] = useState(false);
  const [matSel, setMatSel] = useState(null);      // { hex } o { id } (textura)
  const matSelRef = useRef(null);
  useEffect(() => { matSelRef.current = matSel; }, [matSel]);
  const [selAcab, setSelAcab] = useState(null);  // { tipo: 'muro' | 'suelo', id }
  const [rev, setRev] = useState(0);             // sube cada vez que se rehace el plano 3D
  const [capasAbierto, setCapasAbierto] = useState(false);
  const [ocultas, setOcultas] = useState(() => { try { return JSON.parse(localStorage.getItem('visor3dOcultas') || '[]'); } catch { return []; } });
  const selAcabRef = useRef(null);
  useEffect(() => { selAcabRef.current = selAcab; }, [selAcab]);
  useEffect(() => { objsRef.current = objs; }, [objs]);
  useEffect(() => { herrRef.current = herr; }, [herr]);

  useEffect(() => { document.title = 'Vista 3D · Ranuse'; }, []);

  useEffect(() => {
    const el = caja.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    el.appendChild(renderer.domElement);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    {
      const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
      const cx = cv.getContext('2d'), gr = cx.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#8db6dc'); gr.addColorStop(0.55, '#d8e6ef'); gr.addColorStop(1, '#efe9e0');
      cx.fillStyle = gr; cx.fillRect(0, 0, 2, 256);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
    }
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    const ctrl = new OrbitControls(cam, renderer.domElement);
    ctrl.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8bf, 1.1));
    const sol = new THREE.DirectionalLight(0xffffff, 1.6);
    sol.castShadow = true;
    scene.add(sol);
    const raiz = new THREE.Group();
    scene.add(raiz);
    const esc = new THREE.Group(); // objetos colocados en el visor (biblioteca y cajas)
    scene.add(esc);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0xd9d4cd, roughness: 1 }));
    base.rotation.x = -Math.PI / 2; base.position.y = -0.02; base.receiveShadow = true;
    scene.add(base);
    let raf = 0, vivo = true;
    const ajustar = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    const bucle = () => { if (!vivo) return; raf = requestAnimationFrame(bucle); ctrl.update(); renderer.render(scene, cam); };
    ajustar(); bucle();
    window.addEventListener('resize', ajustar);
    api3d.current = { renderer, scene, cam, ctrl, sol, raiz, esc, base, el };

    let ultima = null, primera = true;
    const cargar = () => api.get('/medicion/' + id).then(r => {
      if (!vivo) return;
      const pl = r.data?.plano;
      if (!primera && pl?.updated === ultima) return; // sin cambios en el plano
      ultima = pl?.updated;
      setTitulo(pl?.nombre || 'Plano');
      if (primera && !cargadaEscena.current) { cargadaEscena.current = true; setGuardado('inicial'); setObjs(pl?.escena3d?.objetos || []); const ac = pl?.escena3d?.acabados; if (ac) setAcab({ muros: ac.muros || {}, salas: ac.salas || {}, techos: ac.techos || {}, todosMuros: ac.todosMuros || null, todosSuelos: ac.todosSuelos || null, todosTechos: ac.todosTechos || null }); setTexturas(pl?.escena3d?.texturas || []); setPaleta(pl?.escena3d?.paleta || []); }
      const modelo = pl?.modelo3d || { muros: [], salas: [], pilares: [], equipos: [], altura: 260 };
      // se rehace el modelo con los datos nuevos, sin mover la cámara
      sel = null; setSeleccion(null);
      while (raiz.children.length) { const o = raiz.children[0]; raiz.remove(o); o.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); }
      const plantas = modelo.plantas || [modelo];
      plantas.forEach(p => raiz.add(planta(p, p.z)));
      if (primera) {
        const caja3 = new THREE.Box3().setFromObject(raiz);
        const vacio = caja3.isEmpty();
        const c = vacio ? new THREE.Vector3(4, 0, 3) : caja3.getCenter(new THREE.Vector3()), s = vacio ? new THREE.Vector3(8, 0, 6) : caja3.getSize(new THREE.Vector3());
        const R = Math.max(s.x, s.z, 4);
        ctrl.target.copy(c);
        cam.position.set(c.x + R * 0.9, Math.max(R * 0.8, 6), c.z + R * 0.9);
        sol.position.set(c.x + R, R * 1.5, c.z + R * 0.5);
        sol.target.position.copy(c); scene.add(sol.target);
        const k = R * 1.2;
        Object.assign(sol.shadow.camera, { left: -k, right: k, top: k, bottom: -k, near: 0.5, far: R * 5 });
        sol.shadow.camera.updateProjectionMatrix();
        setEstado('listo');
      }
      setRev(v => v + 1);
      primera = false;
    }).catch(() => { if (vivo && primera) setEstado('error'); });
    cargar();
    api3d.current.recargar = () => { ultima = null; return cargar(); };
    // El plano se edita en otra pestaña: se mira si ha cambiado cada pocos segundos
    const reloj = setInterval(() => { if (!document.hidden) cargar(); }, 6000);

    // Clic en una máquina: se resalta y se enseña su ficha
    let sel = null;
    const rayo = new THREE.Raycaster(), p2 = new THREE.Vector2();
    let abajo = null;
    const dom = renderer.domElement;
    const onDown = e => { abajo = [e.clientX, e.clientY]; };
    const onUp = e => {
      if (herrRef.current === 'caja') return;
      if (!abajo || Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) > 4) return; // fue arrastre, no clic
      const r = dom.getBoundingClientRect();
      p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(p2, cam);
      const visible = o => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
      if (herrRef.current === 'pincel') {
        const h = rayo.intersectObjects([...raiz.children, ...esc.children], true).find(x => visible(x.object));
        if (h) aplicarPincel(h, e.shiftKey);
        return;
      }
      const primero = rayo.intersectObjects(raiz.children, true).find(h => visible(h.object));
      if (sel) sel.userData.cuerpo.material.emissive.setHex(0x000000);
      sel = null;
      setSelHueco(null);
      const uh = primero?.object?.userData?.hueco;
      if (uh) { setSelHueco({ ...uh, nuevo: { w: uh.w, h: uh.h, sill: uh.sill, p: uh.p } }); setSeleccion(null); setSelAcab(null); setSelObj(null); return; }
      let eq = null; if (primero) { let o = primero.object; while (o && !o.userData.equipo) o = o.parent; eq = o; }
      if (eq) { sel = eq; eq.userData.cuerpo.material.emissive.setHex(0x335577); setSeleccion(eq.userData.equipo); setEqNuevo({ w: eq.userData.equipo.largo || eq.userData.equipo.w, d: eq.userData.equipo.fondo || eq.userData.equipo.d, rot: eq.userData.equipo.rot || 0 }); setSelAcab(null); }
      else {
        setSeleccion(null);
        const u = primero?.object?.userData || {};
        if (u.muroId) { setSelAcab({ tipo: 'muro', id: u.muroId }); setSelObj(null); }
        else if (u.salaKey) { setSelAcab({ tipo: 'suelo', id: u.salaKey }); setSelObj(null); }
        else setSelAcab(null);
      }
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);

    // Diseño: mover objetos y dibujar cajas sobre el suelo
    const suelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt = new THREE.Vector3();
    const snap = v => Math.round(v / 5) * 5;
    const puntoSuelo = e => {
      const r = dom.getBoundingClientRect();
      p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(p2, cam);
      return rayo.ray.intersectPlane(suelo, pt) ? { x: snap(pt.x / CM), y: snap(pt.z / CM) } : null;
    };
    const objetoBajo = e => {
      const r = dom.getBoundingClientRect();
      p2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      rayo.setFromCamera(p2, cam);
      const h = rayo.intersectObjects(esc.children, true)[0];
      let o = h?.object; while (o && !o.userData.oid) o = o.parent;
      return o && o.visible ? o : null;
    };
    let arrastre = null, trazo = null, previa = null;
    const aplicarPincel = (hit, todos) => {
      const mat = matSelRef.current; if (!mat) return;
      const valor = mat.hex || ('tex:' + mat.id);
      const u = hit.object.userData;
      if (u.muroId) setAcab(a => (todos ? { ...a, muros: {}, todosMuros: valor } : { ...a, muros: { ...a.muros, [u.muroId]: valor } }));
      else if (u.salaKey) setAcab(a => (todos ? { ...a, salas: {}, todosSuelos: valor } : { ...a, salas: { ...a.salas, [u.salaKey]: valor } }));
      else if (u.techoKey) setAcab(a => (todos ? { ...a, techos: {}, todosTechos: valor } : { ...a, techos: { ...a.techos, [u.techoKey]: valor } }));
      else { let o = hit.object; while (o && !o.userData.oid) o = o.parent; if (o) setObjs(prev => prev.map(x => (x.id === o.userData.oid ? { ...x, color: valor } : x))); }
    };
    const onDownD = e => {
      if (e.button !== 0) return;
      if (herrRef.current === 'pincel') return;
      if (herrRef.current === 'caja') {
        const p = puntoSuelo(e); if (!p) return;
        ctrl.enabled = false; trazo = p;
        previa = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x2f6fa8, transparent: true, opacity: 0.45 }));
        scene.add(previa); e.stopPropagation(); return;
      }
      const o = objetoBajo(e);
      if (!o) return;
      const ob = objsRef.current.find(x => x.id === o.userData.oid); if (!ob) return;
      setSelObj(ob.id); setSelAcab(null);
      const p = puntoSuelo(e); if (!p) return;
      ctrl.enabled = false; arrastre = { id: ob.id, dx: ob.cx - p.x, dy: ob.cy - p.y, mov: false };
      e.stopPropagation();
    };
    const onMoveD = e => {
      if (trazo && previa) {
        const p = puntoSuelo(e); if (!p) return;
        const w = Math.max(5, Math.abs(p.x - trazo.x)), d = Math.max(5, Math.abs(p.y - trazo.y));
        previa.scale.set(w * CM, 1, d * CM); previa.position.set((p.x + trazo.x) / 2 * CM, 0.5, (p.y + trazo.y) / 2 * CM);
      } else if (arrastre) {
        const p = puntoSuelo(e); if (!p) return;
        arrastre.mov = true;
        const o = esc.children.find(x => x.userData.oid === arrastre.id);
        if (o) { o.position.x = (p.x + arrastre.dx) * CM; o.position.z = (p.y + arrastre.dy) * CM; arrastre.cx = p.x + arrastre.dx; arrastre.cy = p.y + arrastre.dy; }
      }
    };
    const onUpD = e => {
      if (trazo) {
        const p = puntoSuelo(e);
        scene.remove(previa); previa.geometry.dispose(); previa.material.dispose(); previa = null;
        const t = trazo; trazo = null; ctrl.enabled = true;
        if (p && Math.abs(p.x - t.x) >= 10 && Math.abs(p.y - t.y) >= 10) {
          const nuevo = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tipo: 'caja', nombre: 'Caja', cx: (p.x + t.x) / 2, cy: (p.y + t.y) / 2, rot: 0, w: Math.abs(p.x - t.x), d: Math.abs(p.y - t.y), alto: 100, z0: 0, color: '#9aa3ad' };
          setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id); setHerr('sel');
        }
      } else if (arrastre) {
        const a = arrastre; arrastre = null; ctrl.enabled = true;
        if (a.mov && a.cx != null) setObjs(prev => prev.map(x => x.id === a.id ? { ...x, cx: a.cx, cy: a.cy } : x));
      }
    };
    el.addEventListener('pointerdown', onDownD, true);
    window.addEventListener('pointermove', onMoveD);
    window.addEventListener('pointerup', onUpD);

    return () => { el.removeEventListener('pointerdown', onDownD, true); window.removeEventListener('pointermove', onMoveD); window.removeEventListener('pointerup', onUpD); vivo = false; clearInterval(reloj); dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('pointerup', onUp); cancelAnimationFrame(raf); window.removeEventListener('resize', ajustar); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [id]);

  // Colores de muros y suelos (cambian sin rehacer el plano)
  // (ver versión con texturas más abajo)
  useEffect(() => {
    const a = api3d.current; if (!a.raiz) return;
    a.raiz.traverse(o => {
      if (!o.isMesh) return;
      const u = o.userData;
      if (u.muroId) pintar(o, acab.muros[u.muroId] || acab.todosMuros, texturas, true);
      else if (u.salaKey) pintar(o, acab.salas[u.salaKey] || acab.todosSuelos, texturas, false);
      else if (u.techoKey) pintar(o, acab.techos[u.techoKey] || acab.todosTechos, texturas, false);
    });
  }, [acab, rev, estado, texturas]);

  // Capas (etiquetas): se ven u ocultan grupos de elementos
  useEffect(() => {
    const a = api3d.current; if (!a.raiz) return;
    const aplica = o => { if (o.userData.capa) o.visible = !ocultas.includes(o.userData.capa); };
    a.raiz.traverse(aplica);
    a.esc.children.forEach(g => { g.visible = !ocultas.includes('obj:' + (objsRef.current.find(x => x.id === g.userData.oid)?.etiqueta || '')); });
    try { localStorage.setItem('visor3dOcultas', JSON.stringify(ocultas)); } catch {}
  }, [ocultas, rev, objs, estado]);

  // Los objetos de la escena se pintan a partir de la lista
  useEffect(() => {
    const a = api3d.current; if (!a.esc) return;
    while (a.esc.children.length) { const o = a.esc.children[0]; a.esc.remove(o); o.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); }
    objs.forEach(o => {
      const w = o.w * CM, d = o.d * CM, h = o.alto * CM;
      const g = new THREE.Group();
      const mod = modeloDe(o);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: color(/^#/.test(o.color || '') ? o.color : null, o.tipo === 'caja' ? '#9aa3ad' : '#2f6fa8'), roughness: 0.55, metalness: o.tipo === 'caja' ? 0 : 0.15, emissive: o.id === selObj ? 0x335577 : 0x000000, transparent: !!mod, opacity: mod ? 0.18 : 1 }));
      m.position.y = h / 2 + (o.z0 || 0) * CM; m.castShadow = !mod; m.receiveShadow = !mod;
      const tx = o.color && String(o.color).startsWith('tex:') ? texturas.find(x => 'tex:' + x.id === o.color) : null;
      if (tx) { const mp = texturaDe(tx, true).clone(); mp.needsUpdate = true; mp.repeat.set(Math.max(0.2, o.w / tx.tam), Math.max(0.2, o.alto / tx.tam)); m.material.map = mp; m.material.color.setHex(0xffffff); }
      g.add(m);
      if (mod) {
        // mientras baja el modelo se ve la caja fantasma; después, el modelo real en su lugar
        cargarModelo(mod).then(raw => {
          if (!g.parent) return; // el objeto ya no está en la escena
          const mm = ajustarModelo(raw, w, d, h);
          if (!mm) return;
          mm.rotation.y = -((mod.rot || 0) + (o.rotM || 0)) * Math.PI / 180;
          mm.position.y = (o.z0 || 0) * CM;
          g.add(mm); m.material.opacity = 0; m.material.needsUpdate = true;
        }).catch(() => { m.material.opacity = 1; m.material.transparent = false; m.material.needsUpdate = true; });
      }
      if (o.id === selObj) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x1b6dd6 })); l.position.copy(m.position); g.add(l); }
      g.position.set(o.cx * CM, 0, o.cy * CM); g.rotation.y = -(o.rot || 0) * Math.PI / 180;
      g.userData.oid = o.id;
      g.visible = !ocultas.includes('obj:' + (o.etiqueta || ''));
      a.esc.add(g);
    });
  }, [objs, selObj, estado, biblioteca, ocultas, texturas]);

  // Guardado automático de la escena (sin pisar el dibujo del plano 2D)
  useEffect(() => {
    if (!cargadaEscena.current || estado !== 'listo') return;
    if (guardado === 'inicial') { setGuardado(''); return; }
    setGuardado('Guardando…');
    const t = setTimeout(() => {
      api.put('/medicion/' + id + '/escena3d', { objetos: objs, acabados: acab, paleta }).then(() => setGuardado('Guardado ✓')).catch(() => setGuardado('No se pudo guardar'));
    }, 1200);
    return () => clearTimeout(t);
  }, [objs, acab, paleta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/medicion/catalogos').then(r => setBiblioteca((r.data?.maquinas || []).filter(m => m.w > 0 && m.d > 0))).catch(() => setBiblioteca([]));
  }, []);
  const modeloDe = o => (o.cid && biblioteca?.find(m => m.id === o.cid)?.modelo3d) || null;

  const anadirBloque = m => {
    const { ctrl } = api3d.current;
    const nuevo = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), tipo: 'bloque', cid: m.id, nombre: m.nombre, cx: Math.round(ctrl.target.x / CM / 5) * 5, cy: Math.round(ctrl.target.z / CM / 5) * 5, rot: 0, w: m.w, d: m.d, alto: m.alto || 110, z0: 0, color: null, skp: m.skp || null };
    setObjs(prev => [...prev, nuevo]); setSelObj(nuevo.id); setHerr('sel');
  };
  const cambiar = (idObj, campos) => setObjs(prev => prev.map(o => o.id === idObj ? { ...o, ...campos } : o));
  const borrar = idObj => { setObjs(prev => prev.filter(o => o.id !== idObj)); setSelObj(null); };
  const duplicar = idObj => {
    const o = objs.find(x => x.id === idObj); if (!o) return;
    const n = { ...o, id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), cx: o.cx + 30, cy: o.cy + 30 };
    setObjs(prev => [...prev, n]); setSelObj(n.id);
  };
  const objSel = objs.find(o => o.id === selObj) || null;
  const AVISO_PLANO = 'Guardado en el plano ✓. Si tienes Planos abierto en otra pestaña, recárgalo: si no, al guardar allí se perdería este cambio.';
  const aplicarHueco = async () => {
    if (!selHueco) return;
    try {
      await api.patch('/medicion/' + id + '/hueco', { opId: selHueco.id || undefined, muroId: selHueco.muroId, p0: selHueco.p, w0: selHueco.w, cambios: selHueco.nuevo });
      setSelHueco(null); setAviso(AVISO_PLANO); api3d.current.recargar?.();
    } catch (e) { setAviso(e.response?.data?.error || 'No se pudo cambiar el hueco'); }
  };
  const aplicarEquipo = async () => {
    if (!seleccion || !eqNuevo) return;
    try {
      await api.patch('/medicion/' + id + '/equipo', { eqId: seleccion.id, cambios: eqNuevo });
      setSeleccion(null); setAviso(AVISO_PLANO); api3d.current.recargar?.();
    } catch (e) { setAviso(e.response?.data?.error || 'No se pudo cambiar el equipo'); }
  };
  const [subiendo, setSubiendo] = useState('');
  const asignarModelo = async (archivo) => {
    if (!archivo || !objSel?.cid) return;
    if (/\.skp$/i.test(archivo.name)) { alert('Los archivos .skp de SketchUp no se pueden mostrar en el navegador. En SketchUp: Archivo → Exportar → Modelo 3D, y elige glTF (.glb) o COLLADA (.dae). Sube ese archivo.'); return; }
    setSubiendo('Subiendo el modelo…');
    try {
      const fd = new FormData(); fd.append('file', archivo);
      const r = await api.post('/catalog/products/' + objSel.cid + '/modelo3d', fd);
      const nuevo = r.data?.modelo3d;
      setBiblioteca(prev => (prev || []).map(m => m.id === objSel.cid ? { ...m, modelo3d: { url: nuevo.url, tipo: nuevo.tipo, rot: nuevo.rot } } : m));
      setSubiendo('Modelo asignado ✓ (vale para todas las copias de este producto)');
    } catch (e) { setSubiendo(e.response?.data?.error || 'No se pudo subir el modelo'); }
  };
  const quitarModelo = async () => {
    if (!objSel?.cid) return;
    try { await api.delete('/catalog/products/' + objSel.cid + '/modelo3d'); setBiblioteca(prev => (prev || []).map(m => m.id === objSel.cid ? { ...m, modelo3d: null } : m)); setSubiendo('Modelo quitado'); }
    catch { setSubiendo('No se pudo quitar'); }
  };

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
  // Render: una sola imagen grande con sombras suaves y de alta resolución (aunque el ordenador sea flojo, es un único fotograma)
  const [renderizando, setRenderizando] = useState(false);
  const renderAlta = () => {
    const { renderer, scene, cam, sol } = api3d.current;
    setRenderizando(true);
    setTimeout(() => {
      const el = caja.current, w0 = el.clientWidth, h0 = el.clientHeight, pr0 = renderer.getPixelRatio();
      const sombra = sol.castShadow, mapa = sol.shadow.mapSize.x;
      try {
        const W = 3200, H = Math.round(W * h0 / w0);
        renderer.setPixelRatio(1);
        renderer.setSize(W, H, false);
        cam.aspect = W / H; cam.updateProjectionMatrix();
        renderer.shadowMap.enabled = true; sol.castShadow = true;
        sol.shadow.mapSize.set(4096, 4096); sol.shadow.map?.dispose(); sol.shadow.map = null; sol.shadow.radius = 4;
        renderer.render(scene, cam);
        const a = document.createElement('a');
        a.href = renderer.domElement.toDataURL('image/png');
        a.download = (titulo || 'plano') + '-render.png';
        a.click();
      } catch (e) { alert('No se ha podido generar el render: ' + e.message + '. Prueba a bajar la calidad.'); }
      finally {
        renderer.setPixelRatio(pr0); renderer.setSize(w0, h0);
        cam.aspect = w0 / h0; cam.updateProjectionMatrix();
        sol.castShadow = sombra; sol.shadow.mapSize.set(mapa, mapa); sol.shadow.map?.dispose(); sol.shadow.map = null;
        setRenderizando(false);
      }
    }, 60);
  };
  // Render fotorrealista con IA: se manda la vista actual y vuelve mejorada
  const [ia, setIa] = useState(null); // { estado: 'trabajando' | 'listo' | 'error', imagen, mensaje, estancia, estilo, extra }
  const [iaForm, setIaForm] = useState(false);
  const [iaTxt, setIaTxt] = useState({ estancia: '', estilo: '', extra: '', libertad: 'equilibrado' });
  const renderIA = async () => {
    const { renderer, scene, cam } = api3d.current;
    setIaForm(false);
    setIa({ estado: 'trabajando' });
    try {
      const el = caja.current, w0 = el.clientWidth, h0 = el.clientHeight, pr0 = renderer.getPixelRatio();
      const W = 2048, H = Math.round(W * h0 / w0);
      renderer.setPixelRatio(1); renderer.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      const imagen = renderer.domElement.toDataURL('image/jpeg', 0.95);
      renderer.setPixelRatio(pr0); renderer.setSize(w0, h0); cam.aspect = w0 / h0; cam.updateProjectionMatrix();
      const r = await api.post('/render-ia', { imagen, ...iaTxt }, { timeout: 180000 });
      setIa({ estado: 'listo', imagen: r.data.imagen, original: imagen });
    } catch (e) {
      setIa({ estado: 'error', mensaje: e.response?.data?.error || 'No se ha podido generar el render con IA' });
    }
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
      <div ref={caja} style={{ position: 'absolute', inset: 0, cursor: herr === 'pincel' ? 'crosshair' : 'default' }} />
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={btn} onClick={() => (window.history.length > 1 ? navigate(-1) : window.close())}>← Volver</button>
        <b style={{ color: '#222', marginRight: 'auto' }}>{titulo}</b>
        <button style={{ ...btn, ...(herr === 'sel' ? { background: '#2f6fa8' } : {}) }} onClick={() => setHerr('sel')} title="Seleccionar y mover objetos">↖ Mover</button>
        <button style={{ ...btn, ...(herr === 'caja' ? { background: '#2f6fa8' } : {}) }} onClick={() => setHerr('caja')} title="Arrastra sobre el suelo para dibujar una caja; luego le das altura">▭ Dibujar caja</button>
        <button style={{ ...btn, ...(bibAbierta ? { background: '#2f6fa8' } : {}) }} onClick={() => setBibAbierta(v => !v)}>📚 Biblioteca</button>
        <button style={{ ...btn, ...(capasAbierto ? { background: '#2f6fa8' } : {}) }} onClick={() => setCapasAbierto(v => !v)}>🏷 Capas</button>
        <button style={{ ...btn, ...(matAbierto || herr === 'pincel' ? { background: '#2f6fa8' } : {}) }} onClick={() => { setMatAbierto(v => !v); if (matAbierto && herr === 'pincel') setHerr('sel'); }}>🎨 Materiales</button>
        {guardado && guardado !== 'inicial' && <span style={{ color: '#555', fontSize: 12 }}>{guardado}</span>}
        <button style={btn} onClick={() => vista('persp')}>Perspectiva</button>
        <button style={btn} onClick={() => vista('planta')}>Planta</button>
        <select style={btn} value={calidad} onChange={e => setCalidad(e.target.value)} title="Si va lento, baja la calidad">
          <option value="baja">Calidad baja</option><option value="media">Calidad media</option><option value="alta">Calidad alta</option>
        </select>
        <button style={btn} onClick={captura}>📷 Captura</button>
        <button style={{ ...btn, background: '#7a4fc4', borderColor: '#7a4fc4' }} onClick={() => setIaForm(true)} disabled={estado !== 'listo' || ia?.estado === 'trabajando'} title="La IA convierte esta vista en una foto realista">✨ Render con IA</button>
        <button style={{ ...btn, background: '#2f6fa8', borderColor: '#2f6fa8' }} onClick={renderAlta} disabled={renderizando || estado !== 'listo'} title="Imagen grande con sombras suaves (3200 px)">{renderizando ? 'Renderizando…' : '🖼 Render HD'}</button>
      </div>
      {iaForm && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 5 }}>
          <div style={{ background: '#1d1d1d', color: '#fff', borderRadius: 10, padding: 18, width: 380, fontSize: 13 }}>
            <b style={{ fontSize: 15 }}>Render fotorrealista con IA</b>
            <p style={{ opacity: 0.7, margin: '6px 0 10px' }}>Se manda lo que ves ahora en pantalla. Colócate bien la cámara antes.</p>
            {[['estancia', 'Estancia (ej. salón, gimnasio privado)'], ['estilo', 'Estilo (ej. moderno, cálido, minimalista)'], ['extra', 'Algo más (ej. luz de tarde, suelo de roble claro)']].map(([k, ph]) => (
              <input key={k} value={iaTxt[k]} onChange={e => setIaTxt(t => ({ ...t, [k]: e.target.value }))} placeholder={ph} style={{ ...btn, width: '100%', boxSizing: 'border-box', marginBottom: 6 }} />
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ opacity: 0.7 }}>Libertad de la IA</span>
              <select value={iaTxt.libertad} onChange={e => setIaTxt(t => ({ ...t, libertad: e.target.value }))} style={btn}>
                <option value="fiel">Fiel al modelo (solo pule)</option>
                <option value="equilibrado">Equilibrado (añade ambiente y luz)</option>
                <option value="creativo">Creativo (decora con criterio)</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button style={btn} onClick={() => setIaForm(false)}>Cancelar</button>
              <button style={{ ...btn, background: '#7a4fc4', borderColor: '#7a4fc4' }} onClick={renderIA}>Generar</button>
            </div>
          </div>
        </div>
      )}
      {ia && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'grid', placeItems: 'center', zIndex: 6, padding: 16 }}>
          <div style={{ background: '#1d1d1d', color: '#fff', borderRadius: 10, padding: 16, maxWidth: '92vw', maxHeight: '92vh', overflow: 'auto', fontSize: 13 }}>
            {ia.estado === 'trabajando' && <p>Generando el render con IA… puede tardar un minuto.</p>}
            {ia.estado === 'error' && <><p style={{ color: '#ff9b9b' }}>{ia.mensaje}</p><button style={btn} onClick={() => setIa(null)}>Cerrar</button></>}
            {ia.estado === 'listo' && <>
              <img src={ia.imagen} alt="Render con IA" style={{ maxWidth: '86vw', maxHeight: '72vh', display: 'block', borderRadius: 6 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <a style={{ ...btn, textDecoration: 'none' }} href={ia.imagen} download={(titulo || 'plano') + '-render-ia.png'}>Descargar</a>
                <button style={btn} onClick={() => setIa(null)}>Cerrar</button>
              </div>
            </>}
          </div>
        </div>
      )}
      {capasAbierto && (() => {
        const fijas = [['muros', 'Muros'], ['huecos', 'Puertas y ventanas'], ['suelos', 'Suelos'], ['techos', 'Techos'], ['pilares', 'Pilares'], ['equipos', 'Equipos del plano']];
        const propias = [...new Set(objs.map(o => o.etiqueta || ''))];
        const fila = (clave, nombre) => (
          <label key={clave} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={!ocultas.includes(clave)} onChange={() => setOcultas(o => (o.includes(clave) ? o.filter(x => x !== clave) : [...o, clave]))} /> {nombre}
          </label>
        );
        return (
          <div style={{ position: 'absolute', left: bibAbierta ? 292 : 12, top: 56, width: 210, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: '10px 12px', fontSize: 13, zIndex: 3 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Ver por capas</div>
            {fijas.map(([k, n]) => fila(k, n))}
            {propias.length > 0 && <div style={{ borderTop: '1px solid #333', marginTop: 6, paddingTop: 6, opacity: 0.7 }}>Tus objetos</div>}
            {propias.map(t => fila('obj:' + t, t || 'Sin etiqueta'))}
          </div>
        );
      })()}
      {aviso && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', maxWidth: 560, background: 'rgba(20,20,20,0.95)', color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: 13, zIndex: 7, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>{aviso}</span><button style={btn} onClick={() => setAviso('')}>OK</button>
        </div>
      )}
      {selHueco && (
        <div style={{ position: 'absolute', right: 12, top: 56, width: 250, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{selHueco.tipo === 'door' ? 'Puerta' : selHueco.tipo === 'win' ? 'Ventana' : 'Hueco'} del plano</div>
          {[['w', 'Ancho'], ['h', 'Alto'], ['sill', 'Antepecho'], ['p', 'Posición']].map(([k, et]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 70, opacity: 0.7 }}>{et} cm</span>
              <input type="number" value={selHueco.nuevo[k]} onChange={e => setSelHueco(s => ({ ...s, nuevo: { ...s.nuevo, [k]: e.target.value } }))} style={{ ...btn, width: 90 }} />
            </label>
          ))}
          <div style={{ opacity: 0.55, fontSize: 11, margin: '4px 0 8px' }}>Posición = distancia desde el inicio del muro hasta el centro del hueco. Se cambia también en el plano 2D.</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...btn, background: '#2f6fa8' }} onClick={aplicarHueco}>Aplicar al plano</button>
            <button style={btn} onClick={() => setSelHueco(null)}>Cerrar</button>
          </div>
        </div>
      )}
      {matAbierto && (() => {
        const base = ['#ffffff', '#f4f1ec', '#e8e2d8', '#d9cfc0', '#c9b9a0', '#b8a58c', '#a9b5a1', '#8fa3a8', '#7d8e9c', '#9d9a96', '#6e6a66', '#3a3a3c', '#c9a77c', '#8a6a4a', '#d9a7a0', '#b5695e'];
        const elegir = m => { setMatSel(m); setHerr('pincel'); };
        const esSel = m => matSel && ((m.hex && matSel.hex === m.hex) || (m.id && matSel.id === m.id));
        const anadirColor = () => {
          const nombre = (document.getElementById('mat-nombre')?.value || '').trim();
          const hex = document.getElementById('mat-hex')?.value;
          if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
          setPaleta(p => [...p, { nombre: nombre || hex, hex }]);
          const e = document.getElementById('mat-nombre'); if (e) e.value = '';
        };
        const subir = async (archivo) => {
          if (!archivo) return;
          const tam = parseFloat(document.getElementById('mat-tam')?.value) || 60;
          setGuardado('Subiendo textura…');
          try {
            const fd = new FormData(); fd.append('file', archivo); fd.append('tam', String(tam));
            const r = await api.post('/medicion/' + id + '/textura', fd);
            setTexturas(t => [...t, r.data.textura]); setGuardado('Textura subida ✓');
          } catch (e) { setGuardado(e.response?.data?.error || 'No se pudo subir la textura'); }
        };
        const quitarTex = async (t) => {
          try { await api.delete('/medicion/' + id + '/textura/' + t.id); setTexturas(x => x.filter(y => y.id !== t.id)); if (matSel?.id === t.id) setMatSel(null); } catch { setGuardado('No se pudo quitar'); }
        };
        return (
          <div style={{ position: 'absolute', left: 12 + (bibAbierta ? 280 : 0) + (capasAbierto ? 222 : 0), top: 56, bottom: 12, width: 270, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: 10, overflow: 'auto', fontSize: 13, zIndex: 3 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>🎨 Materiales (pincel)</div>
            <div style={{ opacity: 0.65, fontSize: 11, marginBottom: 8 }}>Elige un material y haz clic en un muro, suelo, techo u objeto. Con Mayús + clic se aplica a todos los de ese tipo.</div>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Colores</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {base.map(c => <span key={c} onClick={() => elegir({ hex: c })} title={c} style={{ width: 24, height: 24, background: c, borderRadius: 4, cursor: 'pointer', border: esSel({ hex: c }) ? '2px solid #4da3ff' : '1px solid #555' }} />)}
            </div>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Tu paleta (NCS, RAL, marcas…)</div>
            {paleta.map((p, i) => (
              <div key={i} onClick={() => elegir({ hex: p.hex })} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 2px', cursor: 'pointer', background: esSel({ hex: p.hex }) ? '#2a3a52' : 'transparent', borderRadius: 4 }}>
                <span style={{ width: 20, height: 20, background: p.hex, borderRadius: 4, border: '1px solid #555', flex: 'none' }} />
                <span style={{ flex: 1 }}>{p.nombre}</span><span style={{ opacity: 0.5, fontSize: 11 }}>{p.hex}</span>
                <span onClick={e => { e.stopPropagation(); setPaleta(x => x.filter((_, j) => j !== i)); }} style={{ opacity: 0.6, padding: '0 4px' }}>✕</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 5, margin: '6px 0 10px' }}>
              <input id="mat-nombre" placeholder="Nombre (ej. NCS S 1002-Y)" style={{ ...btn, flex: 1, minWidth: 0 }} />
              <input id="mat-hex" type="color" defaultValue="#d9cfc0" style={{ width: 34, height: 30, padding: 0, border: 'none', background: 'none' }} />
              <button style={btn} onClick={anadirColor}>+</button>
            </div>
            <div style={{ opacity: 0.7, marginBottom: 4 }}>Texturas</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
              {texturas.map(t => (
                <div key={t.id} onClick={() => elegir({ id: t.id })} title={t.nombre + ' · ' + t.tam + ' cm'} style={{ position: 'relative', cursor: 'pointer', border: esSel({ id: t.id }) ? '2px solid #4da3ff' : '1px solid #555', borderRadius: 4, overflow: 'hidden' }}>
                  <img src={t.url} alt={t.nombre} style={{ width: '100%', height: 56, objectFit: 'cover', display: 'block' }} />
                  <div style={{ fontSize: 10, padding: '1px 3px', background: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.nombre}</div>
                  <span onClick={e => { e.stopPropagation(); quitarTex(t); }} style={{ position: 'absolute', top: 1, right: 3, background: '#000a', borderRadius: 3, padding: '0 4px', fontSize: 11 }}>✕</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ ...btn, display: 'inline-block' }}>Subir textura…
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { subir(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <span style={{ opacity: 0.7 }}>tamaño real</span>
              <input id="mat-tam" type="number" defaultValue={60} style={{ ...btn, width: 56 }} /><span style={{ opacity: 0.7 }}>cm</span>
            </div>
            <div style={{ opacity: 0.5, fontSize: 11, marginTop: 4 }}>«Tamaño real» es lo que mide en la vida real el lado de la foto (ej. una loseta de 60 cm), para que no salga gigante.</div>
            {herr === 'pincel' && <button style={{ ...btn, marginTop: 10, width: '100%' }} onClick={() => { setHerr('sel'); }}>Terminar pincel</button>}
          </div>
        );
      })()}
      {selAcab && !objSel && (() => {
        const esMuro = selAcab.tipo === 'muro';
        const actual = esMuro ? (acab.muros[selAcab.id] || acab.todosMuros) : (acab.salas[selAcab.id] || acab.todosSuelos);
        const poner = hex => setAcab(a => esMuro ? { ...a, muros: { ...a.muros, [selAcab.id]: hex } } : { ...a, salas: { ...a.salas, [selAcab.id]: hex } });
        const todos = hex => setAcab(a => esMuro ? { ...a, muros: {}, todosMuros: hex } : { ...a, salas: {}, todosSuelos: hex });
        const quitar = () => setAcab(a => {
          const m = { ...(esMuro ? a.muros : a.salas) }; delete m[selAcab.id];
          return esMuro ? { ...a, muros: m } : { ...a, salas: m };
        });
        const paleta = ['#ffffff', '#f4f1ec', '#e8e2d8', '#d9cfc0', '#c9b9a0', '#b8a58c', '#a9b5a1', '#8fa3a8', '#7d8e9c', '#9d9a96', '#6e6a66', '#3a3a3c', '#c9a77c', '#8a6a4a', '#d9a7a0', '#b5695e'];
        return (
          <div style={{ position: 'absolute', right: 12, top: 56, width: 250, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{esMuro ? 'Muro' : 'Suelo'}: color</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {paleta.map(c => <span key={c} onClick={() => poner(c)} title={c} style={{ width: 24, height: 24, background: c, border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }} />)}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input type="color" value={/^#/.test(actual || '') ? actual : '#e4e0db'} onChange={e => poner(e.target.value)} />
              <input value={/^#/.test(actual || '') ? actual : ''} placeholder="#RRGGBB" onChange={e => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) poner(v); }} style={{ ...btn, width: 100 }} />
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {actual && <button style={btn} onClick={() => todos(actual)}>{esMuro ? 'A todos los muros' : 'A todos los suelos'}</button>}
              <button style={btn} onClick={quitar}>Quitar color</button>
              <button style={btn} onClick={() => setSelAcab(null)}>Cerrar</button>
            </div>
          </div>
        );
      })()}
      {bibAbierta && (
        <div style={{ position: 'absolute', left: 12, top: 56, bottom: 12, width: 270, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', fontSize: 13 }}>
          <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar en la biblioteca…" style={{ ...btn, width: '100%', marginBottom: 8, boxSizing: 'border-box' }} />
          <div style={{ overflow: 'auto', flex: 1 }}>
            {!biblioteca && <p style={{ opacity: 0.6 }}>Cargando biblioteca…</p>}
            {(biblioteca || []).filter(m => !filtro || (m.nombre + ' ' + (m.categoria || '') + ' ' + (m.marca || '')).toLowerCase().includes(filtro.toLowerCase())).slice(0, 80).map(m => (
              <div key={m.id} onClick={() => anadirBloque(m)} style={{ padding: '6px 4px', borderTop: '1px solid #333', cursor: 'pointer' }} title="Clic para colocarlo en el centro de la vista">
                <div>{m.nombre}</div>
                <div style={{ opacity: 0.55, fontSize: 11 }}>{m.categoria} · {Math.round(m.w)}×{Math.round(m.d)} cm</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {objSel && (
        <div style={{ position: 'absolute', right: 12, top: 56, width: 250, background: 'rgba(20,20,20,0.94)', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
          <input value={objSel.nombre} onChange={e => cambiar(objSel.id, { nombre: e.target.value })} style={{ ...btn, width: '100%', boxSizing: 'border-box', fontWeight: 700, marginBottom: 8 }} />
          {[['w', 'Largo'], ['d', 'Fondo'], ['alto', 'Alto'], ['z0', 'Elevación'], ['rot', 'Giro °']].map(([k, et]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 70, opacity: 0.7 }}>{et}</span>
              <input type="number" value={Math.round(objSel[k] * 10) / 10} onChange={e => cambiar(objSel.id, { [k]: parseFloat(e.target.value) || 0 })} style={{ ...btn, width: 90 }} />
            </label>
          ))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><span style={{ width: 70, opacity: 0.7 }}>Etiqueta</span><input value={objSel.etiqueta || ''} placeholder="Mobiliario…" onChange={e => cambiar(objSel.id, { etiqueta: e.target.value })} style={{ ...btn, width: 120 }} /></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0' }}><span style={{ width: 70, opacity: 0.7 }}>Color</span><input type="color" value={objSel.color || (objSel.tipo === 'caja' ? '#9aa3ad' : '#2f6fa8')} onChange={e => cambiar(objSel.id, { color: e.target.value })} /></label>
          {objSel.tipo === 'bloque' && objSel.cid && (
            <div style={{ borderTop: '1px solid #333', marginTop: 8, paddingTop: 8 }}>
              <div style={{ opacity: 0.7, marginBottom: 4 }}>Modelo 3D {modeloDe(objSel) ? '(asignado)' : '(sin modelo: se ve como caja)'}</div>
              <label style={{ ...btn, display: 'inline-block' }}>
                {modeloDe(objSel) ? 'Cambiar modelo…' : 'Asignar modelo 3D…'}
                <input type="file" accept=".glb,.gltf,.obj,.dae,.skp" style={{ display: 'none' }} onChange={e => { asignarModelo(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {modeloDe(objSel) && <button style={{ ...btn, marginLeft: 6 }} onClick={quitarModelo}>Quitar</button>}
              {modeloDe(objSel) && <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}><span style={{ width: 70, opacity: 0.7 }}>Giro modelo</span><input type="number" step="90" value={objSel.rotM || 0} onChange={e => cambiar(objSel.id, { rotM: parseFloat(e.target.value) || 0 })} style={{ ...btn, width: 90 }} /></label>}
              {subiendo && <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>{subiendo}</div>}
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>Formatos: .glb, .gltf, .obj, .dae. Desde SketchUp: Archivo → Exportar → Modelo 3D.</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <button style={btn} onClick={() => cambiar(objSel.id, { rot: ((objSel.rot || 0) + 90) % 360 })}>⟳ 90°</button>
            <button style={btn} onClick={() => duplicar(objSel.id)}>Duplicar</button>
            <button style={{ ...btn, background: '#7a2b2b' }} onClick={() => borrar(objSel.id)}>Borrar</button>
          </div>
        </div>
      )}
      {seleccion && !objSel && (
        <div style={{ position: 'absolute', right: 12, bottom: 12, width: 250, background: 'rgba(20,20,20,0.92)', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{seleccion.nombre || 'Equipo'}</div>
          <div style={{ marginBottom: 4 }}>Alto: {Math.round(seleccion.alto || 110)} cm</div>
          {eqNuevo && [['w', 'Largo'], ['d', 'Fondo'], ['rot', 'Giro °']].map(([k, et]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 70, opacity: 0.7 }}>{et}</span>
              <input type="number" value={eqNuevo[k]} onChange={e => setEqNuevo(s => ({ ...s, [k]: e.target.value }))} style={{ ...btn, width: 90 }} />
            </label>
          ))}
          <button style={{ ...btn, background: '#2f6fa8', marginTop: 6 }} onClick={aplicarEquipo}>Aplicar al plano</button>
          <div>Estado: {seleccion.estado === 'ex' ? 'existente' : 'nuevo'}</div>
          <button style={{ ...btn, marginTop: 8 }} onClick={() => setSeleccion(null)}>Cerrar</button>
        </div>
      )}
      {estado === 'cargando' && <p style={{ position: 'absolute', top: '45%', width: '100%', textAlign: 'center', color: '#555' }}>Cargando…</p>}
      {estado === 'sin-modelo' && <p style={{ position: 'absolute', top: '45%', width: '100%', textAlign: 'center', color: '#555' }}>Este plano todavía no tiene modelo 3D: ábrelo en Planos, dibuja algo y se guarda solo.</p>}
      {estado === 'error' && <p style={{ position: 'absolute', top: '45%', width: '100%', textAlign: 'center', color: '#a33' }}>No se ha podido cargar el plano.</p>}
    </div>
  );
}
