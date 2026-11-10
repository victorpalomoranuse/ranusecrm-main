import express from 'express';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { leerJson, guardarJson } from '../utils/asistente-personal.js';
import { callClaude } from '../utils/anthropic.js';
import { creaTrabajoSistema, leeTrabajoSistema } from './estudio-video.routes.js';

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
const limpia = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

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
router.post('/instagram/sincronizar', async (req, res) => {
  try { const m = await sincronizarInstagram(Math.min(400, Number(req.body?.max) || 300)); res.json({ ok: true, publicaciones: m.length }); }
  catch (e) { res.status(e.codigo === 190 ? 401 : 500).json({ error: e.codigo === 190 ? 'La conexión con Instagram caducó: vuelve a conectarla.' : 'No se pudieron leer tus publicaciones: ' + String(e.message).slice(0, 200) }); }
});

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
export async function refrescaPrefs() {
  try { const p = await leerJson(RUTA_PREFS, { reglas: [] }), no = (p.reglas || []).filter(r => r.tipo === 'no').map(r => '- ' + r.texto), si = (p.reglas || []).filter(r => r.tipo === 'si').map(r => '- ' + r.texto), tr = (p.reglas || []).filter(r => r.tipo === 'transmitir').map(r => '- ' + r.texto), sa = (p.reglas || []).filter(r => r.tipo === 'saber').map(r => '- ' + r.texto);
    PREFS_TXT = no.length || si.length || tr.length || sa.length ? 'PREFERENCIAS DE VÍCTOR (OBLIGATORIAS: nunca las incumplas ni propongas nada que las contradiga, ni en ideas, ni en acciones, ni en guiones, ni en el plan)' + (no.length ? '\nNO QUIERE:\n' + no.join('\n') : '') + (si.length ? '\nQUIERE:\n' + si.join('\n') : '') + (tr.length ? '\nQUIERE TRANSMITIR (imagen y mensaje de marca; todo lo que propongas debe reforzarlo):\n' + tr.join('\n') : '') + (sa.length ? '\nCONTEXTO QUE DEBES SABER (hechos reales de su negocio; úsalos para interpretar bien los datos, por ejemplo qué publicaciones son de clientes y cuáles deberían rendir más):\n' + sa.join('\n') : '') + '\n' : '';
  } catch { PREFS_TXT = ''; }
  return PREFS_TXT;
}
// Realidad fija de su negocio: los proyectos con famosos o clientes concretos son ocasionales, no se pueden repetir a demanda
const BASE_REALIDAD = 'REALIDAD DE SU NEGOCIO (siempre): no siempre hay proyectos con famosos ni clientes llamativos disponibles. NO propongas series ni ideas que dependan de que exista un cliente famoso o un proyecto concreto; prioriza contenido que pueda hacer cualquier semana (explicar procesos, errores típicos, comparativas, cifras reales de obra, detrás de cámaras, reutilizar material que ya tiene, él solo con el móvil). Si una idea aprovecha un proyecto o cliente concreto, márcala como "oportunista: solo si hay proyecto".\n';
const textoPrefs = () => BASE_REALIDAD + PREFS_TXT;
const RUTA_OBJETIVO = 'crm/redes/objetivo.json';
const objetivoActual = async () => { await refrescaPrefs(); const o = await leerJson(RUTA_OBJETIVO, null); return OBJETIVOS[o?.id] ? o.id : 'crecimiento'; };
const redondea = (x) => Math.round(x * 10) / 10;
const puntua = (m, seg, obj = 'crecimiento') => (OBJETIVOS[obj] || OBJETIVOS.crecimiento).f(m);
const textoObjetivo = (obj) => { const o = OBJETIVOS[obj] || OBJETIVOS.crecimiento; return textoPrefs() + 'OBJETIVO ELEGIDO: «' + o.nombre + '» — ' + o.que + ' Se mide así: ' + o.formula + ' Juzga "lo que funciona" SOLO con ese criterio.'; };
// Un reel de prueba es el que casi no se ha mostrado a nadie (alcance muy por debajo de lo habitual de la cuenta). Se detecta solo y se puede corregir a mano.
const RUTA_PRUEBAS = 'crm/redes/pruebas.json';
async function marcaPruebas(media) {
  const ov = await leerJson(RUTA_PRUEBAS, { si: [], no: [] }), v = media.map(vistasDe).filter(Number.isFinite), med = mediana(v) || 0, umbral = Math.max(150, med * 0.04);
  return media.map(m => { const auto = (vistasDe(m) ?? 0) < umbral; const prueba = ov.si.includes(m.id) ? true : ov.no.includes(m.id) ? false : auto; return { ...m, prueba, prueba_auto: auto }; });
}
// ── TALLER DE IDEAS: de una idea a un guion por escenas (con micro, qué grabar, qué renderizar, música) y un chat para pulirlo
const RUTA_GUIONES = 'crm/redes/guiones.json';
const ESQUEMA_GUION = '{"titulo":"","formato":"","duracion_seg":0,"objetivo":"","necesita_micro":true,"equipo":["micro de solapa","trípode","..."],"ganchos_alternativos":["3 ganchos distintos para probar"],"escenas":[{"n":1,"tipo":"a_camara|broll|render|pantalla|voz_en_off","micro":true,"segundos":0,"que_hacer":"qué grabar o qué renderizar, concreto","hablado":"lo que dice Víctor, con su voz, tal cual (vacío si no habla)","texto_pantalla":"","edicion":"ritmo, efecto o corte sugerido"}],"cta":"","musica":{"estilo":"","bpm":"","ambiente":"","nota":"tipo de pista; los audios de tendencia de Instagram no se pueden descargar, se elige uno parecido de su librería"},"para_el_editor":"indicaciones para la IA que monta el vídeo","preguntas":["dudas que necesitas que Víctor resuelva para afinar el guion"]}';
const limpiaGuion = (g) => ({
  titulo: limpia(g?.titulo, 140), formato: limpia(g?.formato, 40), duracion_seg: Math.max(0, Number(g?.duracion_seg) || 0), objetivo: limpia(g?.objetivo, 80), necesita_micro: !!g?.necesita_micro,
  equipo: (g?.equipo || []).slice(0, 10).map(x => limpia(x, 80)), ganchos_alternativos: (g?.ganchos_alternativos || []).slice(0, 5).map(x => limpia(x, 220)),
  escenas: (g?.escenas || []).slice(0, 25).map((s, i) => ({ n: i + 1, tipo: ['a_camara', 'broll', 'render', 'pantalla', 'voz_en_off'].includes(s?.tipo) ? s.tipo : 'broll', micro: !!s?.micro || s?.tipo === 'a_camara' || s?.tipo === 'voz_en_off', segundos: Math.max(0, Number(s?.segundos) || 0), que_hacer: limpia(s?.que_hacer, 400), hablado: limpia(s?.hablado, 600), texto_pantalla: limpia(s?.texto_pantalla, 120), edicion: limpia(s?.edicion, 240) })),
  cta: limpia(g?.cta, 240), musica: { estilo: limpia(g?.musica?.estilo, 100), bpm: limpia(g?.musica?.bpm, 20), ambiente: limpia(g?.musica?.ambiente, 120), nota: limpia(g?.musica?.nota, 240) }, para_el_editor: limpia(g?.para_el_editor, 900), preguntas: (g?.preguntas || []).slice(0, 6).map(x => limpia(x, 220)),
});
async function contextoCreativo() {
  const vm = await leerJson(RUTA_VOZ_MARCA, null), ap = await leerJson(RUTA_APRENDIZAJE, null), ni = await leerJson(RUTA_NICHO, {}), obj = await objetivoActual();
  return textoObjetivo(obj) + (vm ? '\nSU VOZ REAL (escribe así): ' + JSON.stringify({ rasgos: vm.rasgos, muletillas: vm.muletillas, como_abre: vm.como_abre, frases: vm.frases_tipo, evitar: vm.evitar }) : '') + '\nLO QUE SE HA APRENDIDO DE SU CUENTA: ' + JSON.stringify(ap ? { funciona: ap.lo_que_funciona, no: ap.lo_que_no, ganchos: ap.ganchos_ganadores, editor: ap.para_el_editor } : 'sin analizar') + '\nNICHO: ' + JSON.stringify({ ig: ni.instagram ? { patrones: ni.instagram.patrones, ganchos: ni.instagram.ganchos } : null, yt: ni.youtube ? { patrones: ni.youtube.patrones } : null });
}
const SISTEMA_GUION = 'Eres el guionista y director de Víctor Palomo (Ranuse Design, diseño de espacios deportivos y gimnasios). Escribes SU voz: cercana, directa, de profesional que sabe, sin postureo ni frases de manual. Conviertes una idea en un guion REAL por escenas. Reglas: (1) cada escena dice si Víctor habla a cámara o en off (micro:true) o si es solo imagen (micro:false); (2) en "que_hacer" di exactamente qué grabar (plano, lugar, acción) o qué renderizar (qué vista del 3D, qué cámara); aprovecha los renders y planos que él ya produce; (3) el gancho va en los primeros 2 segundos; (4) termina con un CTA acorde al objetivo elegido; (5) propón música (estilo y bpm) sin inventar canciones concretas; (6) si te falta información importante, ponla en "preguntas" en vez de inventarla. Devuelves SOLO JSON con esta forma: ' + ESQUEMA_GUION;
router.post('/guion/generar', async (req, res) => {
  try {
    const idea = limpia(req.body?.idea, 400), formato = limpia(req.body?.formato, 40), gancho = limpia(req.body?.gancho, 240), origen = limpia(req.body?.origen, 20), extra = limpia(req.body?.extra, 600);
    if (!idea && !gancho) return res.status(400).json({ error: 'Falta la idea' });
    const r = json(await callClaude({ system: SISTEMA_GUION, messages: [{ role: 'user', content: (await contextoCreativo()) + '\n\nIDEA: ' + idea + '\nFORMATO: ' + (formato || 'el que mejor encaje') + '\nGANCHO PROPUESTO: ' + gancho + '\nORIGEN: ' + origen + (extra ? '\nINDICACIONES DE VÍCTOR: ' + extra : '') }], maxTokens: 6000 }));
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
    for (const x of elegidos) { try { const j = await graph('/' + x.m.id, { fields: 'media_url' }, c.token); if (j.media_url) videos.push({ id: x.m.id, url: j.media_url, enlace: x.m.enlace, pie: limpia(x.m.pie, 140), puntuacion: redondea(x.p) }); } catch { /* sin url */ } }
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
    const media = await marcaPruebas(c.media || []), reales = media.filter(m => !m.prueba);
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
    const t = await creaTrabajoSistema({ id: 'p' + crypto.randomUUID().slice(0, 7), creado: new Date().toISOString(), por: 'sistema', tipo: 'analisis_redes', videos: [{ id: 'subido', ruta, pie: limpia(req.body?.nombre, 100) }], nombre_archivo: 'Vídeo para predecir', estado: 'pendiente', progreso: 'En cola', version: 1 });
    res.json({ ok: true, id: t.id });
  } catch (e) { res.status(500).json({ error: 'No se pudo analizar el vídeo: ' + String(e.message || e).slice(0, 140) }); }
});
router.get('/video/:id', async (req, res) => {
  try {
    const t = await leeTrabajoSistema(String(req.params.id).replace(/[^\w-]/g, '')); if (!t) return res.status(404).json({ error: 'No existe' });
    if (t.estado === 'error') return res.json({ estado: 'error', error: t.error });
    if (t.estado !== 'listo') return res.json({ estado: 'procesando', progreso: t.progreso, pct: t.pct || 0 });
    const a = t.analisis_videos?.[0]?.analisis; if (!a) return res.json({ estado: 'error', error: t.analisis_videos?.[0]?.error || 'No he podido leer el vídeo' });
    const texto = 'VÍDEO YA EDITADO (medido por la IA): dura ' + Math.round(a.dur) + ' s, ' + a.planos + ' planos (plano medio ' + a.plano_medio + ' s), ' + (a.palabras_por_min ? a.palabras_por_min + ' palabras por minuto' : 'sin voz hablada') + '. ' + limpia(a.descripcion, 400) + ' Estructura: ' + (a.estructura || []).map(x => limpia(x, 160)).join(' | ');
    res.json({ estado: 'listo', texto, dur: a.dur, planos: a.planos, plano_medio: a.plano_medio });
  } catch (e) { res.status(500).json({ error: 'No se pudo leer el análisis' }); }
});
// ── HISTORIAS: Instagram solo deja leer las historias mientras están activas (24 h), así que se guardan solas cada pocas horas con sus números
const RUTA_HISTORIAS_IG = 'crm/redes/historias_ig.json';
export async function sincronizarHistoriasIG() {
  const c = await conexion(); if (!c) return { n: 0 };
  let j; try { j = await graph('/' + c.ig_id + '/stories', { fields: 'id,media_type,permalink,timestamp,thumbnail_url' }, c.token); } catch (e) { return { n: 0, error: String(e.message).slice(0, 120) }; }
  const d = await leerJson(RUTA_HISTORIAS_IG, { historias: [] }), por = new Map((d.historias || []).map(h => [h.id, h]));
  for (const s of (j.data || [])) {
    const h = por.get(s.id) || { id: s.id, fecha: s.timestamp, tipo: s.media_type, enlace: s.permalink };
    for (const m of ['reach', 'replies', 'shares', 'total_interactions', 'views', 'follows', 'profile_visits']) { try { const r = await graph('/' + s.id + '/insights', { metric: m }, c.token); const x = r.data?.[0]; const v = x?.values?.[0]?.value ?? x?.total_value?.value; if (v != null) h[m] = Number(v) || 0; } catch { /* métrica no disponible para esta historia */ } }
    try { const r = await graph('/' + s.id + '/insights', { metric: 'navigation', breakdown: 'story_navigation_action_type' }, c.token); const res = r.data?.[0]?.total_value?.breakdowns?.[0]?.results || []; h.navegacion = Object.fromEntries(res.map(x => [String(x.dimension_values?.[0] || '').toLowerCase(), Number(x.value) || 0])); } catch { /* sin navegación */ }
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
router.get('/objetivos', async (req, res) => { try { const id = await objetivoActual(); res.json({ actual: id, objetivos: Object.entries(OBJETIVOS).map(([k, o]) => ({ id: k, nombre: o.nombre, icono: o.icono, que: o.que, formula: o.formula, unidad: o.unidad })) }); } catch { res.status(500).json({ error: 'No se pudieron leer' }); } });
router.post('/objetivo', async (req, res) => { try { const id = String(req.body?.id || ''); if (!OBJETIVOS[id]) return res.status(400).json({ error: 'Objetivo no válido' }); await guardarJson(RUTA_OBJETIVO, { id }); res.json({ ok: true }); } catch { res.status(500).json({ error: 'No se pudo guardar' }); } });
router.post('/instagram/prueba', async (req, res) => {
  try { const id = String(req.body?.id || ''); const ov = await leerJson(RUTA_PRUEBAS, { si: [], no: [] }); ov.si = ov.si.filter(x => x !== id); ov.no = ov.no.filter(x => x !== id); (req.body?.prueba ? ov.si : ov.no).push(id); await guardarJson(RUTA_PRUEBAS, ov); res.json({ ok: true }); }
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
    const ficha = (x) => ({ tipo: x.m.tipo, fecha: String(x.m.fecha).slice(0, 16), dia_hora: new Date(x.m.fecha).toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', timeZone: 'Europe/Madrid' }), gancho: x.m.pie.split(/[\n.!?]/)[0].slice(0, 160), pie: x.m.pie.slice(0, 300), alcance: x.m.reach ?? x.m.views ?? null, me_gusta: x.m.me_gusta, comentarios: x.m.comentarios, guardados: x.m.saved ?? null, compartidos: x.m.shares ?? null, tiempo_visto: x.m.ig_reels_avg_watch_time ?? null, puntuacion: redondea(x.p) });
    const r = json(await callClaude({ system: textoObjetivo(obj) + ' Eres analista de contenido de Instagram para una marca personal de diseño de gimnasios (Ranuse Design, Víctor Palomo). IMPORTANTE: NO te limites a los formatos que Víctor ya hace. Cada idea lleva "origen": "tus datos" (basada en lo que ya le funciona), "nicho" (basada en lo que funciona a otros) o "exploracion" (formato nuevo que no ha probado, para descubrir). Incluye SIEMPRE al menos 2 ideas de "exploracion". Comparas las publicaciones que MEJOR y PEOR funcionaron para sacar patrones reales y accionables: qué ganchos (primera línea), formatos, temas, longitudes de texto, llamadas a la acción, días y horas funcionan y cuáles no. No inventes: solo conclusiones que se vean en los datos; si no hay base suficiente, dilo. Devuelves SOLO JSON {"resumen":"2-3 frases","lo_que_funciona":["patrón concreto"],"lo_que_no":["patrón concreto"],"ganchos_ganadores":["ejemplo o fórmula de gancho que funcionó, con su porqué"],"ideas_ganadoras":[{"idea":"idea de contenido nueva","formato":"reel|carrusel|foto|historia|otro formato","gancho":"primera frase","origen":"tus datos|nicho|exploracion"}],"para_el_editor":["regla corta para editar vídeos (ritmo, gancho, duración, texto) si se deduce de los datos"],"para_historias":["regla corta para las historias si se deduce"],"horarios":"mejores días y horas si se ven","fiabilidad":"alta|media|baja y por qué (nº de publicaciones, métricas que faltan)"}', messages: [{ role: 'user', content: 'Cuenta: @' + c.usuario + ' · ' + (c.seguidores || '?') + ' seguidores · ' + media.length + ' publicaciones analizadas.\
\
LAS QUE MEJOR FUNCIONARON (puntuación = interacciones ponderadas / alcance):\
' + JSON.stringify(orden.slice(0, n).map(ficha)) + '\
\
LAS QUE PEOR:\
' + JSON.stringify(orden.slice(-n).map(ficha)) }], maxTokens: 4000 }));
    const a = { fecha: new Date().toISOString(), objetivo: obj, cuenta: c.usuario, n: media.length, pruebas_excluidas: nPruebas, resumen: limpia(r.resumen, 500), lo_que_funciona: (r.lo_que_funciona || []).slice(0, 8).map(x => limpia(x, 240)), lo_que_no: (r.lo_que_no || []).slice(0, 8).map(x => limpia(x, 240)), ganchos_ganadores: (r.ganchos_ganadores || []).slice(0, 8).map(x => limpia(x, 240)), ideas_ganadoras: (r.ideas_ganadoras || []).slice(0, 10).map(x => ({ idea: limpia(x?.idea, 240), formato: limpia(x?.formato, 30), gancho: limpia(x?.gancho, 200), origen: limpia(x?.origen, 20) })), para_el_editor: (r.para_el_editor || []).slice(0, 6).map(x => limpia(x, 220)), para_historias: (r.para_historias || []).slice(0, 6).map(x => limpia(x, 220)), horarios: limpia(r.horarios, 240), fiabilidad: limpia(r.fiabilidad, 240) };
    await guardarJson(RUTA_APRENDIZAJE, a);
    // lo aprendido llega al editor de vídeo y al asistente (historias), marcado con su origen
    try { const e = await leerJson('crm/estudio-video/editor.json', { hechos: [], charla: [] }); for (const t of a.para_el_editor) { const x = 'De tus resultados en Instagram: ' + t; if (!e.hechos.some(h => h.texto === x)) e.hechos.push({ id: crypto.randomUUID().slice(0, 6), texto: x, fecha: new Date().toISOString().slice(0, 10) }); } e.hechos = e.hechos.slice(-80); await guardarJson('crm/estudio-video/editor.json', e); } catch { /* sin editor */ }
    try { const l = await leerJson('crm/asistente/historias_lecciones.json', { lecciones: [] }); const hoy = new Date().toISOString().slice(0, 10); for (const t of a.para_historias) { const x = 'Según tus datos de Instagram: ' + t; if (!l.lecciones.some(y => y.texto === x)) l.lecciones.push({ id: crypto.randomUUID().slice(0, 6), fecha: hoy, texto: x }); } l.lecciones = l.lecciones.slice(-60); await guardarJson('crm/asistente/historias_lecciones.json', l); } catch { /* sin lecciones */ }
    res.json({ ok: true, aprendizaje: a });
  } catch (e) { console.error('redes analizar', e.message); res.status(500).json({ error: 'No se pudo analizar: ' + String(e.message).slice(0, 200) }); }
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
router.post('/instagram/predecir', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(404).json({ error: 'Conecta primero tu Instagram' });
    const propuesta = limpia(req.body?.propuesta, 2500); if (propuesta.length < 15) return res.status(400).json({ error: 'Cuéntame el vídeo: de qué va, el gancho y el formato.' });
    let media = c.media || []; if (media.length < 8) media = await sincronizarInstagram(300);
    media = (await marcaPruebas(media)).filter(m => !m.prueba);
    const obj = await objetivoActual(), est = estadisticas(media), top = media.map(m => ({ m, p: puntua(m, c.seguidores, obj) })).sort((a, b) => b.p - a.p);
    const ficha = (x) => ({ tipo: x.m.tipo, gancho: x.m.pie.split(/[\n.!?]/)[0].slice(0, 140), vistas: vistasDe(x.m), guardados: x.m.saved ?? null, compartidos: x.m.shares ?? null, dia: new Date(x.m.fecha).toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' }) });
    const aprend = await leerJson(RUTA_APRENDIZAJE, null);
    const r = json(await callClaude({ system: textoObjetivo(obj) + ' Eres analista de rendimiento de Instagram. Vas a ESTIMAR cuántas visualizaciones (alcance) tendría un vídeo propuesto por Víctor Palomo (Ranuse Design, diseño de gimnasios) y cómo mejorarlo. Reglas: parte SIEMPRE de sus números reales por formato (mediana y percentiles), no de cifras genéricas; ajusta hacia arriba o abajo solo con motivos concretos (gancho, tema, formato, día, parecido con sus mejores o peores) y di cuánto aporta cada factor; da un rango (bajo, medio, alto) y NUNCA una cifra exacta; si tiene pocas publicaciones de ese formato, dilo y baja la confianza. Una estimación no es una promesa: explica la incertidumbre. Devuelves SOLO JSON {"estimacion":{"bajo":0,"medio":0,"alto":0,"metrica":"visualizaciones o alcance"},"confianza":"baja|media|alta","por_que":"2-3 frases","a_favor":["factor"],"en_contra":["factor"],"mejoras":[{"cambio":"qué cambiar, concreto","efecto":"cuánto podría mover (por ejemplo +30 % de alcance) y por qué"}],"version_mejorada":{"gancho":"","estructura":"3-5 pasos cortos","cta":""},"dejar_de_hacer":["algo de la propuesta que conviene quitar"]}', messages: [{ role: 'user', content: 'SUS NÚMEROS POR FORMATO (visualizaciones/alcance):\n' + JSON.stringify(est) + '\n\nSEGUIDORES: ' + (c.seguidores ?? '?') + '\n\nSUS MEJORES PUBLICACIONES:\n' + JSON.stringify(top.slice(0, 6).map(ficha)) + '\n\nLAS PEORES:\n' + JSON.stringify(top.slice(-4).map(ficha)) + (aprend ? '\n\nLO QUE YA SE SABE QUE FUNCIONA EN SU CUENTA: ' + JSON.stringify({ funciona: aprend.lo_que_funciona, no: aprend.lo_que_no, horarios: aprend.horarios }) : '') + '\n\nVÍDEO PROPUESTO (' + (limpia(req.body?.formato, 40) || 'formato sin indicar') + (req.body?.fecha ? ', para el ' + limpia(req.body.fecha, 12) : '') + '):\n' + propuesta }], maxTokens: 2500 }));
    const out = { fecha: new Date().toISOString(), propuesta: propuesta.slice(0, 300), formato: limpia(req.body?.formato, 40), estimacion: { bajo: Math.round(Number(r.estimacion?.bajo) || 0), medio: Math.round(Number(r.estimacion?.medio) || 0), alto: Math.round(Number(r.estimacion?.alto) || 0), metrica: limpia(r.estimacion?.metrica, 30) || 'visualizaciones' }, confianza: limpia(r.confianza, 10), por_que: limpia(r.por_que, 500), a_favor: (r.a_favor || []).slice(0, 5).map(x => limpia(x, 200)), en_contra: (r.en_contra || []).slice(0, 5).map(x => limpia(x, 200)), mejoras: (r.mejoras || []).slice(0, 6).map(x => ({ cambio: limpia(x?.cambio, 240), efecto: limpia(x?.efecto, 200) })), version_mejorada: { gancho: limpia(r.version_mejorada?.gancho, 240), estructura: limpia(r.version_mejorada?.estructura, 400), cta: limpia(r.version_mejorada?.cta, 200) }, dejar_de_hacer: (r.dejar_de_hacer || []).slice(0, 4).map(x => limpia(x, 200)), base: est };
    const h = await leerJson('crm/redes/predicciones.json', { lista: [] }); h.lista = [...(h.lista || []), { fecha: out.fecha, propuesta: out.propuesta, formato: out.formato, estimacion: out.estimacion, confianza: out.confianza }].slice(-60); await guardarJson('crm/redes/predicciones.json', h);
    res.json({ ok: true, prediccion: out });
  } catch (e) { console.error('redes predecir', e.message); res.status(500).json({ error: 'No se pudo estimar: ' + String(e.message).slice(0, 200) }); }
});
router.post('/instagram/autopsia', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(404).json({ error: 'Conecta primero tu Instagram' });
    const todas = await marcaPruebas(c.media || []), media = todas.filter(x => !x.prueba || x.id === req.body?.id), m = media.find(x => x.id === req.body?.id); if (!m) return res.status(404).json({ error: 'No encuentro esa publicación' });
    const obj = await objetivoActual(), est = estadisticas(media), otros = media.filter(x => x.id !== m.id).map(x => ({ m: x, p: puntua(x, c.seguidores, obj) })).sort((a, b) => b.p - a.p);
    const ficha = (x) => ({ tipo: x.tipo, fecha: String(x.fecha).slice(0, 10), dia: new Date(x.fecha).toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', timeZone: 'Europe/Madrid' }), pie: x.pie.slice(0, 350), vistas: vistasDe(x), alcance: x.reach ?? null, me_gusta: x.me_gusta, comentarios: x.comentarios, guardados: x.saved ?? null, compartidos: x.shares ?? null, tiempo_visto: x.ig_reels_avg_watch_time ?? null });
    const r = json(await callClaude({ system: textoObjetivo(obj) + ' Eres el analista de contenido de Víctor Palomo (Ranuse Design, diseño de gimnasios). Haces la AUTOPSIA de una publicación: por qué funcionó o no comparada con SUS PROPIOS números, y qué hacer con ese tipo de contenido. Solo con los datos que ves (no tienes el vídeo ni su transcripción: si algo depende de ello, dilo). Directo, con criterio, sin rodeos. Devuelves SOLO JSON {"veredicto":"repetir|ajustar|dejar","resumen":"1-2 frases","por_que":["motivo concreto basado en los datos"],"que_haria_distinto":["cambio concreto"],"como_repetirlo":"si funcionó, cómo sacarle partido sin copiarse"}', messages: [{ role: 'user', content: 'SUS NÚMEROS POR FORMATO:\n' + JSON.stringify(est) + '\n\nPUBLICACIÓN A ANALIZAR:\n' + JSON.stringify(ficha(m)) + '\n\nSUS MEJORES:\n' + JSON.stringify(otros.slice(0, 4).map(x => ficha(x.m))) + '\n\nSUS PEORES:\n' + JSON.stringify(otros.slice(-3).map(x => ficha(x.m))) }], maxTokens: 1500 }));
    res.json({ ok: true, autopsia: { veredicto: limpia(r.veredicto, 10), resumen: limpia(r.resumen, 300), por_que: (r.por_que || []).slice(0, 5).map(x => limpia(x, 220)), que_haria_distinto: (r.que_haria_distinto || []).slice(0, 5).map(x => limpia(x, 220)), como_repetirlo: limpia(r.como_repetirlo, 300) } });
  } catch (e) { console.error('redes autopsia', e.message); res.status(500).json({ error: 'No se pudo analizar esa publicación: ' + String(e.message).slice(0, 200) }); }
});

// ── 4) Ideas ganadoras en tu nicho (cuentas profesionales públicas de Instagram)
router.post('/nicho/instagram', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(404).json({ error: 'Conecta primero tu Instagram' });
    const cuentas = [...new Set(String(req.body?.cuentas || '').split(/[\s,;]+/).map(x => x.replace(/^@/, '').trim().toLowerCase()).filter(x => /^[a-z0-9._]{2,30}$/.test(x)))].slice(0, 8);
    if (!cuentas.length) return res.status(400).json({ error: 'Escribe al menos una cuenta (por ejemplo: gymcompany_es)' });
    const datos = [], fallos = [];
    for (const u of cuentas) {
      try { const j = await graph('/' + c.ig_id, { fields: 'business_discovery.username(' + u + '){username,followers_count,media_count,media.limit(40){caption,like_count,comments_count,media_type,media_product_type,permalink,timestamp}}' }, c.token); const b = j.business_discovery; datos.push({ usuario: b.username, seguidores: b.followers_count, posts: (b.media?.data || []).map(m => ({ tipo: m.media_product_type || m.media_type, fecha: m.timestamp, gancho: limpia((m.caption || '').split(/[\n.!?]/)[0], 160), pie: limpia(m.caption, 280), me_gusta: m.like_count, comentarios: m.comments_count, enlace: m.permalink, puntuacion: Math.round((((m.like_count || 0) + (m.comments_count || 0) * 3) / Math.max(1, b.followers_count || 1)) * 10000) / 100 })) }); }
      catch (e) { fallos.push(u + ': ' + (/does not exist|not a business|cannot be found|Invalid user/i.test(e.message) ? 'no es una cuenta profesional pública o no existe' : e.message.slice(0, 100))); }
    }
    if (!datos.length) return res.status(422).json({ error: 'No he podido leer ninguna cuenta. ' + fallos.join(' · ') });
    const mejores = datos.flatMap(d => d.posts.map(p => ({ ...p, cuenta: d.usuario }))).sort((a, b) => b.puntuacion - a.puntuacion).slice(0, 20);
    await refrescaPrefs();
    const r = json(await callClaude({ system: textoPrefs() + 'Eres analista de contenido de Instagram. Te paso las publicaciones que MEJOR funcionaron (mayor interacción relativa a sus seguidores) de cuentas de un nicho (diseño y equipamiento de gimnasios, fitness). Saca patrones REALES: qué ganchos, formatos y temas funcionan, y propón ideas para Víctor Palomo (Ranuse Design, diseño de gimnasios), adaptadas a su marca y sin copiar. IMPORTANTE: NO te limites a los formatos que Víctor ya hace. Cada idea lleva "origen": "tus datos" (basada en lo que ya le funciona), "nicho" (basada en lo que funciona a otros) o "exploracion" (formato nuevo que no ha probado, para descubrir). Incluye SIEMPRE al menos 2 ideas de "exploracion". Solo datos públicos: no tienes alcance ni vídeos, solo texto y me gusta/comentarios; dilo en la fiabilidad. Devuelves SOLO JSON {"patrones":["..."],"ganchos":["fórmula de gancho con ejemplo"],"formatos":["formato que funciona y por qué"],"ideas_para_victor":[{"idea":"","formato":"","gancho":"","por_que":"inspirada en qué patrón","origen":"nicho|exploracion"}],"fiabilidad":"..."}', messages: [{ role: 'user', content: JSON.stringify(mejores) }], maxTokens: 3500 }));
    const out = { fecha: new Date().toISOString(), plataforma: 'instagram', cuentas: datos.map(d => ({ usuario: d.usuario, seguidores: d.seguidores })), fallos, top: mejores.slice(0, 10), patrones: (r.patrones || []).slice(0, 8).map(x => limpia(x, 240)), ganchos: (r.ganchos || []).slice(0, 8).map(x => limpia(x, 240)), formatos: (r.formatos || []).slice(0, 6).map(x => limpia(x, 240)), ideas: (r.ideas_para_victor || []).slice(0, 10).map(x => ({ idea: limpia(x?.idea, 240), formato: limpia(x?.formato, 30), gancho: limpia(x?.gancho, 200), por_que: limpia(x?.por_que, 200), origen: limpia(x?.origen, 20) })), fiabilidad: limpia(r.fiabilidad, 240) };
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
    const r = json(await callClaude({ system: textoPrefs() + 'Eres estratega de contenido de Instagram y YouTube. Recomiendas un PLAN DE PUBLICACIÓN realista y basado en datos para Víctor Palomo (Ranuse Design, diseño de gimnasios; persona sola que además diseña y atiende clientes). Usa SUS números por semana (volumen frente a rendimiento), sus mejores formatos, días y horas, y lo que se ve en el nicho. Sé honesto: de las tendencias de la plataforma (audios, formatos del momento) NO tienes datos oficiales; solo lo que se ve en las cuentas del nicho y en tus conocimientos generales, y lo marcas como tal. Devuelves SOLO JSON {"volumen":{"reels_semana":0,"carruseles_semana":0,"historias_dia":0,"youtube_mes":0,"por_que":"basado en sus datos"},"dias_horas":"mejores momentos","semana_tipo":[{"dia":"lunes","que":"qué publicar"}],"tendencias":[{"tendencia":"","fuente":"datos propios|nicho|conocimiento general","como_aprovecharla":""}],"riesgos":["cosas a evitar (saturar, bajar calidad…)"],"experimentos":["prueba concreta de 2 semanas para aprender más"],"faltan_datos":["qué dato no tienes y cómo conseguirlo"]}', messages: [{ role: 'user', content: 'INSTAGRAM (@' + (c?.usuario || '—') + ', ' + (c?.seguidores ?? '?') + ' seguidores): publicaciones y vistas por semana (últimas 14):\n' + JSON.stringify(porSemana) + '\n\nLO QUE YA SE SABE QUE FUNCIONA: ' + JSON.stringify(apr ? { funciona: apr.lo_que_funciona, no: apr.lo_que_no, horarios: apr.horarios } : 'sin análisis') + '\n\nYOUTUBE: ' + JSON.stringify(yt ? { suscriptores: yt.suscriptores, videos: yt.videos_total, cadencia: yt.analisis?.cadencia, formato: yt.analisis?.formato } : 'sin canal') + '\n\nNICHO (instagram): ' + JSON.stringify(nicho.instagram ? { patrones: nicho.instagram.patrones, formatos: nicho.instagram.formatos } : 'sin analizar') + '\nNICHO (youtube): ' + JSON.stringify(nicho.youtube ? { patrones: nicho.youtube.patrones, formatos: nicho.youtube.formatos } : 'sin analizar') }], maxTokens: 6500 }));
    const out = { fecha: new Date().toISOString(), por_semana: porSemana, volumen: { reels_semana: Number(r.volumen?.reels_semana) || 0, carruseles_semana: Number(r.volumen?.carruseles_semana) || 0, historias_dia: Number(r.volumen?.historias_dia) || 0, youtube_mes: Number(r.volumen?.youtube_mes) || 0, por_que: limpia(r.volumen?.por_que, 500) }, dias_horas: limpia(r.dias_horas, 300), semana_tipo: (r.semana_tipo || []).slice(0, 7).map(x => ({ dia: limpia(x?.dia, 12), que: limpia(x?.que, 200) })), tendencias: (r.tendencias || []).slice(0, 8).map(x => ({ tendencia: limpia(x?.tendencia, 200), fuente: limpia(x?.fuente, 30), como_aprovecharla: limpia(x?.como_aprovecharla, 220) })), riesgos: (r.riesgos || []).slice(0, 5).map(x => limpia(x, 200)), experimentos: (r.experimentos || []).slice(0, 4).map(x => limpia(x, 240)), faltan_datos: (r.faltan_datos || []).slice(0, 4).map(x => limpia(x, 200)) };
    await guardarJson('crm/redes/plan.json', out); res.json({ ok: true, plan: out });
  } catch (e) { console.error('redes plan', e.message); res.status(500).json({ error: 'No se pudo preparar el plan: ' + String(e.message).slice(0, 200) }); }
});
router.get('/nicho', async (req, res) => { try { res.json(await leerJson(RUTA_NICHO, { cuentas: [] })); } catch { res.status(500).json({ error: 'No se pudo leer' }); } });

export default router;
