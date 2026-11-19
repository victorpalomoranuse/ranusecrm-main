import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validaPlanYoutube } from '../video-worker/youtube-policy.mjs';
import { planificaYoutube, renderYoutube } from '../video-worker/youtube.mjs';
const fuentes = [{id:'f0', dur:1300, nombre:'Entrevista', palabras:[{t:'Inicio',de:1,a:2},{t:'Final',de:1250,a:1251}]}, {id:'f1',dur:100,nombre:'Conclusión',palabras:[{t:'Cierre',de:1,a:2}]}];
const plan = {titulo:'Historia',segmentos:[{fuente:'f0',de:0,a:60,capitulo:'Inicio'},{fuente:'f1',de:0,a:60,capitulo:'Cierre'}]};
test('rechaza fuentes inventadas, tramos repetidos y tiempos imposibles',()=>{
 assert.equal(validaPlanYoutube(plan,fuentes).duracion,120);
 for(const seg of [{fuente:'inventada',de:0,a:60},{fuente:'f1',de:-1,a:60},{fuente:'f1',de:0,a:101},{fuente:'f1',de:0,a:NaN},plan.segmentos[0]]) assert.throws(()=>validaPlanYoutube({...plan,segmentos:[plan.segmentos[0],seg]},fuentes));
});
test('lee todas las fuentes hasta el final y exige revisión editorial positiva',async()=>{
 let calls=[];
 const modelo=async prompt=>{calls.push(prompt);if(prompt.startsWith('Eres editor')) return {pasajes:[{de:0,a:60}]};if(prompt.startsWith('Construye'))return plan;return {aprobado:true,motivo:'Completo'};};
 const resultado=await planificaYoutube(fuentes,{objetivo:600,tema:'Diseño'},modelo);
 assert.equal(resultado.segmentos[1].inicio,60);assert.equal(calls.filter(p=>p.startsWith('Eres editor')).length,4);assert.ok(calls.some(p=>p.includes('[1250.00-1251.00] Final')));
 await assert.rejects(planificaYoutube(fuentes,{objetivo:600},async p=>p.startsWith('Revisa')?{aprobado:false,motivo:'Falta contexto'}:modelo(p)),/coherencia/);
 await assert.rejects(planificaYoutube(fuentes,{objetivo:600},async p=>p.startsWith('Construye')?{...plan,segmentos:[{fuente:'f0',de:10,a:100}]}:modelo(p)),/pasajes analizados/);
});
test('la lista de trabajos firma los vídeos largos y rehacer borra el resultado anterior',async()=>{
 const source=fs.readFileSync(new URL('../server/routes/estudio-video.routes.js',import.meta.url),'utf8');
 const lista=source.slice(source.indexOf("router.get('/trabajos',"),source.indexOf('// Catálogo de efectos'));
 let handler, respuesta;
 const trabajo={id:'abcdef12',tipo:'youtube',estado:'listo',resultado_gcs:'youtube/abcdef12.mp4'};
 vm.runInNewContext(lista,{router:{get:(_p,h)=>handler=h},bucket:async()=>{},st:()=>({list:async()=>({data:[{name:'abcdef12.json'}]})}),leerTrabajo:async()=>({...trabajo}),drive:{enlaceResultadoGcs:async(p,d)=>'https://example.test/'+p+(d?'?download':'')}});
 await handler({}, {json:r=>respuesta=r,status:()=>{throw Error('Error de lista');}});
 assert.equal(respuesta.trabajos[0].url,'https://example.test/youtube/abcdef12.mp4');
 assert.match(respuesta.trabajos[0].url_descarga,/download/);
 const rehacer=source.slice(source.indexOf("router.post('/trabajos/:id/rehacer'"),source.indexOf('// Postproducción a mano'));
 assert.match(rehacer,/resultado_gcs: null/);
});
test('crea un solo trabajo con varias fuentes y rechaza rutas inválidas',async()=>{
 const source=fs.readFileSync(new URL('../server/routes/estudio-video.routes.js',import.meta.url),'utf8');
 const route=source.slice(source.indexOf("router.post('/trabajos',"),source.indexOf("router.get('/trabajos',"));
 let handler, saved=[];
 vm.runInNewContext(route,{router:{post:(_p,h)=>handler=h},bucket:async()=>{},formatos:async()=>[],recetaFinal:async fmt=>({receta:fmt.receta}),crypto,textoReglasCompleto:async()=>'',limpia:(s,n)=>String(s||'').slice(0,n),nubeActiva:async()=>true,lanzarNube:async()=>true,guardarTrabajo:async t=>saved.push(t)});
 const send=async body=>{let status=200,result;await handler({body},{status:s=>{status=s;return {json:r=>result=r};},json:r=>result=r});return {status,result};};
 const body={tipo:'youtube',fuentes:[{archivo:'entradas/one.mp4',nombre:'Uno'},{base:{id:'1234567890abc'},nombre:'Dos'}],objetivo_segundos:600};
 assert.equal((await send(body)).status,201);assert.equal(saved.length,1);assert.equal(saved[0].fuentes.length,2);assert.equal(saved[0].formato,'youtube');
 for(const fuentes of [[],Array(9).fill(body.fuentes[0]),[{archivo:'secretos/drive.json'}],[{archivo:'entradas/../secretos'}]]) assert.equal((await send({...body,fuentes})).status,400);
});
test('firma privada V2 válida para reproducción y descarga',async()=>{
 const source=fs.readFileSync(new URL('../server/utils/drive-lectura.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('export async function enlaceResultadoGcs'),source.indexOf('export async function borraResultadoGcs')).replace('export async function','async function');
 const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 const context=vm.createContext({crypto,URLSearchParams,clave:async()=>({client_email:'test@example.com',private_key:privateKey})});
 vm.runInContext(fn,context);
 for(const download of [false,true]){
 const url=new URL(await context.enlaceResultadoGcs('youtube/abcdef12.mp4',download));
 const message='GET\n\n\n'+url.searchParams.get('Expires')+'\n'+url.pathname;
 assert.ok(crypto.verify('RSA-SHA256',Buffer.from(message),publicKey,Buffer.from(url.searchParams.get('Signature'),'base64')));
 assert.equal(url.searchParams.has('response-content-disposition'),download);
 }
 await assert.rejects(context.enlaceResultadoGcs('secretos/drive.json'));
});
test('FFmpeg une fuentes vertical y horizontal con audio en 1080p', {skip:!process.env.EDITOR_TEST_FFMPEG}, async()=>{
 const ff=process.env.EDITOR_TEST_FFMPEG, dir=fs.mkdtempSync(path.join(os.tmpdir(),'youtube-test-'));process.env.YOUTUBE_FFMPEG=ff;
 const run=args=>{const r=spawnSync(ff,['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8',maxBuffer:4e6});assert.equal(r.status,0,r.stderr);return r;};
 try {
 for(const [i,size,color] of [[0,'320x180','red'],[1,'180x320','blue']])run(['-f','lavfi','-i',`color=${color}:s=${size}:r=30:d=3`,'-f','lavfi','-i',`sine=frequency=${440+i*220}:duration=3`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',path.join(dir,`source${i}.mp4`)]);
 const salida=await renderYoutube({segmentos:[{fuente:'f0',de:0,a:3},{fuente:'f1',de:0,a:3}]},[0,1].map(i=>({id:'f'+i,archivo:path.join(dir,`source${i}.mp4`)})),dir);
 const metadata=spawnSync(ff,['-i',salida],{encoding:'utf8'}).stderr;
 assert.match(metadata,/1920x1080/);assert.match(metadata,/Audio: aac/);assert.match(metadata,/Duration: 00:00:06/);
 for(const [sec,channel] of [[1,0],[4,2]]){
 const pixel=spawnSync(ff,['-v','error','-ss',String(sec),'-i',salida,'-frames:v','1','-vf','crop=2:2:960:540,scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{maxBuffer:10000});
 assert.equal(pixel.status,0);assert.ok(pixel.stdout[channel]>200);assert.ok(pixel.stdout[(channel+1)%3]<30);
 }
 } finally {delete process.env.YOUTUBE_FFMPEG;fs.rmSync(dir,{recursive:true,force:true});}
});
