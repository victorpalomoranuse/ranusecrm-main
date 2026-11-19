import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { corrigeVocabulario, espaciaSonidos } from '../video-worker/vocabulario.mjs';
import { transcribe } from '../video-worker/transcribir.mjs';
test('corrige errores confirmados sin modificar palabras correctas',()=>{
 assert.equal(corrigeVocabulario('¿McGuerna ajustable o McGuernero?'),'¿mancuerna ajustable o mancuernero?');
 assert.equal(corrigeVocabulario('mancuernas, mancuernero, McDonald'),'mancuernas, mancuernero, McDonald');
});
test('normaliza una transcripción reutilizada sin alterar tiempos ni hablantes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vocabulario-')),base=path.join(dir,'palabras');
 const w={text:' McGuernero?',offsets:{from:2340,to:2920},spk:1};
 try{fs.writeFileSync(base+'.json',JSON.stringify({transcription:[w]}));assert.equal(await transcribe('',base),'cache');const out=JSON.parse(fs.readFileSync(base+'.json')).transcription[0];assert.deepEqual(out,{...w,text:' mancuernero?'});}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('los sonidos quedan separados al menos cinco segundos',()=>{
 assert.deepEqual(espaciaSonidos([{s:'pop',t:8},{s:'whoosh',t:1},{s:'pop',t:2},{s:'pop',t:9}]).map(x=>x.t),[1,8]);
});
