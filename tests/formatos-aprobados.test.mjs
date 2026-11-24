import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { crearFormatoAprobado, aplicarFormatoAprobado } from '../server/utils/formatos-aprobados.js';
const ejemplo = () => ({ id: '12345678', estado: 'listo', tipo: 'bruto', resultado: 'salidas/video.mp4', receta: { flash: false, subs: { tam: 60 }, whoosh: .065, ilustraciones: false, palabra: 'mancuernero' }, musica: 'auto', musica_usada: 'instrumental.mp3', indicaciones: 'Corta la palabra 9', edicion_texto: { fuera: [9] }, reglas: 'Tono profesional' });
test('la aprobación exige un resultado terminado y reproducible', () => {
  for (const t of [null, { ...ejemplo(), estado: 'error' }, { ...ejemplo(), resultado: null }, { ...ejemplo(), tipo: 'referencia' }, { ...ejemplo(), receta: { ilustracionesFijas: [{ palabra: 'mancuernero' }] } }]) assert.throws(() => crearFormatoAprobado(t, 'Prueba'));
  assert.throws(() => crearFormatoAprobado(ejemplo(), '  '));
});
test('guarda una copia aislada, música real y reglas; no arrastra decisiones del contenido', () => {
  const t = ejemplo(), p = crearFormatoAprobado(t, 'Mi estilo', 'Ideas completas');
  t.receta.subs.tam = 100;
  assert.equal(p.receta.subs.tam, 60); assert.equal(p.musica, 'instrumental.mp3');
  assert.equal(p.reglas, 'Tono profesional\nIdeas completas');
  for (const k of ['indicaciones', 'edicion_texto', 'archivo', 'guion', 'recursos']) assert.equal(p[k], undefined);
  assert.equal(p.receta.palabra, undefined);
});
test('la subida no puede reemplazar el tipo, música ni reglas aprobadas', () => {
  const p = { ...crearFormatoAprobado(ejemplo(), 'Estilo'), id: 'formato' };
  const b = aplicarFormatoAprobado(p, { archivo: 'entradas/nuevo.mp4', tipo: 'voz', musica: 'otra', estilo: 'caotico', indicaciones: 'flashes', edicion_texto: { fuera: [0] } });
  assert.equal(b.tipo, 'bruto'); assert.equal(b.musica, 'instrumental.mp3'); assert.equal(b.archivo, 'entradas/nuevo.mp4'); assert.equal(b.estilo, undefined); assert.equal(b.indicaciones, '');
  const yt = aplicarFormatoAprobado({ ...p, tipo: 'youtube', objetivo_segundos: 600 }, { fuentes: [{ archivo: 'entradas/a.mp4' }] });
  assert.equal(yt.indicaciones, p.reglas); assert.equal(yt.objetivo_segundos, 600);
});
test('la API guarda la aprobación por separado y comunica errores de almacenamiento', async () => {
  const source = fs.readFileSync(new URL('../server/routes/estudio-video.routes.js', import.meta.url), 'utf8');
  const fragment = source.slice(source.indexOf('const idAprobado'), source.indexOf("router.post('/trabajos',"));
  const handlers = {}; let write, status, response, storageError = null;
  vm.runInNewContext(fragment, { router: { get: (p,h) => handlers['GET '+p] = h, post: (p,h) => handlers['POST '+p] = h }, bucket: async () => {}, st: () => ({ upload: async (...args) => { write = args; return { error: storageError }; } }), leerTrabajo: async () => ejemplo(), crearFormatoAprobado, crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' }, Buffer });
  const res = { status: s => { status = s; return res; }, json: r => response = r };
  await handlers['POST /aprobados']({ body: { trabajo_id: '12345678', nombre: 'Formato' }, user: { name: 'Editor' } }, res);
  assert.equal(status, 201); assert.equal(response.formato.por, 'Editor'); assert.equal(write[2].upsert, false); assert.match(write[0], /^aprobados\//);
  storageError = Error('offline'); await handlers['POST /aprobados']({ body: { trabajo_id: '12345678', nombre: 'Formato' } }, res); assert.equal(status, 500);
});
