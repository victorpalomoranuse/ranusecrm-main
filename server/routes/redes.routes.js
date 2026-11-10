import express from 'express';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { leerJson, guardarJson } from '../utils/asistente-personal.js';
import { callClaude } from '../utils/anthropic.js';

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
const json = (r) => { const txt = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join(''); return JSON.parse(/\{[\s\S]*\}/.exec(txt)[0]); };
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
    res.json({ instagram: c ? { usuario: c.usuario, nombre: c.nombre, seguidores: c.seguidores, publicaciones: c.publicaciones, foto: c.foto, conectado: c.conectado, ultima_sync: c.ultima_sync || null, n_media: (c.media || []).length, expira_dias: Math.round((c.expira - Date.now()) / 86400000) } : null, aprendizaje: a || null, youtube: !!(cfg.youtube_key || process.env.YOUTUBE_API_KEY), nicho: n.cuentas || [] });
  } catch (e) { res.status(500).json({ error: 'No se pudo leer el estado' }); }
});

router.get('/instagram/conectar', (req, res) => {
  if (!APP_SECRET()) return res.status(503).json({ error: 'Falta la clave de la app de Meta en el servidor (WA_ASIST_APP_SECRET o FB_APP_SECRET).' });
  const origen = ORIGENES.includes(req.query.origen) ? req.query.origen : ORIGENES[0];
  const url = 'https://www.facebook.com/v21.0/dialog/oauth?client_id=' + APP_ID() + '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&state=' + encodeURIComponent(creaEstado(origen)) + '&scope=' + SCOPES + '&response_type=code';
  res.json({ url, redirect_uri: REDIRECT });
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
export async function sincronizarInstagram(max = 60) {
  const c = await conexion(); if (!c) throw new Error('Instagram no está conectado');
  const j = await graph('/' + c.ig_id + '/media', { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url', limit: Math.min(max, 100) }, c.token);
  const media = [];
  for (const m of (j.data || []).slice(0, max)) { const ins = await insightsDe(m, c.token); media.push({ id: m.id, tipo: m.media_product_type || m.media_type, formato: m.media_type, enlace: m.permalink, fecha: m.timestamp, pie: limpia(m.caption, 600), me_gusta: m.like_count ?? ins.likes ?? null, comentarios: m.comments_count ?? ins.comments ?? null, miniatura: m.thumbnail_url || '', ...ins }); }
  let perfil = {}; try { perfil = await graph('/' + c.ig_id, { fields: 'followers_count,media_count,username' }, c.token); } catch { /* sin perfil */ }
  await guardarJson(RUTA_IG, { ...c, media, seguidores: perfil.followers_count ?? c.seguidores, publicaciones: perfil.media_count ?? c.publicaciones, ultima_sync: new Date().toISOString() });
  return media;
}
router.post('/instagram/sincronizar', async (req, res) => {
  try { const m = await sincronizarInstagram(Math.min(100, Number(req.body?.max) || 60)); res.json({ ok: true, publicaciones: m.length }); }
  catch (e) { res.status(e.codigo === 190 ? 401 : 500).json({ error: e.codigo === 190 ? 'La conexión con Instagram caducó: vuelve a conectarla.' : 'No se pudieron leer tus publicaciones: ' + String(e.message).slice(0, 200) }); }
});

// ── 3) Aprender de lo tuyo
const interaccion = (m) => (Number(m.me_gusta) || 0) + (Number(m.comentarios) || 0) * 3 + (Number(m.saved) || 0) * 4 + (Number(m.shares) || 0) * 5;
const puntua = (m, seg) => { const base = Number(m.reach) || Number(m.views) || seg || 1; return interaccion(m) / base; };
router.get('/instagram/publicaciones', async (req, res) => {
  try { const c = await conexion(); if (!c) return res.status(404).json({ error: 'Instagram no está conectado' }); const l = (c.media || []).map(m => ({ ...m, puntuacion: Math.round(puntua(m, c.seguidores) * 1000) / 10 })).sort((a, b) => b.puntuacion - a.puntuacion); res.json({ publicaciones: l }); }
  catch { res.status(500).json({ error: 'No se pudieron leer' }); }
});
router.post('/instagram/analizar', async (req, res) => {
  try {
    const c = await conexion(); if (!c) return res.status(404).json({ error: 'Instagram no está conectado' });
    let media = c.media || []; if (media.length < 8) { media = await sincronizarInstagram(60); }
    if (media.length < 8) return res.status(422).json({ error: 'Hay muy pocas publicaciones para sacar conclusiones fiables (' + media.length + ').' });
    const orden = media.map(m => ({ m, p: puntua(m, c.seguidores) })).sort((a, b) => b.p - a.p), n = Math.max(3, Math.round(orden.length / 4));
    const ficha = (x) => ({ tipo: x.m.tipo, fecha: String(x.m.fecha).slice(0, 16), dia_hora: new Date(x.m.fecha).toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', timeZone: 'Europe/Madrid' }), gancho: x.m.pie.split(/[\n.!?]/)[0].slice(0, 160), pie: x.m.pie.slice(0, 300), alcance: x.m.reach ?? x.m.views ?? null, me_gusta: x.m.me_gusta, comentarios: x.m.comentarios, guardados: x.m.saved ?? null, compartidos: x.m.shares ?? null, tiempo_visto: x.m.ig_reels_avg_watch_time ?? null, puntuacion: Math.round(x.p * 1000) / 10 });
    const r = json(await callClaude({ system: 'Eres analista de contenido de Instagram para una marca personal de diseño de gimnasios (Ranuse Design, Víctor Palomo). Comparas las publicaciones que MEJOR y PEOR funcionaron para sacar patrones reales y accionables: qué ganchos (primera línea), formatos, temas, longitudes de texto, llamadas a la acción, días y horas funcionan y cuáles no. No inventes: solo conclusiones que se vean en los datos; si no hay base suficiente, dilo. Devuelves SOLO JSON {"resumen":"2-3 frases","lo_que_funciona":["patrón concreto"],"lo_que_no":["patrón concreto"],"ganchos_ganadores":["ejemplo o fórmula de gancho que funcionó, con su porqué"],"ideas_ganadoras":[{"idea":"idea de contenido nueva basada en lo que funciona","formato":"reel|carrusel|foto|historia","gancho":"primera frase"}],"para_el_editor":["regla corta para editar vídeos (ritmo, gancho, duración, texto) si se deduce de los datos"],"para_historias":["regla corta para las historias si se deduce"],"horarios":"mejores días y horas si se ven","fiabilidad":"alta|media|baja y por qué (nº de publicaciones, métricas que faltan)"}', messages: [{ role: 'user', content: 'Cuenta: @' + c.usuario + ' · ' + (c.seguidores || '?') + ' seguidores · ' + media.length + ' publicaciones analizadas.\
\
LAS QUE MEJOR FUNCIONARON (puntuación = interacciones ponderadas / alcance):\
' + JSON.stringify(orden.slice(0, n).map(ficha)) + '\
\
LAS QUE PEOR:\
' + JSON.stringify(orden.slice(-n).map(ficha)) }], maxTokens: 4000 }));
    const a = { fecha: new Date().toISOString(), cuenta: c.usuario, n: media.length, resumen: limpia(r.resumen, 500), lo_que_funciona: (r.lo_que_funciona || []).slice(0, 8).map(x => limpia(x, 240)), lo_que_no: (r.lo_que_no || []).slice(0, 8).map(x => limpia(x, 240)), ganchos_ganadores: (r.ganchos_ganadores || []).slice(0, 8).map(x => limpia(x, 240)), ideas_ganadoras: (r.ideas_ganadoras || []).slice(0, 8).map(x => ({ idea: limpia(x?.idea, 240), formato: limpia(x?.formato, 20), gancho: limpia(x?.gancho, 200) })), para_el_editor: (r.para_el_editor || []).slice(0, 6).map(x => limpia(x, 220)), para_historias: (r.para_historias || []).slice(0, 6).map(x => limpia(x, 220)), horarios: limpia(r.horarios, 240), fiabilidad: limpia(r.fiabilidad, 240) };
    await guardarJson(RUTA_APRENDIZAJE, a);
    // lo aprendido llega al editor de vídeo y al asistente (historias), marcado con su origen
    try { const e = await leerJson('crm/estudio-video/editor.json', { hechos: [], charla: [] }); for (const t of a.para_el_editor) { const x = 'De tus resultados en Instagram: ' + t; if (!e.hechos.some(h => h.texto === x)) e.hechos.push({ id: crypto.randomUUID().slice(0, 6), texto: x, fecha: new Date().toISOString().slice(0, 10) }); } e.hechos = e.hechos.slice(-80); await guardarJson('crm/estudio-video/editor.json', e); } catch { /* sin editor */ }
    try { const l = await leerJson('crm/asistente/historias_lecciones.json', { lecciones: [] }); const hoy = new Date().toISOString().slice(0, 10); for (const t of a.para_historias) { const x = 'Según tus datos de Instagram: ' + t; if (!l.lecciones.some(y => y.texto === x)) l.lecciones.push({ id: crypto.randomUUID().slice(0, 6), fecha: hoy, texto: x }); } l.lecciones = l.lecciones.slice(-60); await guardarJson('crm/asistente/historias_lecciones.json', l); } catch { /* sin lecciones */ }
    res.json({ ok: true, aprendizaje: a });
  } catch (e) { console.error('redes analizar', e.message); res.status(500).json({ error: 'No se pudo analizar: ' + String(e.message).slice(0, 200) }); }
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
    const r = json(await callClaude({ system: 'Eres analista de contenido de Instagram. Te paso las publicaciones que MEJOR funcionaron (mayor interacción relativa a sus seguidores) de cuentas de un nicho (diseño y equipamiento de gimnasios, fitness). Saca patrones REALES: qué ganchos, formatos y temas funcionan, y propón ideas para Víctor Palomo (Ranuse Design, diseño de gimnasios), adaptadas a su marca y sin copiar. Solo datos públicos: no tienes alcance ni vídeos, solo texto y me gusta/comentarios; dilo en la fiabilidad. Devuelves SOLO JSON {"patrones":["..."],"ganchos":["fórmula de gancho con ejemplo"],"formatos":["formato que funciona y por qué"],"ideas_para_victor":[{"idea":"","formato":"","gancho":"","por_que":"inspirada en qué patrón"}],"fiabilidad":"..."}', messages: [{ role: 'user', content: JSON.stringify(mejores) }], maxTokens: 3500 }));
    const out = { fecha: new Date().toISOString(), plataforma: 'instagram', cuentas: datos.map(d => ({ usuario: d.usuario, seguidores: d.seguidores })), fallos, top: mejores.slice(0, 10), patrones: (r.patrones || []).slice(0, 8).map(x => limpia(x, 240)), ganchos: (r.ganchos || []).slice(0, 8).map(x => limpia(x, 240)), formatos: (r.formatos || []).slice(0, 6).map(x => limpia(x, 240)), ideas: (r.ideas_para_victor || []).slice(0, 8).map(x => ({ idea: limpia(x?.idea, 240), formato: limpia(x?.formato, 20), gancho: limpia(x?.gancho, 200), por_que: limpia(x?.por_que, 200) })), fiabilidad: limpia(r.fiabilidad, 240) };
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
    const lista = (v.items || []).map(x => { const vistas = Number(x.statistics?.viewCount) || 0, s = subs[x.snippet.channelId] || 0; return { titulo: x.snippet.title, canal: x.snippet.channelTitle, fecha: x.snippet.publishedAt.slice(0, 10), segundos: dur(x.contentDetails?.duration), vistas, me_gusta: Number(x.statistics?.likeCount) || 0, comentarios: Number(x.statistics?.commentCount) || 0, suscriptores: s, vistas_por_suscriptor: s ? Math.round(vistas / s * 100) / 100 : null, enlace: 'https://www.youtube.com/watch?v=' + x.id }; }).sort((a, b) => (b.vistas_por_suscriptor ?? 0) - (a.vistas_por_suscriptor ?? 0));
    const r = json(await callClaude({ system: 'Eres analista de contenido de YouTube. Te paso vídeos públicos de un nicho (diseño y equipamiento de gimnasios) ordenados por vistas relativas al tamaño del canal (los que más rinden por encima de su audiencia son los «ganadores»). Saca qué títulos/ganchos, formatos y temas funcionan y propón ideas para Víctor Palomo (Ranuse Design, diseño de gimnasios), adaptadas a su marca. Solo datos públicos. Devuelves SOLO JSON {"patrones":["..."],"ganchos_titulos":["fórmula con ejemplo"],"formatos":["..."],"ideas_para_victor":[{"idea":"","formato":"short|vídeo largo","gancho":"","por_que":""}],"fiabilidad":"..."}', messages: [{ role: 'user', content: 'Búsqueda: ' + consulta + '\
' + JSON.stringify(lista.slice(0, 20)) }], maxTokens: 3000 }));
    const out = { fecha: new Date().toISOString(), plataforma: 'youtube', consulta, top: lista.slice(0, 12), patrones: (r.patrones || []).slice(0, 8).map(x => limpia(x, 240)), ganchos: (r.ganchos_titulos || []).slice(0, 8).map(x => limpia(x, 240)), formatos: (r.formatos || []).slice(0, 6).map(x => limpia(x, 240)), ideas: (r.ideas_para_victor || []).slice(0, 8).map(x => ({ idea: limpia(x?.idea, 240), formato: limpia(x?.formato, 20), gancho: limpia(x?.gancho, 200), por_que: limpia(x?.por_que, 200) })), fiabilidad: limpia(r.fiabilidad, 240) };
    const prev = await leerJson(RUTA_NICHO, { cuentas: [] }); await guardarJson(RUTA_NICHO, { ...prev, youtube: out });
    res.json({ ok: true, nicho: out });
  } catch (e) { console.error('redes youtube', e.message); res.status(500).json({ error: 'No se pudo analizar YouTube: ' + String(e.message).slice(0, 200) }); }
});
router.get('/nicho', async (req, res) => { try { res.json(await leerJson(RUTA_NICHO, { cuentas: [] })); } catch { res.status(500).json({ error: 'No se pudo leer' }); } });

export default router;
