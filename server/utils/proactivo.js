import { leerJson, guardarJson, responderAsistente, RUTA_RECORD } from './asistente-personal.js';

// Avisos que el asistente manda por su cuenta: recordatorios programados y el resumen del día por la mañana.
// En WhatsApp solo se puede escribir primero dentro de las 24 h siguientes al último mensaje de Víctor (regla de Meta);
// si la ventana está cerrada, el aviso espera a que él escriba o se manda por Telegram si está configurado.
const RUTA_ESTADO = 'crm/asistente/estado.json';
const HORA_BRIEFING = parseInt(process.env.ASIST_HORA_BRIEFING || '8', 10);
const HORA_REPASO = parseInt(process.env.ASIST_HORA_REPASO || '20', 10); // repaso del día: "¿qué has hecho hoy?"
const canales = {}; // { wa: { chatId, enviar(texto), enviarArchivo(f), siempreAbierto } }
let ocupado = false, arrancado = false;

export function registraCanal(nombre, def) { canales[nombre] = def; if (!arrancado) { arrancado = true; setInterval(tick, 60 * 1000); setTimeout(tick, 20 * 1000); } }
export async function anotaEntrante(nombre) {
  try { const e = await leerJson(RUTA_ESTADO, {}); e.entrante = e.entrante || {}; e.entrante[nombre] = new Date().toISOString(); await guardarJson(RUTA_ESTADO, e); } catch { /* no es crítico */ }
}

function madrid() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = (t) => p.find(x => x.type === t).value;
  return { fecha: g('year') + '-' + g('month') + '-' + g('day'), hora: parseInt(g('hour'), 10), local: g('year') + '-' + g('month') + '-' + g('day') + 'T' + g('hour') + ':' + g('minute') };
}
function elegir(estado) {
  for (const n of ['wa', 'tg']) {
    const c = canales[n]; if (!c) continue;
    if (c.siempreAbierto) return c;
    const ult = estado.entrante?.[n]; if (ult && Date.now() - new Date(ult).getTime() < 23 * 3600 * 1000) return c;
  }
  return null;
}
async function entrega(c, out) {
  if (out.texto) await c.enviar(out.texto);
  for (const f of out.archivos || []) if (c.enviarArchivo) await c.enviarArchivo(f);
}

async function avisaVideos(estado) {
  const c = elegir(estado); if (!c) return;
  const { videosTerminados, marcaVideoAvisado } = await import('../routes/estudio-video.routes.js');
  for (const v of await videosTerminados({ soloSinAvisar: true })) {
    await c.enviar(v.estado === 'listo' ? '✅ Tu vídeo «' + v.nombre + '» ya está editado.' + (v.enlace ? '\nDescárgalo (el enlace dura 2 días): ' + v.enlace : '') : '⚠️ Ha fallado la edición de «' + v.nombre + '»' + (v.error ? ': ' + String(v.error).slice(0, 160) : '') + '. Míralo en el Estudio de vídeo.');
    await marcaVideoAvisado(v.id);
  }
}
async function tick() {
  if (ocupado) return; ocupado = true;
  try {
    const ahora = madrid(), estado = await leerJson(RUTA_ESTADO, {});
    try { await avisaVideos(estado); } catch (e) { console.log('Aviso de vídeos:', e.message); }
    // recordatorios
    const lista = await leerJson(RUTA_RECORD, []); let cambio = false;
    for (const r of lista) {
      if (r.enviado || r.cuando > ahora.local) continue;
      const c = elegir(estado);
      if (c) { try { await c.enviar('⏰ ' + r.texto); r.enviado = true; cambio = true; } catch { /* reintenta en el siguiente minuto */ } }
      else if (new Date(r.cuando + ':00').getTime() < Date.now() - 36 * 3600 * 1000) { r.enviado = 'caducado'; cambio = true; }
    }
    if (cambio) await guardarJson(RUTA_RECORD, lista);
    // resumen del día
    if (ahora.hora >= HORA_BRIEFING && ahora.hora < 13 && estado.briefing !== ahora.fecha) {
      const c = elegir(estado);
      if (c) {
        estado.briefing = ahora.fecha; await guardarJson(RUTA_ESTADO, estado); // marcamos antes para no repetir
        const out = await responderAsistente({ chatId: c.chatId, texto: '[Aviso automático de las ' + ahora.local.slice(11) + '] Escríbele tú primero a Víctor con su día: usa agenda_de_hoy y listar_tareas, dile lo atrasado y urgente, lo de hoy y los eventos con hora, y propón su plan con las 3 prioridades en orden. Saludo breve y mensaje corto. Si Víctor tiene perfil de salud guardado (salud_hoy), añade al final, en 2-3 líneas, lo que le toca hoy de entreno y de comida (si el sistema recomienda descanso, díselo).' });
        await entrega(c, out);
      }
    }
    // repaso por la noche: ¿qué has hecho hoy?
    if (ahora.hora >= HORA_REPASO && ahora.hora < 23 && estado.repaso !== ahora.fecha) {
      const c = elegir(estado);
      if (c) {
        estado.repaso = ahora.fecha; await guardarJson(RUTA_ESTADO, estado);
        const out = await responderAsistente({ chatId: c.chatId, texto: '[Aviso automático de las ' + ahora.local.slice(11) + '] Escríbele tú primero a Víctor para el repaso del día: pregúntale qué ha hecho hoy (una sola pregunta, corta y cercana). Si lo tenía previsto, menciona en una línea lo que había para hoy (listar_tareas) para refrescarle la memoria. Dile que te lo cuente como quiera, por audio o texto, y tú lo apuntas. Si tiene perfil de salud (salud_hoy), pregúntale también en la misma frase si ha entrenado y qué ha comido, para apuntarlo (salud_registrar).' });
        await entrega(c, out);
      }
    }
  } catch (e) { console.error('Asistente proactivo:', e.message); }
  finally { ocupado = false; }
}
