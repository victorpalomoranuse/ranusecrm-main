import sharp from 'sharp';

// Fixed cameras: the panorama and every generated view share one optical centre.
const view = (name, lon) => { const a=lon*Math.PI/180; return {name,C:[Math.sin(a),0,Math.cos(a)],U:[Math.cos(a),0,-Math.sin(a)],V:[0,-1,0]}; };
export const directions = [0,90,180,270].map((a,i)=>({...view('zona-'+(i+1),a),tx:Math.tan(Math.PI/3),w:1536,h:1024}));
export const faces = [view('frente',0),view('derecha',90),view('atras',180),view('izquierda',270),{name:'techo',C:[0,1,0],U:[1,0,0],V:[0,0,1]},{name:'suelo',C:[0,-1,0],U:[1,0,0],V:[0,0,-1]}].map(f=>({...f,tx:1,w:1024,h:1024}));
export const stages=[...faces,...directions];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const tick=()=>new Promise(r=>setImmediate(r));
export async function pixels(buf,w,h){ const s=sharp(buf,{limitInputPixels:40000000}).flatten({background:'#000'}).toColourspace('srgb'); if(w)s.resize(w,h,{fit:'fill'}); const {data,info}=await s.raw().toBuffer({resolveWithObject:true}); return {data,w:info.width,h:info.height}; }
export function sample(p,x,y,c,wrap=false){
  x=wrap?((x%p.w)+p.w)%p.w:Math.max(0,Math.min(p.w-1,x)); y=Math.max(0,Math.min(p.h-1,y));
  const ix=Math.floor(x),iy=Math.floor(y),jx=wrap?(ix+1)%p.w:Math.min(ix+1,p.w-1),jy=Math.min(iy+1,p.h-1),fx=x-ix,fy=y-iy;
  const g=(a,b)=>p.data[(b*p.w+a)*3+c]; return g(ix,iy)*(1-fx)*(1-fy)+g(jx,iy)*fx*(1-fy)+g(ix,jy)*(1-fx)*fy+g(jx,jy)*fx*fy;
}
export async function project(p,f){const out=Buffer.alloc(f.w*f.h*3),ty=f.tx*f.h/f.w;
  for(let y=0;y<f.h;y++){if(y%64===0)await tick();for(let x=0;x<f.w;x++){
    const u=(2*(x+.5)/f.w-1)*f.tx,v=(2*(y+.5)/f.h-1)*ty,d=f.C.map((a,k)=>a+f.U[k]*u+f.V[k]*v),len=Math.hypot(...d);
    const px=(Math.atan2(d[0],d[2])/(2*Math.PI)+.5)*p.w-.5,py=(.5-Math.asin(d[1]/len)/Math.PI)*p.h-.5;
    for(let c=0;c<3;c++)out[(y*f.w+x)*3+c]=Math.round(sample(p,px,py,c,true));
  }}return sharp(out,{raw:{width:f.w,height:f.h,channels:3}}).png().toBuffer();
}
const fade=x=>{const t=Math.max(0,Math.min(1,(1-Math.abs(x))/.18));return t*t*(3-2*t);};
// Blend overlapping wide views in spherical space; do not stretch a flat render into 2:1.
export async function assemble(buffers,W=4096){const H=W/2,out=Buffer.alloc(W*H*3),images=await Promise.all(stages.map(async f=>({...f,p:await pixels(buffers[f.name],f.w,f.h)})));
  for(let y=0;y<H;y++){if(y%32===0)await tick();const lat=(.5-(y+.5)/H)*Math.PI;
    for(let x=0;x<W;x++){const lon=((x+.5)/W-.5)*2*Math.PI,d=[Math.sin(lon)*Math.cos(lat),Math.sin(lat),Math.cos(lon)*Math.cos(lat)];
      let base=images[0],zBest=-1;for(const f of images.slice(0,6)){const z=dot(d,f.C);if(z>zBest){zBest=z;base=f;}}
      const color=[0,1,2].map(c=>sample(base.p,(dot(d,base.U)/zBest+1)*base.w/2-.5,(dot(d,base.V)/zBest+1)*base.h/2-.5,c));
      let weight=0,sum=[0,0,0];for(const f of images.slice(6)){const z=dot(d,f.C);if(z<=0)continue;const u=dot(d,f.U)/z/f.tx,v=dot(d,f.V)/z/(f.tx*f.h/f.w);if(Math.abs(u)>=1||Math.abs(v)>=1)continue;const w=fade(u)*fade(v);weight+=w;for(let c=0;c<3;c++)sum[c]+=w*sample(f.p,(u+1)*f.w/2-.5,(v+1)*f.h/2-.5,c);}
      const alpha=Math.min(1,weight);for(let c=0;c<3;c++)out[(y*W+x)*3+c]=Math.round(color[c]*(1-alpha)+(weight?sum[c]/weight:0)*alpha);
    }}return sharp(out,{raw:{width:W,height:H,channels:3}}).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();
}
export const finishPrompt = name => `IMAGE 1 is the exact ${name==='techo'?'upward ceiling':name==='suelo'?'downward floor':'rectilinear architectural'} view from a 3D model. All other images are approved finish references of this same project from other cameras. Preserve the camera, framing, every wall, opening, object position, scale, floor boundary and lighting fixture of IMAGE 1. Transfer only the approved material and lighting appearance from the references. Do not copy their composition. Do not add or remove furniture, lights or decoration. Clear mirrors with physically consistent reflections. Keep LEDs where the model shows them, never move them onto furniture. Natural sharp detail, uniform painted surfaces, no invented patterns, no stains, no smeared machinery, no blown highlights. No crop, no text. This view will be joined with other views from exactly the same centre: preserve boundary geometry and consistent exposure. Return one image.`;
