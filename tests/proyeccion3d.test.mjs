import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { camaraDeRender } from '../src/utils/proyeccion3d.js';
import { puntoEnFoto } from '../src/utils/tourFotos.js';

const meta = (shift = 0, fov = 55) => ({ camara: { px: 1, py: 1.6, pz: -2, tx: -1, ty: 1.2, tz: 4, fov }, shift });

test('la cámara del render coincide con la proyección de los saltos del tour (dos implementaciones independientes)', () => {
  for (const shift of [0, 0.08, -0.05]) {
    const m = meta(shift), cam = camaraDeRender(m, 1.8);
    for (const b of [{ px: -1, py: 1.6, pz: 5 }, { px: 3, py: 1.6, pz: 3 }, { px: -4, py: 1.6, pz: 8 }]) {
      const alt = 1.55, p = new THREE.Vector3(b.px, b.py - alt, b.pz).project(cam);
      const r = puntoEnFoto(m.camara, b, 1.8, shift);
      assert.ok(Math.abs((p.x + 1) * 50 - r.x) < 0.2, `x shift=${shift}: ${(p.x + 1) * 50} vs ${r.x}`);
      assert.ok(Math.abs((1 - p.y) * 50 - r.y) < 0.2, `y shift=${shift}: ${(1 - p.y) * 50} vs ${r.y}`);
    }
  }
});

test('sin cámara guardada no hay proyección', () => {
  assert.equal(camaraDeRender({}, 2), null);
  assert.equal(camaraDeRender({ camara: { px: 'x' } }, 2), null);
});

test('una apertura absurda se corrige a la de por defecto', () => {
  assert.equal(camaraDeRender({ camara: { px: 0, py: 1, pz: 0, tx: 0, ty: 1, tz: 1, fov: 400 } }, 2).fov, 50);
});

import { disposicionMosaico, huecoParaCalidad, MAX_REFS } from '../src/utils/proyeccion3d.js';

test('el mosaico reparte los huecos sin solaparse y caben hasta 12 renders', () => {
  for (const n of [1, 3, 4, 7, 12]) {
    const d = disposicionMosaico(n, 1536, 960), cajas = d.huecos.map(h => [h.tile[0], h.tile[1], h.tile[0] + h.tile[2], h.tile[1] + h.tile[3]]);
    assert.equal(d.huecos.length, n);
    assert.ok(d.W <= 8192 && d.H <= 8192, `mosaico demasiado grande: ${d.W}x${d.H}`);
    cajas.forEach(c => { assert.ok(c[0] >= 0 && c[1] >= -1e-9 && c[2] <= 1 + 1e-9 && c[3] <= 1 + 1e-9); });
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = cajas[i], b = cajas[j]; assert.ok(a[2] <= b[0] + 1e-9 || b[2] <= a[0] + 1e-9 || a[3] <= b[1] + 1e-9 || b[3] <= a[1] + 1e-9, `solape ${i}-${j}`);
    }
  }
  assert.equal(MAX_REFS, 12);
});

test('la calidad 8K usa huecos más finos que la normal', () => {
  assert.ok(huecoParaCalidad(4096)[0] > huecoParaCalidad(2048)[0]);
});
