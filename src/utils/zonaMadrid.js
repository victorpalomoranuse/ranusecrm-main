// Todo el equipo trabaja en hora de Madrid, aunque alguien (p. ej. Franco, en
// El Salvador) tenga el navegador en otra zona horaria. Estas funciones leen y
// escriben fechas SIEMPRE como hora de Madrid, sin depender de la zona del
// ordenador de quien mira el CRM.

const TZ = 'Europe/Madrid';
const pad = (n) => String(n).padStart(2, '0');

function partes(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

// Instante (ISO) -> "YYYY-MM-DDTHH:mm" en hora de Madrid, para un <input type="datetime-local">
export function isoAInputMadrid(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = partes(d);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

// Fecha y hora "de pared" de Madrid -> instante UTC (ISO). Gestiona solo el cambio de horario verano/invierno
export function madridAIso(fecha, hora) {
  const [y, m, d] = fecha.split('-').map(Number);
  const [hh, mm, ss] = (hora || '00:00').split(':').map(Number);
  const ancla = Date.UTC(y, m - 1, d, hh, mm || 0, ss || 0);
  const p = partes(new Date(ancla));
  const comoMadrid = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  let real = ancla - (comoMadrid - ancla);
  const p2 = partes(new Date(real));
  const comoMadrid2 = Date.UTC(p2.y, p2.m - 1, p2.d, p2.h, p2.mi, p2.s);
  if (comoMadrid2 !== ancla) real = ancla - (comoMadrid2 - real);
  return new Date(real).toISOString();
}

// "YYYY-MM-DDTHH:mm" (lo que escribe la persona, en hora de Madrid) -> ISO UTC
export function inputMadridAIso(valor) {
  if (!valor) return null;
  const [f, h] = valor.split('T');
  return madridAIso(f, h || '00:00');
}

// Para mostrar: "08 oct 2026, 17:00" en hora de Madrid
export function fmtFechaHoraMadrid(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const f = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
  const h = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  return `${f}, ${h}`;
}
