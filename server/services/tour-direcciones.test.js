import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {sample,project,pixels,stages,assemble} from './tour-direcciones.js';
test('bilinear sampling wraps the longitude seam and clamps poles',()=>{
 const p={w:2,h:1,data:Buffer.from([0,0,0,200,200,200])};
 assert.equal(sample(p,-.5,0,0,true),100);assert.equal(sample(p,1.5,0,0,true),100);assert.equal(sample(p,0,-99,0),0);
});
test('directional projection and spherical assembly preserve cardinal directions',async()=>{
 const W=256,H=128,raw=Buffer.alloc(W*H*3);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const lon=((x+.5)/W-.5)*2*Math.PI,lat=(.5-(y+.5)/H)*Math.PI,i=(y*W+x)*3;raw[i]=Math.round(128+100*Math.sin(lon)*Math.cos(lat));raw[i+1]=Math.round(128+100*Math.sin(lat));raw[i+2]=Math.round(128+100*Math.cos(lon)*Math.cos(lat));}
 const p={w:W,h:H,data:raw},buffers={};
 for(const f of stages)buffers[f.name]=await project(p,{...f,w:f.w/16,h:f.h/16});
 const out=await pixels(await assemble(buffers,256));
 for(const [x,y] of [[128,64],[192,64],[64,64],[2,64],[128,3],[128,124]]){const i=(y*W+x)*3;for(let c=0;c<3;c++)assert.ok(Math.abs(raw[i+c]-out.data[i+c])<15,`${x},${y} channel ${c}`);}
 const meta=await sharp(await assemble(buffers,128)).metadata();assert.equal(meta.width/meta.height,2);
});
