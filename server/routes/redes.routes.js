import express from 'express';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { leerJson, guardarJson } from '../utils/asistente-personal.js';
import { callClaude } from '../utils/anthropic.js';
import { creaTrabajoSistema, leeTrabajoSistema, contextoMaterial } from './estudio-video.routes.js';
import { ejecutarHistorias } from '../utils/historias-asistente.js';

// Analizador de redes: conecta la cuenta de Instagram de Víctor (inicio de sesión con Facebook, sin copiar ninguna clave), lee sus publicaciones y su rendimiento SIN descargar los vídeos,
// aprende qué ganchos, formatos y temas le funcionan, y busca ideas ganadoras en su nicho (cuentas profesionales públicas de Instagram y vídeos públicos de YouTube).
// Lo aprendido llega al asistente (historias) y al editor de vídeo.
const router = express.Router();

const GRAPH = 'https://graph.facebook.com/v21.0';
const RUTA_IG = 'crm/redes/instagram.json', RUTA_APRENDIZAJE = 'crm/redes/aprendizaje.json', RUTA_NICHO = 'crm/redes/nicho.json', RUTA_CONFIG = 'crm/redes/config.json';
const REDIRECT = process.env.IG_REDIRECT_URI || 'https://ranusecrm-main-production.up.railway.app/api/redes/instagram/callback';
const APP_ID = () => process.env.FB_APP_ID || '1194987756196994';
const APP_SECRET = () => process.env.FB_APP_SECRET || process.env.WA_ASIST_APP_SECRET || '';
const ORIGENES = ['https://ranusedesign.com', 'https://www.ranusedesign.com', 'https://ranusecrm.vercel.app', 'http://localhost:5173'];
const SCOPES = 'instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement';
const SECRETO_ESTADO = () => process.env.JWT_SECRET || 'ranuse-redes';

const firma = (s) => crypto.createHmac('sha256', SECRETO_ESTADO()).update(s).digest('hex').slice(0, 24);
const creaEstado = (origen) => { const b = Buffer.from(JSON.stringify({ t: Date.now(), o: origen })).toString('base64url'); return b + '.' + firma(b); };
const leeEstado = (s) => { try { const [b, f] = String(s).split('.'); if (!b || firma(b) !== f) return null; const d = JSON.parse(Buffer.from(b, 'base64url').toString()); return Date.now() - d.t < 15 * 60 * 1000 ? d : null; } catch { return null; } };

async function graph(ruta, params = {}, token) {
  const u = new URL(ruta.startsWith('http') ? ruta : GRAPH + ruta);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  if (token) u.searchParams.set('access_token', token);
  const r = await fetch(u, { signal: AbortSignal.timeout(45000) }); const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = new Error(j.error?.message || ('Meta ' + r.status)); e.codigo = j.error?.code; e.meta = j.error; throw e; }
  return j;
}
const json = (r) => {
  const txt = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join(''), i = txt.indexOf('{'); if (i < 0) throw new Error('la IA no ha devuelto datos');
  const s = txt.slice(i);
  for (let e = s.lastIndexOf('}'); e > 0; e = s.lastIndexOf('}', e - 1)) { try { return JSON.parse(s.slice(0, e + 1)); } catch { /* se prueba con un cierre anterior */ } }
  // respuesta cortada: se cierran las llaves y corchetes que falten
  let cierre = '', pila = [], dentro = false, esc = false; for (const ch of s) { if (esc) { esc = false; continue; } if (ch === '\\') { esc = true; continue; } if (ch === '"') dentro = !dentro; if (dentro) continue; if (ch === '{' || ch === '[') pila.push(ch); if (ch === '}' || ch === ']') pila.pop(); }
  for (const p of pila.reverse()) cierre += p === '{' ? '}' : ']';
  for (const corte of [s.length, s.lastIndexOf(','), s.lastIndexOf('{')]) { if (corte <= 0) continue; try { let base = s.slice(0, corte).replace(/,\s*$/, ''); let q = '', pl = [], d = false, es = false; for (const ch of base) { if (es) { es = false; continue; } if (ch === '\\') { es = true; continue; } if (ch === '"') d = !d; if (d) continue; if (ch === '{' || ch === '[') pl.push(ch); if (ch === '}' || ch === ']') pl.pop(); } if (d) base += '"'; for (const p of pl.reverse()) q += p === '{' ? '}' : ']'; return JSON.parse(base + q); } catch { /* siguiente corte */ } }
  throw new Error('respuesta de la IA incompleta');
};
const aTexto = (s) => (s && typeof s === 'object' ? (Array.isArray(s) ? s.map(aTexto).join(' · ') : Object.values(s).map(aTexto).filter(Boolean).join(' — ')) : s);
const limpia = (s, n) => String(aTexto(s) || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ── 1) Conexión con Instagram (el callback lo abre el navegador de Víctor, sin cabecera de sesión: se protege con un estado firmado)
router.get('/instagram/callback', async (req, res) => {
  const est = leeEstado(req.query.state), origen = ORIGENES.includes(est?.o) ? est.o : ORIGENES[0];
  const vuelta = (ok, msg) => res.redirect(origen + '/admin?redes=' + (ok ? 'conectado' : 'error') + (msg ? '&msg=' + encodeURIComponent(msg.slice(0, 160)) : ''));
  try {
    if (!est) return vuelta(false, 'La conexión caducó o no es válida. Vuelve a pulsar «Conectar Instagram».');
    if (req.query.error) return vuelta(false, 'No se aceptó el permiso: ' + (req.query.error_description || req.query.error));
    if (!APP_SECRET()) return vuelta(false, 'Falta la clave de la app de Meta en el servidor.');
    const corto = await graph('/oauth/access_token', { client_id: APP_ID(), client_secret: APP_SECRET(), redirect_uri: REDIRECT, code: req.query.code });
    const largo = await graph('/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: APP_ID(), client_secret: APP_SECRET(), fb_exchange_token: corto.access_token });
    const token = largo.access_token;
    const pags = await graph('/me/accounts', { fields: 'id,name,instagram_business_account{id,username,name,followers_count,media_count,profile_picture_url}', limit: 25 }, token);
    const con = (pags.data || []).find(p => p.instagram_business_account);
    if (!con) return vuelta(false, 'No encuentro ninguna cuenta de Instagram profesional vinculada a tus páginas de Facebook. Comprueba que la página que vinculaste aparece al conectar.');
    const ig = con.instagram_business_account;
    await guardarJson(RUTA_IG, { token, expira: Date.now() + (Number(largo.expires_in) || 5184000) * 1000, ig_id: ig.id, usuario: ig.username, nombre: ig.name || '', seguidores: ig.followers_count, publicaciones: ig.media_count, foto: ig.profile_picture_url || '', pagina: con.name, conectado: new Date().toISOString() });
    return vuelta(true);
  } catch (e) { console.error('redes callback', e.message); return vuelta(false, 'Meta ha respondido: ' + e.message); }
});

router.use(authenticateToken);

const conexion = async () => { const c = await leerJson(RUTA_IG, null); return c && c.token ? c : null; };

router.get('/estado', async (req, res) => {
  try {
    const c = await conexion(), a = await leerJson(RUTA_APRENDIZAJE, null), cfg = await leerJson(RUTA_CONFIG, {}), n = await leerJson(RUTA_NICHO, { cuentas: [] });
    res.json({ instagram: c ? { usuario: c.usuario, nombre: c.nombre, seguidores: c.seguidores, publicaciones: c.publicaciones, foto: c.foto, conectado: c.conectado, ultima_sync: c.ultima_sync || null, n_media: (c.media || []).length, expira_dias: Math.round((c.expira - Date.now()) / 86400000) } : null, aprendizaje: a || null, youtube: !!(cfg.youtube_key || process.env.YOUTUBE_API_KEY), objetivo: await objetivoActual(), mi_canal: await leerJson('crm/redes/youtube_canal.json', null), canal_url: cfg.youtube_canal || '', plan: await leerJson('crm/redes/plan.json', null), config: !!(cfg.fb_config_id || process.env.FB_CONFIG_ID), nicho: n.cuentas || [] });
  } catch (e) { res.status(500).json({ error: 'No se pudo leer el estado' }); }
});

router.get('/instagram/conectar', async (req, res) => {
  if (!APP_SECRET()) return res.status(503).json({ error: 'Falta la clave de la app de Meta en el servidor (WA_ASIST_APP_SECRET o FB_APP_SECRET).' });
  const origen = ORIGENES.includes(req.query.origen) ? req.query.origen : ORIGENES[0];
  const cfg = await leerJson(RUTA_CONFIG, {}), config = cfg.fb_config_id || process.env.FB_CONFIG_ID || '';
  const url = 'https://www.facebook.com/v21.0/dialog/oauth?client_id=' + APP_ID() + '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&state=' + encodeURIComponent(creaEstado(origen)) + (config ? '&config_id=' + encodeURIComponent(config) + '&response_type=code&override_default_response_type=true' : '&scope=' + SCOPES + '&response_type=code');
  res.json({ url, redirect_uri: REDIRECT, con_configuracion: !!config });
});
router.post('/config', async (req, res) => {
  try { const id = String(req.body?.config_id || '').trim(); if (!/^\d{8,25}$/.test(id)) return res.status(400).json({ error: 'El ID de configuración son solo números (unos 15 dígitos).' }); const cfg = await leerJson(RUTA_CONFIG, {}); cfg.fb_config_id = id; await guardarJson(RUTA_CONFIG, cfg); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.delete('/instagram', async (req, res) => { try { await guardarJson(RUTA_IG, {}); res.json({ ok: true }); } catch { res.status(500).json({ error: 'No se pudo desconectar' }); } });

// ── 2) Leer publicaciones y su rendimiento (sin descargar nada)
const METRICAS = { REELS: ['reach', 'saved', 'shares', 'likes', 'comments', 'total_interactions', 'views', 'ig_reels_avg_watch_time'], VIDEO: ['reach', 'saved', 'shares', 'likes', 'comments', 'total_interactions', 'views'], FEED: ['reach', 'saved', 'shares', 'likes', 'comments', 'total_interactions', 'views'], STORY: ['reach', 'replies', 'navigation', 'shares', 'total_interactions', 'views'] };
async function insightsDe(media, token) {
  const tipo = media.media_product_type === 'REELS' ? 'REELS' : media.media_product_type === 'STORY' ? 'STORY' : (media.media_type === 'VIDEO' ? 'VIDEO' : 'FEED');
  const lista = METRICAS[tipo], out = {};
  try { const j = await graph('/' + media.id + '/insights', { metric: lista.join(',') }, token); for (const m of j.data || []) out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? null; return out; }
  catch { /* alguna métrica no existe para este tipo: se piden de una en una */ }
  for (const m of lista) { try { const j = await graph('/' + media.id + '/insights', { metric: m }, token); const x = j.data?.[0]; out[m] = x?.values?.[0]?.value ?? x?.total_value?.value ?? null; } catch { /* métrica no disponible */ } }
  return out;
}
export async function sincronizarInstagram(max = 300) {
  const c = await conexion(); if (!c) throw new Error('Instagram no está conectado');
  // se leen TODAS las publicaciones (páginas de 100), no solo las últimas: así entra también ese vídeo antiguo que se hizo viral
  let j = await graph('/' + c.ig_id + '/media', { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url', limit: 100 }, c.token);
  const crudas = [...(j.data || [])];
  while (crudas.length < max && j.paging?.cursors?.after && j.paging?.next) { try { j = await graph('/' + c.ig_id + '/media', { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url', limit: 100, after: j.paging.cursors.after }, c.token); } catch { break; } crudas.push(...(j.data || [])); }
  const media = [], inicio = Date.now(), lote = crudas.slice(0, max), conIns = [];
  for (let i = 0; i < lote.length; i += 8) { if (Date.now() - inicio > 230000) { for (const m of lote.slice(i)) conIns.push([m, {}]); break; } const gr = lote.slice(i, i + 8); const rs = await Promise.all(gr.map(m => insightsDe(m, c.token).catch(() => ({})))); gr.forEach((m, k) => conIns.push([m, rs[k]])); }
  for (const [m, ins] of conIns) { media.push({ id: m.id, tipo: m.media_product_type || m.media_type, formato: m.media_type, enlace: m.permalink, fecha: m.timestamp, pie: limpia(m.caption, 600), me_gusta: m.like_count ?? ins.likes ?? null, comentarios: m.comments_count ?? ins.comments ?? null, miniatura: m.thumbnail_url || '', ...ins }); }
  let perfil = {}; try { perfil = await graph('/' + c.ig_id, { fields: 'followers_count,media_count,username' }, c.token); } catch { /* sin perfil */ }
  await guardarJson(RUTA_IG, { ...c, media, seguidores: perfil.followers_count ?? c.seguidores, publicaciones: perfil.media_count ?? c.publicaciones, ultima_sync: new Date().toISOString() });
  return media;
}
const SYNC = { en_curso: false, inicio: 0, error: null, fin: 0, n: 0 };
router.post('/instagram/sincronizar', async (req, res) => {
  if (SYNC.en_curso && Date.now() - SYNC.inicio < 6 * 60 * 1000) return res.json({ ok: true, en_curso: true });
  Object.assign(SYNC, { en_curso: true, inicio: Date.now(), error: null, n: 0 });
  sincronizarInstagram(Math.min(400, Number(req.body?.max) || 300)).then(m => { SYNC.n = m.length; SYNC.fin = Date.now(); }).catch(e => { SYNC.error = e.codigo === 190 ? 'La conexión con Instagram caducó: vuelve a conectarla.' : 'No se pudieron leer tus publicaciones: ' + String(e.message).slice(0, 200); }).finally(() => { SYNC.en_curso = false; });
  res.json({ ok: true, en_curso: true });
});
router.get('/instagram/sincronizar', (req, res) => res.json({ en_curso: SYNC.en_curso, error: SYNC.error, n: SYNC.n, fin: SYNC.fin }));

// ── 3) Aprender de lo tuyo
const interaccion = (m) => (Number(m.me_gusta) || 0) + (Number(m.comentarios) || 0) * 3 + (Number(m.saved) || 0) * 4 + (Number(m.shares) || 0) * 5;
// ¿Qué es «lo que mejor funciona»? Depende de lo que quieras conseguir. Cada objetivo tiene su propia puntuación (siempre suavizada: con muy poco alcance, un par de me gusta no puede disparar la nota).
const n0 = (x) => Number(x) || 0, base0 = (m) => n0(m.reach) || n0(m.views), K = 400;
export const OBJETIVOS = {
  crecimiento: { nombre: 'Crecer y vender (mezcla)', icono: '📈', que: 'El mix que buscas: llegar a más gente, que te sigan, que comenten y conversen, y que te contacten.', formula: 'Mezcla de alcance (vistas), compartidos (traen gente nueva), comentarios (conversación y contactos), guardados y tiempo visto. Compartidos y comentarios pesan más.', unidad: 'puntos de crecimiento', f: (m) => 8 * Math.log10((n0(m.views) || n0(m.reach)) + 10) + (n0(m.shares) * 4 + n0(m.comentarios) * 3 + n0(m.saved) * 2) * 1000 / (base0(m) + K) / 10 + n0(m.ig_reels_avg_watch_time) / 1000 * 1.5 },
  equilibrado: { nombre: 'Interacción', icono: '⚖️', que: 'Lo que más reacción provoca en quien lo ve.', formula: 'Interacciones ponderadas (me gusta ×1, comentarios ×3, guardados ×4, compartidos ×5) entre el alcance.', unidad: 'puntos', f: (m) => (n0(m.me_gusta) + n0(m.comentarios) * 3 + n0(m.saved) * 4 + n0(m.shares) * 5) / (base0(m) + K) * 100 },
  visibilidad: { nombre: 'Visibilidad', icono: '👁', que: 'Llegar a más gente: lo más visto.', formula: 'Visualizaciones, en miles.', unidad: 'miles de vistas', f: (m) => (n0(m.views) || n0(m.reach)) / 1000 },
  conversacion: { nombre: 'Comentarios y conversación', icono: '💬', que: 'Que la gente escriba, pregunte y responda.', formula: 'Comentarios por cada 1.000 personas alcanzadas.', unidad: 'comentarios / 1.000', f: (m) => n0(m.comentarios) * 1000 / (base0(m) + K) },
  guardados: { nombre: 'Guardados (valor útil)', icono: '🔖', que: 'Contenido que la gente quiere conservar porque le sirve.', formula: 'Guardados por cada 1.000 personas alcanzadas.', unidad: 'guardados / 1.000', f: (m) => n0(m.saved) * 1000 / (base0(m) + K) },
  compartidos: { nombre: 'Compartidos (crecer con gente nueva)', icono: '🚀', que: 'Que se lo manden a otros por mensaje: es la señal que más empuja un reel a gente que no te sigue.', formula: 'Compartidos por cada 1.000 personas alcanzadas.', unidad: 'compartidos / 1.000', f: (m) => n0(m.shares) * 1000 / (base0(m) + K) },
  contactos: { nombre: 'Contactos y clientes (leads)', icono: '🎯', que: 'Que te escriban o pidan tu recurso: comentarios con palabra clave, guardados y compartidos.', formula: 'Comentarios ×5 + guardados ×2 + compartidos ×2, por cada 1.000 personas alcanzadas.', unidad: 'puntos de interés comercial', f: (m) => (n0(m.comentarios) * 5 + n0(m.saved) * 2 + n0(m.shares) * 2) * 1000 / (base0(m) + K) },
  viral: { nombre: 'Viral (compartidos + retención)', icono: '🔥', que: 'Lo que Instagram empuja a desconocidos: que se lo manden a otros y que se vea entero.', formula: 'Compartidos por cada 1.000 alcanzados ×10, más los segundos medios vistos.', unidad: 'puntos virales', f: (m) => n0(m.shares) * 10000 / (base0(m) + K) + n0(m.ig_reels_avg_watch_time) / 1000 },
  retencion: { nombre: 'Retención (que lo vean entero)', icono: '⏱', que: 'Que la gente se quede viendo el vídeo.', formula: 'Tiempo medio que se ve cada reel, en segundos.', unidad: 'segundos vistos', f: (m) => n0(m.ig_reels_avg_watch_time) / 1000 },
};
const RUTA_PREFS = 'crm/redes/preferencias.json';
let PREFS_TXT = '';
function textoRumbo(rb) {
  if (!rb || !(rb.enfoque || rb.ya_no || rb.amplia)) return '';
  return 'RUMBO ACTUAL DE VÍCTOR (hacia dónde se dirige AHORA; manda sobre el historial):\n'
    + (rb.enfoque ? 'CLIENTE QUE QUIERE (a quién vende, el núcleo): ' + rb.enfoque + '\n' : '')
    + (rb.amplia ? 'AUDIENCIA AMPLIA PARA CRECER (a quién atrae con el contenido): ' + rb.amplia + '\n' : '')
    + (rb.ya_no ? 'Ya NO se dirige a: ' + rb.ya_no + '\n' : '')
    + 'ESTRATEGIA DE EMBUDO: para crecer en redes hay que atacar algo MÁS AMPLIO que el cliente final. Alrededor del 60 % del contenido debe atraer a la audiencia amplia (curiosidad, aspiración, deporte, hogar, transformaciones, utilidad para cualquiera) y llevarla poco a poco hacia el núcleo; el resto conecta (confianza, bastidores) o convierte (CTA a contactos). No encierres las ideas en el cliente final. Cada publicación puede traer rumbo: "encaja" (el núcleo), "amplio" (audiencia amplia afín: vale para crecer), "formato" (el tema ya no es suyo pero la forma podría servir) o "fuera" (tema que ya no hace). Que algo antiguo tuviera muchas vistas NO es motivo para repetirlo si está fuera; no propongas temas fuera de rumbo; de los de formato aprende solo la forma si es transferible; da más peso a lo reciente y a lo que encaja o es amplio.\n';
}
const RUTA_RUMBO = 'crm/redes/rumbo.json', RUTA_RUMBO_POSTS = 'crm/redes/rumbo_posts.json';
let RUMBO_TXT = '';
export async function refrescaPrefs() {
  try { RUMBO_TXT = textoRumbo(await leerJson(RUTA_RUMBO, null)); } catch { RUMBO_TXT = ''; }
  try { const p = await leerJson(RUTA_PREFS, { reglas: [] }), no = (p.reglas || []).filter(r => r.tipo === 'no').map(r => '- ' + r.texto), si = (p.reglas || []).filter(r => r.tipo === 'si').map(r => '- ' + r.texto), tr = (p.reglas || []).filter(r => r.tipo === 'transmitir').map(r => '- ' + r.texto), sa = (p.reglas || []).filter(r => r.tipo === 'saber').map(r => '- ' + r.texto);
    PREFS_TXT = no.length || si.length || tr.length || sa.length ? 'PREFERENCIAS DE VÍCTOR (OBLIGATORIAS: nunca las incumplas ni propongas nada que las contradiga, ni en ideas, ni en acciones, ni en guiones, ni en el plan)' + (no.length ? '\nNO QUIERE:\n' + no.join('\n') : '') + (si.length ? '\nQUIERE:\n' + si.join('\n') : '') + (tr.length ? '\nQUIERE TRANSMITIR (imagen y mensaje de marca; todo lo que propongas debe reforzarlo):\n' + tr.join('\n') : '') + (sa.length ? '\nCONTEXTO QUE DEBES SABER (hechos reales de su negocio; úsalos para interpretar bien los datos, por ejemplo qué publicaciones son de clientes y cuáles deberían rendir más):\n' + sa.join('\n') : '') + '\n' : '';
  } catch { PREFS_TXT = ''; }
  return PREFS_TXT;
}
// Realidad fija de su negocio: los proyectos con famosos o clientes concretos son ocasionales, no se pueden repetir a demanda
const BASE_REALIDAD = 'Su cuenta tiene contenido ANTIGUO o que ya no representa su marca (p. ej. decoración del hogar o consejos genéricos que se hicieron virales); Ranuse Design es ahora diseño y montaje de gimnasios y espacios deportivos. No imites ni recomiendes copiar vídeos que se desvíen de esa marca, aunque tengan muchas vistas: si un reel con muchas vistas parece fuera de marca, dilo en vez de usarlo como modelo. ';
const BASE_REALIDAD_2 = 'REALIDAD DE SU NEGOCIO (siempre): no siempre hay proyectos con famosos ni clientes llamativos disponibles. NO propongas series ni ideas que dependan de que exista un cliente famoso o un proyecto concreto; prioriza contenido que pueda hacer cualquier semana (explicar procesos, errores típicos, comparativas, cifras reales de obra, detrás de cámaras, reutilizar material que ya tiene, él solo con el móvil). Si una idea aprovecha un proyecto o cliente concreto, márcala como "oportunista: solo si hay proyecto".\nCÓMO PUBLICA: sube el MISMO vídeo vertical a la vez a Instagram (Reels), TikTok y YouTube Shorts desde Metricool. Por tanto el plan es UNA sola agenda: un único calendario con día y hora pensados para Instagram, sin días ni horas separados por plataforma, y sin contenido pensado solo para YouTube o TikTok. Instagram es la prioridad; el resto se beneficia del mismo vídeo. Las historias son solo de Instagram.\n';
const textoPrefs = () => BASE_REALIDAD + BASE_REALIDAD_2 + RUMBO_TXT + PREFS_TXT;
const RUTA_OBJETIVO = 'crm/redes/objetivo.json';
const objetivoActual = async () => { await refrescaPrefs(); const o = await leerJson(RUTA_OBJETIVO, null); return OBJETIVOS[o?.id] ? o.id : 'crecimiento'; };
const redondea = (x) => Math.round(x * 10) / 10;
const puntua = (m, seg, obj = 'crecimiento') => (OBJETIVOS[obj] || OBJETIVOS.crecimiento).f(m);
const textoObjetivo = (obj) => { const o = OBJETIVOS[obj] || OBJETIVOS.crecimiento; return textoPrefs() + 'OBJETIVO ELEGIDO: «' + o.nombre + '» — ' + o.que + ' Se mide así: ' + o.formula + ' Juzga "lo que funciona" SOLO con ese criterio.'; };
// Un reel de prueba es el que casi no se ha mostrado a nadie (alcance muy por debajo de lo habitual de la cuenta). Se detecta solo y se puede corregir a mano.
const RUTA_CALIB = 'crm/redes/calibracion.json';
const RUTA_PRUEBAS = 'crm/redes/pruebas.json';
const RUTA_PERIODO = 'crm/redes/periodo.json';
async function marcaPruebas(media, { ignoraPeriodo = false } = {}) {
  const rumboMapa = await leerJson(RUTA_RUMBO_POSTS, {}); media = media.map(m => (rumboMapa[m.id] ? { ...m, rumbo: rumboMapa[m.id] } : m));
  const per = ignoraPeriodo ? { dias: 0 } : await leerJson(RUTA_PERIODO, { dias: 0 }), corte = Number(per.dias) > 0 ? Date.now() - Number(per.dias) * 86400000 : 0;
  const ov = await leerJson(RUTA_PRUEBAS, { si: [], no: [] }), v = media.map(vistasDe).filter(Number.isFinite), med = mediana(v) || 0, umbral = Math.max(150, med * 0.04);
  return media.map(m => { if (corte && new Date(m.fecha).getTime() < corte) return { ...m, prueba: true, prueba_auto: false, motivo: 'periodo' }; const auto = (vistasDe(m) ?? 0) < umbral; const prueba = ov.si.includes(m.id) ? true : ov.no.includes(m.id) ? false : auto; return { ...m, prueba, prueba_auto: auto, motivo: prueba ? (ov.motivo?.[m.id] || (auto && !ov.si.includes(m.id) ? 'pocas_vistas' : 'prueba')) : null }; });
}
// ── TALLER DE IDEAS: de una idea a un guion por escenas (con micro, qué grabar, qué renderizar, música) y un chat para pulirlo
const RUTA_GUIONES = 'crm/redes/guiones.json';
const FORMATOS_GRABACION = 'selfie en mano (cámara frontal, tú hablando, cerca) | yo delante de cámara en trípode (plano medio, a la altura de los ojos, espacio detrás) | pantalla dividida (arriba una imagen/render/antes y abajo tú, o izquierda/derecha para comparar) | grabación de pantalla (screen recording del 3D, el plano, una web o una herramienta, con tu voz encima) | voz en off sobre imágenes (b-roll de obra, renders o fotos) | POV en primera persona (la cámara es tus ojos, haciendo algo con las manos) | walk-and-talk (andando por la obra o el espacio mientras hablas) | time-lapse (cámara fija y proceso acelerado) | antes y después en plano fijo (misma toma antes y después, con transición) | entrevista a dos cámaras o a una con pregunta en pantalla | reacción (tú reaccionando a un vídeo, foto o render en pantalla, en esquina o dividido) | pantalla verde (tú delante de un fondo que cambia) | pizarra o boceto a mano (dibujando mientras explicas) | carrusel de fotos con voz';
const ESQUEMA_GUION = '{"titulo":"","formato":"","formato_grabacion":{"tipo":"UNO exacto del catálogo","por_que":"por qué es el mejor para ESTA idea","dispositivo":"móvil|cámara|pantalla del ordenador","orientacion":"vertical 9:16","distancia_y_angulo":"a cuántos metros/cm, a qué altura, de frente o 3/4","donde_te_pones":"lugar exacto y qué se ve detrás","luz":"de dónde viene y qué evitar","sonido":"micro de solapa o cerca del móvil; qué ruido evitar","ajustes":"resolución y fps, cuadrícula, bloquear enfoque y exposición","tomas":["cada toma en orden: qué grabar, cuánto dura, qué dices o haces, dónde empieza y acaba"],"antes_de_grabar":["checklist breve"],"errores_a_evitar":["errores típicos de ESTE formato"],"como_se_monta":"cómo queda en la edición: capas, posiciones y proporciones (ej. pantalla dividida 50/50 con tú abajo y el render arriba)"},"duracion_seg":0,"objetivo":"","necesita_micro":true,"equipo":["micro de solapa","trípode","..."],"ganchos_alternativos":["3 ganchos distintos para probar"],"si_no_puedes_hoy":{"se_puede_hoy":true,"que_falta":"si no se puede hacer tal cual hoy: qué no tiene (cliente, lugar, material)","como_conseguirlo":["pasos para poder hacerlo"],"alternativa_hoy":"versión que sí puede grabar ya con lo que tiene"},"proyecto_y_fase":"proyecto activo (sin nombre de cliente) y fase que permite grabarlo, o vacío","escenas":[{"n":1,"recurso":"clip ya grabado que sirve (carpeta y de qué va) o «grabar nuevo»","como_grabar":"exactamente cómo grabar ESTA escena (posición, plano, movimiento, qué haces con las manos, dónde miras)","tipo":"a_camara|broll|render|pantalla|voz_en_off","micro":true,"segundos":0,"que_hacer":"qué grabar o qué renderizar, concreto","hablado":"lo que dice Víctor, con su voz, tal cual (vacío si no habla)","texto_pantalla":"","edicion":"ritmo, efecto o corte sugerido"}],"cta":"","lead_magnet":{"nombre":"nombre de la herramienta que se regala","tipo":"checklist|guía PDF|plantilla|calculadora|mini auditoría|mood board|vídeo tutorial|herramienta web|catálogo|otro","palabra_clave":"UNA palabra en mayúsculas para comentar","promesa":"qué consigue quien lo recibe, en una frase","contenido":["las secciones o pasos que lleva"],"mensaje_dm":"el mensaje exacto que se le manda por DM, en la voz de Víctor","esfuerzo":"bajo|medio|alto","quien_lo_crea":"la herramienta puede generarlo (guía/checklist/plantilla en PDF) | hay que construirlo aparte (calculadora, herramienta web)","por_que_convierte":"por qué esto atrae a su cliente ideal"},"musica":{"estilo":"","bpm":"","ambiente":"","nota":"tipo de pista; los audios de tendencia de Instagram no se pueden descargar, se elige uno parecido de su librería"},"para_el_editor":"indicaciones para la IA que monta el vídeo","preguntas":["dudas que necesitas que Víctor resuelva para afinar el guion"]}';
const limpiaGuion = (g) => ({
  titulo: limpia(g?.titulo, 140), formato_grabacion: g?.formato_grabacion && typeof g.formato_grabacion === 'object' ? { tipo: limpia(g.formato_grabacion.tipo, 120), por_que: limpia(g.formato_grabacion.por_que, 260), dispositivo: limpia(g.formato_grabacion.dispositivo, 60), orientacion: limpia(g.formato_grabacion.orientacion, 40), distancia_y_angulo: limpia(g.formato_grabacion.distancia_y_angulo, 220), donde_te_pones: limpia(g.formato_grabacion.donde_te_pones, 240), luz: limpia(g.formato_grabacion.luz, 220), sonido: limpia(g.formato_grabacion.sonido, 220), ajustes: limpia(g.formato_grabacion.ajustes, 200), tomas: (g.formato_grabacion.tomas || []).slice(0, 14).map(x => limpia(x, 260)), antes_de_grabar: (g.formato_grabacion.antes_de_grabar || []).slice(0, 8).map(x => limpia(x, 160)), errores_a_evitar: (g.formato_grabacion.errores_a_evitar || []).slice(0, 6).map(x => limpia(x, 180)), como_se_monta: limpia(g.formato_grabacion.como_se_monta, 360) } : null, lead_magnet: g?.lead_magnet && typeof g.lead_magnet === 'object' ? { nombre: limpia(g.lead_magnet.nombre, 120), tipo: limpia(g.lead_magnet.tipo, 40), palabra_clave: limpia(g.lead_magnet.palabra_clave, 30).toUpperCase(), promesa: limpia(g.lead_magnet.promesa, 240), contenido: (g.lead_magnet.contenido || []).slice(0, 10).map(x => limpia(x, 160)), mensaje_dm: limpia(g.lead_magnet.mensaje_dm, 500), esfuerzo: limpia(g.lead_magnet.esfuerzo, 12), quien_lo_crea: limpia(g.lead_magnet.quien_lo_crea, 200), por_que_convierte: limpia(g.lead_magnet.por_que_convierte, 240) } : null, proyecto_y_fase: limpia(g?.proyecto_y_fase, 260), si_no_puedes_hoy: g?.si_no_puedes_hoy && g.si_no_puedes_hoy.se_puede_hoy === false ? { que_falta: limpia(g.si_no_puedes_hoy.que_falta, 260), como_conseguirlo: (g.si_no_puedes_hoy.como_conseguirlo || []).slice(0, 6).map(x => limpia(x, 220)), alternativa_hoy: limpia(g.si_no_puedes_hoy.alternativa_hoy, 300) } : null, formato: limpia(g?.formato, 40), duracion_seg: Math.max(0, Number(g?.duracion_seg) || 0), objetivo: limpia(g?.objetivo, 80), necesita_micro: !!g?.necesita_micro,
  equipo: (g?.equipo || []).slice(0, 10).map(x => limpia(x, 80)), ganchos_alternativos: (g?.ganchos_alternativos || []).slice(0, 5).map(x => limpia(x, 220)),
  escenas: (g?.escenas || []).slice(0, 25).map((s, i) => ({ n: i + 1, tipo: ['a_camara', 'broll', 'render', 'pantalla', 'voz_en_off'].includes(s?.tipo) ? s.tipo : 'broll', micro: !!s?.micro || s?.tipo === 'a_camara' || s?.tipo === 'voz_en_off', segundos: Math.max(0, Number(s?.segundos) || 0), recurso: limpia(s?.recurso, 200), como_grabar: limpia(s?.como_grabar, 380), que_hacer: limpia(s?.que_hacer, 400), hablado: limpia(s?.hablado, 600), texto_pantalla: limpia(s?.texto_pantalla, 120), edicion: limpia(s?.edicion, 240) })),
  cta: limpia(g?.cta, 240), musica: { estilo: limpia(g?.musica?.estilo, 100), bpm: limpia(g?.musica?.bpm, 20), ambiente: limpia(g?.musica?.ambiente, 120), nota: limpia(g?.musica?.nota, 240) }, para_el_editor: limpia(g?.para_el_editor, 900), preguntas: (g?.preguntas || []).slice(0, 6).map(x => limpia(x, 220)),
});
async function contextoCreativo() {
  const vm = await leerJson(RUTA_VOZ_MARCA, null), ap = await leerJson(RUTA_APRENDIZAJE, null), ni = await leerJson(RUTA_NICHO, {}), obj = await objetivoActual();
  return textoObjetivo(obj) + (vm ? '\nSU VOZ REAL (escribe así): ' + JSON.stringify({ rasgos: vm.rasgos, muletillas: vm.muletillas, como_abre: vm.como_abre, frases: vm.frases_tipo, evitar: vm.evitar }) : '') + '\nLO QUE SE HA APRENDIDO DE SU CUENTA: ' + JSON.stringify(ap ? { funciona: ap.lo_que_funciona, no: ap.lo_que_no, ganchos: ap.ganchos_ganadores, editor: ap.para_el_editor } : 'sin analizar') + '\nNICHO: ' + JSON.stringify({ ig: ni.instagram ? { patrones: ni.instagram.patrones, ganchos: ni.instagram.ganchos } : null, yt: ni.youtube ? { patrones: ni.youtube.patrones } : null });
}
const SISTEMA_GUION = 'Eres el guionista y director de Víctor Palomo (Ranuse Design, diseño de espacios deportivos y gimnasios). Escribes SU voz: cercana, directa, de profesional que sabe, sin postureo ni frases de manual. Conviertes una idea en un guion REAL por escenas. Reglas: (1) cada escena dice si Víctor habla a cámara o en off (micro:true) o si es solo imagen (micro:false); (2) en "que_hacer" di exactamente qué grabar (plano, lugar, acción) o qué renderizar (qué vista del 3D, qué cámara); aprovecha los renders y planos que él ya produce; (3) el gancho va en los primeros 2 segundos; (4) termina con un CTA acorde al objetivo elegido; (5) propón música (estilo y bpm) sin inventar canciones concretas; (6) si te falta información importante, ponla en "preguntas" en vez de inventarla; (8) LEAD MAGNET: propone una herramienta CONCRETA y útil para entregar a quien comente la palabra clave del CTA (el CTA del vídeo debe usar esa palabra). Debe resolver el problema del vídeo en 2 minutos, ser creíble para el cliente que quiere (home gym, deportistas) y atraer también a la audiencia amplia. No prometas cálculos con cifras que no tengas: si es una calculadora, dilo en quien_lo_crea. (7a) Si la idea NO se puede hacer tal cual hoy (le falta un cliente de ese tipo, un lugar o un material), NO la descartes ni la cambies: escribe el guion completo igualmente y rellena si_no_puedes_hoy con qué falta, cómo conseguirlo y una alternativa que sí pueda grabar ya. (7b) USA LO QUE TIENE: si hay clips ya grabados que encajan, cítalos en la escena correspondiente (campo recurso) en vez de pedir grabar de nuevo; si hay un proyecto activo cuya fase permite grabar esto, dilo en proyecto_y_fase. (7) ELIGE el formato de grabación más adecuado de este catálogo y explica EXACTAMENTE cómo grabarlo, como si se lo explicaras a alguien que no ha grabado nunca (dónde colocar el móvil, a qué altura, qué se ve detrás, la luz, el sonido, qué tomas y en qué orden): ' + FORMATOS_GRABACION + '. Si la idea pide mezclar (por ejemplo pantalla dividida con tú delante), dilo y explica cada parte. Cada escena lleva su "como_grabar" concreto. Devuelves SOLO JSON con esta forma: ' + ESQUEMA_GUION;
router.post('/guion/generar', async (req, res) => {
  try {
    const idea = limpia(req.body?.idea, 400), formato = limpia(req.body?.formato, 40), gancho = limpia(req.body?.gancho, 240), origen = limpia(req.body?.origen, 20), extra = limpia(req.body?.extra, 600);
    if (!idea && !gancho) return res.status(400).json({ error: 'Falta la idea' });
    const r = json(await callClaude({ system: SISTEMA_GUION, messages: [{ role: 'user', content: (await contextoCreativo()) + '\n\n' + (await contextoMaterial(idea + ' ' + gancho)) + '\n\nIDEA: ' + idea + '\nFORMATO: ' + (formato || 'el que mejor encaje') + '\nGANCHO PROPUESTO: ' + gancho + '\nORIGEN: ' + origen + (extra ? '\nINDICACIONES DE VÍCTOR: ' + extra : '') }], maxTokens: 6000 }));
    const g = { id: crypto.randomUUID(), creado: new Date().toISOString(), idea, origen, ...limpiaGuion(r) };
    const todos = await leerJson(RUTA_GUIONES, []); await guardarJson(RUTA_GUIONES, [g, ...todos].slice(0, 40)); res.json({ guion: g });
  } catch (err) { res.status(500).json({ error: 'No se pudo crear el guion: ' + String(err.message || err).slice(0, 160) }); }
});
router.post('/guion/chat', async (req, res) => {
  try {
    const actual = req.body?.guion, msg = limpia(req.body?.mensaje, 1200); if (!actual || !msg) return res.status(400).json({ error: 'Falta el guion o el mensaje' });
    const r = json(await callClaude({ system: SISTEMA_GUION.replace('Devuelves SOLO JSON con esta forma: ', 'Víctor te pide cambios o responde a tus preguntas sobre el guion actual. Aplícalos y devuelve SOLO JSON {"respuesta":"1-3 frases diciendo qué has cambiado o contestando su duda","guion": <guion completo actualizado con esta forma> , "preguntas_nuevas":["si aún te falta algo"]}. Forma del guion: '), messages: [{ role: 'user', content: (await contextoCreativo()) + '\n\nGUION ACTUAL: ' + JSON.stringify(actual).slice(0, 12000) + '\n\nVÍCTOR DICE: ' + msg }], maxTokens: 7000 }));
    const g = { ...limpiaGuion(r.guion || r), id: actual.id, creado: actual.creado, idea: actual.idea, origen: actual.origen };
    if (r.preguntas_nuevas?.length) g.preguntas = r.preguntas_nuevas.slice(0, 6).map(x => limpia(x, 220));
    if (g.id) { const todos = await leerJson(RUTA_GUIONES, []); await guardarJson(RUTA_GUIONES, todos.map(x => x.id === g.id ? g : x)); }
    res.json({ guion: g, respuesta: limpia(r.respuesta, 500) });
  } catch (err) { res.status(500).json({ error: 'No se pudo ajustar el guion: ' + String(err.message || err).slice(0, 160) }); }
});
router.get('/guiones', async (req, res) => { try { res.json({ guiones: await leerJson(RUTA_GUIONES, []) }); } catch { res.status(500).json({ error: 'No se pudieron leer' }); } });
// ── ANÁLISIS DE VÍDEOS: el worker mira cómo están editados tus reels (ritmo, planos, gancho, voz) sin guardarlos, y se cruza con lo que rindieron
const RUTA_VIDEOS = 'crm/redes/analisis_videos.json', RUTA_VIDEOS_JOB = 'crm/redes/analisis_videos_job.json';
router.post('/instagram/videos/analizar', async (req, res) => {
  try {
    const c = await leerJson(RUTA_IG, null); if (!c?.token) return res.status(400).json({ error: 'Conecta Instagram primero' });
    const obj = await objetivoActual(), reales = (await marcaPruebas(c.media || [])).filter(m => !m.prueba && /VIDEO|REELS/i.test((m.tipo || '') + ' ' + (m.formato || '')));
    if (reales.length < 6) return res.status(422).json({ error: 'Hacen falta al menos 6 reels leídos (pulsa «Leer publicaciones»).' });
    const orden = reales.map(m => ({ m, p: puntua(m, c.seguidores, obj) })).sort((a, b) => b.p - a.p), cuantos = Math.min(14, orden.length), nTop = Math.ceil(cuantos * 0.65);
    const elegidos = [...orden.slice(0, nTop), ...orden.slice(-(cuantos - nTop))];
    const videos = [];
    const urls = await Promise.all(elegidos.map(async x => { try { const j = await graph('/' + x.m.id, { fields: 'media_url' }, c.token); return j.media_url ? { id: x.m.id, url: j.media_url, enlace: x.m.enlace, pie: limpia(x.m.pie, 140), puntuacion: redondea(x.p) } : null; } catch { return null; } }));
    for (const v of urls) if (v) videos.push(v);
    if (!videos.length) return res.status(502).json({ error: 'Instagram no ha dado acceso a los vídeos.' });
    const t = await creaTrabajoSistema({ id: 'a' + crypto.randomUUID().slice(0, 7), creado: new Date().toISOString(), por: 'sistema', tipo: 'analisis_redes', objetivo: obj, videos, nombre_archivo: 'Análisis de tus reels', estado: 'pendiente', progreso: 'En cola', version: 1 });
    await guardarJson(RUTA_VIDEOS_JOB, { id: t.id, objetivo: obj, fecha: new Date().toISOString() }); res.json({ ok: true, id: t.id, n: videos.length });
  } catch (e) { res.status(500).json({ error: 'No se pudo lanzar el análisis: ' + String(e.message || e).slice(0, 140) }); }
});
router.get('/instagram/videos', async (req, res) => {
  try {
    const job = await leerJson(RUTA_VIDEOS_JOB, null), prev = await leerJson(RUTA_VIDEOS, null); if (!job) return res.json({ estado: 'ninguno', analisis: prev });
    if (prev && prev.job === job.id) return res.json({ estado: 'listo', analisis: prev });
    const t = await leeTrabajoSistema(job.id); if (!t) return res.json({ estado: 'ninguno', analisis: prev });
    if (t.estado === 'error') return res.json({ estado: 'error', error: t.error, analisis: prev });
    if (t.estado !== 'listo') return res.json({ estado: 'procesando', progreso: t.progreso, pct: t.pct || 0, analisis: prev });
    const ok = (t.analisis_videos || []).filter(v => v.analisis);
    if (ok.length < 3) return res.json({ estado: 'error', error: 'No se han podido analizar suficientes vídeos (' + ok.length + ').', analisis: prev });
    try { const prevT = await leerJson('crm/redes/transcripciones.json', []), mapa = new Map(prevT.map(x => [x.id, x])); for (const v of ok) if (v.analisis.hablado) mapa.set(v.id, { id: v.id, pie: v.pie, puntuacion: v.puntuacion, hablado: v.analisis.hablado }); await guardarJson('crm/redes/transcripciones.json', [...mapa.values()].slice(-60)); } catch { /* sin guardar transcripciones */ }
    const ficha = (v) => ({ pie: v.pie, puntuacion: v.puntuacion, duracion: v.analisis.dur, planos: v.analisis.planos, plano_medio_s: v.analisis.plano_medio, palabras_por_min: v.analisis.palabras_por_min, descripcion: v.analisis.descripcion, estructura: v.analisis.estructura, receta: v.analisis.receta, a_fondo: v.analisis.detalle ? { gancho: v.analisis.detalle.gancho, grabacion: v.analisis.detalle.grabacion, presencia: v.analisis.detalle.presencia, edicion: v.analisis.detalle.edicion, audio: v.analisis.detalle.audio, narrativa: v.analisis.detalle.narrativa } : null });
    const r = json(await callClaude({ system: textoObjetivo(job.objetivo || 'equilibrado') + ' Eres analista de edición de vídeo corto para Víctor Palomo (Ranuse Design). Te paso el análisis técnico de cómo están EDITADOS sus reels, con la puntuación que sacó cada uno (mayor = funcionó mejor según su objetivo). Compara los que mejor y peor funcionaron y deduce QUÉ marca la diferencia: duración, ritmo de planos, gancho, voz, estructura Y TAMBIÉN cómo está grabado (plano, ángulo, luz, lugar), su presencia (mirada, gestos, energía) y el audio, usando el campo a_fondo cuando exista. Cita gestos y detalles concretos. No inventes: si no se ve diferencia clara, dilo. Devuelves SOLO JSON {"resumen":"2-3 frases","gana":["rasgo de edición de los que funcionan"],"pierde":["rasgo de los que no"],"duracion_ideal_s":"rango","ritmo_ideal":"plano medio en segundos","reglas_edicion":["regla corta e imperativa para el editor automático"],"fiabilidad":"alta|media|baja y por qué"}', messages: [{ role: 'user', content: JSON.stringify(ok.sort((a, b) => b.puntuacion - a.puntuacion).map(ficha)) }], maxTokens: 3500 }));
    const out = { job: job.id, fecha: new Date().toISOString(), objetivo: job.objetivo, n: ok.length, videos: ok.map(v => ({ id: v.id, enlace: v.enlace, pie: v.pie, puntuacion: v.puntuacion, dur: v.analisis.dur, planos: v.analisis.planos, plano_medio: v.analisis.plano_medio, palabras_por_min: v.analisis.palabras_por_min, descripcion: limpia(v.analisis.descripcion, 300) })), resumen: limpia(r.resumen, 500), gana: (r.gana || []).slice(0, 8).map(x => limpia(x, 240)), pierde: (r.pierde || []).slice(0, 8).map(x => limpia(x, 240)), duracion_ideal_s: limpia(r.duracion_ideal_s, 40), ritmo_ideal: limpia(r.ritmo_ideal, 60), detalle_reels: ok.map(v => ({ id: v.id, enlace: v.enlace, pie: v.pie, puntuacion: v.puntuacion, detalle: v.analisis.detalle || null })).filter(x => x.detalle), reglas_edicion: (r.reglas_edicion || []).slice(0, 8).map(x => limpia(x, 220)), fiabilidad: limpia(r.fiabilidad, 240) };
    await guardarJson(RUTA_VIDEOS, out); res.json({ estado: 'listo', analisis: out });
  } catch (e) { res.status(500).json({ error: 'No se pudo leer el análisis: ' + String(e.message || e).slice(0, 140) }); }
});
// Música en tendencia: lista de lo más escuchado hoy en España (YouTube Música). Sirve de pista para buscar ese audio dentro de Instagram al publicar; los audios de Instagram en sí no tienen API pública.
const RUTA_MUSICA = 'crm/redes/musica_tendencia.json';
router.get('/musica/tendencias', async (req, res) => {
  try {
    const guardado = await leerJson(RUTA_MUSICA, null), region = String(req.query.region || 'ES').toUpperCase().slice(0, 2);
    if (guardado && guardado.region === region && !req.query.refrescar && Date.now() - new Date(guardado.fecha).getTime() < 6 * 3600e3) return res.json(guardado);
    const cfg = await leerJson(RUTA_CONFIG, {}), clave = cfg.youtube_key || process.env.YOUTUBE_API_KEY; if (!clave) return res.status(400).json({ error: 'Falta la clave de YouTube.' });
    const j = await ytLlamada(clave, 'videos', { part: 'snippet,statistics', chart: 'mostPopular', videoCategoryId: '10', regionCode: region, maxResults: '30' });
    const lista = (j.items || []).map((v, i) => ({ puesto: i + 1, titulo: limpia(v.snippet?.title, 120), artista: limpia(v.snippet?.channelTitle, 80), vistas: Number(v.statistics?.viewCount) || 0, enlace: 'https://www.youtube.com/watch?v=' + v.id, miniatura: v.snippet?.thumbnails?.medium?.url || '' }));
    const out = { fecha: new Date().toISOString(), region, lista }; await guardarJson(RUTA_MUSICA, out); res.json(out);
  } catch (e) { res.status(500).json({ error: 'No se pudo leer la música en tendencia: ' + String(e.message || e).slice(0, 140) }); }
});
// ── SALUD DE LA CUENTA: seguidores, alcance e interacción ahora frente al periodo anterior, y un diagnóstico claro (¿creces o pierdes? ¿por qué? ¿qué haces?)
const RUTA_SALUD = 'crm/redes/salud.json', RUTA_HIST_SEG = 'crm/redes/seguidores_hist.json';
const sumaPeriodo = (media, ini, fin) => { const l = media.filter(m => { const t = new Date(m.fecha).getTime(); return t >= ini && t < fin; }); const s = (k) => l.reduce((a, m) => a + n0(m[k]), 0); const v = l.map(m => n0(m.views) || n0(m.reach)); return { publicaciones: l.length, reels: l.filter(m => /VIDEO|REELS/i.test((m.tipo || '') + ' ' + (m.formato || ''))).length, vistas_totales: v.reduce((a, b) => a + b, 0), vistas_medias: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0, comentarios: s('comentarios'), compartidos: s('shares'), guardados: s('saved'), me_gusta: s('me_gusta') }; };
router.post('/cuenta/salud', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(400).json({ error: 'Conecta Instagram primero' });
    const DIA = 86400000, ahora = Date.now(), seg = (d) => Math.floor((ahora - d * DIA) / 1000);
    let perfil = {}; try { perfil = await graph('/' + c.ig_id, { fields: 'followers_count,follows_count,media_count' }, c.token); } catch { /* sin perfil */ }
    // histórico propio de seguidores: una foto al día, para ver la evolución real aunque Instagram solo guarde 30 días
    const hist = await leerJson(RUTA_HIST_SEG, []), hoy = new Date().toISOString().slice(0, 10);
    if (perfil.followers_count != null && !hist.some(h => h.dia === hoy)) { hist.push({ dia: hoy, seguidores: perfil.followers_count }); await guardarJson(RUTA_HIST_SEG, hist.slice(-800)); }
    // serie diaria de seguidores de los últimos 30 días (Instagram)
    let serie = []; try { const j = await graph('/' + c.ig_id + '/insights', { metric: 'follower_count', period: 'day', since: seg(29), until: seg(0) }, c.token); serie = (j.data?.[0]?.values || []).map(v => ({ dia: String(v.end_time).slice(0, 10), neto: Number(v.value) || 0 })); } catch { /* métrica no disponible */ }
    const total = async (metric, desde, hasta) => { try { const j = await graph('/' + c.ig_id + '/insights', { metric, period: 'day', metric_type: 'total_value', since: seg(desde), until: seg(hasta) }, c.token); return j.data?.[0]?.total_value?.value ?? null; } catch { return null; } };
    const metricas = {}; for (const m of ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_views']) metricas[m] = { ahora: await total(m, 28, 0), antes: await total(m, 56, 28) };
    const media = await marcaPruebas(c.media || [], { ignoraPeriodo: true }), reales = media.filter(m => !m.prueba);
    const ahoraP = sumaPeriodo(reales, ahora - 30 * DIA, ahora + DIA), antesP = sumaPeriodo(reales, ahora - 60 * DIA, ahora - 30 * DIA);
    const netoMes = serie.reduce((a, x) => a + x.neto, 0), ultimaSemana = serie.slice(-7).reduce((a, x) => a + x.neto, 0), semanaAnt = serie.slice(-14, -7).reduce((a, x) => a + x.neto, 0);
    const obj = await objetivoActual(), ap = await leerJson(RUTA_APRENDIZAJE, null);
    const datos = { seguidores_hoy: perfil.followers_count ?? c.seguidores, seguidores_neto_30d: serie.length ? netoMes : null, seguidores_neto_ultima_semana: serie.length ? ultimaSemana : null, seguidores_neto_semana_anterior: serie.length ? semanaAnt : null, serie_diaria_30d: serie.map(x => x.neto), historico_propio: hist.slice(-12), metricas_28d_frente_a_28d_anteriores: metricas, publicaciones_30d: ahoraP, publicaciones_30d_anteriores: antesP, lo_aprendido: ap ? { funciona: ap.lo_que_funciona, no: ap.lo_que_no } : null, objetivo: textoObjetivo(obj) };
    const r = json(await callClaude({ system: 'Eres el analista de crecimiento de Instagram de Víctor Palomo (Ranuse Design, diseño de gimnasios). Comparas el periodo actual con el anterior y le hablas claro y directo, sin rodeos, en segunda persona: si está ganando o perdiendo seguidores y a qué ritmo, qué ha mejorado y qué ha empeorado respecto al periodo anterior (con los números), y la causa MÁS PROBABLE apoyándote solo en los datos (menos publicaciones, menos reels, vistas medias a la baja, poco compartido…). Nunca afirmes una causa como segura: di «lo más probable es». Si un dato es null, no lo tienes: dilo, no lo inventes. Termina con 3 acciones concretas. Devuelves SOLO JSON {"titular":"una frase que resume cómo va la cuenta","tendencia":"sube|estable|baja","mejoras":["has mejorado en… con cifras"],"alertas":["si sigues así… con cifras y causa probable"],"acciones":["acción concreta"],"fiabilidad":"qué datos faltan"}', messages: [{ role: 'user', content: JSON.stringify(datos) }], maxTokens: 3000 }));
    const out = { fecha: new Date().toISOString(), seguidores: datos.seguidores_hoy, neto_30d: datos.seguidores_neto_30d, neto_semana: datos.seguidores_neto_ultima_semana, neto_semana_anterior: datos.seguidores_neto_semana_anterior, serie: serie.map(x => x.neto), metricas, ahora: ahoraP, antes: antesP, titular: limpia(r.titular, 200), tendencia: ['sube', 'estable', 'baja'].includes(r.tendencia) ? r.tendencia : 'estable', mejoras: (r.mejoras || []).slice(0, 6).map(x => limpia(x, 260)), alertas: (r.alertas || []).slice(0, 6).map(x => limpia(x, 300)), acciones: (r.acciones || []).slice(0, 5).map(x => limpia(x, 260)), fiabilidad: limpia(r.fiabilidad, 260) };
    await guardarJson(RUTA_SALUD, out); res.json(out);
  } catch (e) { res.status(500).json({ error: 'No se pudo analizar la cuenta: ' + String(e.message || e).slice(0, 160) }); }
});
router.get('/cuenta/salud', async (req, res) => { try { res.json(await leerJson(RUTA_SALUD, null) || {}); } catch { res.status(500).json({ error: 'No se pudo leer' }); } });
// Predecir con un vídeo YA EDITADO: se sube, el worker mide cómo está montado (ritmo, gancho, voz, duración) y eso se añade a la predicción
router.post('/video/analizar', async (req, res) => {
  try {
    const ruta = String(req.body?.ruta || ''); if (!/^entradas\//.test(ruta)) return res.status(400).json({ error: 'Falta el vídeo subido' });
    const t = await creaTrabajoSistema({ id: 'p' + crypto.randomUUID().slice(0, 7), creado: new Date().toISOString(), por: 'sistema', tipo: 'analisis_redes', ...(req.body?.predecir ? { pred: { propuesta: limpia(req.body?.propuesta, 2000), formato: limpia(req.body?.formato, 40) } } : {}), videos: [{ id: 'subido', ruta, pie: limpia(req.body?.nombre, 100) }], nombre_archivo: 'Vídeo para predecir', estado: 'pendiente', progreso: 'En cola', version: 1 });
    res.json({ ok: true, id: t.id });
  } catch (e) { res.status(500).json({ error: 'No se pudo analizar el vídeo: ' + String(e.message || e).slice(0, 140) }); }
});
const textoVideo = (a) => 'VÍDEO YA EDITADO (medido por la IA): dura ' + Math.round(a.dur) + ' s, ' + a.planos + ' planos (plano medio ' + a.plano_medio + ' s), ' + (a.palabras_por_min ? a.palabras_por_min + ' palabras por minuto' : 'sin voz hablada') + '. ' + limpia(a.descripcion, 400) + ' Estructura: ' + (a.estructura || []).map(x => limpia(x, 160)).join(' | ') + (a.audio_medido ? ' AUDIO MEDIDO: ' + JSON.stringify(a.audio_medido) + '.' : '') + (a.detalle ? ' ANÁLISIS A FONDO (visto fotograma a fotograma): ' + JSON.stringify({ gancho: a.detalle.gancho, grabacion: a.detalle.grabacion, presencia: a.detalle.presencia, edicion: a.detalle.edicion, narrativa: a.detalle.narrativa }).slice(0, 2800) : '');
export async function prediccionDeTrabajo(t) {
  if (t.pred_resultado) return t.pred_resultado;
  const a = t.analisis_videos?.[0]?.analisis; if (!a || !t.pred) return null;
  const base = t.pred.propuesta && t.pred.propuesta.length >= 15 ? t.pred.propuesta : 'Vídeo ya editado, sin más descripción.';
  const out = await calculaPrediccion(base + '\n\n' + textoVideo(a), t.pred.formato || 'reel');
  const { guardaTrabajoSistema } = await import('./estudio-video.routes.js'); await guardaTrabajoSistema({ ...t, pred_resultado: out });
  return out;
}
router.get('/video/:id', async (req, res) => {
  try {
    const t = await leeTrabajoSistema(String(req.params.id).replace(/[^\w-]/g, '')); if (!t) return res.status(404).json({ error: 'No existe' });
    if (t.estado === 'error') return res.json({ estado: 'error', error: t.error });
    if (t.estado !== 'listo') return res.json({ estado: 'procesando', progreso: t.progreso, pct: t.pct || 0 });
    const a = t.analisis_videos?.[0]?.analisis; if (!a) return res.json({ estado: 'error', error: t.analisis_videos?.[0]?.error || 'No he podido leer el vídeo' });
    const texto = textoVideo(a); let prediccion = null; if (t.pred) { try { prediccion = await prediccionDeTrabajo(t); } catch (e) { return res.json({ estado: 'error', error: 'El vídeo se analizó, pero falló la estimación: ' + String(e.message).slice(0, 120) }); } }
    res.json({ estado: 'listo', prediccion, texto, dur: a.dur, planos: a.planos, plano_medio: a.plano_medio, detalle: a.detalle || null, descripcion: limpia(a.descripcion, 400), estructura: a.estructura || [] });
  } catch (e) { res.status(500).json({ error: 'No se pudo leer el análisis' }); }
});
// ── HISTORIAS: Instagram solo deja leer las historias mientras están activas (24 h), así que se guardan solas cada pocas horas con sus números
const RUTA_HISTORIAS_IG = 'crm/redes/historias_ig.json';
export async function sincronizarHistoriasIG() {
  const c = await conexion(); if (!c) return { n: 0 };
  let j; try { j = await graph('/' + c.ig_id + '/stories', { fields: 'id,media_type,permalink,timestamp,thumbnail_url,media_url' }, c.token); } catch (e) { return { n: 0, error: String(e.message).slice(0, 120) }; }
  const d = await leerJson(RUTA_HISTORIAS_IG, { historias: [] }), por = new Map((d.historias || []).map(h => [h.id, h]));
  for (const s of (j.data || [])) {
    const h = por.get(s.id) || { id: s.id, fecha: s.timestamp, tipo: s.media_type, enlace: s.permalink };
    for (const m of ['reach', 'replies', 'shares', 'total_interactions', 'views', 'follows', 'profile_visits']) { try { const r = await graph('/' + s.id + '/insights', { metric: m }, c.token); const x = r.data?.[0]; const v = x?.values?.[0]?.value ?? x?.total_value?.value; if (v != null) h[m] = Number(v) || 0; } catch { /* métrica no disponible para esta historia */ } }
    try { const r = await graph('/' + s.id + '/insights', { metric: 'navigation', breakdown: 'story_navigation_action_type' }, c.token); const res = r.data?.[0]?.total_value?.breakdowns?.[0]?.results || []; h.navegacion = Object.fromEntries(res.map(x => [String(x.dimension_values?.[0] || '').toLowerCase(), Number(x.value) || 0])); } catch { /* sin navegación */ }
    if (!h.descripcion) {
      try {
        const url = s.media_type === 'VIDEO' ? s.thumbnail_url : (s.media_url || s.thumbnail_url);
        if (url) {
          const rf = await fetch(url, { signal: AbortSignal.timeout(25000) }); const tipoImg = (rf.headers.get('content-type') || 'image/jpeg').split(';')[0];
          if (rf.ok && /^image\//.test(tipoImg)) {
            const buf = Buffer.from(await rf.arrayBuffer());
            if (buf.length < 4.5e6) {
              const r = json(await callClaude({ system: 'Miras UNA historia de Instagram de Víctor Palomo (Ranuse Design, diseño y montaje de gimnasios) y la describes para que su asistente sepa qué ha subido. Sé concreto y breve. Devuelves SOLO JSON {"resumen":"qué se ve y de qué va, en una frase","tipo":"personal|trabajo|autoridad|bastidores|cta|herramienta|otro","texto_en_pantalla":"texto legible o vacío","pegatina":"encuesta/pregunta/enlace u otra, si se ve, o vacío"}', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: tipoImg, data: buf.toString('base64') } }, { type: 'text', text: 'Describe esta historia.' }] }], maxTokens: 500 }));
              h.descripcion = limpia(r.resumen, 220); h.tipo_contenido = limpia(r.tipo, 20); h.texto_pantalla = limpia(r.texto_en_pantalla, 160); h.pegatina = limpia(r.pegatina, 80);
            }
          }
        }
      } catch { /* si no se puede mirar, se queda solo con los números */ }
    }
    h.actualizada = new Date().toISOString(); por.set(s.id, h);
  }
  const lista = [...por.values()].sort((a, b) => new Date(a.fecha) - new Date(b.fecha)).slice(-500);
  await guardarJson(RUTA_HISTORIAS_IG, { historias: lista, ultima_sync: new Date().toISOString() }); return { n: (j.data || []).length, total: lista.length };
}
router.post('/historias/sincronizar', async (req, res) => { try { res.json({ ok: true, ...(await sincronizarHistoriasIG()) }); } catch (e) { res.status(500).json({ error: 'No se pudieron leer las historias' }); } });
router.get('/historias', async (req, res) => { try { res.json(await leerJson(RUTA_HISTORIAS_IG, { historias: [] })); } catch { res.status(500).json({ error: 'No se pudieron leer' }); } });
// ── VOZ DE MARCA sacada de lo que Víctor dice y escribe de verdad (transcripciones de sus reels si las hay; si no, los textos que publica)
const RUTA_VOZ_MARCA = 'crm/redes/voz_marca.json';
router.post('/voz/sacar', async (req, res) => {
  try {
    const trans = (await leerJson('crm/redes/transcripciones.json', [])).filter(x => x.hablado && x.hablado.length > 80), c = await conexion();
    const pies = (c?.media || []).filter(m => m.pie && m.pie.length > 40).sort((a, b) => n0(b.views || b.reach) - n0(a.views || a.reach)).slice(0, 25).map(m => m.pie);
    if (trans.length < 3 && pies.length < 5) return res.status(422).json({ error: 'Aún no tengo textos tuyos suficientes: pulsa «Analizar mis reels» en Instagram (para oír lo que dices) o «Leer publicaciones».' });
    const fuente = trans.length >= 3 ? 'lo que dices en ' + trans.length + ' de tus reels' : 'los textos de tus ' + pies.length + ' publicaciones';
    const material = trans.length >= 3 ? trans.slice(0, 14).map(x => 'REEL (puntuación ' + x.puntuacion + '): ' + x.hablado) : pies.map(p => 'TEXTO: ' + p);
    const r = json(await callClaude({ system: 'Analizas cómo HABLA Víctor Palomo (Ranuse Design, diseño de gimnasios) a partir de lo que dice de verdad. Describe su voz con precisión para que otra IA escriba guiones que suenen a él. Solo lo que se vea en los textos; si algo no se ve, no lo inventes. Las frases tipo y las muletillas deben ser CITAS REALES de los textos. Devuelves SOLO JSON {"resumen":"2 frases sobre cómo habla","rasgos":["rasgo concreto de su forma de hablar"],"muletillas":["expresión real que repite"],"como_abre":["cómo suele empezar un vídeo (con cita real)"],"como_cierra":["cómo cierra o pide la acción"],"frases_tipo":["frase real suya característica"],"evitar":["cosas que no dice o que sonarían falsas en él"]}', messages: [{ role: 'user', content: material.join('\n\n').slice(0, 24000) }], maxTokens: 3000 }));
    const L = (a, n, m) => (a || []).slice(0, n).map(x => limpia(x, m));
    const out = { fecha: new Date().toISOString(), fuente, resumen: limpia(r.resumen, 400), rasgos: L(r.rasgos, 8, 180), muletillas: L(r.muletillas, 8, 80), como_abre: L(r.como_abre, 5, 200), como_cierra: L(r.como_cierra, 5, 200), frases_tipo: L(r.frases_tipo, 8, 200), evitar: L(r.evitar, 6, 160) };
    await guardarJson(RUTA_VOZ_MARCA, out);
    // el asistente de WhatsApp y los guiones escriben con esta voz
    try { const v = await leerJson('crm/asistente/voz.json', { muestras: [], rasgos: [] }); for (const x of out.frases_tipo) if (!v.muestras.includes(x)) v.muestras.push(x); for (const x of out.rasgos) if (!v.rasgos.includes(x)) v.rasgos.push(x); v.muestras = v.muestras.slice(-60); v.rasgos = v.rasgos.slice(-40); await guardarJson('crm/asistente/voz.json', v); } catch { /* sin voz del asistente */ }
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'No se pudo sacar la voz: ' + String(e.message || e).slice(0, 140) }); }
});
router.get('/voz', async (req, res) => { try { res.json(await leerJson(RUTA_VOZ_MARCA, null) || {}); } catch { res.status(500).json({ error: 'No se pudo leer' }); } });
router.get('/preferencias', async (req, res) => { try { res.json(await leerJson(RUTA_PREFS, { reglas: [] })); } catch { res.status(500).json({ error: 'No se pudieron leer' }); } });
router.post('/preferencias', async (req, res) => {
  try {
    const p = await leerJson(RUTA_PREFS, { reglas: [] }); p.reglas = p.reglas || [];
    if (req.body?.borrar) p.reglas = p.reglas.filter(r => r.id !== req.body.borrar);
    else { const texto = limpia(req.body?.texto, 220), tipo = ['si', 'transmitir', 'saber'].includes(req.body?.tipo) ? req.body.tipo : 'no'; if (texto.length < 3) return res.status(400).json({ error: 'Escribe la preferencia' }); if (!p.reglas.some(r => r.texto.toLowerCase() === texto.toLowerCase())) p.reglas.push({ id: crypto.randomUUID().slice(0, 6), tipo, texto }); }
    p.reglas = p.reglas.slice(-40); await guardarJson(RUTA_PREFS, p); await refrescaPrefs(); res.json(p);
  } catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
// ¿Falta un reel? Se busca por su enlace en TODA tu cuenta y se añade con sus números. Si no aparece, es que Instagram no lo da por la API (p. ej. una colaboración publicada desde otra cuenta).
router.post('/instagram/buscar', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(400).json({ error: 'Conecta Instagram primero' });
    const cod = (String(req.body?.enlace || '').match(/\/(?:reel|reels|p|tv)\/([\w-]{5,})/) || [])[1]; if (!cod) return res.status(400).json({ error: 'Pega el enlace del reel (instagram.com/reel/…)' });
    const campos = 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url';
    let j = await graph('/' + c.ig_id + '/media', { fields: campos, limit: 100 }, c.token), vistas = 0, hallado = null;
    for (;;) { vistas += (j.data || []).length; hallado = (j.data || []).find(m => String(m.permalink || '').includes('/' + cod)); if (hallado || !j.paging?.next || vistas > 2000) break; j = await graph('/' + c.ig_id + '/media', { fields: campos, limit: 100, after: j.paging.cursors.after }, c.token); }
    if (!hallado) return res.json({ encontrado: false, revisadas: vistas, aviso: 'No está entre las ' + vistas + ' publicaciones que Instagram me deja leer de tu cuenta. Suele pasar con colaboraciones publicadas desde otra cuenta, o con vídeos de otra cuenta tuya.' });
    const ins = await insightsDe(hallado, c.token).catch(() => ({})), m = hallado;
    const rec = { id: m.id, tipo: m.media_product_type || m.media_type, formato: m.media_type, enlace: m.permalink, fecha: m.timestamp, pie: limpia(m.caption, 600), me_gusta: m.like_count ?? ins.likes ?? null, comentarios: m.comments_count ?? ins.comments ?? null, miniatura: m.thumbnail_url || '', ...ins };
    c.media = [...(c.media || []).filter(x => x.id !== rec.id), rec]; await guardarJson(RUTA_IG, c);
    res.json({ encontrado: true, vistas: rec.views ?? rec.reach ?? null, revisadas: vistas });
  } catch (e) { res.status(500).json({ error: 'No se pudo buscar: ' + String(e.message || e).slice(0, 140) }); }
});
// ── CUENTAS DE SU NICHO: Instagram no deja buscar cuentas por tema, así que la IA propone candidatas y se COMPRUEBAN una a una (que existan y sean profesionales públicas)
const RUTA_CUENTAS_NICHO = 'crm/redes/cuentas_nicho.json';
router.get('/nicho/cuentas', async (req, res) => { try { res.json(await leerJson(RUTA_CUENTAS_NICHO, { cuentas: [] })); } catch { res.status(500).json({ error: 'No se pudieron leer' }); } });
router.post('/nicho/descubrir', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(404).json({ error: 'Conecta primero tu Instagram' });
    await refrescaPrefs();
    const previas = await leerJson(RUTA_CUENTAS_NICHO, { cuentas: [], descartadas: [] }), ya = new Set([...(previas.cuentas || []).map(x => x.usuario), ...(previas.descartadas || [])]);
    const r = json(await callClaude({ system: textoPrefs() + 'Conoces el panorama de Instagram en el nicho de DISEÑO Y MONTAJE DE GIMNASIOS (gimnasios comerciales, boutique y home gyms, equipamiento fitness, interiorismo deportivo, reformas de gimnasios, fabricantes y estudios de diseño de espacios deportivos). Propón nombres de usuario de Instagram de cuentas REALES y activas de ese nicho que Víctor Palomo (Ranuse Design, España) debería estudiar: empresas y creadores de España y Latinoamérica primero, y algunas internacionales referentes. Mezcla TRES tipos: (1) "nicho": cuentas directas del mundo de los gimnasios y su diseño; (2) "adyacente": cuentas de nichos cercanos cuyo contenido podría funcionarle (interiorismo, arquitectura, reformas y obra, fitness, negocios y emprendimiento de servicios, marca personal de profesionales); (3) "estilo": creadores de cualquier tema con una forma de ser, de comunicar o de grabar que le encajaría y se podría copiar la forma (cercanos, con humor, POV, talking head dinámico, storytelling, mucho ritmo). Para cada una di en una frase qué se le puede aprender. Solo usuarios que estés seguro de que existen; si dudas, no lo pongas (se van a comprobar). Devuelves SOLO JSON {"cuentas":[{"usuario":"sin_arroba","tipo":"nicho|adyacente|estilo","aprender":"qué se le puede aprender"}]} con hasta 30 (unas 10 de cada tipo).', messages: [{ role: 'user', content: 'Ya estudiadas o descartadas (no repetir): ' + ([...ya].join(', ') || 'ninguna') + '. Su cuenta: @' + (c.usuario || '') }], maxTokens: 1500 }));
    const meta = new Map(); for (const x of (r.cuentas || [])) { const u = String(x?.usuario || x).replace(/^@/, '').trim().toLowerCase(); if (!meta.has(u)) meta.set(u, { tipo: ['nicho', 'adyacente', 'estilo'].includes(x?.tipo) ? x.tipo : 'nicho', aprender: limpia(x?.aprender, 160) }); }
    const cand = [...meta.keys()].filter(x => /^[a-z0-9._]{2,30}$/.test(x) && x !== String(c.usuario).toLowerCase() && !ya.has(x)).slice(0, 30);
    const ok = [], malas = [];
    for (let i = 0; i < cand.length; i += 6) {
      const lote = cand.slice(i, i + 6);
      const rs = await Promise.all(lote.map(async u => { try { const j = await graph('/' + c.ig_id, { fields: 'business_discovery.username(' + u + '){username,followers_count,media_count}' }, c.token); const b = j.business_discovery; return b?.username ? { usuario: b.username, seguidores: b.followers_count || 0, posts: b.media_count || 0, ...(meta.get(u) || { tipo: 'nicho', aprender: '' }) } : null; } catch { return null; } }));
      rs.forEach((x, k) => { if (x && x.posts >= 12) ok.push(x); else malas.push(lote[k]); });
    }
    ok.sort((a, b) => b.seguidores - a.seguidores);
    const out = { fecha: new Date().toISOString(), cuentas: [...(previas.cuentas || []), ...ok].slice(0, 40), descartadas: [...(previas.descartadas || []), ...malas].slice(-120) };
    await guardarJson(RUTA_CUENTAS_NICHO, out); res.json({ ...out, nuevas: ok.length, propuestas: cand.length });
  } catch (e) { res.status(500).json({ error: 'No se pudieron encontrar cuentas: ' + String(e.message || e).slice(0, 140) }); }
});
router.post('/nicho/cuentas/quitar', async (req, res) => { try { const d = await leerJson(RUTA_CUENTAS_NICHO, { cuentas: [], descartadas: [] }), u = String(req.body?.usuario || '').toLowerCase(); d.cuentas = (d.cuentas || []).filter(x => x.usuario.toLowerCase() !== u); d.descartadas = [...(d.descartadas || []), u]; await guardarJson(RUTA_CUENTAS_NICHO, d); res.json(d); } catch { res.status(500).json({ error: 'No se pudo quitar' }); } });
// Referentes: vídeos de otros creadores que Víctor pasa para que el editor aprenda cómo están hechos
router.post('/referencias', async (req, res) => {
  try {
    const nombre = limpia(req.body?.nombre, 80) || 'Referente', d = req.body?.detalle || {};
    const x = { id: crypto.randomUUID().slice(0, 6), fecha: new Date().toISOString().slice(0, 10), nombre, descripcion: limpia(req.body?.descripcion, 400), replicar: (d.replicar || []).slice(0, 6).map(y => limpia(y, 200)), mejorar: (d.mejorar || []).slice(0, 4).map(y => limpia(y, 200)), grabacion: limpia(d.grabacion, 400), presencia: limpia(d.presencia, 400) };
    const r = await leerJson('crm/redes/referencias.json', { lista: [] }); r.lista = [...(r.lista || []), x].slice(-30); await guardarJson('crm/redes/referencias.json', r); res.json(r);
  } catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.get('/referencias', async (req, res) => { try { res.json(await leerJson('crm/redes/referencias.json', { lista: [] })); } catch { res.status(500).json({ error: 'No se pudo leer' }); } });
router.get('/periodo', async (req, res) => { try { res.json(await leerJson(RUTA_PERIODO, { dias: 0 })); } catch { res.status(500).json({ error: 'No se pudo leer' }); } });
router.post('/periodo', async (req, res) => { try { const dias = [0, 30, 90, 180, 365].includes(Number(req.body?.dias)) ? Number(req.body.dias) : 0; await guardarJson(RUTA_PERIODO, { dias }); res.json({ dias }); } catch { res.status(500).json({ error: 'No se pudo guardar' }); } });
router.get('/rumbo', async (req, res) => { try { const rb = await leerJson(RUTA_RUMBO, {}), mp = await leerJson(RUTA_RUMBO_POSTS, {}), v = Object.values(mp); res.json({ enfoque: rb.enfoque || '', amplia: rb.amplia || '', ya_no: rb.ya_no || '', amplio: v.filter(x => x === 'amplio').length, clasificados: v.length, encaja: v.filter(x => x === 'encaja').length, formato: v.filter(x => x === 'formato').length, fuera: v.filter(x => x === 'fuera').length }); } catch { res.status(500).json({ error: 'No se pudo leer' }); } });
router.post('/rumbo', async (req, res) => {
  try {
    const enfoque = limpia(req.body?.enfoque, 700), amplia = limpia(req.body?.amplia, 700), ya_no = limpia(req.body?.ya_no, 600); await guardarJson(RUTA_RUMBO, { enfoque, amplia, ya_no, actualizado: new Date().toISOString() }); await refrescaPrefs();
    const c = await conexion(), media = (c?.media || []).filter(m => m.pie || m.miniatura);
    if (!(enfoque || amplia) || !media.length) return res.json({ ok: true, clasificados: 0 });
    const lista = media.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 220).map(m => ({ id: m.id, fecha: String(m.fecha).slice(0, 7), texto: limpia(m.pie, 130), vistas: vistasDe(m) }));
    const r = json(await callClaude({ system: 'Víctor Palomo (Ranuse Design, diseño de gimnasios) te cuenta hacia dónde se dirige ahora su contenido. Tiene dos capas: el CLIENTE QUE QUIERE (núcleo) y la AUDIENCIA AMPLIA con la que quiere crecer en redes (más gente que el cliente final). Clasificas cada publicación pasada: "encaja" (habla al núcleo), "amplio" (atrae a la audiencia amplia afín: deporte, hogar aspiracional, transformaciones, curiosidades útiles para cualquiera, siempre que tengan relación con el espacio de entrenamiento o su mundo), "formato" (el tema ya no es suyo pero la forma —gancho, ritmo, estructura— podría servir) o "fuera" (tema que ya no hace o que no ayuda a ninguna de las dos capas). Sé generoso con "amplio": crecer exige llegar más lejos que el cliente final. Si dudas entre amplio y formato, amplio; entre formato y fuera, fuera. Devuelves SOLO JSON {"r":{"id":"encaja|amplio|formato|fuera"}}.', messages: [{ role: 'user', content: 'CLIENTE QUE QUIERE: ' + (enfoque || '(no lo dice)') + '\nAUDIENCIA AMPLIA: ' + (amplia || '(no lo dice)') + '\nYA NO SE DIRIGE A: ' + (ya_no || '(no lo dice)') + '\n\nPUBLICACIONES:\n' + JSON.stringify(lista) }], maxTokens: 9000 }));
    const mapa = {}; for (const [id, v] of Object.entries(r.r || {})) if (['encaja', 'amplio', 'formato', 'fuera'].includes(v)) mapa[id] = v;
    await guardarJson(RUTA_RUMBO_POSTS, mapa); const v = Object.values(mapa); res.json({ ok: true, clasificados: v.length, encaja: v.filter(x => x === 'encaja').length, amplio: v.filter(x => x === 'amplio').length, formato: v.filter(x => x === 'formato').length, fuera: v.filter(x => x === 'fuera').length });
  } catch (e) { res.status(500).json({ error: 'No se pudo guardar el rumbo: ' + String(e.message || e).slice(0, 140) }); }
});
// Mejorar el rumbo con la IA: reescribe lo que Víctor ha puesto en dos capas (cliente y audiencia amplia) con sus datos delante
router.post('/rumbo/mejorar', async (req, res) => {
  try {
    await refrescaPrefs();
    const c = await conexion(), media = (c?.media || []).filter(m => /VIDEO|REELS/i.test((m.tipo || '') + ' ' + (m.formato || ''))), top = media.slice().sort((a, b) => (vistasDe(b) || 0) - (vistasDe(a) || 0)).slice(0, 12).map(m => limpia(m.pie, 90) + ' (' + (vistasDe(m) || 0) + ' vistas)'), nicho = await leerJson(RUTA_NICHO, {});
    const r = json(await callClaude({ system: 'Eres el estratega de crecimiento de Víctor Palomo (Ranuse Design, diseño y montaje de gimnasios). Te paso lo que él ha escrito sobre hacia dónde se dirige. Reescríbelo mejor, en dos capas: (1) CLIENTE QUE QUIERE: a quién vende, concreto (tipo de cliente, qué quiere, qué le mueve). (2) AUDIENCIA AMPLIA PARA CRECER: un público MUCHO más grande que el cliente final al que atraer con el contenido (por ejemplo aficionados al deporte y a los deportistas, gente que sueña con un gimnasio en casa, familias activas, hogar y espacios aspiracionales, curiosidades de entrenamiento), porque crecer en redes exige ir más amplio que el comprador y luego llevar a una parte de esa audiencia al núcleo. (3) YA NO: SOLO lo que él ha dicho que deja (si no ha dicho nada, déjalo vacío; no inventes cosas que dejar ni le digas que se limite o no a algo). Usa sus datos reales para elegir bien la audiencia amplia (qué ha llevado vistas). No inventes productos ni servicios que no haya dicho. Cada campo breve (1-3 frases). Devuelves SOLO JSON {"enfoque":"","amplia":"","ya_no":"","por_que":"1-2 frases de por qué esta audiencia amplia"}.', messages: [{ role: 'user', content: 'LO QUE HA ESCRITO — dirigirse a: ' + limpia(req.body?.enfoque, 700) + ' | audiencia amplia: ' + limpia(req.body?.amplia, 700) + ' | ya no: ' + limpia(req.body?.ya_no, 600) + '\n\nSUS REELS QUE MÁS VISTAS HAN LLEVADO: ' + JSON.stringify(top) + '\nLO QUE FUNCIONA EN SU NICHO: ' + JSON.stringify((nicho.instagram?.patrones || []).slice(0, 4)) }], maxTokens: 1500 }));
    res.json({ enfoque: limpia(r.enfoque, 700), amplia: limpia(r.amplia, 700), ya_no: limpia(r.ya_no, 600), por_que: limpia(r.por_que, 300) });
  } catch (e) { res.status(500).json({ error: 'No se pudo mejorar: ' + String(e.message || e).slice(0, 140) }); }
});
// Qué subir a historias, con guion exacto y con su voz (usa lo mismo que el asistente: voz, plan, rumbo, preferencias, historias reales y su agenda)
router.post('/historias/hoy', async (req, res) => {
  try {
    await refrescaPrefs();
    const madrid = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d), manana = req.body?.dia === 'manana';
    const fecha = madrid(new Date(Date.now() + (manana ? 86400000 : 0)));
    const contexto = [manana ? 'Es para MAÑANA (' + fecha + ').' : '', limpia(req.body?.contexto, 500)].filter(Boolean).join(' ');
    const out = await ejecutarHistorias('que_subo_hoy', { contexto, hoy_no_quiero: limpia(req.body?.no_quiero, 250) }, { fecha });
    if (out.error) return res.status(422).json({ error: out.error });
    res.json({ fecha, tipo_del_dia: out.tipo_del_dia, por_que: out.por_que, historias: out.estructurado || [], herramienta: out.herramienta_sugerida || null });
  } catch (e) { res.status(500).json({ error: 'No se pudo preparar: ' + String(e.message || e).slice(0, 140) }); }
});
// De YouTube a Instagram: los Shorts que mejor han funcionado en su canal se prueban en Instagram (adaptados)
const RUTA_YT_IG = 'crm/redes/yt_a_ig.json';
router.get('/youtube/a-instagram', async (req, res) => { try { res.json(await leerJson(RUTA_YT_IG, null) || {}); } catch { res.status(500).json({ error: 'No se pudo leer' }); } });
router.post('/youtube/a-instagram', async (req, res) => {
  try {
    const yt = await leerJson('crm/redes/youtube_canal.json', null); if (!yt?.videos?.length) return res.status(422).json({ error: 'Primero añade tu canal de YouTube y léelo (pestaña YouTube).' });
    await refrescaPrefs();
    const cortos = yt.videos.filter(v => v.segundos != null && v.segundos <= 90), base = cortos.length >= 3 ? cortos : yt.videos, mediana = base.map(v => v.vistas).sort((a, b) => a - b)[Math.floor(base.length / 2)] || 1;
    const mejores = base.slice().sort((a, b) => b.vistas - a.vistas).slice(0, 8).map(v => ({ titulo: v.titulo, fecha: v.fecha, segundos: v.segundos, vistas: v.vistas, veces_la_mediana: Math.round(v.vistas / mediana * 10) / 10, me_gusta: v.me_gusta, comentarios: v.comentarios }));
    const r = json(await callClaude({ system: textoPrefs() + 'Víctor Palomo (Ranuse Design) publica el mismo vídeo en YouTube Shorts, Reels y TikTok, pero su cuenta principal es Instagram. Te paso los vídeos de su canal de YouTube que MEJOR han funcionado. Para cada uno que merezca la pena, di por qué crees que funcionó en YouTube (solo con los datos que ves: título, duración, vistas) y cómo PROBARLO en Instagram: qué gancho usar, qué cambiar porque en Instagram se consume distinto (primeros segundos, texto en pantalla, CTA de comentar/guardar/compartir), y qué riesgo tiene. No inventes lo que hay dentro del vídeo: solo lo que se deduce del título y los números; si algo no se sabe, dilo. Descarta los que no encajen con su rumbo actual. Devuelves SOLO JSON {"resumen":"1-2 frases","ideas":[{"video":"título del original","por_que_funciono":"","gancho_instagram":"primera frase","formato":"reel|carrusel|historia","adaptar":"qué cambiar para Instagram","riesgo":""}],"aprendizaje":["patrón que se ve en los Shorts que funcionan y vale para Instagram"]}', messages: [{ role: 'user', content: 'SUS MEJORES VÍDEOS EN YOUTUBE (' + (cortos.length >= 3 ? 'Shorts' : 'todos, hay pocos cortos') + '):' + String.fromCharCode(92) + 'n' + JSON.stringify(mejores) }], maxTokens: 3500 }));
    const out = { fecha: new Date().toISOString(), resumen: limpia(r.resumen, 300), ideas: (r.ideas || []).slice(0, 6).map(x => ({ video: limpia(x?.video, 120), por_que_funciono: limpia(x?.por_que_funciono, 260), gancho: limpia(x?.gancho_instagram, 200), formato: limpia(x?.formato, 20), adaptar: limpia(x?.adaptar, 300), riesgo: limpia(x?.riesgo, 200) })), aprendizaje: (r.aprendizaje || []).slice(0, 5).map(x => limpia(x, 240)) };
    await guardarJson(RUTA_YT_IG, out); res.json(out);
  } catch (e) { res.status(500).json({ error: 'No se pudo preparar: ' + String(e.message || e).slice(0, 140) }); }
});
router.post('/prediccion/real', async (req, res) => {
  try {
    const estimado = Math.round(Number(req.body?.estimado) || 0), real = Math.round(Number(req.body?.real) || 0); if (!estimado || !real) return res.status(400).json({ error: 'Faltan las cifras' });
    const d = await leerJson(RUTA_CALIB, { lista: [] }); d.lista = [...(d.lista || []), { fecha: new Date().toISOString().slice(0, 10), estimado, real, nota: limpia(req.body?.nota, 100) }].slice(-30); await guardarJson(RUTA_CALIB, d); res.json({ ok: true, total: d.lista.length });
  } catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.post('/nicho/estudiar', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(400).json({ error: 'Conecta Instagram primero' });
    const cuenta = String(req.body?.cuenta || '').replace(/^@/, '').toLowerCase(), enlace = String(req.body?.enlace || ''); if (!/^[a-z0-9._]{2,30}$/.test(cuenta) || !enlace) return res.status(400).json({ error: 'Faltan datos' });
    const j = await graph('/' + c.ig_id, { fields: 'business_discovery.username(' + cuenta + '){media.limit(60){permalink,media_url,caption,view_count}}' }, c.token), m = (j.business_discovery?.media?.data || []).find(x => x.permalink === enlace);
    if (!m?.media_url) return res.status(422).json({ error: 'Instagram no me da el archivo de ese vídeo (algunos no se pueden descargar).' });
    const t = await creaTrabajoSistema({ id: 'n' + crypto.randomUUID().slice(0, 7), creado: new Date().toISOString(), por: 'sistema', tipo: 'analisis_redes', videos: [{ id: 'nicho', url: m.media_url, enlace, pie: limpia(m.caption, 100) }], nombre_archivo: 'Vídeo del nicho @' + cuenta, estado: 'pendiente', progreso: 'En cola', version: 1 });
    res.json({ ok: true, id: t.id });
  } catch (e) { res.status(500).json({ error: 'No se pudo estudiar: ' + String(e.message || e).slice(0, 140) }); }
});
router.post('/guion/lead-magnet', async (req, res) => {
  try {
    const lm = req.body?.lead_magnet || {}, idea = limpia(req.body?.idea, 300); if (!lm.nombre) return res.status(400).json({ error: 'Falta el lead magnet' });
    await refrescaPrefs();
    const r = json(await callClaude({ system: textoPrefs() + 'Eres el redactor de Víctor Palomo (Ranuse Design, diseño y montaje de gimnasios). Escribes el CONTENIDO COMPLETO de un lead magnet (una guía, checklist o plantilla de 1-3 páginas) que se entrega por mensaje directo a quien comenta una palabra clave. Debe ser realmente útil, concreto y fácil de aplicar, con la voz de Víctor (directa, cercana, frases cortas, sin jerga) y sin inventar cifras, precios ni normativas que no tengas: si hace falta un dato, deja [DATO] para que él lo rellene. Termina con una llamada a la acción suave para hablar con él. Devuelves SOLO JSON {"titulo":"","subtitulo":"","intro":"2 frases","secciones":[{"titulo":"","puntos":["punto concreto y accionable"]}],"consejo_final":"","cta":"qué hacer si quiere ayuda (ej. escribirme por DM)"}', messages: [{ role: 'user', content: 'LEAD MAGNET: ' + JSON.stringify({ nombre: lm.nombre, tipo: lm.tipo, promesa: lm.promesa, contenido: lm.contenido }) + '\nVÍDEO AL QUE ACOMPAÑA: ' + idea }], maxTokens: 3500 }));
    const L = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map(x => limpia(x, m));
    res.json({ titulo: limpia(r.titulo, 120), subtitulo: limpia(r.subtitulo, 200), intro: limpia(r.intro, 360), secciones: (r.secciones || []).slice(0, 8).map(s => ({ titulo: limpia(s?.titulo, 100), puntos: L(s?.puntos, 8, 240) })), consejo_final: limpia(r.consejo_final, 300), cta: limpia(r.cta, 200) });
  } catch (e) { res.status(500).json({ error: 'No se pudo escribir: ' + String(e.message || e).slice(0, 140) }); }
});
// ── LO QUE ANTES NO SABÍA: se mide lo que sí se puede medir (carruseles, retención, días de seguidores) y se dice con claridad lo que no se puede
const RUTA_HUECOS = 'crm/redes/huecos.json';
router.get('/cuenta/huecos', async (req, res) => { try { res.json(await leerJson(RUTA_HUECOS, null) || {}); } catch { res.status(500).json({ error: 'No se pudo leer' }); } });
router.post('/cuenta/huecos', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(400).json({ error: 'Conecta Instagram primero' });
    const media = (await marcaPruebas(c.media || [], { ignoraPeriodo: true })).filter(m => !m.prueba || m.formato !== 'VIDEO'), v = (m) => Number(m.views) || Number(m.reach) || 0, med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    // 1) formatos: reels, carruseles, fotos
    const grupo = (f) => { const l = media.filter(f); return { n: l.length, mediana_alcance: med(l.map(v)), mediana_guardados: med(l.map(m => n0(m.saved))), mediana_compartidos: med(l.map(m => n0(m.shares))), mediana_comentarios: med(l.map(m => n0(m.comentarios))), mejor: l.slice().sort((a, b) => v(b) - v(a))[0] ? { enlace: l.slice().sort((a, b) => v(b) - v(a))[0].enlace, alcance: v(l.slice().sort((a, b) => v(b) - v(a))[0]) } : null }; };
    const formatos = { reels: grupo(m => m.formato === 'VIDEO' || /REELS/i.test(m.tipo || '')), carruseles: grupo(m => m.formato === 'CAROUSEL_ALBUM'), fotos: grupo(m => m.formato === 'IMAGE') };
    // 2) retención media de los reels analizados (tiempo medio visto frente a su duración)
    const vid = await leerJson('crm/redes/analisis_videos.json', null), retencion = [];
    for (const x of (vid?.videos || [])) { const m = (c.media || []).find(q => q.id === x.id); const seg = m ? n0(m.ig_reels_avg_watch_time) / 1000 : 0; if (m && x.dur > 3 && seg > 0) retencion.push({ pie: limpia(m.pie, 70), enlace: m.enlace, duracion_s: Math.round(x.dur), visto_s: Math.round(seg * 10) / 10, retencion_pct: Math.min(100, Math.round(seg / x.dur * 100)), vistas: v(m) }); }
    retencion.sort((a, b) => b.retencion_pct - a.retencion_pct);
    // 3) qué reels coinciden con los mejores días de seguidores (aproximación: Instagram no da los seguidores por publicación)
    const salud = await leerJson(RUTA_SALUD, null), dias = [];
    if (salud?.serie?.length) { const hoy = new Date(); salud.serie.forEach((neto, i) => { const d = new Date(hoy.getTime() - (salud.serie.length - 1 - i) * 86400000); dias.push({ dia: d.toISOString().slice(0, 10), neto }); }); }
    const mejoresDias = dias.slice().sort((a, b) => b.neto - a.neto).slice(0, 4).map(d => { const cerca = media.filter(m => Math.abs(new Date(m.fecha).getTime() - new Date(d.dia).getTime()) < 1.6 * 86400000).sort((a, b) => v(b) - v(a))[0]; return { dia: d.dia, seguidores_netos: d.neto, reel_cercano: cerca ? { pie: limpia(cerca.pie, 70), enlace: cerca.enlace, vistas: v(cerca) } : null }; });
    // 4) lectura corta y honesta
    const r = json(await callClaude({ system: 'Eres el analista de Víctor Palomo (Ranuse Design). Te paso datos medidos de su cuenta de Instagram sobre carruseles, retención y días de seguidores. Hoy es ' + new Date().toISOString().slice(0, 10) + ' (las fechas son reales). Saca 3 conclusiones útiles y honestas, con cifras, solo de lo que ves (si hay pocos datos, dilo: p. ej. con 4 carruseles no hay certeza). Devuelves SOLO JSON {"lecturas":["conclusión con cifras"],"fiabilidad":"qué tan fiable es y por qué"}', messages: [{ role: 'user', content: JSON.stringify({ formatos, retencion: retencion.slice(0, 14), mejores_dias_seguidores: mejoresDias }) }], maxTokens: 1500 }));
    const out = { fecha: new Date().toISOString(), formatos, retencion, mejores_dias: mejoresDias, lecturas: (r.lecturas || []).slice(0, 4).map(x => limpia(x, 300)), fiabilidad: limpia(r.fiabilidad, 260), no_se_puede: [{ dato: 'Qué canciones o audios usas', por_que: 'Instagram no da el título del audio de tus reels a ninguna herramienta.', como: 'Un servicio de reconocimiento de audio (tipo AudD o ACRCloud) podría identificarlos, pero necesita una clave de pago por uso. Dime si lo quieres.' }, { dato: 'Curva de retención (dónde se va la gente segundo a segundo)', por_que: 'Instagram solo la muestra dentro de su app, no por API.', como: 'Mírala en Instagram Insights en tus 5 mejores reels y cuéntame dónde cae: lo apunto en «Debes saber».' }, { dato: 'De dónde vienen los seguidores (Instagram, TikTok, YouTube)', por_que: 'Cada plataforma solo ve los suyos. Y Instagram no da los seguidores por publicación en los reels.', como: 'En YouTube Studio → Analítica → Audiencia → «Dónde ven tus vídeos» y «Suscriptores». Apunta lo que veas en «Debes saber».' }] };
    await guardarJson(RUTA_HUECOS, out); res.json(out);
  } catch (e) { res.status(500).json({ error: 'No se pudo medir: ' + String(e.message || e).slice(0, 140) }); }
});
router.get('/objetivos', async (req, res) => { try { const id = await objetivoActual(); res.json({ actual: id, objetivos: Object.entries(OBJETIVOS).map(([k, o]) => ({ id: k, nombre: o.nombre, icono: o.icono, que: o.que, formula: o.formula, unidad: o.unidad })) }); } catch { res.status(500).json({ error: 'No se pudieron leer' }); } });
router.post('/objetivo', async (req, res) => { try { const id = String(req.body?.id || ''); if (!OBJETIVOS[id]) return res.status(400).json({ error: 'Objetivo no válido' }); await guardarJson(RUTA_OBJETIVO, { id }); res.json({ ok: true }); } catch { res.status(500).json({ error: 'No se pudo guardar' }); } });
router.post('/instagram/prueba', async (req, res) => {
  try { const id = String(req.body?.id || ''); const ov = await leerJson(RUTA_PRUEBAS, { si: [], no: [] }); ov.si = ov.si.filter(x => x !== id); ov.no = ov.no.filter(x => x !== id); ov.motivo = ov.motivo || {}; (req.body?.prueba ? ov.si : ov.no).push(id); if (req.body?.prueba && ['prueba', 'repetido', 'marca'].includes(req.body?.motivo)) ov.motivo[id] = req.body.motivo; else delete ov.motivo[id]; await guardarJson(RUTA_PRUEBAS, ov); res.json({ ok: true }); }
  catch { res.status(500).json({ error: 'No se pudo guardar' }); }
});
router.get('/instagram/publicaciones', async (req, res) => {
  try { const c = await conexion(); if (!c) return res.status(404).json({ error: 'Instagram no está conectado' }); const obj = await objetivoActual(); const l = (await marcaPruebas(c.media || [])).map(m => ({ ...m, puntuacion: redondea(puntua(m, c.seguidores, obj)) })).sort((a, b) => b.puntuacion - a.puntuacion); res.json({ publicaciones: l, objetivo: obj }); }
  catch { res.status(500).json({ error: 'No se pudieron leer' }); }
});
router.post('/instagram/analizar', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(404).json({ error: 'Instagram no está conectado' });
    let media = c.media || []; if (media.length < 8) { media = await sincronizarInstagram(300); }
    const nPruebas = (await marcaPruebas(media)).filter(m => m.prueba).length; media = (await marcaPruebas(media)).filter(m => !m.prueba);
    if (media.length < 8) return res.status(422).json({ error: 'Hay muy pocas publicaciones para sacar conclusiones fiables (' + media.length + ').' });
    const obj = await objetivoActual(), orden = media.map(m => ({ m, p: puntua(m, c.seguidores, obj) })).sort((a, b) => b.p - a.p), n = Math.max(3, Math.round(orden.length / 4));
    const ficha = (x) => ({ id: x.m.id, rumbo: x.m.rumbo || null, tipo: x.m.tipo, fecha: String(x.m.fecha).slice(0, 16), dia_hora: new Date(x.m.fecha).toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', timeZone: 'Europe/Madrid' }), gancho: x.m.pie.split(/[\n.!?]/)[0].slice(0, 160), pie: x.m.pie.slice(0, 300), alcance: x.m.reach ?? x.m.views ?? null, me_gusta: x.m.me_gusta, comentarios: x.m.comentarios, guardados: x.m.saved ?? null, compartidos: x.m.shares ?? null, tiempo_visto: x.m.ig_reels_avg_watch_time ?? null, puntuacion: redondea(x.p) });
    const r = json(await callClaude({ system: textoObjetivo(obj) + ' Eres analista de contenido de Instagram para una marca personal de diseño de gimnasios (Ranuse Design, Víctor Palomo). IMPORTANTE: NO te limites a los formatos que Víctor ya hace. Cada idea lleva "origen": "tus datos" (basada en lo que ya le funciona), "nicho" (basada en lo que funciona a otros) o "exploracion" (formato nuevo que no ha probado, para descubrir). Incluye SIEMPRE al menos 2 ideas de "exploracion". Comparas las publicaciones que MEJOR y PEOR funcionaron para sacar patrones reales y accionables: qué ganchos (primera línea), formatos, temas, longitudes de texto, llamadas a la acción, días y horas funcionan y cuáles no. No inventes: solo conclusiones que se vean en los datos; si no hay base suficiente, dilo. Devuelves SOLO JSON {"resumen":"2-3 frases","lo_que_funciona":["patrón concreto"],"lo_que_no":["patrón concreto"],"ganchos_ganadores":["ejemplo o fórmula de gancho que funcionó, con su porqué"],"ideas_ganadoras":[{"idea":"idea de contenido nueva","formato":"reel|carrusel|foto|historia|otro formato","gancho":"primera frase","origen":"tus datos|nicho|exploracion","refs":["id de 1-3 reels SUYOS de los datos que demuestran que esta idea funciona; vacío si es exploración"]}],"para_el_editor":["regla corta para editar vídeos (ritmo, gancho, duración, texto) si se deduce de los datos"],"para_historias":["regla corta para las historias si se deduce"],"horarios":"mejores días y horas si se ven","fiabilidad":"alta|media|baja y por qué (nº de publicaciones, métricas que faltan)"}', messages: [{ role: 'user', content: 'Cuenta: @' + c.usuario + ' · ' + (c.seguidores || '?') + ' seguidores · ' + media.length + ' publicaciones analizadas.\
\
LAS QUE MEJOR FUNCIONARON (puntuación = interacciones ponderadas / alcance):\
' + JSON.stringify(orden.slice(0, n).map(ficha)) + '\
\
LAS QUE PEOR:\
' + JSON.stringify(orden.slice(-n).map(ficha)) }], maxTokens: 4000 }));
    const a = { fecha: new Date().toISOString(), objetivo: obj, cuenta: c.usuario, n: media.length, pruebas_excluidas: nPruebas, resumen: limpia(r.resumen, 500), lo_que_funciona: (r.lo_que_funciona || []).slice(0, 8).map(x => limpia(x, 240)), lo_que_no: (r.lo_que_no || []).slice(0, 8).map(x => limpia(x, 240)), ganchos_ganadores: (r.ganchos_ganadores || []).slice(0, 8).map(x => limpia(x, 240)), ideas_ganadoras: (r.ideas_ganadoras || []).slice(0, 10).map(x => ({ idea: limpia(x?.idea, 240), formato: limpia(x?.formato, 30), gancho: limpia(x?.gancho, 200), origen: limpia(x?.origen, 20), refs: (Array.isArray(x?.refs) ? x.refs : []).slice(0, 3).map(id => { const m = media.find(q => q.id === String(id)); return m ? { enlace: m.enlace, miniatura: m.miniatura, vistas: vistasDe(m), pie: limpia(m.pie, 80) } : null; }).filter(Boolean) })), para_el_editor: (r.para_el_editor || []).slice(0, 6).map(x => limpia(x, 220)), para_historias: (r.para_historias || []).slice(0, 6).map(x => limpia(x, 220)), horarios: limpia(r.horarios, 240), fiabilidad: limpia(r.fiabilidad, 240) };
    await guardarJson(RUTA_APRENDIZAJE, a);
    // lo aprendido llega al editor de vídeo y al asistente (historias), marcado con su origen
    try { const e = await leerJson('crm/estudio-video/editor.json', { hechos: [], charla: [] }); for (const t of a.para_el_editor) { const x = 'De tus resultados en Instagram: ' + t; if (!e.hechos.some(h => h.texto === x)) e.hechos.push({ id: crypto.randomUUID().slice(0, 6), texto: x, fecha: new Date().toISOString().slice(0, 10) }); } e.hechos = e.hechos.slice(-80); await guardarJson('crm/estudio-video/editor.json', e); } catch { /* sin editor */ }
    try { const l = await leerJson('crm/asistente/historias_lecciones.json', { lecciones: [] }); const hoy = new Date().toISOString().slice(0, 10); for (const t of a.para_historias) { const x = 'Según tus datos de Instagram: ' + t; if (!l.lecciones.some(y => y.texto === x)) l.lecciones.push({ id: crypto.randomUUID().slice(0, 6), fecha: hoy, texto: x }); } l.lecciones = l.lecciones.slice(-60); await guardarJson('crm/asistente/historias_lecciones.json', l); } catch { /* sin lecciones */ }
    res.json({ ok: true, aprendizaje: a });
  } catch (e) { console.error('redes analizar', e.message); res.status(500).json({ error: 'No se pudo analizar: ' + String(e.message).slice(0, 200) }); }
});

// Ideas ganadoras: descartar las que no gustan y pedir otras nuevas manteniendo las elegidas
router.post('/instagram/ideas/regenerar', async (req, res) => {
  try {
    const a = await leerJson(RUTA_APRENDIZAJE, null); if (!a || !Array.isArray(a.ideas_ganadoras)) return res.status(404).json({ error: 'Primero analiza tu cuenta' });
    const lim = (l) => (Array.isArray(l) ? l : []).map(x => String(x || '').slice(0, 240)).slice(0, 30);
    const mantener = lim(req.body?.mantener), descartar = lim(req.body?.descartar), cantidad = Math.max(0, Math.min(6, Number(req.body?.cantidad) || 0));
    a.ideas_descartadas = [...(a.ideas_descartadas || []), ...descartar].slice(-40);
    const quedan = a.ideas_ganadoras.filter(x => !descartar.includes(x.idea));
    const fijas = quedan.filter(x => mantener.includes(x.idea)), otras = quedan.filter(x => !mantener.includes(x.idea));
    let nuevas = [];
    if (cantidad > 0) {
      const obj = await objetivoActual();
      const r = json(await callClaude({ system: textoObjetivo(obj) + ' ' + textoPrefs() + ' Eres estratega de contenido de Instagram para Víctor Palomo (Ranuse Design, diseño de gimnasios). Te paso lo que se ha aprendido de su cuenta y las ideas que YA tiene (para no repetirlas) y las que DESCARTÓ (no le gustan: no propongas nada parecido). Propón ideas NUEVAS y distintas, realistas de grabar él solo con el móvil, sin depender de clientes famosos. Cada idea lleva "origen": "tus datos", "nicho" o "exploracion". Devuelves SOLO JSON {"ideas":[{"idea":"","formato":"reel|carrusel|foto|historia","gancho":"primera frase","origen":""}]}', messages: [{ role: 'user', content: 'Resumen: ' + (a.resumen || '') + '\nLo que funciona: ' + JSON.stringify(a.lo_que_funciona || []) + '\nLo que no: ' + JSON.stringify(a.lo_que_no || []) + '\nGanchos ganadores: ' + JSON.stringify(a.ganchos_ganadores || []) + '\nIdeas que ya tiene: ' + JSON.stringify(quedan.map(x => x.idea)) + '\nIdeas DESCARTADAS (no repetir ni parecidas): ' + JSON.stringify(a.ideas_descartadas) + '\nDame ' + cantidad + ' ideas nuevas.' }], maxTokens: 2500 }));
      nuevas = (r.ideas || []).slice(0, cantidad).map(x => ({ idea: limpia(x?.idea, 240), formato: limpia(x?.formato, 30), gancho: limpia(x?.gancho, 200), origen: limpia(x?.origen, 20), refs: [] })).filter(x => x.idea);
    }
    a.ideas_ganadoras = [...fijas, ...nuevas, ...(cantidad > 0 ? [] : otras)].slice(0, 10);
    await guardarJson(RUTA_APRENDIZAJE, a);
    res.json({ ok: true, ideas: a.ideas_ganadoras });
  } catch (e) { console.error('redes ideas regenerar', e.message); res.status(500).json({ error: 'No se pudieron regenerar: ' + String(e.message).slice(0, 200) }); }
});

// ── 3b) Predecir un vídeo antes de hacerlo y «autopsia» de uno ya publicado (todo anclado a TUS números reales)
const mediana = (a) => { const v = a.filter(x => Number.isFinite(x)).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
const cuantil = (a, q) => { const v = a.filter(x => Number.isFinite(x)).sort((p, r) => p - r); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * q))] : null; };
const vistasDe = (m) => Number(m.views) || Number(m.reach) || null;
function estadisticas(media) {
  const por = {}; for (const m of media) { const k = m.tipo === 'REELS' ? 'reel' : m.tipo === 'STORY' ? 'historia' : (m.formato === 'CAROUSEL_ALBUM' ? 'carrusel' : m.formato === 'VIDEO' ? 'vídeo' : 'foto'); (por[k] = por[k] || []).push(m); }
  const out = {}; for (const [k, l] of Object.entries(por)) { const v = l.map(vistasDe); out[k] = { n: l.length, mediana: mediana(v), p25: cuantil(v, 0.25), p75: cuantil(v, 0.75), max: Math.max(...v.filter(Number.isFinite), 0) || null, guardados_mediana: mediana(l.map(x => Number(x.saved))), compartidos_mediana: mediana(l.map(x => Number(x.shares))) }; }
  return out;
}
export async function calculaPrediccion(propuesta, formato) {
  {
    const c = await conexion(); if (!c) throw new Error('Conecta primero tu Instagram');
    let media = c.media || []; if (media.length < 8) media = await sincronizarInstagram(300);
    media = (await marcaPruebas(media)).filter(m => !m.prueba);
    const obj = await objetivoActual(), est = estadisticas(media), top = media.map(m => ({ m, p: puntua(m, c.seguidores, obj) })).sort((a, b) => b.p - a.p);
    const ficha = (x) => ({ rumbo: x.m.rumbo || null, tipo: x.m.tipo, gancho: x.m.pie.split(/[\n.!?]/)[0].slice(0, 140), vistas: vistasDe(x.m), guardados: x.m.saved ?? null, compartidos: x.m.shares ?? null, dia: new Date(x.m.fecha).toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' }) });
    const aprend = await leerJson(RUTA_APRENDIZAJE, null);
    const rec = media.filter(m => Date.now() - new Date(m.fecha).getTime() < 120 * 86400000 && m.rumbo !== 'fuera').map(vistasDe).filter(Number.isFinite), ultimos = media.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 12).map(m => ({ fecha: String(m.fecha).slice(0, 10), vistas: vistasDe(m), gancho: String(m.pie || '').slice(0, 60) }));
    const calib = (await leerJson(RUTA_CALIB, { lista: [] })).lista.slice(-10);
    const anclaje = 'ANCLAJE (muy importante): lo que RINDE AHORA su cuenta, últimos 120 días (sin lo que ya no es su rumbo): mediana ' + mediana(rec) + ' vistas, percentil 25: ' + cuantil(rec, 0.25) + ', percentil 75: ' + cuantil(rec, 0.75) + ', máximo ' + Math.max(0, ...rec) + '. Sus últimos 12 reels: ' + JSON.stringify(ultimos) + '. Parte de la MEDIANA reciente, no de sus virales históricos: un vídeo normal rinde cerca de la mediana, y solo uno con razones muy claras se acerca al percentil 75. Los éxitos antiguos (millones de vistas) son excepciones, no la base.' + (calib.length ? ' CALIBRACIÓN con tus fallos pasados (estimación frente a lo que pasó de verdad): ' + JSON.stringify(calib.map(x => ({ estimado: x.estimado, real: x.real, nota: x.nota }))) + '. Si te has pasado de optimista, corrige a la baja de forma proporcional.' : '') + '\n';
    const r = json(await callClaude({ system: textoObjetivo(obj) + ' Eres analista de rendimiento de Instagram. Vas a ESTIMAR cuántas visualizaciones (alcance) tendría un vídeo propuesto por Víctor Palomo (Ranuse Design, diseño de gimnasios) y cómo mejorarlo. Reglas: parte SIEMPRE de sus números reales por formato (mediana y percentiles), no de cifras genéricas; ajusta hacia arriba o abajo solo con motivos concretos (gancho, tema, formato, día, parecido con sus mejores o peores) y di cuánto aporta cada factor; da un rango (bajo, medio, alto) y NUNCA una cifra exacta; si tiene pocas publicaciones de ese formato, dilo y baja la confianza. Una estimación no es una promesa: explica la incertidumbre. Devuelves SOLO JSON {"estimacion":{"bajo":0,"medio":0,"alto":0,"metrica":"visualizaciones o alcance"},"confianza":"baja|media|alta","por_que":"2-3 frases","a_favor":["factor"],"en_contra":["factor"],"mejoras":[{"cambio":"qué cambiar, concreto","efecto":"cuánto podría mover (por ejemplo +30 % de alcance) y por qué"}],"version_mejorada":{"gancho":"","estructura":"3-5 pasos cortos","cta":""},"dejar_de_hacer":["algo de la propuesta que conviene quitar"]}', messages: [{ role: 'user', content: 'SUS NÚMEROS POR FORMATO (visualizaciones/alcance):\n' + JSON.stringify(est) + '\n\nSEGUIDORES: ' + (c.seguidores ?? '?') + '\n\nSUS MEJORES PUBLICACIONES:\n' + JSON.stringify(top.slice(0, 6).map(ficha)) + '\n\nLAS PEORES:\n' + JSON.stringify(top.slice(-4).map(ficha)) + (aprend ? '\n\nLO QUE YA SE SABE QUE FUNCIONA EN SU CUENTA: ' + JSON.stringify({ funciona: aprend.lo_que_funciona, no: aprend.lo_que_no, horarios: aprend.horarios }) : '') + anclaje + '\n\nVÍDEO PROPUESTO (' + (limpia(formato, 40) || 'formato sin indicar') + '' + '):\n' + propuesta }], maxTokens: 2500 }));
    const out = { fecha: new Date().toISOString(), propuesta: propuesta.slice(0, 300), formato: limpia(formato, 40), estimacion: { bajo: Math.round(Number(r.estimacion?.bajo) || 0), medio: Math.round(Number(r.estimacion?.medio) || 0), alto: Math.round(Number(r.estimacion?.alto) || 0), metrica: limpia(r.estimacion?.metrica, 30) || 'visualizaciones' }, confianza: limpia(r.confianza, 10), por_que: limpia(r.por_que, 500), a_favor: (r.a_favor || []).slice(0, 5).map(x => limpia(x, 200)), en_contra: (r.en_contra || []).slice(0, 5).map(x => limpia(x, 200)), mejoras: (r.mejoras || []).slice(0, 6).map(x => ({ cambio: limpia(x?.cambio, 240), efecto: limpia(x?.efecto, 200) })), version_mejorada: { gancho: limpia(r.version_mejorada?.gancho, 240), estructura: limpia(r.version_mejorada?.estructura, 400), cta: limpia(r.version_mejorada?.cta, 200) }, dejar_de_hacer: (r.dejar_de_hacer || []).slice(0, 4).map(x => limpia(x, 200)), base: est };
    const h = await leerJson('crm/redes/predicciones.json', { lista: [] }); h.lista = [...(h.lista || []), { fecha: out.fecha, propuesta: out.propuesta, formato: out.formato, estimacion: out.estimacion, confianza: out.confianza }].slice(-60); await guardarJson('crm/redes/predicciones.json', h);
    return out;
  }
}
router.post('/instagram/predecir', async (req, res) => {
  try {
    const propuesta = limpia(req.body?.propuesta, 2500); if (propuesta.length < 15) return res.status(400).json({ error: 'Cuéntame el vídeo: de qué va, el gancho y el formato.' });
    res.json({ ok: true, prediccion: await calculaPrediccion(propuesta, req.body?.formato) });
  } catch (e) { console.error('redes predecir', e.message); res.status(500).json({ error: 'No se pudo estimar: ' + String(e.message).slice(0, 200) }); }
});
router.post('/instagram/autopsia', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(404).json({ error: 'Conecta primero tu Instagram' });
    const todas = await marcaPruebas(c.media || []), media = todas.filter(x => !x.prueba || x.id === req.body?.id), m = media.find(x => x.id === req.body?.id); if (!m) return res.status(404).json({ error: 'No encuentro esa publicación' });
    const obj = await objetivoActual(), est = estadisticas(media), otros = media.filter(x => x.id !== m.id).map(x => ({ m: x, p: puntua(x, c.seguidores, obj) })).sort((a, b) => b.p - a.p);
    const ficha = (x) => ({ rumbo: x.rumbo || null, tipo: x.tipo, fecha: String(x.fecha).slice(0, 10), dia: new Date(x.fecha).toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', timeZone: 'Europe/Madrid' }), pie: x.pie.slice(0, 350), vistas: vistasDe(x), alcance: x.reach ?? null, me_gusta: x.me_gusta, comentarios: x.comentarios, guardados: x.saved ?? null, compartidos: x.shares ?? null, tiempo_visto: x.ig_reels_avg_watch_time ?? null });
    const r = json(await callClaude({ system: textoObjetivo(obj) + ' Eres el analista de contenido de Víctor Palomo (Ranuse Design, diseño de gimnasios). Haces la AUTOPSIA de una publicación: por qué funcionó o no comparada con SUS PROPIOS números, y qué hacer con ese tipo de contenido. Solo con los datos que ves (no tienes el vídeo ni su transcripción: si algo depende de ello, dilo). Directo, con criterio, sin rodeos. Devuelves SOLO JSON {"veredicto":"repetir|ajustar|dejar","resumen":"1-2 frases","por_que":["motivo concreto basado en los datos"],"que_haria_distinto":["cambio concreto"],"como_repetirlo":"si funcionó, cómo sacarle partido sin copiarse"}', messages: [{ role: 'user', content: 'SUS NÚMEROS POR FORMATO:\n' + JSON.stringify(est) + '\n\nPUBLICACIÓN A ANALIZAR:\n' + JSON.stringify(ficha(m)) + '\n\nSUS MEJORES:\n' + JSON.stringify(otros.slice(0, 4).map(x => ficha(x.m))) + '\n\nSUS PEORES:\n' + JSON.stringify(otros.slice(-3).map(x => ficha(x.m))) }], maxTokens: 1500 }));
    res.json({ ok: true, autopsia: { veredicto: limpia(r.veredicto, 10), resumen: limpia(r.resumen, 300), por_que: (r.por_que || []).slice(0, 5).map(x => limpia(x, 220)), que_haria_distinto: (r.que_haria_distinto || []).slice(0, 5).map(x => limpia(x, 220)), como_repetirlo: limpia(r.como_repetirlo, 300) } });
  } catch (e) { console.error('redes autopsia', e.message); res.status(500).json({ error: 'No se pudo analizar esa publicación: ' + String(e.message).slice(0, 200) }); }
});

// ── 4) Ideas ganadoras en tu nicho (cuentas profesionales públicas de Instagram)
router.post('/nicho/instagram', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(404).json({ error: 'Conecta primero tu Instagram' });
    const cuentas = [...new Set(String(req.body?.cuentas || '').split(/[\s,;]+/).map(x => x.replace(/^@/, '').trim().toLowerCase()).filter(x => /^[a-z0-9._]{2,30}$/.test(x)))].slice(0, 10);
    if (!cuentas.length) return res.status(400).json({ error: 'Escribe al menos una cuenta (por ejemplo: gymcompany_es)' });
    const datos = [], fallos = [];
    for (const u of cuentas) {
      try { const j = await graph('/' + c.ig_id, { fields: 'business_discovery.username(' + u + '){username,followers_count,media_count,media.limit(40){caption,like_count,comments_count,media_type,media_product_type,permalink,timestamp,thumbnail_url,view_count}}' }, c.token); const b = j.business_discovery; datos.push({ usuario: b.username, seguidores: b.followers_count, posts: (b.media?.data || []).map(m => ({ tipo: m.media_product_type || m.media_type, fecha: m.timestamp, gancho: limpia((m.caption || '').split(/[\n.!?]/)[0], 160), pie: limpia(m.caption, 280), me_gusta: m.like_count, comentarios: m.comments_count, enlace: m.permalink, miniatura: m.thumbnail_url || '', vistas: Number(m.view_count) || null, seguidores: b.followers_count || 0, puntuacion: Number(m.view_count) ? Math.round(Number(m.view_count) / Math.max(1, b.followers_count || 1) * 10000) / 100 : Math.round((((m.like_count || 0) + (m.comments_count || 0) * 3) / Math.max(1, b.followers_count || 1)) * 10000) / 100 })) }); }
      catch (e) { fallos.push(u + ': ' + (/does not exist|not a business|cannot be found|Invalid user/i.test(e.message) ? 'no es una cuenta profesional pública o no existe' : e.message.slice(0, 100))); }
    }
    if (!datos.length) return res.status(422).json({ error: 'No he podido leer ninguna cuenta. ' + fallos.join(' · ') });
    // «ideas ganadoras de vídeos»: primero los reels y vídeos (por vistas, y por rendimiento si no hay vistas); si hay muy pocos, se completa con el resto
    const todos = datos.flatMap(d => d.posts.map(p => ({ ...p, cuenta: d.usuario }))), esVideo = p => /REELS|VIDEO/i.test(String(p.tipo || ''));
    const vids = todos.filter(esVideo).sort((a, b) => (b.vistas || 0) - (a.vistas || 0) || b.puntuacion - a.puntuacion);
    const mejores = (vids.length >= 6 ? vids : [...vids, ...todos.filter(p => !esVideo(p)).sort((a, b) => b.puntuacion - a.puntuacion)]).slice(0, 20);
    await refrescaPrefs();
    const guardadas = await leerJson(RUTA_CUENTAS_NICHO, { cuentas: [] }), tiposCuenta = Object.fromEntries((guardadas.cuentas || []).map(x => [x.usuario.toLowerCase(), x.tipo || 'nicho']));
    for (const p of mejores) p.tipo_cuenta = tiposCuenta[String(p.cuenta).toLowerCase()] || 'nicho';
    const r = json(await callClaude({ system: textoPrefs() + 'Cada publicación indica tipo_cuenta: "nicho" (misma industria), "adyacente" (industria cercana) o "estilo" (otro tema, pero con una forma de ser, comunicar o grabar que le puede encajar). De las de nicho saca temas y formatos; de las adyacentes y de estilo saca sobre todo CÓMO comunican (tono, gancho, ritmo, personalidad) y CÓMO graban (plano, gesto, movimiento, lugar, edición) y cómo adaptarlo a su caso, citando de qué cuenta viene. Eres analista de contenido de Instagram. Te paso las publicaciones que MEJOR funcionaron (mayor interacción relativa a sus seguidores) de cuentas de un nicho (diseño y equipamiento de gimnasios, fitness). Saca patrones REALES: qué ganchos, formatos y temas funcionan, y propón ideas para Víctor Palomo (Ranuse Design, diseño de gimnasios), adaptadas a su marca y sin copiar. IMPORTANTE: NO te limites a los formatos que Víctor ya hace. Cada idea lleva "origen": "tus datos" (basada en lo que ya le funciona), "nicho" (basada en lo que funciona a otros) o "exploracion" (formato nuevo que no ha probado, para descubrir). Incluye SIEMPRE al menos 2 ideas de "exploracion". Solo datos públicos: no tienes alcance ni vídeos, solo texto y me gusta/comentarios; dilo en la fiabilidad. Devuelves SOLO JSON {"patrones":["..."],"ganchos":["fórmula de gancho con ejemplo"],"formatos":["formato que funciona y por qué"],"ideas_para_victor":[{"idea":"","formato":"","gancho":"","por_que":"inspirada en qué patrón","origen":"nicho|exploracion","refs":["número n de 1-3 publicaciones reales de la lista que la respaldan; vacío si es exploración"]}],"fiabilidad":"..."}', messages: [{ role: 'user', content: JSON.stringify(mejores.map((p, i) => ({ n: i + 1, ...p }))) }], maxTokens: 3500 }));
    const out = { fecha: new Date().toISOString(), plataforma: 'instagram', cuentas: datos.map(d => ({ usuario: d.usuario, seguidores: d.seguidores })), fallos, top: mejores.slice(0, 12), patrones: (r.patrones || []).slice(0, 8).map(x => limpia(x, 240)), ganchos: (r.ganchos || []).slice(0, 8).map(x => limpia(x, 240)), formatos: (r.formatos || []).slice(0, 6).map(x => limpia(x, 240)), ideas: (r.ideas_para_victor || []).slice(0, 10).map(x => ({ idea: limpia(x?.idea, 240), formato: limpia(x?.formato, 30), gancho: limpia(x?.gancho, 200), por_que: limpia(x?.por_que, 200), origen: limpia(x?.origen, 20), refs: (Array.isArray(x?.refs) ? x.refs : []).slice(0, 3).map(n => mejores[Number(n) - 1]).filter(Boolean).map(p => ({ cuenta: p.cuenta, enlace: p.enlace, pie: limpia(p.gancho || p.pie, 90), me_gusta: p.me_gusta, comentarios: p.comentarios, miniatura: p.miniatura, vistas: p.vistas })) })), fiabilidad: limpia(r.fiabilidad, 240) };
    const prev = await leerJson(RUTA_NICHO, { cuentas: [] }); await guardarJson(RUTA_NICHO, { ...prev, cuentas: cuentas, instagram: out });
    res.json({ ok: true, nicho: out });
  } catch (e) { console.error('redes nicho', e.message); res.status(500).json({ error: 'No se pudo analizar el nicho: ' + String(e.message).slice(0, 200) }); }
});

// ── 5) YouTube (datos públicos con una clave de la API de YouTube; no hace falta conectar cuentas)
router.post('/nicho/youtube', async (req, res) => {
  try {
    const cfg = await leerJson(RUTA_CONFIG, {}), clave = cfg.youtube_key || process.env.YOUTUBE_API_KEY;
    if (!clave) return res.status(503).json({ error: 'Falta la clave de la API de YouTube.' });
    const consulta = limpia(req.body?.consulta, 120); if (!consulta) return res.status(400).json({ error: 'Escribe qué buscar (por ejemplo: diseño de gimnasios)' });
    const yt = async (ruta, p) => { const u = new URL('https://www.googleapis.com/youtube/v3/' + ruta); for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v); u.searchParams.set('key', clave); const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || ('YouTube ' + r.status)); return j; };
    const desde = new Date(Date.now() - 365 * 86400000).toISOString();
    const b = await yt('search', { part: 'snippet', q: consulta, type: 'video', order: 'viewCount', maxResults: '25', publishedAfter: desde, relevanceLanguage: 'es', regionCode: 'ES' });
    const ids = (b.items || []).map(i => i.id.videoId).filter(Boolean); if (!ids.length) return res.status(422).json({ error: 'No he encontrado vídeos para esa búsqueda.' });
    const v = await yt('videos', { part: 'snippet,statistics,contentDetails', id: ids.join(',') });
    const canales = [...new Set((v.items || []).map(x => x.snippet.channelId))]; const cs = await yt('channels', { part: 'statistics,snippet', id: canales.slice(0, 50).join(',') });
    const subs = Object.fromEntries((cs.items || []).map(c => [c.id, Number(c.statistics?.subscriberCount) || 0]));
    const dur = (iso) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || ''); return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0; };
    const lista = (v.items || []).map(x => { const vistas = Number(x.statistics?.viewCount) || 0, s = subs[x.snippet.channelId] || 0; return { miniatura: x.snippet.thumbnails?.medium?.url || '', titulo: x.snippet.title, canal: x.snippet.channelTitle, fecha: x.snippet.publishedAt.slice(0, 10), segundos: dur(x.contentDetails?.duration), vistas, me_gusta: Number(x.statistics?.likeCount) || 0, comentarios: Number(x.statistics?.commentCount) || 0, suscriptores: s, vistas_por_suscriptor: Math.round(vistas / Math.max(s, 1000) * 100) / 100, enlace: 'https://www.youtube.com/watch?v=' + x.id }; }).sort((a, b) => (b.vistas_por_suscriptor ?? 0) - (a.vistas_por_suscriptor ?? 0));
    await refrescaPrefs();
    const r = json(await callClaude({ system: textoPrefs() + 'Eres analista de contenido de YouTube. Te paso vídeos públicos de un nicho (diseño y equipamiento de gimnasios) ordenados por vistas relativas al tamaño del canal (los que más rinden por encima de su audiencia son los «ganadores»). Saca qué títulos/ganchos, formatos y temas funcionan y propón ideas para Víctor Palomo (Ranuse Design, diseño de gimnasios), adaptadas a su marca. IMPORTANTE: NO te limites a los formatos que Víctor ya hace. Cada idea lleva "origen": "tus datos" (basada en lo que ya le funciona), "nicho" (basada en lo que funciona a otros) o "exploracion" (formato nuevo que no ha probado, para descubrir). Incluye SIEMPRE al menos 2 ideas de "exploracion". Solo datos públicos. Devuelves SOLO JSON {"patrones":["..."],"ganchos_titulos":["fórmula con ejemplo"],"formatos":["..."],"ideas_para_victor":[{"idea":"","formato":"short|vídeo largo|otro","gancho":"","por_que":"","origen":"nicho|exploracion"}],"fiabilidad":"..."}', messages: [{ role: 'user', content: 'Búsqueda: ' + consulta + '\
' + JSON.stringify(lista.slice(0, 20)) }], maxTokens: 3000 }));
    const out = { fecha: new Date().toISOString(), plataforma: 'youtube', consulta, top: lista.slice(0, 12), patrones: (r.patrones || []).slice(0, 8).map(x => limpia(x, 240)), ganchos: (r.ganchos_titulos || []).slice(0, 8).map(x => limpia(x, 240)), formatos: (r.formatos || []).slice(0, 6).map(x => limpia(x, 240)), ideas: (r.ideas_para_victor || []).slice(0, 10).map(x => ({ idea: limpia(x?.idea, 240), formato: limpia(x?.formato, 30), gancho: limpia(x?.gancho, 200), por_que: limpia(x?.por_que, 200), origen: limpia(x?.origen, 20) })), fiabilidad: limpia(r.fiabilidad, 240) };
    const prev = await leerJson(RUTA_NICHO, { cuentas: [] }); await guardarJson(RUTA_NICHO, { ...prev, youtube: out });
    res.json({ ok: true, nicho: out });
  } catch (e) { console.error('redes youtube', e.message); res.status(500).json({ error: 'No se pudo analizar YouTube: ' + String(e.message).slice(0, 200) }); }
});
// ── 5b) Tu canal de YouTube (datos públicos con la clave de YouTube)
const ytLlamada = async (clave, ruta, p) => { const u = new URL('https://www.googleapis.com/youtube/v3/' + ruta); for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v); u.searchParams.set('key', clave); const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || ('YouTube ' + r.status)); return j; };
const duracionS = (iso) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || ''); return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0; };
router.post('/youtube/mi-canal', async (req, res) => {
  try {
    const cfg = await leerJson(RUTA_CONFIG, {}), clave = cfg.youtube_key || process.env.YOUTUBE_API_KEY; if (!clave) return res.status(503).json({ error: 'Falta la clave de la API de YouTube.' });
    let entrada = String(req.body?.canal || cfg.youtube_canal || ''); try { entrada = decodeURIComponent(entrada); } catch { /* tal cual */ }
    const h = /@([^/?#\s]+)/.exec(entrada)?.[1], idc = /channel\/(UC[\w-]{20,})/.exec(entrada)?.[1];
    if (!h && !idc) return res.status(400).json({ error: 'Pega el enlace de tu canal (youtube.com/@tuCanal).' });
    const ch = await ytLlamada(clave, 'channels', { part: 'snippet,statistics,contentDetails', ...(idc ? { id: idc } : { forHandle: '@' + h }) });
    const c = ch.items?.[0]; if (!c) return res.status(404).json({ error: 'No encuentro ese canal. Revisa el enlace.' });
    if (req.body?.canal) { cfg.youtube_canal = String(req.body.canal).slice(0, 300); await guardarJson(RUTA_CONFIG, cfg); }
    const lista = await ytLlamada(clave, 'playlistItems', { part: 'contentDetails', playlistId: c.contentDetails.relatedPlaylists.uploads, maxResults: '50' });
    const ids = (lista.items || []).map(i => i.contentDetails.videoId); let vids = [];
    if (ids.length) { const v = await ytLlamada(clave, 'videos', { part: 'snippet,statistics,contentDetails', id: ids.join(',') }); vids = (v.items || []).map(x => ({ id: x.id, titulo: x.snippet.title, fecha: x.snippet.publishedAt.slice(0, 10), segundos: duracionS(x.contentDetails?.duration), vistas: Number(x.statistics?.viewCount) || 0, me_gusta: Number(x.statistics?.likeCount) || 0, comentarios: Number(x.statistics?.commentCount) || 0, miniatura: x.snippet.thumbnails?.medium?.url || '', enlace: 'https://www.youtube.com/watch?v=' + x.id, tipo: duracionS(x.contentDetails?.duration) <= 60 ? 'short' : 'largo' })); }
    const orden = vids.slice().sort((a, b) => b.vistas - a.vistas), subs = Number(c.statistics?.subscriberCount) || 0;
    const base = { canal: c.snippet.title, handle: h ? '@' + h : '', suscriptores: subs, videos_total: Number(c.statistics?.videoCount) || 0, vistas_total: Number(c.statistics?.viewCount) || 0, foto: c.snippet.thumbnails?.default?.url || '', videos: vids, fecha: new Date().toISOString() };
    if (vids.length < 4) { await guardarJson('crm/redes/youtube_canal.json', base); return res.json({ ok: true, canal: base, aviso: 'Tiene muy pocos vídeos para sacar patrones.' }); }
    const r = json(await callClaude({ system: 'Eres analista de YouTube para un canal personal de diseño de gimnasios (Víctor Palomo, Ranuse Design). Comparas sus vídeos que mejor y peor funcionaron (vistas, me gusta, comentarios, duración, shorts frente a largos, título/gancho, fecha) y sacas patrones REALES, la cadencia de publicación y qué haría para crecer. Solo lo que se ve en los datos; no tienes retención ni tráfico (lo dices). Devuelves SOLO JSON {"resumen":"2-3 frases","funciona":["patrón"],"no_funciona":["patrón"],"formato":"shorts o largos: qué le rinde más y por qué","titulos":["fórmula de título que le funcionó"],"cadencia":"cuánto publica ahora y qué recomiendas","ideas":[{"idea":"","formato":"short|vídeo largo","gancho":"","por_que":""}],"fiabilidad":"..."}', messages: [{ role: 'user', content: 'Canal: ' + base.canal + ' · ' + subs + ' suscriptores · ' + base.videos_total + ' vídeos.\nMEJORES:\n' + JSON.stringify(orden.slice(0, 8).map(v => ({ titulo: v.titulo, tipo: v.tipo, segundos: v.segundos, vistas: v.vistas, me_gusta: v.me_gusta, comentarios: v.comentarios, fecha: v.fecha }))) + '\nPEORES:\n' + JSON.stringify(orden.slice(-6).map(v => ({ titulo: v.titulo, tipo: v.tipo, segundos: v.segundos, vistas: v.vistas, fecha: v.fecha }))) + '\nFECHAS DE TODOS: ' + vids.map(v => v.fecha).join(',') }], maxTokens: 3000 }));
    const out = { ...base, analisis: { resumen: limpia(r.resumen, 500), funciona: (r.funciona || []).slice(0, 8).map(x => limpia(x, 240)), no_funciona: (r.no_funciona || []).slice(0, 8).map(x => limpia(x, 240)), formato: limpia(r.formato, 300), titulos: (r.titulos || []).slice(0, 6).map(x => limpia(x, 200)), cadencia: limpia(r.cadencia, 300), ideas: (r.ideas || []).slice(0, 8).map(x => ({ idea: limpia(x?.idea, 240), formato: limpia(x?.formato, 20), gancho: limpia(x?.gancho, 200), por_que: limpia(x?.por_que, 200) })), fiabilidad: limpia(r.fiabilidad, 240) } };
    await guardarJson('crm/redes/youtube_canal.json', out); res.json({ ok: true, canal: out });
  } catch (e) { console.error('redes mi canal', e.message); res.status(500).json({ error: 'No se pudo leer tu canal: ' + String(e.message).slice(0, 200) }); }
});

// ── 5c) Plan de publicación: volumen, formatos, días y horas, y tendencias del nicho (a partir de TUS datos, los del canal de YouTube y las cuentas del nicho)
router.post('/plan', async (req, res) => {
  try {
    const c = await conexion(); const yt = await leerJson('crm/redes/youtube_canal.json', null), nicho = await leerJson(RUTA_NICHO, {}), apr = await leerJson(RUTA_APRENDIZAJE, null);
    if (!c && !yt) return res.status(404).json({ error: 'Conecta tu Instagram o añade tu canal de YouTube primero.' });
    const media = (c?.media || []).slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    const semanas = {}; for (const m of media) { const d = new Date(m.fecha); const lun = new Date(d); lun.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = lun.toISOString().slice(0, 10); (semanas[k] = semanas[k] || []).push(m); }
    const porSemana = Object.entries(semanas).slice(-14).map(([k, l]) => ({ semana: k, publicaciones: l.length, vistas_media: Math.round(l.reduce((s, x) => s + (vistasDe(x) || 0), 0) / l.length), vistas_totales: l.reduce((s, x) => s + (vistasDe(x) || 0), 0) }));
    const cadenciaNicho = (nicho.instagram?.cuentas || []).length ? (() => { const out = []; for (const d of (nicho.instagram?.top || [])) out.push(d.fecha); return out.length; })() : null;
    await refrescaPrefs();
    const diaSem = {}; for (const m of (await marcaPruebas(c?.media || [])).filter(x => !x.prueba)) { const d = new Date(m.fecha).toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' }); const q = (diaSem[d] = diaSem[d] || { n: 0, vistas: 0 }); q.n++; q.vistas += vistasDe(m) || 0; }
    const porDia = Object.fromEntries(Object.entries(diaSem).map(([d, q]) => [d, { publicaciones: q.n, vistas_medias: Math.round(q.vistas / q.n) }]));
    const salud = await leerJson(RUTA_SALUD, null);
    const r = json(await callClaude({ system: textoPrefs() + 'REGLAS DEL PLAN (obligatorias): (1) Se publica UN solo vídeo vertical por día de publicación, el mismo a la vez en Instagram (Reels), TikTok y YouTube Shorts desde Metricool. Por tanto NO hay días de YouTube y días de Instagram: cada día de publicación es una única entrada con una hora pensada para Instagram, que manda. TODO EL PLAN ES DE INSTAGRAM: nada de horarios, días, tendencias, pruebas ni ideas específicas de YouTube o TikTok (solo di que el mismo vídeo sale también allí, sin más); las tendencias y las pruebas son de Instagram (formatos, ganchos, Reels, Historias, carruseles, colaboraciones). youtube_mes = 0 salvo que haya un motivo claro. En dias_horas habla SOLO de Instagram y de las historias. (2) El plan debe ser COHERENTE con el análisis de la cuenta y con los datos por día de la semana que se te dan: si un día rinde claramente peor o el análisis aconseja no publicar ese día, ese día es DESCANSO o solo historias, y lo dices con el dato. (3) Reparte la semana en embudo: la mayoría de los reels atraen a la AUDIENCIA AMPLIA (según su rumbo), y una parte conecta y convierte hacia el cliente que quiere. (4) Cada entrada de semana_tipo empieza por REEL (o CARRUSEL, o HISTORIAS, o DESCANSO) y la hora. Eres estratega de contenido de Instagram con TikTok y Shorts de acompañante. Recomiendas un PLAN DE PUBLICACIÓN realista y basado en datos para Víctor Palomo (Ranuse Design, diseño de gimnasios; persona sola que además diseña y atiende clientes). Usa SUS números por semana (volumen frente a rendimiento), sus mejores formatos, días y horas, y lo que se ve en el nicho. Sé honesto: de las tendencias de la plataforma (audios, formatos del momento) NO tienes datos oficiales; solo lo que se ve en las cuentas del nicho y en tus conocimientos generales, y lo marcas como tal. Devuelves SOLO JSON {"volumen":{"reels_semana":0,"carruseles_semana":0,"historias_dia":0,"youtube_mes":0,"por_que":"basado en sus datos"},"dias_horas":"mejores momentos","semana_tipo":[{"dia":"lunes","que":"qué publicar"}],"tendencias":[{"tendencia":"","fuente":"datos propios|nicho|conocimiento general","como_aprovecharla":""}],"riesgos":["cosas a evitar (saturar, bajar calidad…)"],"experimentos":["prueba concreta de 2 semanas para aprender más"],"faltan_datos":["qué dato no tienes y cómo conseguirlo"]}', messages: [{ role: 'user', content: 'INSTAGRAM (@' + (c?.usuario || '—') + ', ' + (c?.seguidores ?? '?') + ' seguidores): publicaciones y vistas por semana (últimas 14):\n' + JSON.stringify(porSemana) + '\n\nLO QUE YA SE SABE QUE FUNCIONA: ' + JSON.stringify(apr ? { funciona: apr.lo_que_funciona, no: apr.lo_que_no, horarios: apr.horarios } : 'sin análisis') + '\n\nRENDIMIENTO POR DÍA DE LA SEMANA (sus reels): ' + JSON.stringify(porDia) + '\n\nDATOS YA MEDIDOS (NO los pongas en faltan_datos): ' + JSON.stringify(await leerJson(RUTA_HUECOS, null) ? { formatos: (await leerJson(RUTA_HUECOS, {})).formatos, lecturas: (await leerJson(RUTA_HUECOS, {})).lecturas } : 'aún sin medir') + '\n\nANÁLISIS DE SALUD DE LA CUENTA (el plan no debe contradecirlo): ' + JSON.stringify(salud ? { titular: salud.titular, alertas: salud.alertas, acciones: salud.acciones } : 'sin analizar') + '\n\nYOUTUBE: ' + JSON.stringify(yt ? { suscriptores: yt.suscriptores, videos: yt.videos_total, cadencia: yt.analisis?.cadencia, formato: yt.analisis?.formato } : 'sin canal') + '\n\nNICHO (instagram): ' + JSON.stringify(nicho.instagram ? { patrones: nicho.instagram.patrones, formatos: nicho.instagram.formatos } : 'sin analizar') + '\nNICHO (youtube): ' + JSON.stringify(nicho.youtube ? { patrones: nicho.youtube.patrones, formatos: nicho.youtube.formatos } : 'sin analizar') }], maxTokens: 6500 }));
    const out = { fecha: new Date().toISOString(), por_semana: porSemana, volumen: { reels_semana: Number(r.volumen?.reels_semana) || 0, carruseles_semana: Number(r.volumen?.carruseles_semana) || 0, historias_dia: Number(r.volumen?.historias_dia) || 0, youtube_mes: Number(r.volumen?.youtube_mes) || 0, por_que: limpia(r.volumen?.por_que, 500) }, dias_horas: limpia(r.dias_horas, 300), semana_tipo: (r.semana_tipo || []).slice(0, 7).map(x => ({ dia: limpia(x?.dia, 12), que: limpia(x?.que, 200) })), tendencias: (r.tendencias || []).slice(0, 8).map(x => ({ tendencia: limpia(x?.tendencia, 200), fuente: limpia(x?.fuente, 30), como_aprovecharla: limpia(x?.como_aprovecharla, 220) })), riesgos: (r.riesgos || []).slice(0, 5).map(x => limpia(x, 200)), experimentos: (r.experimentos || []).slice(0, 4).map(x => limpia(x, 240)), faltan_datos: (r.faltan_datos || []).slice(0, 4).map(x => limpia(x, 200)) };
    await guardarJson('crm/redes/plan.json', out); res.json({ ok: true, plan: out });
  } catch (e) { console.error('redes plan', e.message); res.status(500).json({ error: 'No se pudo preparar el plan: ' + String(e.message).slice(0, 200) }); }
});
router.get('/nicho', async (req, res) => { try { res.json(await leerJson(RUTA_NICHO, { cuentas: [] })); } catch { res.status(500).json({ error: 'No se pudo leer' }); } });

export default router;
