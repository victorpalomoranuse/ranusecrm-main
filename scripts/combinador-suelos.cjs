// Saca los suelos técnicos del Combinador de colores (public/combinador/index.html)
// a public/combinador/suelos.json, para que Planos los ofrezca en su paleta.
// Ejecutar de nuevo si se cambian los suelos base del combinador:
//   node scripts/combinador-suelos.cjs
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..', 'public', 'combinador');
const t = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const trozo = (re) => { const m = t.match(re); if (!m) throw new Error('No encuentro ' + re); return (0, eval)('(' + m[1] + ')'); };
const FLOORIMG = trozo(/const FLOORIMG=(\{.*?\});/s);
const P = trozo(/const P=(\{[\s\S]*?\n\});/);
const LIB = trozo(/const LIB=(\{[\s\S]*?\n\});/);
const suelos = Object.keys(LIB).filter(id => LIB[id][1] === 'Suelo técnico').map(id => {
  const [n, , eq, ohex, oncs, tex, , , , nota, extra] = LIB[id];
  const b = eq && P[eq];
  return { id, n, hex: b ? b[2] : ohex, ncs: b ? b[1] : (oncs || ''), tex, nota: nota || '', fleck: (extra && extra.fleck) || '', img: FLOORIMG[id] || '' };
});
fs.writeFileSync(path.join(raiz, 'suelos.json'), JSON.stringify({ suelos }));
console.log(suelos.length + ' suelos, ' + suelos.filter(s => s.img).length + ' con foto');
