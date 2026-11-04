import sharp from 'sharp';

// Logo de una empresa a partir de su web: busca el icono de la página (apple-touch-icon o favicon grande) y, si no lo encuentra,
// usa el servicio de iconos de Google. Devuelve un PNG cuadrado de 256 px, o null si no hay forma. Se guarda en memoria 12 horas.
const cache = new Map();
const HORAS = 12 * 3600 * 1000;

const esPrivado = (h) => /^(localhost|.*\.local|.*\.internal)$/i.test(h) || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|fc|fd)/i.test(h);

export function origenDeWeb(u) {
  let s = String(u || '').trim(); if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const x = new URL(s);
    // enlaces de redirección (p. ej. l.wl.co/l/?u=…): se usa la web de destino
    if (/(^|\.)l\.wl\.co$/i.test(x.hostname) && x.searchParams.get('u')) return origenDeWeb(x.searchParams.get('u'));
    if (esPrivado(x.hostname)) return null;
    return x.origin;
  } catch { return null; }
}

async function traer(url, { ms = 5000, max = 2e6 } = {}) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RanuseCRM/1.0)', Accept: '*/*' } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length && buf.length <= max ? { buf, tipo: r.headers.get('content-type') || '' } : null;
  } catch { return null; } finally { clearTimeout(t); }
}
const aPng = (buf) => sharp(buf, { density: 200 }).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

export async function logoDeSitio(url) {
  const origen = origenDeWeb(url); if (!origen) return null;
  const c = cache.get(origen); if (c && Date.now() - c.t < HORAS) return c.png;
  let png = null;
  try {
    const pag = await traer(origen, { ms: 6000, max: 900000 });
    const candidatos = [];
    if (pag) {
      const html = pag.buf.toString('utf8');
      for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
        const tag = m[0], rel = (tag.match(/rel=["']([^"']+)["']/i) || [])[1] || '', href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
        if (!href || !/icon/i.test(rel) || /\.ico(\?|$)/i.test(href)) continue;
        const tam = parseInt(((tag.match(/sizes=["'](\d+)x/i) || [])[1]) || '0', 10) || 0;
        let abs; try { abs = new URL(href, origen).href; } catch { continue; }
        candidatos.push({ abs, puntos: (/apple-touch/i.test(rel) ? 1000 : 0) + tam + (/\.svg(\?|$)/i.test(href) ? 400 : 0) });
      }
      candidatos.sort((a, b) => b.puntos - a.puntos);
    }
    for (const cd of candidatos.slice(0, 3)) {
      const f = await traer(cd.abs, { ms: 5000 }); if (!f) continue;
      try { png = await aPng(f.buf); break; } catch { /* formato que no se puede leer */ }
    }
    if (!png) {
      const g = await traer(`https://www.google.com/s2/favicons?domain=${new URL(origen).hostname}&sz=128`, { ms: 5000, max: 300000 });
      if (g && /image/i.test(g.tipo)) { try { png = await aPng(g.buf); } catch { png = null; } }
    }
  } catch { png = null; }
  cache.set(origen, { png, t: Date.now() });
  return png;
}
