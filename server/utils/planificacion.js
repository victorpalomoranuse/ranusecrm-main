import { supabase } from '../config/supabase.js';

// Planificación de proyectos: catálogo de entregables (con horas medias) y reparto de fechas.
// Todo se guarda en un solo JSON del almacenamiento (crm/planificacion.json), así no hace falta tocar la base de datos.

const BUCKET = 'project-documents';
const RUTA = 'crm/planificacion.json';

export const CATALOGO_BASE = [
  { id: 'medicion', nombre: 'Medición y toma de datos', horas: 2 },
  { id: 'estado-actual', nombre: 'Plano del estado actual', horas: 3 },
  { id: 'distribucion', nombre: 'Propuesta de distribución (2D)', horas: 4 },
  { id: 'iluminacion', nombre: 'Plano de iluminación', horas: 2 },
  { id: 'modelo3d', nombre: 'Modelado 3D', horas: 5 },
  { id: 'moodboard', nombre: 'Moodboard y materiales', horas: 2 },
  { id: 'renders', nombre: 'Renders', horas: 4 },
  { id: 'presupuesto', nombre: 'Presupuesto', horas: 3 },
  { id: 'memoria', nombre: 'Memoria y carpinterías', horas: 3 },
  { id: 'revision', nombre: 'Revisión con el cliente y ajustes', horas: 2 },
  { id: 'entrega', nombre: 'Entrega final al cliente', horas: 1 },
];

export async function leerPlanificacion() {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(RUTA);
    if (error || !data) return { catalogo: CATALOGO_BASE, proyectos: {}, avatares: {} };
    const j = JSON.parse(await data.text());
    return { catalogo: Array.isArray(j.catalogo) && j.catalogo.length ? j.catalogo : CATALOGO_BASE, proyectos: j.proyectos && typeof j.proyectos === 'object' ? j.proyectos : {}, avatares: j.avatares && typeof j.avatares === 'object' ? j.avatares : {} };
  } catch { return { catalogo: CATALOGO_BASE, proyectos: {}, avatares: {} }; }
}
export const guardarPlanificacion = (p) => supabase.storage.from(BUCKET).upload(RUTA, Buffer.from(JSON.stringify(p)), { contentType: 'application/json', upsert: true, cacheControl: '0' });

// ── fechas (siempre YYYY-MM-DD, a mediodía para no tropezar con el cambio de hora) ──
const aFecha = iso => new Date(iso + 'T12:00:00');
const aISO = d => d.toLocaleDateString('sv');
const sumar = (iso, n) => { const d = aFecha(iso); d.setDate(d.getDate() + n); return aISO(d); };
export const laborable = iso => { const d = aFecha(iso).getDay(); return d !== 0 && d !== 6; };
export const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const siguienteLaborable = iso => { let f = iso; while (!laborable(f)) f = sumar(f, 1); return f; };
const anteriorLaborable = iso => { let f = iso; while (!laborable(f)) f = sumar(f, -1); return f; };
// resta n días laborables (lunes a viernes)
export function restarLaborables(iso, n) {
  let f = anteriorLaborable(iso), k = n;
  while (k > 0) { f = sumar(f, -1); if (laborable(f)) k--; }
  return f;
}
export function diasLaborables(desde, hasta) {
  const out = []; let f = siguienteLaborable(desde), guard = 0;
  while (f <= hasta && guard++ < 800) { out.push(f); f = siguienteLaborable(sumar(f, 1)); }
  return out;
}

// Reparte los entregables entre hoy y la fecha INTERNA de entrega (unos días antes de la del cliente), a un ritmo parejo:
// así el trabajo no se amontona en el último día. Si no cabe a la capacidad diaria, lo dice y lo marca.
export function repartir({ items, inicio, entrega, margenDias = 2, horasDia = 5 }) {
  const lista = (items || []).map(i => ({ id: i.id, nombre: i.nombre, horas: Math.max(0.5, Number(i.horas) || 1) }));
  const hd = Math.min(12, Math.max(1, Number(horasDia) || 5)), md = Math.min(15, Math.max(0, Math.round(Number(margenDias) || 0)));
  const interna = restarLaborables(entrega, md);
  const dias = diasLaborables(inicio, interna);
  const total = lista.reduce((s, i) => s + i.horas, 0);
  const capacidad = dias.length * hd;
  const cabe = dias.length > 0 && total <= capacidad + 1e-9;
  const ritmo = dias.length ? (cabe ? Math.max(Math.min(hd, total / dias.length), 0.5) : hd) : hd;
  let acum = 0;
  const out = lista.map(i => {
    const ini = acum; acum += i.horas;
    if (!dias.length) return { ...i, inicio: interna, fecha: interna, fuera: true };
    const dIni = Math.min(dias.length - 1, Math.floor(ini / ritmo + 1e-9)), dFin = Math.min(dias.length - 1, Math.max(0, Math.ceil(acum / ritmo - 1e-9) - 1));
    return { ...i, inicio: dias[dIni], fecha: dias[Math.max(dIni, dFin)], fuera: !cabe && acum > capacidad + 1e-9 };
  });
  return { interna, entrega, margenDias: md, horasDia: hd, diasDisponibles: dias.length, totalHoras: total, ritmo: Math.round(ritmo * 10) / 10, cabe, faltanHoras: cabe ? 0 : Math.round((total - capacidad) * 10) / 10, items: out };
}
