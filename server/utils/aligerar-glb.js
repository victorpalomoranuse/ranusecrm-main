// Aligera un modelo .glb: suelda vértices duplicados y reduce triángulos (simplificación de malla) hasta un máximo de puntos.
// Los modelos que salen de las fotos traen 150.000 puntos o más: con 10 copias en una sala la Vista 3D se queda colgada.
// Con unos 20.000 puntos se ven igual de bien a la distancia a la que se miran las máquinas.
import { NodeIO } from '@gltf-transform/core';
import { weld, simplify, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const io = new NodeIO();
const puntos = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getAttribute('POSITION')?.getCount() || 0), 0), 0);

// Devuelve { glb, antes, despues } (o el mismo archivo si ya es ligero o si algo falla)
export async function aligeraGlb(buf, maxPuntos = 20000) {
  try {
    await MeshoptSimplifier.ready;
    const doc = await io.readBinary(new Uint8Array(buf));
    const antes = puntos(doc);
    if (antes <= maxPuntos * 1.3) return { glb: buf, antes, despues: antes, igual: true };
    await doc.transform(weld({ tolerance: 0.0001 }));
    const ratio = Math.max(0.02, Math.min(1, maxPuntos / Math.max(1, puntos(doc))));
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: false }), dedup(), prune());
    const out = Buffer.from(await io.writeBinary(doc));
    const despues = puntos(doc);
    if (out.length > buf.length || despues < 200) return { glb: buf, antes, despues: antes, igual: true };
    return { glb: out, antes, despues, igual: false };
  } catch (e) {
    console.error('aligeraGlb:', String(e.message || e).slice(0, 200));
    return { glb: buf, antes: 0, despues: 0, igual: true, error: true };
  }
}
