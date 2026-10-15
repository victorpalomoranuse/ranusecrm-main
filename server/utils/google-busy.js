// Disponibilidad desde Google Calendar sin OAuth: cada persona pega la «dirección
// secreta en formato iCal» de su calendario y de ahí leemos cuándo está ocupada.
// Solo lectura. Los huecos del CRM que caigan en un evento de Google se marcan
// como ocupados para que nadie los reserve encima.
import ical from 'node-ical';
import rrulePkg from 'rrule';
const { RRule } = rrulePkg;
import { madridToUtcDate } from './timezone.js';

const CACHE = new Map(); // url -> { t, eventos }
const TTL_MS = 5 * 60 * 1000;

export function urlGoogleValida(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'calendar.google.com' && /\/calendar\/ical\//.test(u.pathname) && u.pathname.endsWith('.ics');
  } catch { return false; }
}

async function eventosDe(url) {
  const c = CACHE.get(url);
  if (c && Date.now() - c.t < TTL_MS) return c.eventos;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Google respondió ' + r.status);
  const data = ical.sync.parseICS(await r.text());
  const eventos = Object.values(data).filter(e => e && e.type === 'VEVENT' && e.start && e.status !== 'CANCELLED' && e.transparency !== 'TRANSPARENT');
  CACHE.set(url, { t: Date.now(), eventos });
  return eventos;
}

// Hora «de pared» (guardada como UTC flotante, así devuelve rrule las repeticiones) -> instante real en la zona tz
function paredAUtc(flot, tz) {
  const zona = tz || 'Europe/Madrid';
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const off = (t) => { const p = Object.fromEntries(dtf.formatToParts(new Date(t)).map(x => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t; };
  let t = flot - off(flot);
  t = flot - off(t);
  return t;
}

// Instante real -> hora de pared en la zona tz, como UTC flotante (lo contrario de paredAUtc)
function aPared(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

// Repeticiones de un evento con RRULE calculadas en hora de pared (sin depender de la zona del servidor): instantes reales
function repeticiones(e, desde, hasta, dur) {
  const tz = e.start && e.start.tz && !/^(UTC|Z)$/i.test(e.start.tz) ? e.start.tz : 'UTC';
  const o = { ...e.rrule.origOptions, dtstart: new Date(aPared(new Date(e.start).getTime(), tz)) };
  delete o.tzid;
  if (o.until) o.until = new Date(aPared(new Date(o.until).getTime(), tz));
  const regla = new RRule(o);
  const flot = regla.between(new Date(aPared(desde.getTime() - dur, tz) - 86400000), new Date(aPared(hasta.getTime(), tz) + 86400000), true);
  return flot.map(d => paredAUtc(d.getTime(), tz));
}

// Intervalos ocupados [ini, fin] (ms UTC) entre desde y hasta (Date)
export async function ocupadoGoogle(url, desde, hasta) {
  const eventos = await eventosDe(url);
  const out = [];
  for (const e of eventos) {
    const dur = (e.end ? new Date(e.end) : new Date(new Date(e.start).getTime() + 3600000)) - new Date(e.start);
    const empieza = (d) => { const a = new Date(d).getTime(); if (a < hasta.getTime() && a + dur > desde.getTime()) out.push([a, a + dur]); };
    if (e.rrule) {
      const ex = new Set(Object.values(e.exdate || {}).map(d => new Date(d).getTime()));
      const sobrescritos = new Set(Object.values(e.recurrences || {}).map(r => new Date(r.recurrenceid || r.start).getTime()));
      let fechas = [];
      try { fechas = repeticiones(e, desde, hasta, dur); } catch { /* regla rara: se ignora */ }
      fechas.forEach(t => { if (!ex.has(t) && !sobrescritos.has(t)) empieza(t); });
      Object.values(e.recurrences || {}).forEach(r => { if (r.status !== 'CANCELLED') { const a = new Date(r.start).getTime(), b = new Date(r.end || r.start).getTime(); if (a < hasta.getTime() && b > desde.getTime()) out.push([a, b]); } });
    } else {
      empieza(e.start);
    }
  }
  return out;
}

// ¿Se pisa el hueco (fecha + horas en hora de Madrid) con algún evento?
export function solapa(intervalos, fecha, horaIni, horaFin) {
  const a = madridToUtcDate(fecha, horaIni).getTime(), b = madridToUtcDate(fecha, horaFin).getTime();
  return intervalos.some(([x, y]) => x < b && y > a);
}
