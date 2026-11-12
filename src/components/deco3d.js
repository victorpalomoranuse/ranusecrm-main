// Piezas de decoración «libres»: plantas, esculturas, bancos, cuadros y columnas de luz que se construyen aquí mismo, sin depender de la biblioteca 3D.
// La IA las puede proponer aunque en la biblioteca no haya nada parecido.
import * as THREE from 'three';

const CM = 0.01;
export const KINDS_DECO = {
  planta: 'Planta grande en maceta', planta_alta: 'Planta alta o palmera', arbusto: 'Jardinera con arbusto',
  escultura_esfera: 'Escultura de esferas apiladas', escultura_arco: 'Escultura en arco', escultura_monolito: 'Monolito escultórico',
  banco: 'Banco', columna_luz: 'Columna de luz', cuadro: 'Cuadro grande',
};
// Medidas habituales (cm) para cuando la IA no las da
export const MEDIDAS_DECO = {
  planta: [55, 55, 150], planta_alta: [60, 60, 230], arbusto: [90, 45, 110], escultura_esfera: [50, 50, 140], escultura_arco: [110, 30, 160],
  escultura_monolito: [40, 40, 190], banco: [150, 45, 45], columna_luz: [25, 25, 220], cuadro: [140, 4, 100],
};
const hexOk = (v, d) => (/^#[0-9a-fA-F]{6}/.test(v || '') ? String(v).slice(0, 7) : d);

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
    default: break;
  }
  return g;
}
