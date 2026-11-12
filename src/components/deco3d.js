// Piezas de decoración «libres»: plantas, esculturas, bancos, cuadros y columnas de luz que se construyen aquí mismo, sin depender de la biblioteca 3D.
// La IA las puede proponer aunque en la biblioteca no haya nada parecido.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const CM = 0.01;
export const KINDS_DECO = {
  planta: 'Planta grande en maceta', planta_alta: 'Planta alta o palmera', arbusto: 'Jardinera con arbusto',
  escultura_esfera: 'Escultura de esferas apiladas', escultura_arco: 'Escultura en arco', escultura_monolito: 'Monolito escultórico',
  banco: 'Banco', columna_luz: 'Columna de luz', cuadro: 'Cuadro grande',
  persona_de_pie: 'Persona de pie', persona_andando: 'Persona andando', persona_corriendo: 'Persona corriendo', persona_mancuernas: 'Persona con mancuernas',
  sofa_modular: 'Sofá modular', sofa_esquina: 'Sofá en esquina', butaca: 'Butaca', puf: 'Puf', mesa_centro: 'Mesa de centro', mesa_alta: 'Mesa alta (barra)', taburete_alto: 'Taburete alto',
  banco_vestuario: 'Banco de vestuario', taquillas: 'Taquillas', mostrador_recepcion: 'Mostrador de recepción', estanteria_abierta: 'Estantería abierta', aparador: 'Aparador bajo', escritorio: 'Escritorio',
  espejo_pie: 'Espejo de pie', espejo_pared: 'Espejo de pared', lampara_pie: 'Lámpara de pie', lampara_colgante: 'Lámpara colgante de aro', alfombra: 'Alfombra', panel_lamas: 'Panel de lamas de madera', tv_mural: 'Televisión en pared',
  persona_sentadilla: 'Persona haciendo sentadilla', persona_sentada: 'Persona sentada', persona_estirando: 'Persona estirando', grupo_hablando: 'Dos personas hablando',
};
export const KINDS_MOBILIARIO = ['sofa_modular', 'sofa_esquina', 'butaca', 'puf', 'mesa_centro', 'mesa_alta', 'taburete_alto', 'banco_vestuario', 'taquillas', 'mostrador_recepcion', 'estanteria_abierta', 'aparador', 'escritorio', 'espejo_pie', 'espejo_pared', 'lampara_pie', 'lampara_colgante', 'alfombra', 'panel_lamas', 'tv_mural'];
export const KINDS_PERSONAS = ['persona_de_pie', 'persona_andando', 'persona_corriendo', 'persona_mancuernas', 'persona_sentadilla', 'persona_sentada', 'persona_estirando', 'grupo_hablando'];
// Medidas habituales (cm) para cuando la IA no las da
export const MEDIDAS_DECO = {
  planta: [55, 55, 150], planta_alta: [60, 60, 230], arbusto: [90, 45, 110], escultura_esfera: [50, 50, 140], escultura_arco: [110, 30, 160],
  escultura_monolito: [40, 40, 190], banco: [150, 45, 45], columna_luz: [25, 25, 220], cuadro: [140, 4, 100],
  persona_de_pie: [55, 35, 175], persona_andando: [55, 70, 175], persona_corriendo: [55, 85, 175], persona_mancuernas: [60, 35, 175],
  persona_sentadilla: [60, 70, 175], persona_sentada: [55, 70, 130], persona_estirando: [60, 110, 150], grupo_hablando: [65, 110, 175],
  sofa_modular: [220, 92, 76], sofa_esquina: [270, 170, 76], butaca: [82, 82, 78], puf: [60, 60, 40], mesa_centro: [100, 60, 38], mesa_alta: [140, 60, 105], taburete_alto: [40, 40, 75],
  banco_vestuario: [180, 40, 46], taquillas: [150, 50, 190], mostrador_recepcion: [280, 75, 110], estanteria_abierta: [120, 35, 200], aparador: [170, 42, 76], escritorio: [150, 70, 75],
  espejo_pie: [80, 6, 190], espejo_pared: [140, 4, 180], lampara_pie: [40, 40, 170], lampara_colgante: [70, 70, 110], alfombra: [260, 180, 2], panel_lamas: [120, 6, 240], tv_mural: [140, 6, 82],
};
// Poses (ángulos en radianes en el plano lateral): inclinación del tronco, pierna [cadera, rodilla], brazo [hombro, codo]; 0 = colgando recto, positivo = hacia delante
const POSES = {
  persona_de_pie: { lean: 0.02, legL: [0.03, 0.04], legR: [-0.03, 0.04], armL: [0.05, 0.12], armR: [-0.05, 0.12] },
  persona_andando: { lean: 0.06, legL: [0.5, 0.12], legR: [-0.4, 0.45], armL: [-0.45, 0.3], armR: [0.45, 0.3] },
  persona_corriendo: { lean: 0.3, legL: [1.0, 1.0], legR: [-0.75, 1.3], armL: [-0.9, 1.4], armR: [0.85, 1.4] },
  persona_mancuernas: { lean: 0, legL: [0.03, 0.04], legR: [-0.03, 0.04], armL: [0.12, 1.75], armR: [0.12, 1.75], mancuernas: true },
  persona_sentadilla: { lean: 0.6, legL: [1.15, 1.95], legR: [1.15, 1.95], armL: [-0.55, 2.3], armR: [-0.55, 2.3], barra: true },
  persona_sentada: { lean: 0.02, legL: [1.5, 1.5], legR: [1.5, 1.5], armL: [0.3, 0.9], armR: [0.3, 0.9], banco: true },
  persona_estirando: { lean: 0.35, legL: [1.05, 1.1], legR: [-0.55, 0.15], armL: [0.4, 0.2], armR: [0.4, 0.2] },
  grupo_hablando: { lean: 0.03, legL: [0.03, 0.04], legR: [-0.03, 0.04], armL: [0.05, 0.12], armR: [0.55, 1.25] },
};
const hexOk = (v, d) => (/^#[0-9a-fA-F]{6}/.test(v || '') ? String(v).slice(0, 7) : d);

// Figura humana sencilla (maniquí) con la pose dada: sirve para dar vida y ESCALA; el render con IA es el que le da el realismo
function figuraHumana(h, P, cTop, cLeg, cSkin) {
  const g = new THREE.Group(), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const mat = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
  const limb = (a, b, r, c) => { const d = new THREE.Vector3().subVectors(b, a), L = d.length() || 0.001, m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.88, L, 10), mat(c)); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); m.castShadow = true; g.add(m); };
  const bola = (p, r, c) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat(c)); m.position.copy(p); m.castShadow = true; g.add(m); };
  const L1 = 0.245 * h, L2 = 0.245 * h, Lt = 0.30 * h, La = 0.17 * h, Lf = 0.15 * h, ancla = 0.04 * h;
  const sale = (hip, ang, flex, l1, l2) => { const k = V(hip.x, hip.y - l1 * Math.cos(ang), hip.z + l1 * Math.sin(ang)); return { k, t: V(k.x, k.y - l2 * Math.cos(ang - flex), k.z + l2 * Math.sin(ang - flex)) }; };
  const caida = (ang, flex) => L1 * Math.cos(ang) + L2 * Math.cos(ang - flex);
  const hy = Math.max(caida(P.legL[0], P.legL[1]), caida(P.legR[0], P.legR[1])) + ancla;
  const hipX = 0.055 * h, cadera = V(0, hy, 0), t = P.lean || 0;
  const sh0 = V(0, hy + Lt * Math.cos(t), Lt * Math.sin(t)), cab = V(0, sh0.y + 0.095 * h * Math.cos(t), sh0.z + 0.095 * h * Math.sin(t));
  limb(cadera, sh0, 0.075 * h, cTop); bola(sh0, 0.085 * h, cTop); bola(cab, 0.062 * h, cSkin); limb(sh0, V(0, cab.y - 0.04 * h, cab.z), 0.026 * h, cSkin);
  const pel = new THREE.Mesh(new THREE.BoxGeometry(0.2 * h, 0.07 * h, 0.12 * h), mat(cLeg)); pel.position.copy(cadera); g.add(pel);
  [[-1, P.legL, P.armL], [1, P.legR, P.armR]].forEach(([sx, leg, arm]) => {
    const hp = V(sx * hipX, hy, 0), { k, t: tob } = sale(hp, leg[0], leg[1], L1, L2);
    limb(hp, k, 0.052 * h, cLeg); limb(k, tob, 0.042 * h, cLeg);
    const pie = new THREE.Mesh(new THREE.BoxGeometry(0.075 * h, 0.04 * h, 0.15 * h), mat('#202022')); pie.position.set(tob.x, tob.y - 0.01 * h, tob.z + 0.045 * h); pie.castShadow = true; g.add(pie);
    const hs = V(sx * 0.115 * h, sh0.y - 0.01 * h, sh0.z), cod = V(hs.x, hs.y - La * Math.cos(arm[0]), hs.z + La * Math.sin(arm[0])), man = V(cod.x, cod.y - Lf * Math.cos(arm[0] + arm[1]), cod.z + Lf * Math.sin(arm[0] + arm[1]));
    limb(hs, cod, 0.034 * h, cTop); limb(cod, man, 0.03 * h, cSkin); bola(man, 0.032 * h, cSkin);
    if (P.mancuernas) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * h, 0.03 * h, 0.12 * h, 10), mat('#2a2a2c', 0.4)); d.rotation.z = Math.PI / 2; d.position.copy(man); g.add(d); }
  });
  if (P.barra) { const hs = V(0, sh0.y + 0.03 * h, sh0.z - 0.06 * h), b = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * h, 0.012 * h, 0.9 * h, 10), mat('#9a9a9e', 0.3)); b.rotation.z = Math.PI / 2; b.position.copy(hs); g.add(b); for (const sx of [-1, 1]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * h, 0.11 * h, 0.04 * h, 20), mat('#1f1f21', 0.5)); d.rotation.z = Math.PI / 2; d.position.set(sx * 0.4 * h, hs.y, hs.z); g.add(d); } }
  if (P.banco) { const bk = new THREE.Mesh(new THREE.BoxGeometry(0.5 * h, 0.05 * h, 0.4 * h), mat('#2a2a2c', 0.6)); bk.position.set(0, hy - 0.06 * h, 0.02 * h); g.add(bk); }
  return g;
}

export function construirDeco(o) {
  const w = (o.w || 50) * CM, dd = (o.d || 50) * CM, h = (o.alto || 100) * CM, r = Math.min(w, dd) / 2, kind = o.deco?.kind || 'planta';
  const c1 = new THREE.Color(hexOk(o.color, kind.startsWith('planta') || kind === 'arbusto' ? '#8a5a3c' : '#c9b9a0')), c2 = new THREE.Color(hexOk(o.deco?.color2, '#3f7d3a'));
  const mat = (c, rough = 0.7, met = 0.05) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: met });
  const g = new THREE.Group();
  const add = (geo, m, x, y, z) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = me.receiveShadow = true; g.add(me); return me; };
  const hojas = (n, rx, ry, rz, yMin, yMax, rad, col) => { for (let i = 0; i < n; i++) { const ang = i * 2.399, k = i / Math.max(1, n - 1), me = add(new THREE.SphereGeometry(1, 14, 10), mat(col.clone().offsetHSL(0, 0, (i % 3 - 1) * 0.04), 0.85, 0), Math.cos(ang) * rad * (0.35 + 0.65 * ((i * 7) % n) / n), yMin + (yMax - yMin) * (0.15 + 0.85 * k), Math.sin(ang) * rad * (0.35 + 0.65 * ((i * 5) % n) / n)); me.scale.set(rx * (0.8 + 0.4 * ((i * 3) % 5) / 5), ry, rz * (0.8 + 0.4 * ((i * 2) % 5) / 5)); } };
  switch (kind) {
    case 'planta': {
      const hp = h * 0.28; add(new THREE.CylinderGeometry(r * 0.62, r * 0.48, hp, 28), mat(c1, 0.6, 0.05), 0, hp / 2, 0); add(new THREE.CylinderGeometry(r * 0.58, r * 0.58, 0.01, 24), mat(new THREE.Color('#2b211c'), 1, 0), 0, hp, 0);
      hojas(9, r * 0.6, (h - hp) * 0.2, r * 0.6, hp, h * 0.92, r * 0.5, c2); break;
    }
    case 'planta_alta': {
      const hp = h * 0.14; add(new THREE.CylinderGeometry(r * 0.55, r * 0.42, hp, 28), mat(c1, 0.6, 0.05), 0, hp / 2, 0);
      add(new THREE.CylinderGeometry(r * 0.05, r * 0.08, h * 0.62, 10), mat(new THREE.Color('#6b4f36'), 0.9, 0), 0, hp + h * 0.31, 0);
      for (let i = 0; i < 8; i++) { const hoja = add(new THREE.ConeGeometry(r * 0.16, h * 0.34, 8), mat(c2.clone().offsetHSL(0, 0, (i % 3 - 1) * 0.04), 0.8, 0), 0, 0, 0); hoja.position.set(Math.cos(i * 0.785) * r * 0.25, hp + h * 0.66, Math.sin(i * 0.785) * r * 0.25); hoja.rotation.set(Math.sin(i * 0.785) * 1.1, 0, -Math.cos(i * 0.785) * 1.1); }
      break;
    }
    case 'arbusto': {
      const hp = h * 0.35; add(new THREE.BoxGeometry(w, hp, dd), mat(c1, 0.55, 0.05), 0, hp / 2, 0);
      hojas(7, w * 0.3, (h - hp) * 0.5, dd * 0.55, hp, h * 0.7, Math.max(w, dd) * 0.28, c2); break;
    }
    case 'escultura_esfera': {
      const m = mat(c1, 0.25, 0.6); add(new THREE.CylinderGeometry(r * 0.7, r * 0.8, h * 0.06, 28), mat(new THREE.Color('#2a2a2c'), 0.6, 0.2), 0, h * 0.03, 0);
      const rs = [r * 0.62, r * 0.46, r * 0.32]; let y = h * 0.06; rs.forEach((q, i) => { y += q; add(new THREE.SphereGeometry(q, 28, 20), m, (i % 2 ? 1 : -1) * r * 0.08, y, 0); y += q * 0.9; }); break;
    }
    case 'escultura_arco': {
      const m = mat(c1, 0.3, 0.55), R = Math.min(w, h) * 0.38; add(new THREE.BoxGeometry(w * 0.7, h * 0.04, dd * 1.2), mat(new THREE.Color('#2a2a2c'), 0.6, 0.2), 0, h * 0.02, 0);
      const t = add(new THREE.TorusGeometry(R, Math.min(dd, R) * 0.16, 16, 48, Math.PI), m, 0, h * 0.04, 0); t.rotation.z = 0; break;
    }
    case 'escultura_monolito': {
      const m = mat(c1, 0.35, 0.3), me = add(new THREE.CylinderGeometry(r * 0.55, r * 0.85, h, 4), m, 0, h / 2, 0); me.rotation.y = Math.PI / 4; break;
    }
    // ── mobiliario moderno de la casa: formas limpias, tapizados suaves (esquinas redondeadas), color principal = el del objeto, color 2 = patas y herrajes
    case 'sofa_modular': case 'sofa_esquina': case 'butaca': {
      const esq = kind === 'sofa_esquina', but = kind === 'butaca', pata = 0.09, mt = mat(c1, 0.92, 0), mp = mat(c2, 0.45, 0.5), asientoH = h * 0.2, baseH = h * 0.2, rb = (x, y, z, rd = 0.03) => new RoundedBoxGeometry(x, y, z, 4, Math.min(rd, x / 2.2, y / 2.2, z / 2.2));
      const fila = (ancho, prof, ox, oz, rot) => { const gg = new THREE.Group(); gg.position.set(ox, 0, oz); gg.rotation.y = rot || 0; g.add(gg); const ad = (geo, m, x, y, z) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = me.receiveShadow = true; gg.add(me); return me; };
        const n = Math.max(1, Math.round(ancho / 0.78)), cw = (ancho - 0.2) / n;
        ad(rb(ancho, baseH, prof, 0.04), mt, 0, pata + baseH / 2, 0);
        for (let i = 0; i < n; i++) { ad(rb(cw - 0.01, asientoH, prof * 0.8, 0.05), mt, -ancho / 2 + 0.1 + cw * (i + 0.5), pata + baseH + asientoH / 2, prof * 0.1); ad(rb(cw - 0.02, h * 0.42, prof * 0.2, 0.05), mt, -ancho / 2 + 0.1 + cw * (i + 0.5), pata + baseH + asientoH + h * 0.16, -prof * 0.36).rotation.x = -0.12; }
        for (const sx of [-1, 1]) ad(rb(0.1, h * 0.55, prof, 0.04), mt, sx * (ancho / 2 - 0.05), pata + h * 0.27 + baseH * 0.5, 0);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) ad(new THREE.CylinderGeometry(0.02, 0.016, pata, 10), mp, sx * (ancho / 2 - 0.08), pata / 2, sz * (prof / 2 - 0.08)); };
      if (but) fila(w, dd, 0, 0, 0); else if (esq) { fila(w, dd * 0.5, 0, -dd / 2 + dd * 0.25, 0); fila(dd * 0.5 * 1.0, dd * 0.5, -w / 2 + dd * 0.25 - 0.1, dd * 0.25 - 0.05, Math.PI / 2 * 0 + 0); } else fila(w, dd, 0, 0, 0);
      break;
    }
    case 'puf': {
      add(new RoundedBoxGeometry(w, h, dd, 4, Math.min(w, dd, h) * 0.3), mat(c1, 0.94, 0), 0, h / 2, 0); break;
    }
    case 'mesa_centro': case 'mesa_alta': case 'escritorio': case 'taburete_alto': {
      const alta = kind === 'mesa_alta', tab = kind === 'taburete_alto', esc = kind === 'escritorio', gr = tab ? 0.035 : 0.04;
      if (tab) { add(new THREE.CylinderGeometry(w / 2, w / 2 * 0.95, gr, 32), mat(c1, 0.6, 0.05), 0, h - gr / 2, 0); for (const k of [0, 1, 2, 3]) add(new THREE.CylinderGeometry(0.014, 0.014, h - gr, 8), mat(c2, 0.4, 0.6), Math.cos(k * 1.5708 + 0.785) * w * 0.34, (h - gr) / 2, Math.sin(k * 1.5708 + 0.785) * w * 0.34); add(new THREE.TorusGeometry(w * 0.3, 0.008, 6, 24), mat(c2, 0.4, 0.6), 0, h * 0.35, 0).rotation.x = Math.PI / 2; break; }
      add(new RoundedBoxGeometry(w, gr, dd, 3, 0.012), mat(c1, 0.55, 0.05), 0, h - gr / 2, 0);
      if (esc) { for (const sx of [-1, 1]) { add(new THREE.BoxGeometry(0.035, h - gr, dd * 0.9), mat(c2, 0.45, 0.4), sx * (w / 2 - 0.05), (h - gr) / 2, 0); } add(new THREE.BoxGeometry(w - 0.1, h * 0.28, 0.02), mat(c2, 0.5, 0.3), 0, h * 0.62, -dd / 2 + 0.05); }
      else for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.02, alta ? 0.02 : 0.016, h - gr, 10), mat(c2, 0.4, 0.6), sx * (w / 2 - 0.07), (h - gr) / 2, sz * (dd / 2 - 0.07));
      break;
    }
    case 'banco_vestuario': {
      const n = Math.max(3, Math.round(w / 0.1)), lw = w / n;
      for (let i = 0; i < n; i++) add(new THREE.BoxGeometry(lw - 0.012, 0.03, dd), mat(c1, 0.65, 0), -w / 2 + lw * (i + 0.5), h - 0.015, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.035, h - 0.03, 0.035), mat(c2, 0.4, 0.5), sx * (w / 2 - 0.1), (h - 0.03) / 2, sz * (dd / 2 - 0.05));
      add(new THREE.BoxGeometry(w - 0.2, 0.03, 0.03), mat(c2, 0.4, 0.5), 0, h * 0.3, 0); break;
    }
    case 'taquillas': {
      const n = Math.max(2, Math.round(w / 0.3)), cw = w / n, mm = mat(c1, 0.5, 0.3), mh = mat(c2, 0.35, 0.7);
      add(new THREE.BoxGeometry(w, h - 0.12, dd), mm, 0, 0.12 + (h - 0.12) / 2, 0); add(new THREE.BoxGeometry(w, 0.12, dd * 0.9), mat('#1d1d1f', 0.6, 0.2), 0, 0.06, 0);
      for (let i = 0; i < n; i++) { const x = -w / 2 + cw * (i + 0.5); add(new THREE.BoxGeometry(cw - 0.008, h - 0.16, 0.012), mat(i % 2 ? c1.clone().offsetHSL(0, 0, -0.03) : c1, 0.45, 0.35), x, 0.12 + (h - 0.12) / 2, dd / 2 + 0.006); for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(cw * 0.5, 0.008, 0.004), mh, x, h - 0.2 - k * 0.025, dd / 2 + 0.014); add(new THREE.BoxGeometry(0.012, 0.09, 0.014), mh, x + cw * 0.3, h * 0.55, dd / 2 + 0.018); }
      break;
    }
    case 'mostrador_recepcion': {
      add(new RoundedBoxGeometry(w, h * 0.9, dd * 0.55, 3, 0.02), mat(c1, 0.55, 0.08), 0, h * 0.45, dd * 0.22); add(new THREE.BoxGeometry(w + 0.04, 0.045, dd), mat(c2, 0.4, 0.15), 0, h * 0.9 + 0.022, 0);
      add(new THREE.BoxGeometry(w * 0.98, h * 0.62, 0.02), mat(c1.clone().offsetHSL(0, 0, 0.05), 0.4, 0.25), 0, h * 0.46, dd * 0.5 + 0.005);
      add(new THREE.BoxGeometry(w * 0.9, 0.012, 0.012), new THREE.MeshStandardMaterial({ color: '#ffe2b0', emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 2.2 }), 0, 0.03, dd * 0.5 + 0.012); // tira LED al pie del frente
      break;
    }
    case 'estanteria_abierta': {
      const m = mat(c2, 0.4, 0.5), n = 5;
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.03, h, dd), m, sx * (w / 2 - 0.015), h / 2, 0);
      for (let i = 0; i < n; i++) add(new THREE.BoxGeometry(w, 0.03, dd), mat(c1, 0.6, 0.05), 0, 0.04 + (i * (h - 0.08)) / (n - 1), 0);
      add(new THREE.BoxGeometry(w, h, 0.012), mat(c2, 0.5, 0.3), 0, h / 2, -dd / 2 + 0.006); break;
    }
    case 'aparador': {
      add(new RoundedBoxGeometry(w, h - 0.12, dd, 3, 0.012), mat(c1, 0.55, 0.05), 0, 0.12 + (h - 0.12) / 2, 0);
      const n = Math.max(2, Math.round(w / 0.55));
      for (let i = 1; i < n; i++) add(new THREE.BoxGeometry(0.006, h - 0.2, 0.004), mat('#151515', 0.8, 0), -w / 2 + (w * i) / n, 0.12 + (h - 0.12) / 2, dd / 2 + 0.001);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.018, 0.012, 0.12, 8), mat(c2, 0.4, 0.6), sx * (w / 2 - 0.08), 0.06, sz * (dd / 2 - 0.06)); break;
    }
    case 'espejo_pie': case 'espejo_pared': {
      const pie = kind === 'espejo_pie', fr = 0.035, mf = mat(c2, 0.4, 0.6);
      const luna = add(new THREE.BoxGeometry(w - fr * 2, h - fr * 2, 0.008), new THREE.MeshStandardMaterial({ color: '#dfe6ea', roughness: 0.04, metalness: 1, envMapIntensity: 1.6 }), 0, pie ? h / 2 + 0.05 : h / 2, 0.01);
      luna.userData.espejoDeco = true;
      for (const [bw, bh, x, y] of [[w, fr, 0, (pie ? h / 2 + 0.05 : h / 2) + h / 2 - fr / 2], [w, fr, 0, (pie ? h / 2 + 0.05 : h / 2) - h / 2 + fr / 2], [fr, h, -w / 2 + fr / 2, pie ? h / 2 + 0.05 : h / 2], [fr, h, w / 2 - fr / 2, pie ? h / 2 + 0.05 : h / 2]]) add(new THREE.BoxGeometry(bw, bh, 0.03), mf, x, y, 0.005);
      if (pie) for (const sx of [-1, 1]) { const p = add(new THREE.BoxGeometry(0.03, h * 0.5, 0.03), mf, sx * w * 0.38, h * 0.22, -0.12); p.rotation.x = 0.3; }
      break;
    }
    case 'lampara_pie': {
      add(new THREE.CylinderGeometry(0.14, 0.15, 0.015, 24), mat(c2, 0.4, 0.6), 0, 0.008, 0); add(new THREE.CylinderGeometry(0.008, 0.008, h * 0.82, 8), mat(c2, 0.4, 0.7), 0, h * 0.42, 0);
      add(new THREE.CylinderGeometry(r * 0.75, r, h * 0.2, 28, 1, true), new THREE.MeshStandardMaterial({ color: c1, emissive: c1, emissiveIntensity: 0.9, roughness: 0.9, side: THREE.DoubleSide }), 0, h * 0.88, 0); break;
    }
    case 'lampara_colgante': {
      const rr = r * 0.9; add(new THREE.TorusGeometry(rr, 0.018, 10, 48), new THREE.MeshStandardMaterial({ color: c1, emissive: c1, emissiveIntensity: 1.6, roughness: 0.4 }), 0, h * 0.2, 0).rotation.x = Math.PI / 2;
      add(new THREE.TorusGeometry(rr, 0.022, 10, 48), mat(c2, 0.35, 0.7), 0, h * 0.2 + 0.03, 0).rotation.x = Math.PI / 2;
      for (const a of [0, 2.094, 4.188]) add(new THREE.CylinderGeometry(0.003, 0.003, h * 0.8, 4), mat('#1a1a1a', 0.5, 0.5), Math.cos(a) * rr * 0.9, h * 0.6, Math.sin(a) * rr * 0.9); break;
    }
    case 'alfombra': {
      add(new RoundedBoxGeometry(w, Math.max(0.012, h), dd, 2, 0.005), mat(c1, 0.98, 0), 0, Math.max(0.012, h) / 2, 0);
      add(new THREE.BoxGeometry(w * 0.9, Math.max(0.014, h) + 0.001, dd * 0.9), mat(c1.clone().offsetHSL(0, 0, -0.08), 0.98, 0), 0, Math.max(0.014, h) / 2, 0); break;
    }
    case 'panel_lamas': {
      const n = Math.max(6, Math.round(w / 0.06)), lw = w / n;
      add(new THREE.BoxGeometry(w, h, 0.012), mat('#2a2a2c', 0.9, 0), 0, h / 2, 0);
      for (let i = 0; i < n; i++) add(new THREE.BoxGeometry(lw * 0.62, h, dd * 0.8), mat(c1, 0.6, 0), -w / 2 + lw * (i + 0.5), h / 2, dd * 0.4); break;
    }
    case 'tv_mural': {
      add(new THREE.BoxGeometry(w, h, dd), mat('#0c0c0d', 0.3, 0.4), 0, h / 2, 0); add(new THREE.BoxGeometry(w - 0.03, h - 0.03, 0.004), new THREE.MeshStandardMaterial({ color: '#0a0f1a', roughness: 0.08, metalness: 0.6 }), 0, h / 2, dd / 2 + 0.001); break;
    }
    case 'banco': {
      add(new THREE.BoxGeometry(w, h * 0.16, dd), mat(c1, 0.65, 0.05), 0, h * 0.92, 0);
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(w * 0.06, h * 0.84, dd * 0.9), mat(c2.clone().set(hexOk(o.deco?.color2, '#1f1f21')), 0.5, 0.4), sx * w * 0.38, h * 0.42, 0); break;
    }
    case 'columna_luz': {
      add(new THREE.CylinderGeometry(r * 1.3, r * 1.3, h * 0.03, 24), mat(new THREE.Color('#1f1f21'), 0.6, 0.3), 0, h * 0.015, 0);
      const me = add(new THREE.CylinderGeometry(r * 0.7, r * 0.7, h * 0.94, 24), new THREE.MeshStandardMaterial({ color: c1, emissive: new THREE.Color(hexOk(o.deco?.color2, '#ffd9a0')), emissiveIntensity: 1.6, roughness: 0.4 }), 0, h * 0.5, 0); me.castShadow = false; break;
    }
    case 'cuadro': {
      add(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.04), mat(new THREE.Color('#1c1c1e'), 0.5, 0.3), 0, h / 2, 0);
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = Math.max(64, Math.round(256 * h / w)); const cx = cv.getContext('2d'), gr = cx.createLinearGradient(0, 0, cv.width, cv.height);
      gr.addColorStop(0, '#' + c1.getHexString()); gr.addColorStop(1, '#' + c2.getHexString()); cx.fillStyle = gr; cx.fillRect(0, 0, cv.width, cv.height);
      for (let i = 0; i < 5; i++) { cx.fillStyle = 'rgba(255,255,255,' + (0.05 + i * 0.03) + ')'; cx.beginPath(); cx.arc(cv.width * (0.2 + 0.15 * i), cv.height * (0.3 + 0.1 * ((i * 3) % 4)), cv.width * (0.08 + 0.03 * i), 0, 6.283); cx.fill(); }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; const me = add(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }), 0, h / 2, 0.022); me.castShadow = false; break;
    }
    default: {
      if (kind === 'grupo_hablando') {
        const a = figuraHumana(h, POSES.persona_de_pie, c1, new THREE.Color(hexOk(o.deco?.color2, '#2a2a3a')), new THREE.Color('#c9a98c')), b = figuraHumana(h * 0.94, POSES.grupo_hablando, c1.clone().offsetHSL(0.12, 0, 0), new THREE.Color('#2f3a4a'), new THREE.Color('#b88f72'));
        a.position.z = -0.42; b.position.z = 0.42; b.rotation.y = Math.PI; g.add(a, b);
      } else if (POSES[kind]) {
        g.add(figuraHumana(h, POSES[kind], c1, new THREE.Color(hexOk(o.deco?.color2, '#2a2a3a')), new THREE.Color('#c9a98c')));
      }
      break;
    }
  }
  return g;
}
