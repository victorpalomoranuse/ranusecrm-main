// Motor de Home Gym Studio: coloca las máquinas con medidas reales y recomienda según el espacio.
// Las medidas las fija este código (nunca la IA): todo en cm. La IA, más adelante, solo da luz y materiales al render.

export const TIPOS = {
  rack: { n: 'Rack', cat: 'fuerza' }, banco: { n: 'Banco', cat: 'fuerza' }, discos: { n: 'Discos', cat: 'fuerza' },
  mancu: { n: 'Mancuernas', cat: 'fuerza' }, polea: { n: 'Polea', cat: 'fuerza' },
  cinta: { n: 'Cinta', cat: 'cardio' }, bici: { n: 'Bici', cat: 'cardio' }, remo: { n: 'Remo', cat: 'cardio' },
  kettle: { n: 'Kettlebells', cat: 'func' }, cajon: { n: 'Cajón', cat: 'func' },
};

export const OBJETIVOS = {
  fuerza: { n: 'Fuerza', s: 'Pesas, rack y banco', prio: ['rack', 'banco', 'discos', 'mancu', 'polea', 'remo', 'bici', 'kettle', 'cajon'] },
  cardio: { n: 'Cardio', s: 'Cinta, bici y remo', prio: ['cinta', 'bici', 'remo', 'mancu', 'banco', 'kettle', 'cajon', 'rack'] },
  mixto: { n: 'Mixto', s: 'De todo un poco', prio: ['rack', 'banco', 'discos', 'mancu', 'bici', 'remo', 'cinta', 'kettle', 'cajon'] },
  func: { n: 'Funcional', s: 'Kettlebells y cross', prio: ['kettle', 'rack', 'banco', 'remo', 'cajon', 'mancu', 'bici', 'cinta'] },
};

export const SALAS = [
  { n: 'Habitación', L: 350, W: 350, H: 250, door: 'abajo' },
  { n: 'Garaje 1 coche', L: 550, W: 300, H: 240, door: 'abajo' },
  { n: 'Garaje doble', L: 600, W: 550, H: 260, door: 'izq' },
  { n: 'Sótano techo bajo', L: 600, W: 400, H: 215, door: 'arriba' },
  { n: 'Trastero', L: 300, W: 250, H: 230, door: 'abajo' },
];

export const NIVELES = ['Esencial', 'Equilibrado', 'Completo'];
export const TAM_NIVEL = [3, 5, 7];
export const DESCUENTO = 0.10; // descuento exclusivo orientativo; el real lo confirma Ranuse al revisar
const GAP = 30, EDGE = 8, LIBRE_MIN = { 1: 0.2, 2: 0.3, 3: 0.38 };

// Catálogo de ejemplo: se usa solo si el catálogo real aún no tiene máquinas marcadas para Home Gym
export const CATALOGO_DEMO = [
  ['rack', 'Rack half 4 postes', 125, 140, 215, 549, 0], ['rack', 'Rack bajo para techos bajos', 125, 140, 190, 529, 1], ['rack', 'Rack plegable a pared', 110, 100, 210, 649, 2],
  ['banco', 'Banco ajustable', 135, 50, 48, 149, 0], ['banco', 'Banco plegable', 120, 45, 45, 129, 1],
  ['discos', 'Barra + discos 100 kg', 60, 60, 110, 319, 0],
  ['mancu', 'Mancuernero + set 5–30 kg', 150, 55, 85, 689, 0], ['mancu', 'Mancuernas ajustables 2–24 kg', 45, 25, 30, 349, 1],
  ['polea', 'Polea / multiestación', 150, 130, 210, 1290, 0],
  ['cinta', 'Cinta de correr', 170, 80, 140, 899, 0], ['cinta', 'Cinta plegable compacta', 130, 55, 100, 349, 1],
  ['bici', 'Bici indoor', 120, 55, 115, 399, 0],
  ['remo', 'Remo de aire', 210, 60, 100, 799, 0], ['remo', 'Remo plegable vertical', 120, 55, 110, 549, 1],
  ['kettle', 'Set kettlebells 8–24 kg', 50, 40, 40, 279, 0], ['cajon', 'Cajón pliométrico', 75, 60, 60, 119, 0],
].map(([tipo, nombre, w, d, h, precio, orden], i) => ({ id: 'demo-' + i, nombre, marca: 'Ejemplo', precio, w, d, h, tipo, orden, enlace: null, foto: null, modelo3d: null }));

// Agrupa el catálogo en "huecos": por cada tipo, las opciones de más normal a más compacta
export function construyeHuecos(productos) {
  const huecos = {};
  (productos || []).forEach(p => {
    if (!TIPOS[p.tipo]) return;
    const it = { ...p, s: TIPOS[p.tipo].n, cat: TIPOS[p.tipo].cat };
    (huecos[p.tipo] = huecos[p.tipo] || []).push(it);
  });
  Object.values(huecos).forEach(l => l.sort((a, b) => a.orden - b.orden || a.precio - b.precio));
  return huecos;
}

export function rectPuerta(s) {
  const { L, W } = s;
  return { arriba: { x: L / 2 - 55, y: 0, w: 110, d: 100 }, abajo: { x: L / 2 - 55, y: W - 100, w: 110, d: 100 },
    izq: { x: 0, y: W / 2 - 55, w: 100, d: 110 }, der: { x: L - 100, y: W / 2 - 55, w: 100, d: 110 } }[s.door];
}
const choca = (x, y, w, d, b) => x < b.x + b.w + b.g && x + w + b.g > b.x && y < b.y + b.d + b.g && y + d + b.g > b.y;

function buscaSitio(it, s, colocados) {
  const bl = [{ ...rectPuerta(s), g: 0 }, ...colocados.map(p => ({ x: p.x, y: p.y, w: p.w, d: p.d, g: GAP }))];
  const giros = it.w === it.d ? [[it.w, it.d]] : [[it.w, it.d], [it.d, it.w]];
  let mejor = null;
  for (const [w, d] of giros) {
    let hallado = null;
    for (let y = EDGE; y + d <= s.W - EDGE && !hallado; y += 5)
      for (let x = EDGE; x + w <= s.L - EDGE; x += 5)
        if (bl.every(b => !choca(x, y, w, d, b))) { hallado = { x, y, w, d }; break; }
    if (hallado && (!mejor || hallado.y < mejor.y || (hallado.y === mejor.y && hallado.x < mejor.x))) mejor = hallado;
  }
  return mejor;
}

// s = { L, W, H (cm), door, goal, people }. Devuelve los equipos colocados, lo que no cabe y los niveles de propuesta.
export function recomienda(s, huecos) {
  const prio = OBJETIVOS[s.goal].prio, libreMin = LIBRE_MIN[s.people] || 0.2, area = s.L * s.W;
  const elegidos = [], omitidos = [];
  prio.forEach((tipo, idx) => {
    if (elegidos.length >= 7) return;
    const opciones = huecos[tipo];
    if (!opciones || !opciones.length) return;
    const motivos = []; let hecho = false;
    opciones.forEach((it, i) => {
      if (hecho) return;
      if (it.h > s.H - 15) { motivos.push('altura'); return; }
      const pos = buscaSitio(it, s, elegidos);
      if (!pos) { motivos.push('espacio'); return; }
      const usado = elegidos.reduce((a, c) => a + c.w * c.d, 0) + pos.w * pos.d;
      if (1 - usado / area < libreMin) { motivos.push('libre'); return; }
      elegidos.push({ it, ...pos, idx, cambio: i > 0 ? (motivos[0] || 'espacio') : null, primera: opciones[0] });
      hecho = true;
    });
    if (!hecho) {
      const r = motivos.includes('libre') ? 'dejaría poco espacio para moverte' : motivos.every(m => m === 'altura') ? 'tu techo no llega' : 'no cabe en tu sala';
      omitidos.push({ it: opciones[0], idx, r });
    }
  });
  const tam = [...new Set(TAM_NIVEL.map(n => Math.min(n, elegidos.length)).filter(n => n > 0))];
  const niveles = tam.map((n, i) => {
    const lista = elegidos.slice(0, n);
    return { nombre: NIVELES[i], n, lista, total: lista.reduce((a, c) => a + c.it.precio, 0), maxIdx: lista[n - 1].idx };
  });
  return { elegidos, omitidos, niveles };
}

export const nivelRecomendado = (niveles, presupuesto) => niveles.reduce((r, x, i) => (x.total * (1 - DESCUENTO) <= presupuesto ? i : r), 0);

export function razones(s, nivel, fmtM, fmtEur) {
  const area = s.L * s.W / 10000, out = [];
  out.push(`Tu sala tiene ${area.toLocaleString('es-ES', { maximumFractionDigits: 1 })} m² y techo de ${fmtM(s.H)} m. ${area < 9 ? 'Es compacta: priorizamos equipos de poca huella.' : area < 16 ? 'Tamaño medio: cabe un set sólido sin agobiar.' : 'Tienes espacio de sobra para combinar fuerza y cardio.'}`);
  out.push(`Objetivo ${OBJETIVOS[s.goal].n.toLowerCase()}: empezamos por ${nivel.lista.slice(0, 2).map(c => c.it.s.toLowerCase()).join(' y ')}.`);
  nivel.lista.filter(c => c.cambio).forEach(c => out.push(`Cambiamos «${c.primera.nombre}» por «${c.it.nombre}» ${c.cambio === 'altura' ? `porque tu techo mide ${fmtM(s.H)} m` : 'para ahorrar espacio'}.`));
  out.push(`Dejamos libre al menos el ${Math.round((LIBRE_MIN[s.people] || 0.2) * 100)} % del suelo${s.people > 1 ? ' para que entrenéis a la vez' : ' para moverte con comodidad'}, y la puerta despejada.`);
  const c = nivel.total * (1 - DESCUENTO);
  out.push(c <= s.budget ? `Con el descuento, ${fmtEur(c)}: dentro de tu presupuesto.` : `Con el descuento, ${fmtEur(c)}: ${fmtEur(c - s.budget)} por encima de tu presupuesto. Prueba un nivel inferior.`);
  return out;
}
