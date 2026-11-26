import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import routerFactory from './tour-acabado.routes.js';
test('jobs retain completed zones, reject bad references, resume, redo one zone and approve idempotently',async()=>{
 process.env.OPENAI_API_KEY='test-not-a-real-key';process.env.SUPABASE_URL='https://test.invalid';
 const files=new Map(),row={escena3d:{renders:[{id:'r1',tipo:'ia',url:'https://test.invalid/storage/v1/object/public/project-documents/renders3d/p1/r1.jpg'}]}};
 const image=await sharp({create:{width:2048,height:1024,channels:3,background:'#706050'}}).jpeg().toBuffer();files.set('renders3d/p1/r1.jpg',image);
 const storage={upload:async(p,b,o)=>{if(!o.upsert&&files.has(p))return{error:{message:'exists',statusCode:409}};files.set(p,Buffer.from(b));return{};},download:async p=>files.has(p)?{data:new Blob([files.get(p)])}:{error:{message:'not found',statusCode:404}},remove:async paths=>{paths.forEach(p=>files.delete(p));return{};},createSignedUrl:async p=>({data:{signedUrl:'https://test.invalid/'+p}}),list:async()=>({data:[...new Set([...files.keys()].filter(p=>p.startsWith('p1/')).map(p=>p.split('/')[1]))].map(name=>({name}))})};
 const supabase={storage:{getBucket:async()=>({data:{}}),from:()=>storage},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{data:row}})})})})};
 let calls=0,saves=0,failOnce=true;
 const app=express();app.use(express.json({limit:'4mb'}));app.use('/medicion/:id/tour-acabado',routerFactory({supabase,guardaRenderGaleria:async(pid,b,opts)=>{saves++;const r={id:'saved',...opts};row.escena3d.renders.push(r);return r;},projectView:async()=>image,assemblePanorama:async b=>{assert.equal(Object.keys(b).length,10);return image;},generateImage:async()=>{calls++;if(calls===3&&failOnce){failOnce=false;throw Error('simulated failure');}return image;}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/medicion/p1/tour-acabado`;
 const req=async(path='',body)=>{const r=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return {status:r.status,data:await r.json()};};
 const until=async(id,state)=>{for(let n=0;n<100;n++){const r=await req('/'+id);if(r.data.state===state)return r.data;await new Promise(r=>setTimeout(r,15));}throw Error('state not reached: '+state);};
 try{
   const payload={requestId:randomUUID(),confirm:true,refs:['r1'],imagen:'data:image/jpeg;base64,'+image.toString('base64'),meta:{camara:{px:0,py:1.6,pz:0,tx:0,ty:1.6,tz:1,fov:75}}};
   assert.equal((await req('',{...payload,refs:['unknown']})).status,400);assert.equal(calls,0);
   assert.equal((await req('',{...payload,confirm:false})).status,400);
   const created=await req('',payload);assert.equal(created.status,202);const id=created.data.id;
   const failed=await until(id,'error');assert.equal(failed.done,2);assert.equal(calls,3);
   await req('',payload);assert.equal(calls,3,'duplicate create must not spend');
   assert.equal((await req('/'+id+'/aprobar',{})).status,400);
   await req('/'+id+'/continuar',{confirm:true});await until(id,'review');assert.equal(calls,11);
   await req('/'+id+'/continuar',{confirm:true,zona:'zona-2'});await until(id,'review');assert.equal(calls,12,'only one new generation');
   await req('/'+id+'/aprobar',{});await req('/'+id+'/aprobar',{});assert.equal(saves,1);
   assert.equal((await req('/'+id+'/continuar',{confirm:true,zona:'zona-1'})).status,400);
   assert.equal((await req()).data.jobs.length,1);
 }finally{await new Promise(r=>server.close(r));}
});
