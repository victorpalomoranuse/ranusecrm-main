// Recover missing rooms from closed wall loops. Existing rooms and finishes win.
export function completarSalas(plano) {
  const originales = plano.salas || [], vertices = [], edges = [];
  const walls = (plano.muros || []).filter(w => w.estado !== 'dem' && w.a?.length === 2 && w.b?.length === 2);
  const vertex = p => {
    let i = vertices.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 3);
    if (i < 0) { i = vertices.length; vertices.push([...p]); }
    return i;
  };
  for (const w of walls) { const a = vertex(w.a), b = vertex(w.b); if (a !== b) edges.push({ a, b, w }); }
  const adj = vertices.map(() => new Map());
  // Split a wall at nodes along it, so a partition ending at a long wall closes a room.
  for (const e of edges) {
    const a = vertices[e.a], b = vertices[e.b], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const cuts = vertices.map((p, i) => ({ i, t: ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, d: Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(len2) })).filter(c => c.t >= 0 && c.t <= 1 && c.d < 0.1).sort((a, b) => a.t - b.t);
    for (let j = 1; j < cuts.length; j++) { const u = cuts[j - 1].i, v = cuts[j].i; adj[u].set(v, e.w); adj[v].set(u, e.w); }
  }
  const sorted = adj.map((list, i) => [...list.keys()].sort((a, b) => Math.atan2(vertices[a][1] - vertices[i][1], vertices[a][0] - vertices[i][0]) - Math.atan2(vertices[b][1] - vertices[i][1], vertices[b][0] - vertices[i][0])));
  const used = new Set(), nuevas = [];
  const inside = (p, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
    return c;
  };
  for (let start = 0; start < adj.length; start++) for (const next of sorted[start]) {
    let u = start, v = next; const loop = [], ws = [];
    while (!used.has(u + ':' + v)) {
      used.add(u + ':' + v); loop.push(u); ws.push(adj[u].get(v));
      const list = sorted[v], ix = list.indexOf(u), n = list[(ix - 1 + list.length) % list.length]; u = v; v = n;
    }
    if (u !== start || v !== next || loop.length < 3 || new Set(loop).size !== loop.length) continue;
    const pts = loop.map(i => vertices[i]);
    const area2 = pts.reduce((sum, p, i) => { const q = pts[(i + 1) % pts.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    if (area2 < 200) continue; // negative face is the unbounded exterior
    // A point just inside every boundary catches already-covered rooms without using a concave centroid.
    const probes = pts.map((p, i) => { const q = pts[(i + 1) % pts.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); return [(p[0] + q[0]) / 2 - dy / l * ((ws[i].t || 12) / 2 + 1), (p[1] + q[1]) / 2 + dx / l * ((ws[i].t || 12) / 2 + 1)]; });
    if (probes.every(p => originales.some(s => s.pts?.length >= 3 && inside(p, s.pts)))) continue;
    // Stable compact id, independent of wall iteration order.
    const signature = [...new Set(ws.map(w => String(w.id)))].sort().join('|'); let hash = 2166136261;
    for (const ch of signature) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    const id = 'auto-' + (hash >>> 0).toString(36);
    nuevas.push({ idS: id, idT: id, nombre: 'Recinto nuevo', pts, techo: { h: Math.min(...ws.map(w => w.h || plano.altura || 260)), c: '#f6f4f1' } });
  }
  return [...originales, ...nuevas];
}
