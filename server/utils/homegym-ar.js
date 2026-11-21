// Monta el gym completo en UN solo .glb a tamaño real (metros) para verlo en realidad aumentada.
// Cada máquina se lee de su modelo 3D del catálogo, se gira como la colocó el motor y se estira a sus medidas reales (largo, ancho, alto del catálogo).
// Si una máquina no tiene modelo (o no se puede leer), se pone una caja de esas medidas. El origen queda en el centro de la sala, en el suelo.
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const MAX_BYTES = 25e6;
// Colores en lineal (glTF): equivalen a los grises, greige y hueso de la marca
const COLORES = { fuerza: [0.18, 0.168, 0.147, 1], cardio: [0.52, 0.44, 0.37, 1], func: [0.79, 0.75, 0.70, 1] };

async function bajaModelo(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const len = Number(r.headers.get('content-length')) || 0;
    if (len > MAX_BYTES) throw new Error('modelo demasiado pesado');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('modelo demasiado pesado');
    return buf;
  } finally { clearTimeout(t); }
}

// Caja con las medidas dadas (metros), apoyada en el suelo y centrada en x/z
function documentoCaja(w, h, d, cat, color) {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  const hx = w / 2, hz = d / 2;
  const caras = [ // [normal, 4 esquinas]
    [[0, 1, 0], [[-hx, h, -hz], [-hx, h, hz], [hx, h, hz], [hx, h, -hz]]],
    [[0, -1, 0], [[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz]]],
    [[1, 0, 0], [[hx, 0, -hz], [hx, h, -hz], [hx, h, hz], [hx, 0, hz]]],
    [[-1, 0, 0], [[-hx, 0, -hz], [-hx, 0, hz], [-hx, h, hz], [-hx, h, -hz]]],
    [[0, 0, 1], [[-hx, 0, hz], [hx, 0, hz], [hx, h, hz], [-hx, h, hz]]],
    [[0, 0, -1], [[-hx, 0, -hz], [-hx, h, -hz], [hx, h, -hz], [hx, 0, -hz]]],
  ];
  const pos = [], nor = [], idx = [];
  caras.forEach(([n, qs], i) => { qs.forEach(q => { pos.push(...q); nor.push(...n); }); const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); });
  const col = color || COLORES[cat] || COLORES.fuerza;
  const mat = doc.createMaterial('caja').setBaseColorFactor(col).setRoughnessFactor(0.7).setMetallicFactor(0.1);
  if (col[3] < 1) mat.setAlphaMode('BLEND');
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer))
    .setMaterial(mat);
  const mesh = doc.createMesh('caja').addPrimitive(prim);
  scene.addChild(doc.createNode('caja').setMesh(mesh));
  return doc;
}

// Medidas reales de un modelo (metros, sin girar). Se guardan 24 h para no volver a descargarlo en cada visita.
const cacheMedidas = new Map();
export async function medidasModelo(url) {
  const c = cacheMedidas.get(url);
  if (c && Date.now() - c.t < 864e5) return c;
  const doc = await io.readBinary(new Uint8Array(await bajaModelo(url)));
  const scene = doc.getRoot().listScenes()[0]; if (!scene) throw new Error('sin escena');
  const b = getBounds(scene);
  const r = { dx: b.max[0] - b.min[0], dy: b.max[1] - b.min[1], dz: b.max[2] - b.min[2], t: Date.now() };
  if (!(r.dx > 1e-6 && r.dy > 1e-6 && r.dz > 1e-6)) throw new Error('modelo vacío');
  cacheMedidas.set(url, r);
  return r;
}

// Lee el modelo de una máquina, lo gira (yaw en grados) y lo escala a la altura h (metros) sin deformarlo, con la base en y=0 y centrado en x/z
async function documentoMaquina(item) {
  if (!item.modelo3d?.url) return documentoCaja(item.w, item.h, item.d, item.cat);
  try {
    const doc = await io.readBinary(new Uint8Array(await bajaModelo(item.modelo3d.url)));
    // Ya vienen descomprimidos al leerlos; se quitan las extensiones de compresión para poder volver a escribir sin codificador
    doc.getRoot().listExtensionsUsed().filter(e => /compression/i.test(e.extensionName)).forEach(e => e.dispose());
    const scene = doc.getRoot().listScenes()[0]; if (!scene) throw new Error('sin escena');
    const raices = scene.listChildren();
    const interior = doc.createNode('giro');
    raices.forEach(n => { scene.removeChild(n); interior.addChild(n); });
    const yaw = ((item.rot || 0) * Math.PI) / 180, s = Math.sin(-yaw / 2), c = Math.cos(-yaw / 2); // mismo sentido de giro que el visor 3D
    interior.setRotation([0, s, 0, c]);
    const exterior = doc.createNode('medidas'); exterior.addChild(interior); scene.addChild(exterior);
    const b = getBounds(scene);
    const dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
    if (!(dx > 1e-6 && dy > 1e-6 && dz > 1e-6)) throw new Error('modelo vacío');
    // Escala UNIFORME por la altura (es el dato del catálogo que sí coincide con los modelos): así la máquina no se deforma nunca
    const k = item.h / dy;
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    exterior.setScale([k, k, k]).setTranslation([-cx * k, -b.min[1] * k, -cz * k]);
    return doc;
  } catch (e) {
    console.error('Home Gym AR · modelo no válido, se usa una caja:', String(e.message || e).slice(0, 120));
    return documentoCaja(item.w, item.h, item.d, item.cat);
  }
}

// Copia un documento (una máquina, la placa del suelo…) dentro del principal, en la posición dada (metros)
function injerta(principal, raiz, doc, pos, nombre) {
  const origen = doc.getRoot().listScenes()[0];
  const mapa = mergeDocuments(principal, doc); // copia el contenido del otro documento al principal y devuelve la correspondencia
  const sc = mapa.get(origen);
  if (!sc) return;
  const nodo = principal.createNode(nombre || 'pieza');
  sc.listChildren().forEach(n => { sc.removeChild(n); nodo.addChild(n); });
  nodo.setTranslation(pos);
  raiz.addChild(nodo);
  sc.dispose();
}

// items: [{ w, d, h (cm, ya tras el giro de la colocación), x, y (esquina superior izquierda en cm), cat, rot, modelo3d }], sala: { L, W, door } en cm
export async function montaGymGlb(items, sala) {
  const principal = new Document(); principal.createBuffer();
  const escena = principal.createScene('gym');
  const raiz = principal.createNode('gym'); escena.addChild(raiz);
  // Placa del suelo con la forma de la sala y una marca blanca en la puerta: sirve para alinear el modelo con las paredes reales
  const Lm = sala.L / 100, Wm = sala.W / 100;
  injerta(principal, raiz, documentoCaja(Lm, 0.01, Wm, null, [0.52, 0.44, 0.37, 0.35]), [0, 0, 0], 'suelo');
  const horizontal = sala.door === 'arriba' || sala.door === 'abajo';
  const marca = horizontal ? documentoCaja(0.9, 0.02, 0.08, null, [1, 1, 1, 1]) : documentoCaja(0.08, 0.02, 0.9, null, [1, 1, 1, 1]);
  const pm = { arriba: [0, 0.011, -Wm / 2 + 0.04], abajo: [0, 0.011, Wm / 2 - 0.04], izq: [-Lm / 2 + 0.04, 0.011, 0], der: [Lm / 2 - 0.04, 0.011, 0] }[sala.door] || [0, 0.011, Wm / 2 - 0.04];
  injerta(principal, raiz, marca, pm, 'puerta');
  for (const it of items) {
    const doc = await documentoMaquina({ ...it, w: it.w / 100, d: it.d / 100, h: it.h / 100 });
    injerta(principal, raiz, doc, [(it.x + it.w / 2 - sala.L / 2) / 100, 0, (it.y + it.d / 2 - sala.W / 2) / 100], it.nombre || 'maquina');
  }
  for (const sc of principal.getRoot().listScenes()) if (sc !== escena) sc.dispose();
  await principal.transform(unpartition()); // un solo buffer: lo exige el formato .glb
  return Buffer.from(await io.writeBinary(principal));
}
