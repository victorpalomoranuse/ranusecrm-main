// Crea modelos 3D sencillos propios (cuadros con marco y taburetes), los sube a la biblioteca 3D y los añade al índice.
// Cada modelo es un .glb con piezas con nombre (Marco, Paspartú, Lámina; Asiento, Estructura) para poder pintar cada parte por separado.
// Uso (desde /server):  node scripts/generar-modelos-sencillos.mjs --dry   → solo los crea en memoria y cuenta
//                       node scripts/generar-modelos-sencillos.mjs         → sube los .glb y actualiza el índice (no borra nada, guarda una copia)
import 'dotenv/config';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { supabase } from '../config/supabase.js';

// GLTFExporter pide FileReader (del navegador): se simula con lo mínimo
globalThis.FileReader = class { readAsArrayBuffer(b) { b.arrayBuffer().then(ab => { this.result = ab; this.onloadend?.(); this.onload?.(); }); } readAsDataURL(b) { b.arrayBuffer().then(ab => { this.result = 'data:' + (b.type || 'application/octet-stream') + ';base64,' + Buffer.from(ab).toString('base64'); this.onloadend?.(); this.onload?.(); }); } };

const BUCKET = 'project-documents', RUTA = 'biblioteca3d/indice.json', dry = process.argv.includes('--dry');
const mat = (nombre, hex, rough = 0.6, metal = 0) => { const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: metal }); m.name = nombre; return m; };
const caja = (w, h, d, x, y, z, m, g) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };

const MARCOS = { negro: ['#17171a', 'negro'], roble: ['#b98d5d', 'roble'], blanco: ['#f1efea', 'blanco'] };
function cuadro(wCm, hCm, marcoKey) {
  const W = wCm / 100, H = hCm / 100, D = 0.03, fw = 0.02, pp = Math.min(W, H) * 0.08, g = new THREE.Group();
  const mMarco = mat('Marco', MARCOS[marcoKey][0], 0.5), mPasp = mat('Paspartú', '#f6f4ef', 0.9), mLam = mat('Lámina', '#cfcac2', 0.8);
  caja(W, fw, D, 0, H / 2 - fw / 2, 0, mMarco, g); caja(W, fw, D, 0, -H / 2 + fw / 2, 0, mMarco, g);
  caja(fw, H - 2 * fw, D, -W / 2 + fw / 2, 0, 0, mMarco, g); caja(fw, H - 2 * fw, D, W / 2 - fw / 2, 0, 0, mMarco, g);
  caja(W - 2 * fw, H - 2 * fw, 0.004, 0, 0, -0.008, mPasp, g);
  caja(W - 2 * fw - 2 * pp, H - 2 * fw - 2 * pp, 0.002, 0, 0, -0.005, mLam, g);
  return g;
}
const cil = (rs, ri, h, x, y, z, m, g, seg = 24) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(rs, ri, h, seg), m); c.position.set(x, y, z); g.add(c); return c; };
function taburete(altoCm, tipo, asientoKey) {
  const H = altoCm / 100, g = new THREE.Group();
  const mEst = mat('Estructura', '#1d1d1f', 0.45, 0.6), mAs = asientoKey === 'madera' ? mat('Asiento', '#b98d5d', 0.6) : mat('Asiento', '#1b1b1d', 0.7);
  if (tipo === 'cuadrado') {
    const S = 0.36; caja(S, 0.03, S, 0, H - 0.015, 0, mAs, g);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => cil(0.014, 0.011, H - 0.03, sx * (S / 2 - 0.035), (H - 0.03) / 2, sz * (S / 2 - 0.035), mEst, g, 14));
    caja(S - 0.07, 0.02, 0.02, 0, H * 0.35, S / 2 - 0.035, mEst, g); caja(S - 0.07, 0.02, 0.02, 0, H * 0.35, -S / 2 + 0.035, mEst, g);
    return g;
  }
  const R = tipo === 'bajo' ? 0.16 : 0.18, patas = tipo === 'bajo' ? 3 : 4;
  cil(R, R, 0.04, 0, H - 0.02, 0, mAs, g, 40);
  for (let i = 0; i < patas; i++) {
    const a = (i / patas) * Math.PI * 2 + Math.PI / 4, top = R * 0.62, bot = R * 0.9, h = H - 0.04, leg = cil(0.012, 0.01, h, 0, 0, 0, mEst, g, 12);
    const dx = (bot - top) * Math.cos(a), dz = (bot - top) * Math.sin(a), len = Math.hypot(h, bot - top);
    leg.scale.y = len / h; leg.position.set(((top + bot) / 2) * Math.cos(a), h / 2, ((top + bot) / 2) * Math.sin(a));
    leg.rotation.set(Math.atan2(dz, h), 0, -Math.atan2(dx, h)); leg.rotation.order = 'ZXY';
  }
  if (tipo !== 'bajo') { const aro = new THREE.Mesh(new THREE.TorusGeometry(R * 0.8, 0.009, 10, 40), mEst); aro.rotation.x = Math.PI / 2; aro.position.y = H * 0.34; g.add(aro); }
  return g;
}

const modelos = [];
[[30, 40], [50, 70], [70, 100], [100, 100]].forEach(([w, h]) => Object.keys(MARCOS).forEach(k => modelos.push({ id: 'ranuse_cuadro_' + w + 'x' + h + '_' + k, nombre: 'Cuadro sencillo ' + w + '×' + h + ' · marco ' + MARCOS[k][1], categoria: 'Cuadros y espejos', g: cuadro(w, h, k), w, d: 3, alto: h })));
[['alto', 75, 'alto', 'negro'], ['alto', 75, 'alto', 'madera'], ['medio', 65, 'medio', 'negro'], ['medio', 65, 'medio', 'madera'], ['bajo', 45, 'bajo', 'negro'], ['bajo', 45, 'bajo', 'madera']].forEach(([nom, h, tipo, as]) => modelos.push({ id: 'ranuse_taburete_' + nom + '_' + as, nombre: 'Taburete ' + nom + ' (' + h + ' cm) · asiento ' + as, categoria: 'Asientos', g: taburete(h, tipo, as), w: tipo === 'bajo' ? 34 : 38, d: tipo === 'bajo' ? 34 : 38, alto: h }));
modelos.push({ id: 'ranuse_taburete_cuadrado_madera', nombre: 'Taburete cuadrado (45 cm) · madera', categoria: 'Asientos', g: taburete(45, 'cuadrado', 'madera'), w: 36, d: 36, alto: 45 });

const aGlb = g => new Promise((ok, ko) => { const sc = new THREE.Scene(); sc.add(g); new GLTFExporter().parse(sc, r => ok(Buffer.from(r)), ko, { binary: true }); });

const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(RUTA);
const ind = await (await fetch(pub.publicUrl + '?t=' + Date.now())).json();
const tengo = new Set((ind.modelos || []).map(m => m.id));
const nuevos = [];
for (const m of modelos) {
  const glb = await aGlb(m.g);
  if (glb.slice(0, 4).toString() !== 'glTF') throw new Error('GLB no válido: ' + m.id);
  if (process.env.LOCAL_DIR) { const { writeFileSync } = await import('fs'); writeFileSync(process.env.LOCAL_DIR + '/' + m.id + '.glb', glb); }
  if (tengo.has(m.id)) { console.log('ya está', m.id); continue; }
  console.log(dry ? 'creado (no se sube)' : 'subiendo', m.id, Math.round(glb.length / 1024) + ' KB');
  if (dry) continue;
  const ruta = 'biblioteca3d/modelos/' + m.id + '/' + m.id + '.glb';
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, glb, { contentType: 'model/gltf-binary', upsert: true });
  if (error) throw error;
  nuevos.push({ id: m.id, nombre: m.nombre, categoria: m.categoria, url: supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl, w: m.w, d: m.d, alto: m.alto });
}
if (!dry && nuevos.length) {
  await supabase.storage.from(BUCKET).upload('biblioteca3d/indice.copia-modelos-' + new Date().toISOString().slice(0, 10) + '.json', Buffer.from(JSON.stringify(ind)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  const out = { ...ind, modelos: [...ind.modelos, ...nuevos], generado: new Date().toISOString() };
  const { error } = await supabase.storage.from(BUCKET).upload(RUTA, Buffer.from(JSON.stringify(out)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw error;
}
console.log('Listo:', dry ? 'prueba (' + modelos.length + ' modelos válidos)' : nuevos.length + ' modelos añadidos');
