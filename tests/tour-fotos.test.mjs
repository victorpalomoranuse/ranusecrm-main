import test from 'node:test';
import assert from 'node:assert/strict';
import { puntoEnFoto, enlacesDeFoto } from '../src/utils/tourFotos.js';
import { fotosDeTour } from '../server/utils/tour-fotos.js';

// Cámara en el origen a 1,6 m de altura mirando hacia +Z (apertura vertical 50°, imagen 2:1)
const A = { px: 0, py: 1.6, pz: 0, tx: 0, ty: 1.6, tz: 5, fov: 50 };

test('un destino justo delante cae en el centro horizontal y por debajo del horizonte (el suelo)', () => {
  const r = puntoEnFoto(A, { px: 0, py: 1.6, pz: 6 }, 2);
  assert.ok(Math.abs(r.x - 50) < 0.01, 'x=' + r.x);
  assert.ok(r.y > 50 && r.y < 100, 'y=' + r.y); // el suelo queda debajo del centro
  assert.equal(r.dentro, true); assert.equal(r.dist, 6);
});

test('izquierda y derecha respetan el sentido de la cámara de three.js (mirando a +Z, la derecha es −X)', () => {
  const izq = puntoEnFoto(A, { px: 2, py: 1.6, pz: 6 }, 2), der = puntoEnFoto(A, { px: -2, py: 1.6, pz: 6 }, 2);
  assert.ok(izq.x < 50 && der.x > 50, `izq=${izq.x} der=${der.x}`);
});

test('lo que queda más lejos cae más cerca del horizonte', () => {
  const cerca = puntoEnFoto(A, { px: 0, py: 1.6, pz: 3 }, 2), lejos = puntoEnFoto(A, { px: 0, py: 1.6, pz: 12 }, 2);
  assert.ok(cerca.y > lejos.y);
});

test('un destino detrás de la cámara no tiene punto pero sí lado', () => {
  const r = puntoEnFoto(A, { px: 3, py: 1.6, pz: -4 }, 2);
  assert.equal(r.x, null); assert.equal(r.dentro, false); assert.equal(r.lado, 'izq');
});

test('un destino muy a un lado queda fuera del encuadre, con su lado', () => {
  const r = puntoEnFoto(A, { px: -20, py: 1.6, pz: 3 }, 2);
  assert.equal(r.dentro, false); assert.equal(r.lado, 'der');
});

test('una apertura más cerrada (más zoom) aleja los puntos del centro', () => {
  const b = { px: -1, py: 1.6, pz: 5 }, ancho = puntoEnFoto({ ...A, fov: 70 }, b, 2), cerrado = puntoEnFoto({ ...A, fov: 30 }, b, 2);
  assert.ok(Math.abs(cerrado.x - 50) > Math.abs(ancho.x - 50));
});

test('el desplazamiento vertical de la lente mueve el punto igual que en el visor', () => {
  const b = { px: 0, py: 1.6, pz: 6 }, sin = puntoEnFoto(A, b, 2, 0), con = puntoEnFoto(A, b, 2, 0.1);
  assert.ok(Math.abs((con.y - sin.y) - 10) < 0.01, 'sube/baja ' + (con.y - sin.y)); // 2·shift en NDC = 10 puntos de alto
});

test('con cámara mirando en vertical no se rompe', () => {
  const r = puntoEnFoto({ ...A, tx: 0, ty: 10, tz: 0 }, { px: 0, py: 1.6, pz: 2 }, 2);
  assert.ok(r === null || typeof r.dist === 'number');
});

test('los saltos de una foto salen ordenados por cercanía y sin ella misma', () => {
  const f = (id, px, pz) => ({ id, cam: { px, py: 1.6, pz, tx: px, ty: 1.6, tz: pz + 5, fov: 50 }, shift: 0 });
  const fotos = [f('a', 0, 0), f('b', 0, 8), f('c', 0, 3), f('d', 1, -5)];
  const e = enlacesDeFoto(fotos, 0, 2);
  assert.deepEqual(e.map(x => x.i), [2, 3, 1]);
  assert.equal(e.find(x => x.i === 3).dentro, false); // la de atrás queda fuera del encuadre
});

test('fotosDeTour usa solo renders publicados con cámara y deja fuera los 360', () => {
  const cam = { px: 1, py: 1.6, pz: 2, tx: 1, ty: 1.6, tz: 5, fov: 60 };
  const esc = { renders: [
    { id: 'r1', tipo: 'ia', nombre: 'Cardio', url: 'u1', thumb: 't1', creado: '2026-11-25T13:13', publicado: { en: 'x' }, meta: { camara: cam, shift: 0.05 } },
    { id: 'r2', tipo: 'ia', nombre: 'Sin publicar', url: 'u2', creado: '2026-11-25T13:14', meta: { camara: cam } },
    { id: 'r3', tipo: '360', nombre: 'Pano', url: 'u3', publicado: {}, meta: { camara: cam } },
    { id: 'r4', tipo: 'hd', nombre: 'Sin cámara', url: 'u4', publicado: {}, meta: {} },
    { id: 'r5', tipo: 'hd', nombre: 'Sauna', url: 'u5', creado: '2026-11-25T13:01', publicado: {}, meta: { camara: { px: 4, pz: 9 } } },
  ] };
  const fotos = fotosDeTour(esc);
  assert.deepEqual(fotos.map(f => f.id), ['r5', 'r1']); // por fecha de creación
  assert.equal(fotos[1].shift, 0.05); assert.equal(fotos[0].cam.fov, 50); assert.equal(fotos[0].cam.tz, 10);
  assert.deepEqual(fotosDeTour(null), []);
});
