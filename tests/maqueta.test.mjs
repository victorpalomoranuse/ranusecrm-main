import test from 'node:test';
import assert from 'node:assert/strict';
import { limpiaPines, maquetaDeTour } from '../server/utils/maqueta.js';

test('limpiaPines keeps only points inside the image', () => {
  const r = limpiaPines([{ id: 'a', x: 0.5, y: 0.25 }, { id: 'b', x: 1.2, y: 0.5 }, { id: '', x: 0.1, y: 0.1 }, { id: 'c', x: 'nope', y: 0.2 }, null]);
  assert.deepEqual(r, [{ id: 'a', x: 0.5, y: 0.25 }]);
  assert.deepEqual(limpiaPines('x'), []);
});

test('maquetaDeTour returns only the latest batch, sorted by angle', () => {
  const esc = { renders: [
    { id: 'old', tipo: 'maqueta', url: 'u0', creado: '2026-01-01', meta: { grupo: 'g1', az: 45, pines: [] } },
    { id: 'n2', tipo: 'maqueta', url: 'u2', creado: '2026-02-01T10:00:02', meta: { grupo: 'g2', az: 135, pines: [{ id: 'r1', x: 0.3, y: 0.4 }] } },
    { id: 'n1', tipo: 'maqueta', url: 'u1', creado: '2026-02-01T10:00:01', meta: { grupo: 'g2', az: 45, pines: [] } },
    { id: 'ia', tipo: 'ia', url: 'x', creado: '2026-03-01', meta: {} },
  ] };
  const m = maquetaDeTour(esc);
  assert.deepEqual(m.map(v => v.id), ['n1', 'n2']);
  assert.deepEqual(m[1].pines, [{ id: 'r1', x: 0.3, y: 0.4 }]);
  assert.deepEqual(maquetaDeTour({ renders: [] }), []);
  assert.deepEqual(maquetaDeTour(null), []);
});
