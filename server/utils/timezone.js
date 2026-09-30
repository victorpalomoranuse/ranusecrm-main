// Ranuse Design opera en hora de España — pero el servidor (Railway) corre
// en UTC, no en Europe/Madrid. Si construimos un Date a partir de un string
// tipo "2026-10-05T10:00:00" con `new Date(...)`, Node lo interpreta en la
// zona horaria DEL PROCESO (UTC en producción), no en la de España — así
// que "10:00" se guardaría como si fueran las 10:00 UTC (= 12:00 en Madrid
// en verano), un desfase de 1-2h según la época del año.
//
// Esta función convierte una fecha+hora "de pared" en Europe/Madrid a un
// Date UTC correcto, gestionando sola el cambio de horario de verano — y,
// a diferencia del truco de toLocaleString(), NO depende de en qué zona
// horaria esté configurada la máquina que la ejecuta (usa
// Intl.DateTimeFormat().formatToParts(), que es puro cálculo).
export function madridToUtcDate(fecha, hora) {
  // fecha: "YYYY-MM-DD" · hora: "HH:mm" o "HH:mm:ss"
  const [y, m, d] = fecha.split('-').map(Number);
  const [hh, mm, ss] = hora.split(':').map(Number);

  // 1) Tratamos la fecha/hora pedida como si ya fuera UTC (una ancla).
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm || 0, ss || 0));

  // 2) Vemos qué hora de PARED marcaría esa ancla en Madrid.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(guess).map(x => [x.type, x.value]));
  const comoSiFueraMadrid = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);

  // 3) La diferencia es el offset real de Madrid en ese instante (+1h en
  // invierno, +2h en verano) — se la restamos a la ancla para obtener el
  // UTC correcto que, visto desde Madrid, marca la hora que pedimos.
  const offsetMs = comoSiFueraMadrid - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}
