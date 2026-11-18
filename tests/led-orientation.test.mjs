import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizarGiroLed} from '../src/components/ledEmpotrado3d.js';
const source=fs.readFileSync(new URL('../server/routes/medicion.routes.js',import.meta.url),'utf8');
const start=source.indexOf('    const num =',source.indexOf("router.put('/:id/escena3d'"));
const end=source.indexOf('    const mapa =',start);
assert(start>=0&&end>start);
const save=new Function('objs',source.match(/const TIPOS_OBJ3D = .*;/)[0]+'\n'+source.slice(start,end)+'\nreturn JSON.parse(JSON.stringify(limpios));');
const equivalent=(a,b)=>{for(const fn of [Math.sin,Math.cos])assert(Math.abs(fn(a*Math.PI/180)-fn(b*Math.PI/180))<1e-10);};
for(const angle of [0,90,-90,180,270,-270,450,-450,720,1080,275.25])test('LED save/reload preserves '+angle+' degrees',()=>{
 const original={id:'orientation-test',tipo:'led',inclinacionX:angle,inclinacionZ:angle,rot:37,pts:[[-50,0],[50,0]],led:{empotrado:true,superficie:'m:test',lm:800}};
 const once=save([original])[0],twice=save([once])[0];
 for(const field of ['inclinacionX','inclinacionZ']){equivalent(angle,once[field]);assert.equal(once[field],twice[field]);equivalent(angle,normalizarGiroLed(angle));assert.equal(normalizarGiroLed(angle),once[field]);}
 assert.equal(twice.led.superficie,'m:test');assert.equal(twice.rot,37);
});
test('270 degrees stays vertical instead of being clamped to horizontal',()=>assert.equal(save([{id:'led',tipo:'led',inclinacionZ:270}])[0].inclinacionZ,-90));
test('missing or invalid angles have safe defaults',()=>{for(const angle of [undefined,NaN,Infinity,'bad'])assert.equal(normalizarGiroLed(angle),0);});
