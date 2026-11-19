import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { aceptaClip, efectosPermitidos, admiteDestello, geometriaSuperposicion } from '../video-worker/editor-policy.mjs';
import { juzgaClips, tramosReparados } from '../video-worker/entrevista.mjs';

test('rechaza clips incompletos, no revisados o rechazados aunque tengan score alto', () => {
  const juicio = { veredicto: 'publicar', entiendeSolo: true, incompleto: false, mezcla: false, nota: 80 };
  assert.equal(aceptaClip({ juicio }), true);
  for (const cambio of [{veredicto:'descartar'}, {veredicto:'arreglar'}, {incompleto:true}, {entiendeSolo:false}, {mezcla:true}, {nota:null}, {nota:0}]) assert.equal(aceptaClip({ score: 99, juicio: {...juicio,...cambio} }), false);
  assert.equal(aceptaClip({score:99}), false);
});
test('el estilo sobrio bloquea efectos agresivos y los destellos comparten límite', () => {
  assert.equal(efectosPermitidos({}).includes('glitch'), false);
  for (const flash of ['flash','flashColor','impacto']) {
    assert.equal(efectosPermitidos({flash:false}).includes(flash), false);
    assert.equal(efectosPermitidos({flash:true}).includes(flash), true);
    assert.equal(admiteDestello(flash, 9.99, 0), false);
    assert.equal(admiteDestello(flash, 10, 0), true);
  }
  assert.equal(admiteDestello('zoom', 1, 0), true);
});
test('la ventana cabe en vertical y mantiene la relación de aspecto', () => {
  const g = geometriaSuperposicion('ventana');
  assert.match(g.escala,/force_original_aspect_ratio=decrease/);
  assert.equal(g.y,'H-h-350');
  assert.match(geometriaSuperposicion('completa').escala,/crop=1080:1920/);
});
test('migración existente añade estilos, apaga flashes y no borra personalizaciones', async () => {
  const source = fs.readFileSync(new URL('../server/routes/estudio-video.routes.js',import.meta.url),'utf8');
  const code = source.slice(source.indexOf('export const FORMATO_BASE'),source.indexOf('const guardarFormatos')).replaceAll('export const','const');
  const formats = { lista:[{id:'propio', receta:{flash:true,fuente:'Rubik'}}], sembrados:[], migracion:2,musicaV2:true,diaV3:true,motionV1:true,diaV4:true,diaV5:true,sinFlashV1:true,directorV1:true,clipsV3:true,clipsV2:true,autoV1:true };
  const data = new Map([['formatos',formats],['crm/estudio-video/estilos.json',{lista:[{id:'personalizado',receta:{flash:true,subs:{tam:61}}}]}]]);
  const ctx = vm.createContext({RUTA_FORMATOS:'formatos',leerJson:async(k,f)=>structuredClone(data.get(k)??f),guardarJson:async(k,v)=>{data.set(k,structuredClone(v));}});
  vm.runInContext(code,ctx);
  const estilos = await vm.runInContext('estilos()',ctx);
  assert.equal(estilos.length,4);
  assert.equal(estilos.find(x=>x.id==='personalizado').receta.subs.tam,61);
  assert.ok(estilos.every(x=>x.receta.flash===false));
  assert.equal(data.get('formatos').lista.find(x=>x.id==='propio').receta.fuente,'Rubik');
  const saved=data.get('crm/estudio-video/estilos.json'); saved.lista[0].receta.flash=true;
  await vm.runInContext('estilos()',ctx);
  assert.equal(data.get('crm/estudio-video/estilos.json').lista[0].receta.flash,true,'no sobrescribe una elección explícita posterior');
});
test('la corrección del clip se vuelve a juzgar y un fallo no se aprueba', async () => {
  const original=globalThis.fetch; let calls=0; const prompts=[];
  globalThis.fetch=async(url,opts)=>{calls++;prompts.push(JSON.parse(opts.body).messages[0].content); const verdict=calls===1 ? {nota:40,se_entiende_solo:false,veredicto:'arreglar',quitar_tramos:[2]} : {nota:80,se_entiende_solo:true,veredicto:'publicar',incompleto:false,mezcla_de_voces:false}; return {ok:true,json:async()=>({content:[{text:JSON.stringify(verdict)}]})};};
  try {
    const clips=[{titulo:'Caso',tramos:[[0,1],[2,3]]}];
    await juzgaClips(clips,[{t:'Contexto.',de:0,a:1},{t:'Repetición.',de:2,a:3}]);
    assert.equal(calls,2); assert.equal(clips[0].tramos.length,1); assert.equal(aceptaClip(clips[0]),true);
    assert.match(prompts[0],/CONTEXTO ORIGINAL/);
    globalThis.fetch=async()=>{throw Error('sin red');};
    await juzgaClips(clips,[]); assert.equal(aceptaClip(clips[0]),false);
  } finally {globalThis.fetch=original;}
});

// Integration test: actual FFmpeg pixels verify transparency, placement and timing.
test('repara el final cortado con palabras originales y vuelve a revisar', async () => {
 const original=globalThis.fetch;let calls=0;
 const palabras=[{t:'Todas',de:0,a:1},{t:'tus',de:1,a:2},{t:'mancuernas',de:2,a:3},{t:'colocadas.',de:3,a:4}];
 globalThis.fetch=async()=>{calls++;const r=calls===1?{nota:58,se_entiende_solo:false,incompleto:true,veredicto:'arreglar',problemas:['Falta el final']} : calls===2?{rangos:[[0,3]],titulo:'Orden en casa'}:{nota:78,se_entiende_solo:true,incompleto:false,mezcla_de_voces:false,veredicto:'publicar'};return {ok:true,json:async()=>({content:[{text:JSON.stringify(r)}]})};};
 try{const clips=[{titulo:'Caso',tramos:[[0,2]]}];await juzgaClips(clips,palabras);assert.equal(calls,3);assert.deepEqual(clips[0].tramos,[[0,4]]);assert.equal(aceptaClip(clips[0]),true);assert.equal(clips[0].fin,4);}finally{globalThis.fetch=original;}
 assert.throws(()=>tramosReparados([[0,4]],palabras,[[0,2]]));
 assert.throws(()=>tramosReparados([[0,2],[2,3]],palabras,[[0,2]]));
 assert.throws(()=>tramosReparados([[0,0]],[{t:'Ajeno',de:50,a:51}],[[0,2]]));
});

test('FFmpeg mantiene el fondo y muestra el recurso solo en su intervalo', {skip: !process.env.EDITOR_TEST_FFMPEG}, async () => {
  const {spawnSync}=await import('node:child_process');
  const {filtrosSuperposicion}=await import('../video-worker/editor-policy.mjs');
  const exe=process.env.EDITOR_TEST_FFMPEG;
  const graph=filtrosSuperposicion({index:1,prev:'0:v',k:0,a:0.5,d:1,modo:'ventana'}).join(';');
  const r=spawnSync(exe,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=1080x1920:r=30:d=2','-f','lavfi','-i','color=c=red:s=400x400:r=30:d=2', '-filter_complex',graph,'-map','[oi0]','-t','2','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{maxBuffer:400*1024*1024});
  assert.equal(r.status,0,r.stderr.toString());
  const pixel=(frame,x,y)=>Array.from(r.stdout.subarray((frame*1080*1920+y*1080+x)*3,(frame*1080*1920+y*1080+x)*3+3));
  assert.ok(pixel(30,540,1350)[0]>200,'recurso visible abajo');
  assert.ok(pixel(30,540,500)[2]>200,'presentador/fondo superior intacto');
  assert.ok(pixel(0,540,1350)[2]>200,'no aparece antes de tiempo');
  assert.ok(pixel(55,540,1350)[2]>200,'desaparece al terminar');
});
