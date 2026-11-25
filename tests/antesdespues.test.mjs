import test from 'node:test';
import assert from 'node:assert/strict';
import { planifica, elegirVentana, pulsosDe, escFuente } from '../video-worker/antesdespues.mjs';
import { creaTrabajoReveal } from '../server/utils/reveal.js';

const rejilla = (bpm, dur, ini = 0.3) => { const p = []; for (let t = ini; t < dur; t += 60 / bpm) p.push(+t.toFixed(3)); return p; };

test('el corte del antes cae en un pulso y los planos siguen la rejilla de la canción', () => {
  const pulsos = rejilla(163, 18.25, 0.313), plan = planifica({ duracion: 18.25, pulsos, nClips: 7 });
  assert.ok(pulsos.some(t => Math.abs(t - plan.revelado) < 0.002), 'el revelado cae en un pulso');
  assert.ok(Math.abs(plan.revelado - 4.7) < 0.4);
  assert.equal(plan.tramos[0].ini, plan.revelado);
  assert.equal(plan.tramos.at(-1).fin, 18.25);
  for (let i = 1; i < plan.tramos.length; i++) assert.equal(plan.tramos[i].ini, plan.tramos[i - 1].fin, 'sin huecos entre planos');
  const primero = plan.tramos[0].fin - plan.tramos[0].ini, segundo = plan.tramos[1].fin - plan.tramos[1].ini;
  assert.ok(primero > segundo * 1.3, 'el primer plano del resultado respira más');
});

test('el cierre empieza a tiempo para que quepa la animación entera', () => {
  const plan = planifica({ duracion: 18.25, pulsos: rejilla(163, 18.25, 0.313), nClips: 3 });
  assert.ok(plan.pastillaInicio + 2.5 <= plan.duracion + 0.06);
  assert.ok(plan.pastillaInicio > plan.revelado);
});

test('reparte los clips en orden y vuelve al primero si faltan clips', () => {
  const plan = planifica({ duracion: 18.25, pulsos: rejilla(163, 18.25, 0.313), nClips: 2 });
  plan.tramos.forEach((t, i) => assert.equal(t.clip, i % 2));
});

test('sin ritmo claro usa una rejilla y no falla; canciones cortas se rechazan', () => {
  const plan = planifica({ duracion: 12, pulsos: [], nClips: 2 });
  assert.ok(plan.tramos.length >= 2);
  assert.throws(() => planifica({ duracion: 5, pulsos: [], nClips: 2 }), /demasiado corta/);
  assert.throws(() => planifica({ duracion: 12, pulsos: [], nClips: 0 }), /al menos un clip/);
});

test('elige la ventana fluida y evita el tirón y las ventanas ya usadas', () => {
  const fps = 30, y = Array.from({ length: 300 }, (_, i) => (i >= 100 && i < 103) ? 60 : 8 + (i % 3)); // tirón en 3,3 s
  const usados = [], a = elegirVentana(y, 2, usados, fps), n = Math.round(2 * fps), s = Math.round(a.ss * fps);
  assert.ok(!(s < 103 && s + n > 100), 'la ventana no contiene el tirón');
  const b = elegirVentana(y, 2, usados, fps);
  assert.notEqual(a.ss, b.ss, 'la segunda ventana no repite la primera');
  assert.ok(Math.abs(b.ss - a.ss) * fps >= n - 1 || b.ss !== a.ss);
  assert.equal(elegirVentana(y.slice(0, 40), 5, [], fps).corto, true, 'un clip corto se marca');
});

test('detecta el pulso de una canción sintética a 100 pulsos por minuto', () => {
  const sr = 22050, x = new Float32Array(sr * 20);
  for (let t = 0.2; t < 19.5; t += 0.6) for (let j = 0; j < 2000; j++) x[Math.round(t * sr) + j] += Math.sin(j * 0.3) * Math.exp(-j / 300);
  const r = pulsosDe(x, sr);
  assert.ok(Math.abs(r.bpm - 100) <= 3 || Math.abs(r.bpm - 50) <= 2 || Math.abs(r.bpm - 200) <= 6, 'bpm=' + r.bpm);
  const d = r.pulsos.slice(1).map((t, i) => t - r.pulsos[i]); assert.ok(d.every(v => Math.abs(v - d[0]) < 0.01), 'pulsos a distancia constante');
});

test('la ruta de la fuente se escapa para el filtro de ffmpeg en Windows', () => {
  assert.equal(escFuente('C:\\a\\b\\Montserrat-Bold.ttf'), 'C\\:/a/b/Montserrat-Bold.ttf');
});

const base = { antes: { archivo: 'entradas/a.mp4', nombre: 'a' }, despues: [{ archivo: 'entradas/b.mp4' }, { base: { id: 'abcdefghij1234', nombre: 'c' } }], cancion: 'entradas/c.mp3' };
test('el trabajo valida fuentes, limpia los textos y fija los valores por defecto', () => {
  const t = creaTrabajoReveal({ ...base, textos: { intro: ' ¿y si sale mal? ', handle: '@victoreldisenador' }, ajustes: { antes_inicio: 17, antes_x: 150 } }, { email: 'a@b.c' });
  assert.equal(t.tipo, 'reveal'); assert.equal(t.estado, 'pendiente'); assert.equal(t.textos.intro, '¿y si sale mal?');
  assert.equal(t.textos.handle, 'victoreldisenador'); assert.equal(t.ajustes.antes_x, 100, 'se acota al rango'); assert.equal(t.ajustes.antes_seg, 4.7);
  assert.equal(t.despues[1].base.id, 'abcdefghij1234'); assert.match(t.id, /^[0-9a-f]{8}$/);
});

test('el trabajo rechaza rutas peligrosas, usuarios raros y entradas incompletas', () => {
  assert.throws(() => creaTrabajoReveal({ ...base, antes: { archivo: 'entradas/../secretos/x.json' } }), /Falta subir el clip de antes/);
  assert.throws(() => creaTrabajoReveal({ ...base, antes: { archivo: 'otro/a.mp4' } }), /clip de antes/);
  assert.throws(() => creaTrabajoReveal({ ...base, despues: [] }), /al menos un clip/);
  assert.throws(() => creaTrabajoReveal({ ...base, despues: Array(21).fill({ archivo: 'entradas/b.mp4' }) }), /20 clips/);
  assert.throws(() => creaTrabajoReveal({ ...base, cancion: undefined }), /canción/);
  assert.throws(() => creaTrabajoReveal({ ...base, textos: { handle: 'a b;<script>' } }), /usuario/);
});
