// Cambios hechos desde el visor 3D en el plano (mover o girar una máquina, tocar un muro, un hueco, una luminaria…).
// Se guardan como una lista de operaciones sencillas por elemento (con su id). Cuando Planos guarda su copia —que puede ser más vieja que lo hecho en el 3D—
// el servidor vuelve a aplicar esas operaciones encima, y así lo hecho en el 3D no se deshace.
const COLS = ['walls', 'ops', 'eq', 'pts', 'nodes'];
const MAX_ENTRADAS = 200, VIDA_MS = 14 * 86400000;

// contenedores del plano: la raíz, cada planta y el contenido completo de las plantas que no son la activa (piso.b)
function contenedores(d) {
  const out = [['raiz', d]];
  for (const p of Array.isArray(d?.pisos) ? d.pisos : []) {
    if (!p || typeof p !== 'object') continue;
    out.push(['piso:' + p.id, p]);
    if (p.b && typeof p.b === 'object') out.push(['pisob:' + p.id, p.b]);
  }
  return out;
}
const lista = (c, col) => (Array.isArray(c?.[col]) ? c[col].filter(x => x && typeof x === 'object' && x.id != null) : []);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function diffPlano(antes, despues) {
  const ops = [], mapaAntes = new Map(contenedores(antes)), mapaDespues = new Map(contenedores(despues));
  for (const [k, cd] of mapaDespues) {
    const ca = mapaAntes.get(k); if (!ca) continue;
    for (const col of COLS) {
      const la = new Map(lista(ca, col).map(x => [String(x.id), x])), ld = new Map(lista(cd, col).map(x => [String(x.id), x]));
      for (const [id, x] of ld) {
        const y = la.get(id);
        if (!y) { ops.push({ k, col, id, add: x }); continue; }
        const set = {}, unset = [];
        for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) { if (igual(x[f], y[f])) continue; if (x[f] === undefined) unset.push(f); else set[f] = x[f]; }
        if (Object.keys(set).length || unset.length) ops.push({ k, col, id, set, ...(unset.length ? { unset } : {}) });
      }
      for (const id of la.keys()) if (!ld.has(id)) ops.push({ k, col, id, del: 1 });
    }
  }
  return ops;
}

export function aplicaOps(data, ops) {
  const mapa = new Map(contenedores(data));
  for (const op of ops || []) {
    const c = mapa.get(op.k); if (!c) continue;
    if (!Array.isArray(c[op.col])) { if (op.add) c[op.col] = []; else continue; }
    const arr = c[op.col], i = arr.findIndex(x => x && String(x.id) === String(op.id));
    if (op.del) { if (i >= 0) arr.splice(i, 1); continue; }
    if (op.add) { if (i < 0) arr.push(JSON.parse(JSON.stringify(op.add))); else Object.assign(arr[i], op.add); continue; }
    if (i < 0) continue;
    if (op.set) Object.assign(arr[i], op.set);
    for (const f of op.unset || []) delete arr[i][f];
  }
}

// Anota en «data» lo que ha cambiado respecto a «previo» (la versión guardada antes de esta escritura)
export function registraOps3d(previo, data) {
  try {
    const ops = diffPlano(previo, data); if (!ops.length) return;
    const ahora = Date.now(), previas = (Array.isArray(data.ops3d) ? data.ops3d : []).filter(e => e && ahora - e.t < VIDA_MS);
    data.ops3d = [...previas, { t: ahora, ops }].slice(-MAX_ENTRADAS);
  } catch (e) { console.error('registraOps3d:', e.message); }
}

// Vuelve a aplicar sobre la copia que llega de Planos lo que se hizo en el 3D después de que Planos la cargara (base = momento en el servidor de esa carga)
export function reaplicaOps3d(data, guardadas, base) {
  if (!Array.isArray(guardadas) || !guardadas.length) return;
  if (base > 0) for (const e of guardadas) if (e && e.t > base) aplicaOps(data, e.ops);
  data.ops3d = guardadas;
}
