// Fotos de un producto a partir del enlace de su página (web del proveedor): imagen principal que publica la propia página.
// Solo páginas públicas por http/https: nunca direcciones internas (protección contra peticiones a la red local).
import dns from 'dns/promises';
import net from 'net';

const privada = (ip) => {
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127); }
  if (net.isIPv6(ip)) { const x = ip.toLowerCase(); return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.'); }
  return true;
};
async function urlSegura(texto) {
  let u; try { u = new URL(texto); } catch { throw new Error('El enlace no es válido'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('El enlace debe empezar por http o https');
  if (net.isIP(u.hostname)) { if (privada(u.hostname)) throw new Error('Ese enlace no se puede usar'); return u; }
  const r = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!r.length || r.some(x => privada(x.address))) throw new Error('Ese enlace no se puede usar');
  return u;
}
async function traer(texto, { max = 8e6, tipo = '', timeout = 12000 } = {}) {
  let u = await urlSegura(texto);
  for (let salto = 0; salto < 4; salto++) {
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'Mozilla/5.0 (compatible; RanuseBot/1.0)', accept: tipo === 'imagen' ? 'image/*' : 'text/html,*/*' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = await urlSegura(new URL(r.headers.get('location'), u).toString()); continue; }
    if (!r.ok) throw new Error('La página respondió ' + r.status);
    const ct = r.headers.get('content-type') || '';
    if (tipo === 'imagen' && !/^image\//.test(ct)) throw new Error('No es una imagen');
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > max) throw new Error('Pesa demasiado');
    return { buf, ct, url: u.toString() };
  }
  throw new Error('Demasiadas redirecciones');
}
const abs = (s, base) => { try { return new URL(String(s).replace(/&amp;/g, '&'), base).toString(); } catch { return null; } };

// Devuelve hasta «max» imágenes (Buffer) de la página: og:image, twitter:image, image_src y las de los datos estructurados del producto
export async function imagenesDeEnlace(enlace, max = 2) {
  const { buf, url } = await traer(enlace, { max: 3e6 });
  const html = buf.toString('utf8'), cand = [];
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/gi)) cand.push(m[1]);
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/gi)) cand.push(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/gi)) cand.push(m[1]);
  for (const m of html.matchAll(/"image"\s*:\s*(\[[^\]]{0,800}\]|"[^"]+")/g)) { try { const v = JSON.parse(m[1]); (Array.isArray(v) ? v : [v]).forEach(x => cand.push(typeof x === 'string' ? x : x?.url)); } catch { /* sin datos */ } }
  const vistas = new Set(), out = [];
  for (const c of cand) { const a = c && abs(c, url); if (!a || vistas.has(a)) continue; vistas.add(a); try { const r = await traer(a, { max: 8e6, tipo: 'imagen' }); out.push(r.buf); } catch { /* la siguiente */ } if (out.length >= max) break; }
  return out;
}
