// Aligera un modelo .glb: suelda vértices duplicados y reduce triángulos (simplificación de malla) hasta un máximo de puntos.
// Los modelos que salen de las fotos traen 150.000 puntos o más: con 10 copias en una sala la Vista 3D se queda colgada.
// Con unos 20.000 puntos se ven igual de bien a la distancia a la que se miran las máquinas.
import { NodeIO } from '@gltf-transform/core';
import { weld, join, simplify, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const io = new NodeIO();
const puntos = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getAttribute('POSITION')?.getCount() || 0), 0), 0);

// Deja el modelo en unos maxTri triángulos (por defecto 12.000: con 100 máquinas en una sala son 1,2 millones y el visor va fluido).
// Devuelve { glb, antes, despues } (o el mismo archivo si ya es ligero o si algo falla)
const tris = (doc) => Math.round(doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3, 0), 0));
const verts = (doc) => puntos(doc);
const sube = async (doc, maxTri, errores) => { for (const err of errores) { const t = tris(doc); if (t <= maxTri * 1.15) break; await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.02, Math.min(1, maxTri / t)), error: err, lockBorder: false })); } };
export async function aligeraGlb(buf, maxTri = 12000) {
  try {
    await MeshoptSimplifier.ready;
    const doc = await io.readBinary(new Uint8Array(buf));
    const antes = tris(doc);
    if (antes <= maxTri * 1.15) return { glb: buf, antes, despues: antes, igual: true };
    await doc.transform(weld({ tolerance: 0.0001 }));
    try { await doc.transform(join({ keepMeshes: false, keepNamed: false })); } catch { /* sin unir piezas */ }
    await sube(doc, maxTri, [0.03, 0.08, 0.2, 0.5]);
    if (tris(doc) > maxTri * 1.5 && doc.getRoot().listTextures().length === 0) { // atascado por los cantos duros: sin normales los vértices se pueden juntar y el visor sombrea plano
      for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setAttribute('NORMAL', null);
      await doc.transform(weld({ tolerance: 0.0001 }));
      try { await doc.transform(join({ keepMeshes: false, keepNamed: false })); } catch { /* sin unir piezas */ }
      await sube(doc, maxTri, [0.03, 0.08, 0.2, 0.5, 1.0]);
    }
    await doc.transform(dedup(), prune());
    const out = Buffer.from(await io.writeBinary(doc)), despues = tris(doc);
    if (out.length > buf.length || despues < 200) return { glb: buf, antes, despues: antes, igual: true };
    return { glb: out, antes, despues, igual: false };
  } catch (e) {
    console.error('aligeraGlb:', String(e.message || e).slice(0, 200));
    return { glb: buf, antes: 0, despues: 0, igual: true, error: true };
  }
}
