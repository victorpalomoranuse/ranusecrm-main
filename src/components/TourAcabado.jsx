import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

function Preview({url,version}){
  const host=useRef(null);
  useEffect(()=>{const el=host.current,scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(70,1,.1,10),renderer=new THREE.WebGLRenderer({antialias:true});let disposed=false,texture,down=false,lastX=0,lastY=0,yaw=0,pitch=0;
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;el.appendChild(renderer.domElement);
    const geometry=new THREE.SphereGeometry(2,64,32),material=new THREE.MeshBasicMaterial({side:THREE.BackSide}),sphere=new THREE.Mesh(geometry,material);sphere.scale.x=-1;scene.add(sphere);
    const draw=()=>{camera.lookAt(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));renderer.render(scene,camera);};
    new THREE.TextureLoader().load(url,t=>{if(disposed){t.dispose();return;}texture=t;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=renderer.capabilities.getMaxAnisotropy();material.map=t;material.needsUpdate=true;draw();});
    const resize=new ResizeObserver(()=>{renderer.setSize(el.clientWidth,el.clientHeight);camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();draw();});resize.observe(el);
    const start=e=>{down=true;lastX=e.clientX;lastY=e.clientY;el.setPointerCapture(e.pointerId);};
    const move=e=>{if(!down)return;yaw-=(e.clientX-lastX)*.004;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.clientY-lastY)*.004));lastX=e.clientX;lastY=e.clientY;draw();};const end=()=>{down=false;};
    el.addEventListener('pointerdown',start);el.addEventListener('pointermove',move);el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
    return()=>{disposed=true;resize.disconnect();el.removeEventListener('pointerdown',start);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',end);el.removeEventListener('pointercancel',end);texture?.dispose();geometry.dispose();material.dispose();renderer.dispose();renderer.domElement.remove();};
  },[version]);
  return <div ref={host} style={{height:330,width:'100%',touchAction:'none',background:'#111',borderRadius:8,overflow:'hidden'}} aria-label="Vista previa del punto: arrastra para girar"/>;
}

export default function TourAcabado({id,api,renders,capture,onClose,onSaved,onOpenTour}){
  const [refs,setRefs]=useState([]),[jobs,setJobs]=useState([]),[name,setName]=useState('Punto del tour'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(null),[zone,setZone]=useState('zona-1');
  const active=useRef(true),requestId=useRef(crypto.randomUUID()),endpoint='/medicion/'+id+'/tour-acabado';
  const refresh=async()=>{const {data}=await api.get(endpoint);if(active.current)setJobs(data.jobs);};
  useEffect(()=>{active.current=true;let timer;const poll=async()=>{try{await refresh();}catch(e){if(active.current)setError(e.response?.data?.error||'No se puede consultar el tour.');}finally{if(active.current)timer=setTimeout(poll,5000);}};poll();return()=>{active.current=false;clearTimeout(timer);};},[id]);
  const run=async fn=>{if(busy)return;setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(e.response?.data?.error||e.message||'No se pudo completar la operación');}finally{setBusy(false);}};
  const create=()=>run(async()=>{
    if(!window.confirm('Este punto requiere hasta 10 generaciones de IA (6 direcciones y 4 vistas amplias), con coste en la API configurada. No se publicará hasta que lo revises. ¿Generar este punto?'))return;
    const input=await capture();const {data}=await api.post(endpoint,{...input,refs,nombre:name,confirm:true,requestId:requestId.current},{timeout:180000});setSelected(data.id);requestId.current=crypto.randomUUID();
  });
  const continueJob=(job,zona)=>run(async()=>{if(!window.confirm(zona?'Se regenerará solo esta zona con una nueva llamada de IA. ¿Continuar?':'Se conservarán las zonas guardadas. Si una llamada se interrumpió, puede haberse cobrado sin guardar resultado y repetirla tiene coste. ¿Continuar con las pendientes?'))return;await api.post(endpoint+'/'+job.id+'/continuar',{confirm:true,...(zona?{zona}:{})});});
  const approve=job=>run(async()=>{const {data}=await api.post(endpoint+'/'+job.id+'/aprobar');if(data.render)onSaved(data.render);});
  const btn={background:'#e5d8c0',color:'#211e19',border:0,borderRadius:7,padding:'9px 12px',cursor:'pointer'},j=jobs.find(x=>x.id===selected),gal=renders.filter(r=>r.tipo!=='360'&&r.tipo!=='maqueta');
  return <section role="dialog" aria-label="Crear tour con imágenes aprobadas" style={{position:'absolute',right:12,top:54,bottom:12,width:'min(560px, calc(100vw - 24px))',overflowY:'auto',padding:18,boxSizing:'border-box',background:'#24211e',color:'#fff',borderRadius:12,zIndex:30,fontSize:13,boxShadow:'0 8px 30px #0008'}}>
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h2 style={{fontSize:18}}>5 · Crear tour</h2><button style={btn} onClick={onClose}>Cerrar</button></header>
    <p>Coloca la cámara donde quieras que mire el cliente. Elige hasta tres imágenes aprobadas para el acabado de este punto.</p>
    <p>Una vez enviado, el servidor continúa aunque cierres el modelador. Vuelve aquí para revisar el resultado o continuar un trabajo interrumpido.</p>
    <label>Nombre del punto<input value={name} maxLength={80} onChange={e=>setName(e.target.value)} style={{display:'block',width:'100%',boxSizing:'border-box',margin:'6px 0 12px',padding:9}}/></label>
    {!gal.length&&<p>Primero exporta Full HD y edita tus imágenes en Postproducción IA.</p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>{gal.map(r=><button key={r.id} aria-pressed={refs.includes(r.id)} onClick={()=>setRefs(old=>old.includes(r.id)?old.filter(x=>x!==r.id):old.length<3?[...old,r.id]:old)} style={{padding:3,background:refs.includes(r.id)?'#d1b78e':'#39342f',border:0,borderRadius:6,color:refs.includes(r.id)?'#111':'#fff',cursor:'pointer'}}><img src={r.thumb||r.url} alt="" style={{width:'100%',height:65,objectFit:'cover'}}/><span>{r.nombre}</span></button>)}</div>
    <p>{refs.length}/3 imágenes seleccionadas · 10 generaciones por punto. El importe depende de la API configurada.</p>
    <button style={btn} disabled={busy||!refs.length||!name.trim()} onClick={create}>{busy?'Preparando…':'Generar punto desde esta cámara'}</button>
    {error&&<p role="alert" style={{color:'#ffb5a5'}}>{error}</p>}
    <h3>Puntos del tour</h3>
    {jobs.map(job=><button key={job.id} style={{...btn,display:'block',width:'100%',marginBottom:6,textAlign:'left',background:job.id===selected?'#d1b78e':'#403a34',color:job.id===selected?'#111':'#fff'}} onClick={()=>setSelected(job.id)}>{job.name} · {job.state==='saved'?'En el tour':job.state==='review'?'Listo para revisar':job.interrupted?'Interrumpido':job.state==='error'?'Requiere atención':`${job.done}/${job.total} zonas`}</button>)}
    {j&&<div>
      {j.error&&<p role="alert">{j.error}</p>}
      {j.state==='running'&&!j.interrupted&&<p role="status">Generando {j.current||'punto'}… {j.done}/{j.total}. Las zonas terminadas se conservan.</p>}
      {(j.state==='error'||j.state==='ready'||j.interrupted)&&<button style={btn} disabled={busy} onClick={()=>continueJob(j)}>Continuar pendientes</button>}
      {j.preview&&<><Preview url={j.preview} version={j.id+j.result}/><p>Arrastra para girar. Revisa máquinas, espejos, luces y uniones. Salida 4096 × 2048; no es detalle nativo 8K.</p></>}
      {j.state==='review'&&<><button style={btn} disabled={busy} onClick={()=>approve(j)}>Aprobar y añadir al tour</button><details style={{marginTop:14}}><summary>Corregir una zona</summary><select value={zone} onChange={e=>setZone(e.target.value)}>{['zona-1','zona-2','zona-3','zona-4','frente','derecha','atras','izquierda','techo','suelo'].map(z=><option key={z}>{z}</option>)}</select><button style={btn} disabled={busy} onClick={()=>continueJob(j,zone)}>Rehacer solo esta zona</button><p>Las cuatro zonas amplias rodean el punto en orden. Corregir tiene coste de una generación.</p></details></>}
      {j.state==='saved'&&<button style={btn} onClick={onOpenTour}>Copiar enlace del tour</button>}
    </div>}
  </section>;
}
