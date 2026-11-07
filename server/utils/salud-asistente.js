// El almacén (leer/guardar JSON del bucket privado) lo inyecta asistente-personal.js para no tener imports circulares.
let leer = async () => { throw new Error('almacén de salud no iniciado'); }, guardar = async () => { throw new Error('almacén de salud no iniciado'); };
export function ponAlmacen(l, g) { leer = l; guardar = g; }
import { GUIA, TEMAS, RACIONES, nivelRaciones, objetivoCalorico } from './salud-conocimiento.js';

// Asistente de salud de Víctor: nutrición, entrenamiento y hábitos. Perfil, plan a largo plazo, registro diario (entrenos con sus marcas) y ajuste
// del día según lo que haya hecho de verdad. Todo se guarda en el bucket privado del asistente y se ve en el CRM (Asistente personal › Salud).
export const RUTA_PERFIL = 'crm/asistente/salud/perfil.json';
export const RUTA_PLAN = 'crm/asistente/salud/plan.json';
export const RUTA_REGISTRO = 'crm/asistente/salud/registro.json';
export const RUTA_MARCAS = 'crm/asistente/salud/marcas.json';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const fechaMadrid = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const aDate = (f) => new Date(f + 'T12:00:00Z');
const sumaDias = (f, n) => fechaMadrid(new Date(aDate(f).getTime() + n * 86400000));
const diaSemana = (f) => aDate(f).getUTCDay(); // 0 domingo
const normN = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const epley = (kg, reps) => kg * (1 + reps / 30);
const lunesDe = (f) => { const d = diaSemana(f); return sumaDias(f, -((d + 6) % 7)); }; // lunes de esa semana

export const SALUD_NOMBRES = new Set(['salud_perfil', 'salud_guia', 'salud_plan', 'salud_registrar', 'salud_hoy', 'salud_historial']);

export const TOOLS_SALUD = [
  { name: 'salud_perfil', description: 'Perfil de salud de Víctor (objetivo, sexo, edad, altura, peso, nivel, días de entreno, material, lesiones, dieta, horarios…). accion "ver" devuelve el perfil con los cálculos (calorías, macros y nivel de raciones de las guías). accion "guardar" actualiza SOLO los campos que le pases (no borra el resto). Úsala en cuanto Víctor te diga datos suyos (peso nuevo, objetivo, lesión, material) y antes de hacer un plan si faltan datos.', input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['ver', 'guardar'] }, campos: { type: 'object', description: 'objetivo (ganar músculo | perder grasa | recomposición | rendimiento | salud), sexo (hombre|mujer), edad, altura_cm, peso_kg, nivel (principiante|intermedio|avanzado), dias_entreno_semana, dias_preferidos (lista de días), minutos_sesion, material (gimnasio|casa|mixto + detalle), lesiones, condiciones_medicas, dieta (omnívora|vegetariana|vegana), alergias, no_le_gusta, actividad (baja|media|alta), horarios, fecha_objetivo, notas' } }, required: ['accion'] } },
  { name: 'salud_guia', description: 'Consulta las guías de nutrición, entrenamiento y hábitos (las de Víctor). tema: ' + TEMAS.join(', ') + ', raciones (tabla de gramos por nivel).', input_schema: { type: 'object', properties: { tema: { type: 'string' } }, required: ['tema'] } },
  { name: 'salud_plan', description: 'Plan a LARGO PLAZO de Víctor. accion "ver" lo devuelve. accion "guardar" guarda el plan que tú diseñas (estructura: objetivo, semanas_total, fecha_inicio AAAA-MM-DD, dias_por_semana, fases [{nombre, semanas, foco, calorias_ajuste}], sesiones [{nombre, foco, ejercicios:[{nombre, series, reps, rir, notas}]}] en el orden en que se hacen (rotan, NO van atados a un día de la semana), progresion (texto: cómo sube las cargas), descarga_cada_semanas, notas, revision_cada_semanas). Diséñalo solo cuando conozcas su perfil.', input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['ver', 'guardar'] }, plan: { type: 'object' } }, required: ['accion'] } },
  { name: 'salud_registrar', description: 'Apunta lo que Víctor ha hecho: un ENTRENO con sus marcas (ejercicios con series kg×reps), su peso, lo que ha comido, pasos, sueño, energía o una nota del día. Úsala siempre que te cuente algo de su día de salud (ayer, hoy, otro día con "fecha"). Detecta marcas personales nuevas y te las devuelve para felicitarle. Puede mandar varias cosas a la vez.', input_schema: { type: 'object', properties: { fecha: { type: 'string', description: 'AAAA-MM-DD; por defecto hoy' }, entreno: { type: 'object', description: '{ nombre: nombre de la sesión (p. ej. "Torso A", "Pierna"), minutos, sensaciones, ejercicios: [{ nombre, series: [{ kg, reps, rir }] }] }. Si solo dice "hice pierna" sin cargas, manda nombre y ejercicios vacíos.' }, peso_kg: { type: 'number' }, comidas: { type: 'string', description: 'Lo que ha comido, en texto libre' }, pasos: { type: 'number' }, sueno_horas: { type: 'number' }, energia: { type: 'number', description: '1 a 5' }, notas: { type: 'string' } } } },
  { name: 'salud_hoy', description: 'El plan de HOY de Víctor, adaptado a lo que de verdad ha hecho. Devuelve: perfil y objetivos, en qué semana/fase del plan va, qué sesiones lleva esta semana frente a las previstas, qué hizo ayer, cuál le toca hoy (las sesiones ROTAN: si fue un día de más o de menos, se recoloca), la última vez que hizo cada ejercicio (para proponer cargas) y la guía nutricional del día. Con eso tú redactas la rutina y la dieta de hoy. Úsala cuando pregunte "qué toca hoy", "qué ceno", "rutina de hoy" o en el aviso de la mañana.', input_schema: { type: 'object', properties: { fecha: { type: 'string' } } } },
  { name: 'salud_historial', description: 'Evolución de Víctor: peso, entrenos y progresión de un ejercicio (marcas). dias por defecto 30. Con "ejercicio" devuelve cada vez que lo hizo y su mejor marca.', input_schema: { type: 'object', properties: { dias: { type: 'number' }, ejercicio: { type: 'string' } } } },
];

function calculosDe(perfil) {
  if (!perfil || !perfil.peso_kg) return {};
  const base = { sexo: perfil.sexo, altura_cm: num(perfil.altura_cm), peso_kg: num(perfil.peso_kg), actividad: perfil.actividad, dias_fuerza: num(perfil.dias_entreno_semana) };
  return { raciones: nivelRaciones(base), energia: objetivoCalorico({ ...perfil, peso_kg: base.peso_kg, altura_cm: base.altura_cm, edad: num(perfil.edad) }) };
}

// sesión que toca: las sesiones del plan ROTAN según la última que hizo; así un día de más o de menos no descuadra nada
function siguienteSesion(plan, registro, hasta) {
  const ses = plan?.sesiones || []; if (!ses.length) return { idx: -1 };
  const dias = Object.keys(registro.dias || {}).filter(d => d <= hasta).sort().reverse();
  for (const d of dias) { const en = (registro.dias[d].entrenos || []); if (!en.length) continue; const nom = normN(en[en.length - 1].nombre); const i = ses.findIndex(s => normN(s.nombre) === nom || (nom && (normN(s.nombre).includes(nom) || nom.includes(normN(s.nombre))))); return { idx: i >= 0 ? (i + 1) % ses.length : 0, ultima: en[en.length - 1].nombre, fecha_ultima: d }; }
  return { idx: 0, ultima: null };
}

function ultimaVez(registro, nombre, antesDe) {
  const n = normN(nombre); const dias = Object.keys(registro.dias || {}).filter(d => d < antesDe).sort().reverse();
  for (const d of dias) for (const en of (registro.dias[d].entrenos || [])) { const ej = (en.ejercicios || []).find(e => normN(e.nombre) === n); if (ej && (ej.series || []).length) return { fecha: d, series: ej.series.map(s => (s.kg ?? '?') + '×' + (s.reps ?? '?') + (s.rir != null ? ' (RIR ' + s.rir + ')' : '')).join(', ') }; }
  return null;
}

export async function ejecutarSalud(nombre, input = {}) {
  const hoy = fechaMadrid();
  if (nombre === 'salud_guia') {
    const t = normN(input.tema).replace(/ /g, '_');
    if (t === 'raciones') return { tablas_por_nivel: RACIONES, como_se_calcula: 'Nivel 1-5 por puntos: altura (1-3), peso (1-3), actividad diaria (1-3), días de fuerza (1-3). 4-5 pts = nivel 1, 6-7 = 2, 8-9 = 3, 10-11 = 4, 12 = 5. Si el alimento no está en el menú, se ignora.' };
    const k = TEMAS.find(x => x === t) || TEMAS.find(x => x.includes(t) || t.includes(x));
    if (!k) return { error: 'Temas disponibles: ' + TEMAS.join(', ') + ', raciones' };
    return { tema: k, texto: GUIA[k] };
  }
  if (nombre === 'salud_perfil') {
    const p = await leer(RUTA_PERFIL, {});
    if (input.accion === 'guardar') {
      const c = input.campos && typeof input.campos === 'object' ? input.campos : {}; const nuevo = { ...p };
      for (const [k, v] of Object.entries(c)) { if (v === null || v === undefined || v === '') continue; nuevo[k] = typeof v === 'string' ? v.slice(0, 400) : v; }
      if (num(c.peso_kg)) { nuevo.peso_kg = num(c.peso_kg); const r = await leer(RUTA_REGISTRO, { dias: {} }); r.dias[hoy] = { ...(r.dias[hoy] || {}), peso_kg: nuevo.peso_kg }; await guardar(RUTA_REGISTRO, r); }
      nuevo.actualizado = hoy; await guardar(RUTA_PERFIL, nuevo);
      const faltan = ['objetivo', 'sexo', 'edad', 'altura_cm', 'peso_kg', 'nivel', 'dias_entreno_semana', 'material'].filter(k => !nuevo[k]);
      return { ok: true, perfil: nuevo, calculos: calculosDe(nuevo), datos_que_faltan: faltan };
    }
    const faltan = ['objetivo', 'sexo', 'edad', 'altura_cm', 'peso_kg', 'nivel', 'dias_entreno_semana', 'material'].filter(k => !p[k]);
    return { perfil: p, calculos: calculosDe(p), datos_que_faltan: faltan };
  }
  if (nombre === 'salud_plan') {
    if (input.accion === 'guardar') {
      const pl = input.plan && typeof input.plan === 'object' ? input.plan : null; if (!pl || !Array.isArray(pl.sesiones) || !pl.sesiones.length) return { error: 'El plan necesita al menos una sesión (sesiones: [{ nombre, ejercicios }]).' };
      const antes = await leer(RUTA_PLAN, {}); const guardado = { ...pl, fecha_inicio: /^\d{4}-\d{2}-\d{2}$/.test(pl.fecha_inicio || '') ? pl.fecha_inicio : hoy, creado: antes.creado || hoy, actualizado: hoy, version: (antes.version || 0) + 1 };
      if (JSON.stringify(guardado).length > 40000) return { error: 'El plan es demasiado largo; resúmelo.' };
      await guardar(RUTA_PLAN, guardado); return { ok: true, guardado: true, version: guardado.version };
    }
    const pl = await leer(RUTA_PLAN, {}); return Object.keys(pl).length ? { plan: pl } : { plan: null, aviso: 'Todavía no hay plan. Primero completa el perfil y diséñalo con salud_plan accion guardar.' };
  }
  if (nombre === 'salud_registrar') {
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(input.fecha || '') ? input.fecha : hoy; if (fecha > hoy) return { error: 'No se puede apuntar en una fecha futura.' };
    const r = await leer(RUTA_REGISTRO, { dias: {} }); const dia = r.dias[fecha] = r.dias[fecha] || {}; const hecho = [];
    const marcasNuevas = [];
    if (input.entreno && typeof input.entreno === 'object') {
      const e = input.entreno; const ejercicios = (Array.isArray(e.ejercicios) ? e.ejercicios : []).slice(0, 30).map(x => ({ nombre: String(x.nombre || '').slice(0, 60), series: (Array.isArray(x.series) ? x.series : []).slice(0, 15).map(s => ({ kg: num(s.kg), reps: num(s.reps), rir: num(s.rir) })).filter(s => s.reps || s.kg) })).filter(x => x.nombre);
      (dia.entrenos = dia.entrenos || []).push({ nombre: String(e.nombre || 'Entreno').slice(0, 60), minutos: num(e.minutos), sensaciones: String(e.sensaciones || '').slice(0, 300), ejercicios }); hecho.push('entreno');
      const m = await leer(RUTA_MARCAS, {});
      for (const ej of ejercicios) for (const s of ej.series) {
        if (!s.kg || !s.reps || s.reps > 30) continue; const k = normN(ej.nombre); const rm = Math.round(epley(s.kg, s.reps) * 10) / 10; const act = m[k] || { nombre: ej.nombre };
        const mejorRM = act.mejor_1rm?.valor || 0, mejorKg = act.mejor_peso?.kg || 0;
        if (rm > mejorRM + 0.4) { if (mejorRM) marcasNuevas.push({ ejercicio: ej.nombre, tipo: '1RM estimado', antes: mejorRM, ahora: rm, serie: s.kg + '×' + s.reps }); act.mejor_1rm = { valor: rm, kg: s.kg, reps: s.reps, fecha }; }
        if (s.kg > mejorKg || (s.kg === mejorKg && s.reps > (act.mejor_peso?.reps || 0))) { if (mejorKg && s.kg > mejorKg && !marcasNuevas.find(x => x.ejercicio === ej.nombre)) marcasNuevas.push({ ejercicio: ej.nombre, tipo: 'peso máximo', antes: mejorKg, ahora: s.kg, serie: s.kg + '×' + s.reps }); act.mejor_peso = { kg: s.kg, reps: s.reps, fecha }; }
        m[k] = act;
      }
      await guardar(RUTA_MARCAS, m);
    }
    if (num(input.peso_kg)) { dia.peso_kg = num(input.peso_kg); hecho.push('peso'); const p = await leer(RUTA_PERFIL, {}); if (fecha === hoy) { p.peso_kg = dia.peso_kg; await guardar(RUTA_PERFIL, p); } }
    if (input.comidas) { dia.comidas = ((dia.comidas ? dia.comidas + ' | ' : '') + String(input.comidas)).slice(0, 1500); hecho.push('comidas'); }
    if (num(input.pasos)) { dia.pasos = num(input.pasos); hecho.push('pasos'); }
    if (num(input.sueno_horas)) { dia.sueno_horas = num(input.sueno_horas); hecho.push('sueño'); }
    if (num(input.energia)) { dia.energia = Math.max(1, Math.min(5, num(input.energia))); hecho.push('energía'); }
    if (input.notas) { dia.notas = ((dia.notas ? dia.notas + ' | ' : '') + String(input.notas)).slice(0, 800); hecho.push('nota'); }
    if (!hecho.length) return { error: 'No me has dado nada que apuntar.' };
    await guardar(RUTA_REGISTRO, r);
    return { ok: true, fecha, apuntado: hecho, marcas_nuevas: marcasNuevas };
  }
  if (nombre === 'salud_historial') {
    const dias = Math.max(1, Math.min(365, num(input.dias) || 30)); const r = await leer(RUTA_REGISTRO, { dias: {} }); const desde = sumaDias(hoy, -dias);
    const lista = Object.keys(r.dias).filter(d => d >= desde).sort();
    if (input.ejercicio) {
      const n = normN(input.ejercicio); const veces = [];
      for (const d of lista) for (const en of (r.dias[d].entrenos || [])) { const ej = (en.ejercicios || []).find(e => normN(e.nombre).includes(n) || n.includes(normN(e.nombre))); if (ej) veces.push({ fecha: d, series: ej.series.map(s => s.kg + '×' + s.reps).join(', ') }); }
      const m = await leer(RUTA_MARCAS, {}); const k = Object.keys(m).find(x => x.includes(n) || n.includes(x));
      return { ejercicio: input.ejercicio, veces, mejor_marca: k ? m[k] : null };
    }
    const pesos = lista.filter(d => r.dias[d].peso_kg).map(d => ({ fecha: d, kg: r.dias[d].peso_kg }));
    return { dias_analizados: dias, entrenos: lista.filter(d => (r.dias[d].entrenos || []).length).map(d => ({ fecha: d, sesiones: r.dias[d].entrenos.map(e => e.nombre) })), pesos, marcas: await leer(RUTA_MARCAS, {}) };
  }
  if (nombre === 'salud_hoy') {
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(input.fecha || '') ? input.fecha : hoy;
    const [perfil, plan, registro] = await Promise.all([leer(RUTA_PERFIL, {}), leer(RUTA_PLAN, {}), leer(RUTA_REGISTRO, { dias: {} })]);
    const calc = calculosDe(perfil); const faltan = ['objetivo', 'sexo', 'edad', 'altura_cm', 'peso_kg', 'nivel', 'dias_entreno_semana', 'material'].filter(k => !perfil[k]);
    const ayer = sumaDias(fecha, -1), lunes = lunesDe(fecha), finSemana = sumaDias(lunes, 6);
    const hechosSemana = Object.keys(registro.dias).filter(d => d >= lunes && d < fecha && (registro.dias[d].entrenos || []).length);
    const hoyYaHecho = (registro.dias[fecha]?.entrenos || []).length > 0;
    const previstas = num(plan.dias_por_semana) || num(perfil.dias_entreno_semana) || 3;
    const diasQuedan = Math.round((aDate(finSemana) - aDate(fecha)) / 86400000) + 1; // incluido hoy
    const pendientes = Math.max(0, previstas - hechosSemana.length - (hoyYaHecho ? 1 : 0));
    // días seguidos entrenando hasta ayer
    let seguidos = 0; for (let i = 1; i <= 7; i++) { if ((registro.dias[sumaDias(fecha, -i)]?.entrenos || []).length) seguidos++; else break; }
    const sig = siguienteSesion(plan, registro, hoyYaHecho ? ayer : fecha);
    let consejo, motivo;
    if (!Object.keys(plan).length) { consejo = 'sin_plan'; motivo = 'No hay plan guardado: diseña el plan (salud_plan guardar) antes de dar rutinas largas; mientras, propón una sesión sencilla según su perfil.'; }
    else if (hoyYaHecho) { consejo = 'ya_entrenó_hoy'; motivo = 'Ya ha apuntado un entreno hoy: toca recuperar, comida y descanso.'; }
    else if (seguidos >= 3) { consejo = 'descanso'; motivo = 'Lleva ' + seguidos + ' días seguidos entrenando: descanso o movilidad suave hoy.'; }
    else if (pendientes <= 0) { consejo = 'semana_completa'; motivo = 'Esta semana ya ha hecho las ' + previstas + ' sesiones previstas (lleva ' + hechosSemana.length + '). Hoy descanso activo (paseo, movilidad); si se encuentra bien, una sesión opcional ligera.'; }
    else if (pendientes > diasQuedan) { consejo = 'atrasado'; motivo = 'Le faltan ' + pendientes + ' sesiones y solo quedan ' + diasQuedan + ' días de semana: hoy entrena la sesión que toca y compacta (quita accesorios) si hace falta.'; }
    else { consejo = (ayer && (registro.dias[ayer]?.entrenos || []).length) ? 'entrenar_tras_entreno' : 'entrenar'; motivo = 'Lleva ' + hechosSemana.length + ' de ' + previstas + ' sesiones esta semana; le quedan ' + pendientes + ' y ' + diasQuedan + ' días.' + ((registro.dias[ayer]?.entrenos || []).length ? ' Ayer también entrenó: evita repetir el mismo grupo muscular.' : ''); }
    const sesion = plan.sesiones?.[sig.idx] || null;
    const cargas = sesion ? (sesion.ejercicios || []).map(e => ({ ejercicio: e.nombre, plan: (e.series || '') + '×' + (e.reps || '') + (e.rir != null ? ' RIR ' + e.rir : ''), ultima_vez: ultimaVez(registro, e.nombre, fecha) })) : [];
    // semana del plan y fase
    let semanaPlan = null, fase = null; if (plan.fecha_inicio) { semanaPlan = Math.max(1, Math.floor((aDate(fecha) - aDate(plan.fecha_inicio)) / (7 * 86400000)) + 1); let acum = 0; for (const f of (plan.fases || [])) { acum += num(f.semanas) || 0; if (semanaPlan <= acum) { fase = f; break; } } }
    const pesos = Object.keys(registro.dias).filter(d => registro.dias[d].peso_kg).sort().slice(-8).map(d => ({ fecha: d, kg: registro.dias[d].peso_kg }));
    const ultimos = Object.keys(registro.dias).filter(d => d < fecha && d >= sumaDias(fecha, -7)).sort().map(d => ({ fecha: d, entrenos: (registro.dias[d].entrenos || []).map(e => e.nombre), comidas: registro.dias[d].comidas || null, sueno_horas: registro.dias[d].sueno_horas || null, energia: registro.dias[d].energia || null, pasos: registro.dias[d].pasos || null }));
    const obj = String(perfil.objetivo || '').toLowerCase(); const plato = /grasa|perder|definic/.test(obj) ? GUIA.plato.split('\n')[2] : GUIA.plato.split('\n')[1];
    return {
      fecha, dia_semana: DIAS[diaSemana(fecha)], perfil, datos_que_faltan: faltan, calculos: calc,
      plan_resumen: Object.keys(plan).length ? { objetivo: plan.objetivo, semana_actual: semanaPlan, de_semanas: plan.semanas_total || null, fase, progresion: plan.progresion || null, descarga_cada_semanas: plan.descarga_cada_semanas || null, sesiones_rotan: (plan.sesiones || []).map(s => s.nombre), revision_cada_semanas: plan.revision_cada_semanas || null } : null,
      esta_semana: { previstas, hechas: hechosSemana.length, hoy_ya_entrenado: hoyYaHecho, dias_que_quedan_incluido_hoy: diasQuedan, sesiones_hechas_dias: hechosSemana },
      ayer: registro.dias[ayer] || null,
      recomendacion_del_sistema: { consejo, motivo, sesion_que_toca: sesion ? { nombre: sesion.nombre, foco: sesion.foco, ejercicios: cargas } : null, ultima_sesion_hecha: sig.ultima || null },
      peso_ultimos: pesos, ultimos_7_dias: ultimos,
      nutricion_del_dia: { objetivo_kcal_y_macros: calc.energia || null, metodo_del_plato: plato, raciones_de_tu_nivel: calc.raciones || null, menu_de_referencia_de_hoy: (GUIA.menu_semanal.split('\n').find(l => l.startsWith(DIAS[diaSemana(fecha)].toUpperCase().replace('É', 'É'))) || null), frecuencia_semanal: GUIA.frecuencia },
      recordatorio: 'Redacta TÚ la rutina y la dieta de hoy usando esto. Respeta lesiones/preferencias del perfil. Si falta información importante, pregunta lo mínimo (una cosa).',
    };
  }
  return { error: 'Herramienta de salud desconocida' };
}

// Bloque que se añade al prompt del asistente (breve; el detalle viene de las herramientas)
export async function bloqueSaludSistema() {
  let p = {}; try { p = await leer(RUTA_PERFIL, {}); } catch { /* sin perfil */ }
  const resumen = Object.keys(p).length ? 'Perfil guardado: ' + ['objetivo', 'sexo', 'edad', 'altura_cm', 'peso_kg', 'nivel', 'dias_entreno_semana', 'material', 'lesiones', 'dieta'].filter(k => p[k]).map(k => k + ': ' + p[k]).join(', ') + '.' : 'Todavía NO hay perfil de salud guardado: si Víctor habla de entrenar o comer, empieza preguntándole lo mínimo (objetivo, peso y altura, días que puede entrenar, material, lesiones) y guárdalo con salud_perfil.';
  return '\n\nSALUD, ENTRENAMIENTO Y HÁBITOS (además de lo anterior, eres su entrenador y nutricionista de confianza):\n' +
    '- Eres un EXPERTO en nutrición deportiva, entrenamiento de fuerza y hábitos. Te basas en las guías de Víctor (herramienta salud_guia: ganar músculo, perder grasa, recomposición, método del plato, compra, suplementos, mitos, hábitos 12 semanas, menú semanal, raciones por nivel) y en principios de entrenamiento basados en la evidencia. No inventes cifras: calorías, macros y raciones salen de salud_perfil/salud_hoy.\n' +
    '- PLAN A LARGO PLAZO: tiene un objetivo y una fecha; diseña el plan por fases (salud_plan guardar) con sesiones que ROTAN (no atadas al día de la semana), progresión de cargas, semana de descarga y revisión periódica. Cada decisión de hoy debe encajar en ese plan.\n' +
    '- REGISTRO: cuando Víctor te cuente un entreno (ejercicios, pesos, repeticiones, "marcas"), comidas, peso, sueño o cómo se siente, apúntalo SIEMPRE con salud_registrar (también si es de ayer: usa la fecha). Si hay marcas nuevas, felicítale en una frase. Si solo dice "ayer hice pierna", apunta la sesión y pregunta si quiere dar los pesos.\n' +
    '- ADAPTACIÓN DIARIA: para "qué toca hoy / qué como / rutina de hoy" usa salud_hoy. Tiene en cuenta lo que ha hecho de verdad: si ha entrenado un día de más o de menos, recoloca ("vale, pues hoy toca esto") sin descuadrar el plan; propón cargas a partir de la última vez que hizo cada ejercicio.\n' +
    '- FORMATO: mensaje corto y escaneable en WhatsApp (sin tablas): rutina de hoy en líneas (ejercicio, series×reps, carga sugerida) y comida del día con raciones en gramos; si pide más detalle, dáselo o ofrécele el PDF (crear_pdf). Esta parte puede ser más larga que 4 líneas porque es una rutina o una dieta, pero sin relleno.\n' +
    '- SEGURIDAD: no eres médico. No des diagnósticos ni dietas extremas (nunca por debajo del mínimo calórico de salud_hoy). Si hay dolor agudo, lesión, embarazo, medicación, trastorno alimentario o enfermedad, adapta con prudencia y recomienda consultar con un profesional sanitario. Si algo de su perfil falta y es importante para la seguridad, pregúntalo antes.\n' +
    '- ' + resumen;
}
