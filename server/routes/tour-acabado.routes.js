import express from 'express';
import sharp from 'sharp';
import { stages, pixels, project, assemble, finishPrompt } from '../services/tour-direcciones.js';

const BUCKET='tour-acabado-privado', STALE=20*60*1000;
const running=new Set();
const valid=s=>/^[a-zA-Z0-9_-]{1,90}$/.test(String(s||''));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export default function tourAcabadoRouter({supabase,guardaRenderGaleria,generateImage,projectView,assemblePanorama}) {
  const router=express.Router({mergeParams:true});
  let ready;
  async function bucket(){
    if(!ready)ready=(async()=>{const r=await supabase.storage.getBucket(BUCKET);if(r.error){const c=await supabase.storage.createBucket(BUCKET,{public:false,fileSizeLimit:25000000});if(c.error){const again=await supabase.storage.getBucket(BUCKET);if(again.error)throw c.error;}}})();
    try{await ready;}catch(e){ready=null;throw e;}return supabase.storage.from(BUCKET);
  }
  const prefix=(pid,jid)=>`${pid}/${jid}`;
  async function put(p,b,type='application/json',upsert=true){const {error}=await (await bucket()).upload(p,b,{contentType:type,upsert});if(error)throw error;}
  async function get(p,optional=false){const {data,error}=await (await bucket()).download(p);if(error){if(optional&&(String(error.statusCode)==='404'||/not found/i.test(error.message)))return null;throw error;}return Buffer.from(await data.arrayBuffer());}
  const save=j=>{j.updated=Date.now();return put(`${prefix(j.plano,j.id)}/job.json`,Buffer.from(JSON.stringify(j)));};
  async function load(pid,jid){if(!valid(pid)||!valid(jid))throw fail('Trabajo no válido');const b=await get(`${prefix(pid,jid)}/job.json`,true);if(!b)throw fail('Trabajo no encontrado',404);return JSON.parse(b);}
  async function plan(pid){const {data,error}=await supabase.from('mediciones').select('data').eq('id',pid).maybeSingle();if(error)throw error;if(!data)throw fail('Plano no encontrado',404);return data.data;}
  async function safeReference(r,pid){
    const url=new URL(r.url),origin=new URL(process.env.SUPABASE_URL).origin;
    const start='/storage/v1/object/public/project-documents/renders3d/'+pid+'/';
    if(url.origin!==origin||!url.pathname.startsWith(start))throw fail('Referencia fuera de la galería de este plano');
    const key=decodeURIComponent(url.pathname.slice('/storage/v1/object/public/project-documents/'.length));
    const {data,error}=await supabase.storage.from('project-documents').download(key);if(error)throw error;
    if(data.size>25000000)throw fail('Referencia demasiado grande');
    return sharp(Buffer.from(await data.arrayBuffer()),{limitInputPixels:40000000}).resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:95}).toBuffer();
  }
  async function summary(j){const {base,meta,refs,...safe}=j;safe.done=Object.values(j.parts).filter(p=>p.state==='done').length;safe.total=stages.length;safe.interrupted=j.state==='running'&&!running.has(j.id)&&Date.now()-j.updated>STALE;
    if(j.result){const r=await (await bucket()).createSignedUrl(`${prefix(j.plano,j.id)}/${j.result}`,3600);if(r.error)throw r.error;safe.preview=r.data.signedUrl;}return safe;}
  async function edit(base,refs,name){
    const form=new FormData(),stage=stages.find(s=>s.name===name);
    form.append('model',process.env.OPENAI_IMAGE_MODEL||'gpt-image-2');form.append('quality','high');form.append('size',stage.w+'x'+stage.h);form.append('n','1');form.append('prompt',finishPrompt(name));
    if(/^gpt-image-1/.test(process.env.OPENAI_IMAGE_MODEL||''))form.append('input_fidelity','high');
    for(const [i,b] of [base,...refs].entries())form.append('image[]',new Blob([b],{type:i?'image/jpeg':'image/png'}),i?`ref-${i}.jpg`:'modelo.png');
    const r=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},body:form,signal:AbortSignal.timeout(8*60*1000)});
    const j=await r.json();if(!r.ok||!j.data?.[0]?.b64_json)throw fail('No se pudo terminar la zona. Revisa el servicio de imágenes antes de continuar.',502);
    const out=Buffer.from(j.data[0].b64_json,'base64'),m=await sharp(out).metadata();if(!m.width||Math.abs(m.width/m.height-stage.w/stage.h)>.03)throw fail('La IA devolvió una proporción incorrecta; la zona requiere revisión.',502);return out;
  }
  async function work(j){running.add(j.id);const root=prefix(j.plano,j.id);
    try{
      j.state='running';j.error=null;await save(j);
      const p=await pixels(await get(root+'/base.jpg')),refs=await Promise.all(j.refs.map((_,i)=>get(root+`/ref-${i}.jpg`)));
      for(const stage of stages){const part=j.parts[stage.name];if(part.state==='done')continue;
        // A persisted output survives a restart between upload and status update.
        if(part.file){const cached=await get(root+'/'+part.file,true);if(cached){part.state='done';await save(j);continue;}}
        j.current=stage.name;part.state='preparing';await save(j);
        const input=await (projectView||project)(p,stage);part.file=`${stage.name}-${part.version}.png`;part.state='calling';await save(j);
        const output=await (generateImage||edit)(input,refs,stage.name);
        await put(root+'/'+part.file,output,'image/png');part.state='done';await save(j);
      }
      j.current='montaje';await save(j);
      const buffers={};for(const s of stages)buffers[s.name]=await get(root+'/'+j.parts[s.name].file);
      const output=await (assemblePanorama||assemble)(buffers);j.result=`resultado-${j.attempt}.jpg`;await put(root+'/'+j.result,output,'image/jpeg');
      j.state='review';j.current=null;await save(j);
    }catch(e){j.state='error';j.error=String(e.message||'No se pudo continuar').slice(0,240);try{await save(j);}catch(err){console.error('tour-acabado persistencia',err.message);}}
    finally{running.delete(j.id);}
  }
  async function start(j){
    if(running.size>=2)throw fail('Hay dos puntos en proceso. Espera a que termine uno.',409);
    if(running.has(j.id))throw fail('El punto sigue trabajando.',409);
    running.add(j.id);
    // Unique immutable attempt lock also rejects double clicks across server instances.
    try{await put(`${prefix(j.plano,j.id)}/attempt-${j.attempt}.lock`,Buffer.from('{}'),'application/json',false);
      j.state='running';await save(j);void work(j);
    }catch(e){running.delete(j.id);throw fail('No se pudo iniciar este intento o ya está en curso. Actualiza el estado.',409);}
  }
  const handle=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('tour-acabado',e.message);res.status(e.status||500).json({error:e.status?e.message:'No se pudo completar la operación del tour.'});}};
  router.get('/',handle(async(req,res)=>{await plan(req.params.id);const {data,error}=await (await bucket()).list(req.params.id,{limit:100,sortBy:{column:'name',order:'desc'}});if(error)throw error;const jobs=[];for(const row of data||[]){if(!valid(row.name))continue;const b=await get(`${req.params.id}/${row.name}/job.json`,true);if(b)jobs.push(await summary(JSON.parse(b)));}res.json({jobs:jobs.sort((a,b)=>b.created-a.created)});}));
  router.post('/',handle(async(req,res)=>{
    if(!process.env.OPENAI_API_KEY)throw fail('No está configurado el servicio de imágenes.',503);
    if(req.body?.confirm!==true)throw fail('Confirma las 10 generaciones de este punto.');
    const pid=req.params.id;if(!valid(pid))throw fail('Plano no válido');const d=await plan(pid),ids=req.body.refs;
    const requestId=String(req.body.requestId||'');if(!/^[a-f0-9-]{36}$/.test(requestId))throw fail('Falta el identificador del envío');
    const previous=await get(`${prefix(pid,requestId)}/job.json`,true);if(previous)return res.json(await summary(JSON.parse(previous)));
    if(!Array.isArray(ids)||ids.length<1||ids.length>3||new Set(ids).size!==ids.length)throw fail('Selecciona de una a tres imágenes aprobadas.');
    const refs=ids.map(id=>(d.escena3d?.renders||[]).find(r=>r.id===id&&r.tipo!=='360'));if(refs.some(r=>!r))throw fail('Una referencia ya no está en la galería.');
    const m=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(req.body.imagen||'');if(!m)throw fail('Falta la captura del modelo');const raw=Buffer.from(m[2],'base64');if(raw.length>16000000)throw fail('Captura demasiado grande');
    const im=await sharp(raw,{limitInputPixels:40000000}).metadata();if(im.width!==im.height*2||im.width<2048)throw fail('La captura debe ser un panorama 2:1 de al menos 2048 píxeles.');
    const meta=req.body.meta,c=meta?.camara;if(!c||!['px','py','pz','tx','ty','tz','fov'].every(k=>Number.isFinite(c[k])))throw fail('Falta la cámara del punto');
    if(running.size>=2)throw fail('Espera a que termine un punto antes de crear otro.',409);
    const j={id:requestId,plano:pid,created:Date.now(),updated:Date.now(),name:String(req.body.nombre||'Punto del tour').slice(0,80),meta:{camara:c,shift:0},refs:ids,state:'ready',attempt:1,parts:Object.fromEntries(stages.map(s=>[s.name,{state:'pending',version:1}]))};
    const root=prefix(pid,j.id);
    try{await put(root+'/create.lock',Buffer.from('{}'),'application/json',false);}catch{throw fail('Este envío se está preparando. Espera y actualiza.',409);}
    try{
      await put(root+'/base.jpg',await sharp(raw).jpeg({quality:96,chromaSubsampling:'4:4:4'}).toBuffer(),'image/jpeg');
      for(let i=0;i<refs.length;i++)await put(root+`/ref-${i}.jpg`,await safeReference(refs[i],pid),'image/jpeg');
      await save(j);await start(j);res.status(202).json(await summary(j));
    }catch(e){await (await bucket()).remove([root+'/create.lock']);throw e;}
  }));
  router.get('/:job',handle(async(req,res)=>res.json(await summary(await load(req.params.id,req.params.job)))));
  router.post('/:job/continuar',handle(async(req,res)=>{
    const j=await load(req.params.id,req.params.job);if(req.body?.confirm!==true)throw fail('Confirma que deseas continuar.');
    if(running.has(j.id)||(j.state==='running'&&Date.now()-j.updated<STALE))throw fail('El punto sigue trabajando.',409);
    if(req.body.zona){const part=j.parts[req.body.zona];if(!part||!['review','error'].includes(j.state))throw fail('Zona no válida');part.version++;part.file=null;part.state='pending';j.result=null;j.render=null;}
    else if(!['error','ready','running'].includes(j.state))throw fail('Este punto ya está terminado.');
    j.attempt++;await start(j);res.status(202).json(await summary(j));
  }));
  router.post('/:job/aprobar',handle(async(req,res)=>{
    const j=await load(req.params.id,req.params.job);if(!['review','saved'].includes(j.state)||!j.result)throw fail('El punto todavía no está listo');
    const d=await plan(j.plano),marker=`tour-acabado:${j.id}:${j.result}`;
    const found=(d.escena3d?.renders||[]).find(r=>r.nota===marker);
    if(found){j.render=found;j.state='saved';await save(j);return res.json(await summary(j));}
    // Approval is separate from generation: do not publish an unreviewed image to the client's tour.
    try{await put(`${prefix(j.plano,j.id)}/approve-${j.result}.lock`,Buffer.from('{}'),'application/json',false);}catch{throw fail('La aprobación ya está en curso. Actualiza el estado.',409);}
    try {
      j.render=await guardaRenderGaleria(j.plano,await get(`${prefix(j.plano,j.id)}/${j.result}`),{tipo:'360',nombre:j.name,meta:j.meta,tour:true,nota:marker});j.state='saved';await save(j);res.json(await summary(j));
    } catch(e) {
      // A repeat first checks the gallery marker, including an upload that succeeded before a timeout.
      await (await bucket()).remove([`${prefix(j.plano,j.id)}/approve-${j.result}.lock`]);throw e;
    }
  }));
  return router;
}
