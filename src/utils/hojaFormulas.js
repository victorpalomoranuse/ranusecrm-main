// Motor de fórmulas de las Hojas del CRM (un «Excel» sencillo para cuentas y listados rápidos).
// Sin dependencias. Entiende números con coma decimal (12,5), referencias (A1, $A$1), rangos (A1:B5),
// operadores + - * / ^ & % y comparaciones, y funciones en español o inglés (SUMA/SUM, SI/IF…).

export const colLetra = (n) => { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
export const letraCol = (s) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
export const refA1 = (c, f) => colLetra(c) + (f + 1);
export function parseRef(s) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,5})$/.exec(String(s).trim());
  return m ? { c: letraCol(m[1]), f: Number(m[2]) - 1 } : null;
}

const ERR = (e) => ({ err: e });
const esErr = (v) => v && typeof v === 'object' && 'err' in v;

// «12,5» «1.234,56» «12.5» «12 %» «12 €» → número; si no es un número, null
export function aNumero(txt) {
  if (typeof txt === 'number') return txt;
  let s = String(txt ?? '').trim();
  if (!s) return null;
  let pct = false;
  if (/%$/.test(s)) { pct = true; s = s.slice(0, -1).trim(); }
  s = s.replace(/\s?(€|eur|euros)$/i, '').replace(/^€\s?/, '').trim();
  let n;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else if (/^-?\d+,\d+$/.test(s)) n = Number(s.replace(',', '.'));
  else if (/^-?\d+(\.\d+)?$/.test(s)) n = Number(s);
  else return null;
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

// ── tokenizador ──
function tokens(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') { let j = i + 1, s = ''; while (j < src.length && src[j] !== '"') s += src[j++]; out.push({ t: 'str', v: s }); i = j + 1; continue; }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] || ''))) {
      let j = i; while (j < src.length && /[\d.]/.test(src[j])) j++;
      if (src[j] === ',' && /\d/.test(src[j + 1] || '')) { j++; while (j < src.length && /\d/.test(src[j])) j++; }
      out.push({ t: 'num', v: Number(src.slice(i, j).replace(',', '.')) }); i = j; continue;
    }
    if (/[A-Za-z_$]/.test(ch)) { let j = i; while (j < src.length && /[A-Za-z0-9_$.]/.test(src[j])) j++; out.push({ t: 'id', v: src.slice(i, j) }); i = j; continue; }
    const dos = src.slice(i, i + 2);
    if (['<>', '<=', '>='].includes(dos)) { out.push({ t: 'op', v: dos }); i += 2; continue; }
    if ('+-*/^&=<>%():;,'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    throw ERR('#NOMBRE?');
  }
  return out;
}

const FUNC = {
  SUM: 'SUM', SUMA: 'SUM', AVERAGE: 'AVERAGE', PROMEDIO: 'AVERAGE', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT', CONTAR: 'COUNT', COUNTA: 'COUNTA', CONTARA: 'COUNTA',
  ROUND: 'ROUND', REDONDEAR: 'ROUND', ABS: 'ABS', IF: 'IF', SI: 'IF', AND: 'AND', Y: 'AND', OR: 'OR', O: 'OR', SUMIF: 'SUMIF', 'SUMAR.SI': 'SUMIF',
  CONCAT: 'CONCAT', CONCATENAR: 'CONCAT', SQRT: 'SQRT', RAIZ: 'SQRT', TODAY: 'TODAY', HOY: 'TODAY', POWER: 'POWER', POTENCIA: 'POWER', PRODUCT: 'PRODUCT', PRODUCTO: 'PRODUCT',
};

// Evalúa una fórmula (sin el «=») contra una hoja. getCelda(c,f) devuelve el valor ya calculado de otra celda.
export function evaluaFormula(src, getCelda) {
  let tk;
  try { tk = tokens(src); } catch (e) { return e; }
  let p = 0;
  const peek = () => tk[p], next = () => tk[p++];
  const isOp = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v;

  const numero = (v) => {
    if (esErr(v)) throw v;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === '' || v == null) return 0;
    const n = aNumero(v);
    if (n == null) throw ERR('#VALOR!');
    return n;
  };
  const texto = (v) => { if (esErr(v)) throw v; if (v == null) return ''; if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO'; return String(v); };
  const plano = (a) => a.flat ? a.flat(1) : [].concat(...a);
  const valores = (args) => { // lista de valores sueltos a partir de argumentos (rangos incluidos)
    const out = [];
    args.forEach(a => { if (Array.isArray(a)) plano(a).forEach(x => out.push(x)); else out.push(a); });
    return out;
  };
  const nums = (args) => valores(args).filter(x => { if (esErr(x)) throw x; return typeof x === 'number'; });

  function llamada(nombre, args) {
    const f = FUNC[nombre.toUpperCase()];
    if (!f) throw ERR('#NOMBRE?');
    const a = args;
    switch (f) {
      case 'SUM': return nums(a).reduce((s, x) => s + x, 0);
      case 'PRODUCT': { const n = nums(a); return n.length ? n.reduce((s, x) => s * x, 1) : 0; }
      case 'AVERAGE': { const n = nums(a); if (!n.length) throw ERR('#DIV/0!'); return n.reduce((s, x) => s + x, 0) / n.length; }
      case 'MIN': { const n = nums(a); return n.length ? Math.min(...n) : 0; }
      case 'MAX': { const n = nums(a); return n.length ? Math.max(...n) : 0; }
      case 'COUNT': return nums(a).length;
      case 'COUNTA': return valores(a).filter(x => x !== '' && x != null).length;
      case 'ROUND': { const d = a[1] == null ? 0 : numero(a[1]), k = Math.pow(10, d), v = numero(a[0]); return Math.round((v + Number.EPSILON) * k) / k; }
      case 'ABS': return Math.abs(numero(a[0]));
      case 'SQRT': { const v = numero(a[0]); if (v < 0) throw ERR('#NUM!'); return Math.sqrt(v); }
      case 'POWER': return Math.pow(numero(a[0]), numero(a[1]));
      case 'IF': { const c = a[0]; if (esErr(c)) throw c; const cierto = typeof c === 'boolean' ? c : (typeof c === 'number' ? c !== 0 : !!String(c || '').trim()); return cierto ? (a[1] === undefined ? true : a[1]) : (a[2] === undefined ? false : a[2]); }
      case 'AND': return valores(a).every(x => (typeof x === 'boolean' ? x : numero(x) !== 0));
      case 'OR': return valores(a).some(x => (typeof x === 'boolean' ? x : numero(x) !== 0));
      case 'CONCAT': return valores(a).map(texto).join('');
      case 'TODAY': { const d = new Date(); return d.toLocaleDateString('es-ES'); }
      case 'SUMIF': { // SUMAR.SI(rango; criterio; [rango_suma])
        const rg = plano(a[0] || []), cr = a[1], sr = a[2] ? plano(a[2]) : rg;
        const cumple = (x) => {
          if (typeof cr === 'number') return typeof x === 'number' && x === cr;
          const s = String(cr), m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s), op = m[1] || '=', ref = m[2], rn = aNumero(ref), xn = typeof x === 'number' ? x : aNumero(x);
          if (rn != null && xn != null) { switch (op) { case '<': return xn < rn; case '>': return xn > rn; case '<=': return xn <= rn; case '>=': return xn >= rn; case '<>': return xn !== rn; default: return xn === rn; } }
          const a1 = String(x ?? '').toLowerCase(), b1 = ref.toLowerCase();
          return op === '<>' ? a1 !== b1 : a1 === b1;
        };
        let tot = 0; rg.forEach((x, i) => { if (cumple(x)) { const v = sr[i]; if (typeof v === 'number') tot += v; else { const n = aNumero(v); if (n != null) tot += n; } } });
        return tot;
      }
      default: throw ERR('#NOMBRE?');
    }
  }

  function primario() {
    const t = next();
    if (!t) throw ERR('#ERROR!');
    if (t.t === 'num') return t.v;
    if (t.t === 'str') return t.v;
    if (t.t === 'op' && t.v === '(') { const v = comparacion(); if (!isOp(')')) throw ERR('#ERROR!'); next(); return v; }
    if (t.t === 'op' && t.v === '-') return -numero(unarioBase());
    if (t.t === 'op' && t.v === '+') return numero(unarioBase());
    if (t.t === 'id') {
      if (isOp('(')) { // función
        next(); const args = [];
        if (!isOp(')')) { for (;;) { args.push(comparacion()); if (isOp(';') || isOp(',')) { next(); continue; } break; } }
        if (!isOp(')')) throw ERR('#ERROR!');
        next(); return llamada(t.v, args);
      }
      const up = t.v.toUpperCase();
      if (up === 'TRUE' || up === 'VERDADERO') return true;
      if (up === 'FALSE' || up === 'FALSO') return false;
      const a = parseRef(t.v);
      if (!a) throw ERR('#NOMBRE?');
      if (isOp(':')) { // rango
        next(); const t2 = next(); const b = t2 && t2.t === 'id' ? parseRef(t2.v) : null;
        if (!b) throw ERR('#REF!');
        const f0 = Math.min(a.f, b.f), f1 = Math.max(a.f, b.f), c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c);
        if ((f1 - f0 + 1) * (c1 - c0 + 1) > 20000) throw ERR('#REF!');
        const m = [];
        for (let f = f0; f <= f1; f++) { const fila = []; for (let c = c0; c <= c1; c++) fila.push(getCelda(c, f)); m.push(fila); }
        return m;
      }
      return getCelda(a.c, a.f);
    }
    throw ERR('#ERROR!');
  }
  function unarioBase() { return potencia(); }
  function postfijo() {
    let v = primario();
    while (isOp('%')) { next(); v = numero(v) / 100; }
    return v;
  }
  function potencia() {
    let v = postfijo();
    while (isOp('^')) { next(); v = Math.pow(numero(v), numero(postfijo())); }
    return v;
  }
  function producto() {
    let v = potencia();
    while (isOp('*') || isOp('/')) {
      const op = next().v, r = potencia();
      if (op === '*') v = numero(v) * numero(r);
      else { const d = numero(r); if (d === 0) throw ERR('#DIV/0!'); v = numero(v) / d; }
    }
    return v;
  }
  function suma() {
    let v = producto();
    while (isOp('+') || isOp('-')) { const op = next().v, r = producto(); v = op === '+' ? numero(v) + numero(r) : numero(v) - numero(r); }
    return v;
  }
  function concat() {
    let v = suma();
    while (isOp('&')) { next(); v = texto(v) + texto(suma()); }
    return v;
  }
  function comparacion() {
    let v = concat();
    while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
      const op = next().v, r = concat();
      const an = typeof v === 'number' ? v : aNumero(v), bn = typeof r === 'number' ? r : aNumero(r);
      let a1 = v, b1 = r;
      if (an != null && bn != null) { a1 = an; b1 = bn; } else { a1 = texto(v).toLowerCase(); b1 = texto(r).toLowerCase(); }
      v = op === '=' ? a1 === b1 : op === '<>' ? a1 !== b1 : op === '<' ? a1 < b1 : op === '>' ? a1 > b1 : op === '<=' ? a1 <= b1 : a1 >= b1;
    }
    return v;
  }

  try {
    const v = comparacion();
    if (p < tk.length) return ERR('#ERROR!');
    if (Array.isArray(v)) return ERR('#VALOR!');
    return v;
  } catch (e) {
    if (esErr(e)) return e;
    return ERR('#ERROR!');
  }
}

// ── la hoja ──
// datos = { cols, filas, celdas: { 'A1': { v: '=B1+2' | 'texto' | '12,5', f: { b, i, a, fmt, col, bg } } }, anchos: { A: 120 } }
export function calculaHoja(datos) {
  const celdas = datos.celdas || {};
  const cache = {}; const pila = new Set();
  function valor(c, f) {
    const k = refA1(c, f);
    if (k in cache) return cache[k];
    const raw = celdas[k] && celdas[k].v;
    if (raw == null || raw === '') return (cache[k] = '');
    const s = String(raw);
    if (s[0] === '=') {
      if (pila.has(k)) return ERR('#CICLO!');
      pila.add(k);
      const r = evaluaFormula(s.slice(1), valor);
      pila.delete(k);
      return (cache[k] = r);
    }
    const n = aNumero(s);
    return (cache[k] = n != null ? n : s);
  }
  return { valor };
}

const NF = {
  n0: new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'min2' }),
  n2: new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }),
  gen: new Intl.NumberFormat('es-ES', { maximumFractionDigits: 10, useGrouping: false }),
};
// el texto que se enseña en la celda según su formato
export function textoCelda(v, fmt) {
  if (v == null || v === '') return '';
  if (esErr(v)) return v.err;
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (typeof v === 'number') {
    switch (fmt) {
      case 'n2': return NF.n2.format(v);
      case 'eur': return NF.n2.format(v) + ' €';
      case 'pct': return NF.n2.format(v * 100).replace(/,00$/, '') + ' %';
      case 'n0': return NF.n0.format(v);
      default: return NF.gen.format(Math.round(v * 1e10) / 1e10);
    }
  }
  return String(v);
}

// ── insertar / eliminar filas y columnas: las fórmulas se ajustan solas ──
function mueveRef(c, f, eje, en, delta) { // devuelve {c,f} movida, o null si la celda desaparece
  if (eje === 'f') { if (delta > 0) return { c, f: f >= en ? f + delta : f }; if (f === en) return null; return { c, f: f > en ? f + delta : f }; }
  if (delta > 0) return { c: c >= en ? c + delta : c, f }; if (c === en) return null; return { c: c > en ? c + delta : c, f };
}
export function ajustaFormula(formula, eje, en, delta) {
  if (!formula || formula[0] !== '=') return formula;
  const partes = formula.split(/("[^"]*")/);
  return partes.map((p, i) => {
    if (i % 2 === 1) return p;
    return p.replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d{1,5})(?::(\$?)([A-Za-z]{1,3})(\$?)(\d{1,5}))?(?![A-Za-z0-9(])/g, (m, d1, c1, d2, r1, d3, c2, d4, r2, off, str) => {
      if (off > 0 && /[A-Za-z0-9_.]/.test(str[off - 1])) return m;
      const a = { c: letraCol(c1), f: Number(r1) - 1 };
      if (c2 === undefined) {
        const n = mueveRef(a.c, a.f, eje, en, delta);
        return n ? d1 + colLetra(n.c) + d2 + (n.f + 1) : '#REF!';
      }
      const b = { c: letraCol(c2), f: Number(r2) - 1 };
      let a2 = mueveRef(a.c, a.f, eje, en, delta), b2 = mueveRef(b.c, b.f, eje, en, delta);
      if (!a2 && !b2) return '#REF!';
      if (!a2) a2 = { c: a.c, f: a.f }; // se elimina el extremo: el rango se encoge
      if (!b2) b2 = eje === 'f' ? { c: b.c, f: b.f - 1 } : { c: b.c - 1, f: b.f };
      return d1 + colLetra(a2.c) + d2 + (a2.f + 1) + ':' + d3 + colLetra(b2.c) + d4 + (b2.f + 1);
    });
  }).join('');
}
export function insertaEliminaEje(datos, eje, en, delta) {
  const celdas = {}, anchos = {}, alturas = {};
  Object.keys(datos.celdas || {}).forEach(k => {
    const r = parseRef(k); if (!r) return;
    const n = mueveRef(r.c, r.f, eje, en, delta); if (!n) return;
    const cel = { ...datos.celdas[k] };
    if (typeof cel.v === 'string' && cel.v[0] === '=') cel.v = ajustaFormula(cel.v, eje, en, delta);
    celdas[refA1(n.c, n.f)] = cel;
  });
  Object.keys(datos.anchos || {}).forEach(l => {
    if (eje !== 'c') { anchos[l] = datos.anchos[l]; return; }
    const c = letraCol(l), n = mueveRef(c, 0, 'c', en, delta); if (n) anchos[colLetra(n.c)] = datos.anchos[l];
  });
  Object.keys(datos.alturas || {}).forEach(r => {
    if (eje !== 'f') { alturas[r] = datos.alturas[r]; return; }
    const f = Number(r), n = mueveRef(0, f, 'f', en, delta); if (n) alturas[n.f] = datos.alturas[r];
  });
  return { ...datos, celdas, anchos, alturas, filas: eje === 'f' ? Math.max(1, datos.filas + delta) : datos.filas, cols: eje === 'c' ? Math.max(1, datos.cols + delta) : datos.cols };
}

// al pegar una fórmula copiada de otra celda, sus referencias relativas se desplazan (A1 → A2 si bajas una fila); las que llevan $ se quedan
export function desplazaFormula(formula, dc, df) {
  if (!formula || formula[0] !== '=' || (!dc && !df)) return formula;
  return formula.split(/("[^"]*")/).map((p, i) => {
    if (i % 2 === 1) return p;
    return p.replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d{1,5})(?![A-Za-z0-9(])/g, (m, d1, c1, d2, r1, off, str) => {
      if (off > 0 && /[A-Za-z0-9_.]/.test(str[off - 1])) return m;
      const c = d1 ? letraCol(c1) : letraCol(c1) + dc, f = d2 ? Number(r1) - 1 : Number(r1) - 1 + df;
      if (c < 0 || f < 0) return '#REF!';
      return d1 + colLetra(c) + d2 + (f + 1);
    });
  }).join('');
}
