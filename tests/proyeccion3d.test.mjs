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
