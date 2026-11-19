export function validaPlanYoutube(plan, fuentes, objetivo = 600) {
  if (!plan?.titulo || !Array.isArray(plan.segmentos) || !plan.segmentos.length || plan.segmentos.length > 80) throw new Error('No hay un montaje de YouTube válido');
  const vistos = new Map(); let duracion = 0;
  const segmentos = plan.segmentos.map(s => {
    const f = fuentes.find(f => f.id === s.fuente);
    const de = s.de, a = s.a;
    if (!f || !Number.isFinite(de) || !Number.isFinite(a) || de < 0 || a > f.dur + 0.05 || a - de < 3) throw new Error('Tramo fuera de la fuente original');
    const anteriores = vistos.get(f.id) || [];
    if (anteriores.some(x => de < x.a && a > x.de)) throw new Error('El montaje repite material');
    anteriores.push({ de, a }); vistos.set(f.id, anteriores);
    const resultado = { fuente: f.id, de, a, capitulo: String(s.capitulo || '').slice(0, 160), inicio: duracion };
    duracion += a - de; return resultado;
  });
  if (duracion > objetivo * 1.35 || duracion < Math.min(60, objetivo * 0.2)) throw new Error('La duración del montaje no es válida');
  return { titulo: String(plan.titulo).slice(0, 160), resumen: String(plan.resumen || '').slice(0, 1000), segmentos, duracion };
}

export function textoYoutube(fuente, de = 0, a = fuente.dur) {
  return fuente.palabras.filter(w => w.a > de && w.de < a).map(w => `[${w.de.toFixed(2)}-${w.a.toFixed(2)}] ${w.t}`).join(' ');
}
