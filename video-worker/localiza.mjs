// Localiza cada parte del guion en la transcripción de la voz: reparte la transcripción en tramos consecutivos (cortando en signos de puntuación)
// y elige, por programación dinámica, los cortes que mejor encajan con las palabras de cada parte (por raíz de 5 letras), penalizando las palabras ajenas.
export function localizaPartes(palabras, partes, { VACIAS = new Set(), norm } = {}) {
  const N = palabras.map(w => norm(w.t)), n = N.length;
  const cand = [0]; palabras.forEach((w, i) => { if (/[.!?,;:]$/.test(w.t) && i + 1 < n) cand.push(i + 1); }); cand.push(n);
  const raiz = (x) => x.length >= 4 && !VACIAS.has(x) ? x.slice(0, 5) : null;
  const R = N.map(raiz);
  const pw = partes.map(p => new Set(String(p).split(/\s+/).map(norm).map(raiz).filter(Boolean)));
  const cache = new Map(); const seg = (a, b) => { const k = a + ':' + b; if (!cache.has(k)) { const s = new Set(); for (let i = a; i < b; i++) if (R[i]) s.add(R[i]); cache.set(k, s); } return cache.get(k); };
  const puntua = (p, a, b) => { if (b <= a) return -1.5; const s = seg(a, b); let comun = 0; for (const x of s) if (pw[p].has(x)) comun++; return comun - 0.35 * (s.size - comun); };
  const C = cand.length - 1, P = partes.length, NEG = -1e9;
  // dp[p][c]: mejor puntuación habiendo asignado las partes 0..p-1 y empezando la parte p en el candidato c
  const dp = Array.from({ length: P + 1 }, () => new Array(C + 1).fill(NEG)), from = Array.from({ length: P + 1 }, () => new Array(C + 1).fill(-1));
  for (let c = 0; c <= C; c++) dp[0][c] = 0;
  for (let p = 0; p < P; p++) for (let c = 0; c <= C; c++) {
    if (dp[p][c] === NEG) continue;
    // la parte p no está en el audio (no usa palabras)
    if (dp[p][c] - 1.5 > dp[p + 1][c]) { dp[p + 1][c] = dp[p][c] - 1.5; from[p + 1][c] = c * 2; }
    for (let d = c + 1; d <= C; d++) { const v = dp[p][c] + puntua(p, cand[c], cand[d]); if (v > dp[p + 1][d]) { dp[p + 1][d] = v; from[p + 1][d] = c * 2 + 1; } }
  }
  // el último tramo llega hasta el final de la voz: se elige el mejor final y se reconstruye
  const mejorC = C;
  const res = new Array(P).fill(null); let c = mejorC;
  for (let p = P; p >= 1; p--) { const f = from[p][c]; if (f < 0) break; const prev = f >> 1, usada = f & 1; if (usada) res[p - 1] = { a: cand[prev], b: cand[c] }; c = prev; }
  return res; // por parte: { a, b } (índices de palabra) o null si no se encuentra
}
