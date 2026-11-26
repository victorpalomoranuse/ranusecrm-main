import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Render-only batching. Source meshes, names, triangle indices and picking remain unchanged.
// No decimation, texture resizing, material replacement or persistent model edits.
export function instalarAgrupacionDibujo(renderer) {
  const originalRender=renderer.render, originalDispose=renderer.dispose;
  const caches=new Map(), materialKeys=new WeakMap(), signatures=new Map(), attributeIds=new WeakMap();let rendering=false,mainScene=null,attributeId=0;
  const visible=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
  function materialKey(m){
    // Standard material updates increment version. Include direct colour/intensity edits as well.
    const stamp=[m.version,m.color?.getHexString(),m.emissive?.getHexString(),m.emissiveIntensity,m.opacity,m.roughness,m.metalness,m.envMapIntensity,m.normalScale?.x,m.normalScale?.y,m.visible].join('|');
    const old=materialKeys.get(m);if(old?.stamp===stamp)return old.key;
    const json=m.toJSON({textures:{},images:{}});delete json.uuid;delete json.name;delete json.metadata;
    const signature=JSON.stringify(json);if(!signatures.has(signature))signatures.set(signature,signatures.size+1);
    const key=signatures.get(signature);materialKeys.set(m,{stamp,key});return key;
  }
  function eligible(m){
    const g=m.geometry,t=m.material;
    return m.isMesh&&!m.isSkinnedMesh&&!m.isInstancedMesh&&!m.isBatchedMesh&&g?.attributes.position&&
      !Array.isArray(t)&&t?.visible&&!t.transparent&&!t.transmission&&!t.isShaderMaterial&&!t.isRawShaderMaterial&&
      !t.clippingPlanes?.length&&!Object.keys(g.morphAttributes||{}).length&&g.drawRange.start===0&&g.drawRange.count===Infinity&&
      m.onBeforeRender===THREE.Object3D.prototype.onBeforeRender&&m.onAfterRender===THREE.Object3D.prototype.onAfterRender&&
      t.onBeforeCompile===THREE.Material.prototype.onBeforeCompile&&visible(m)&&!m.userData.overlay&&!m.userData.hit;
  }
  const layout=g=>Object.entries(g.attributes).map(([k,a])=>`${k}:${a.itemSize}:${a.normalized}:${a.array?.constructor.name}`).sort().join(',');
  const aid=a=>{if(!a)return '';if(!attributeIds.has(a))attributeIds.set(a,++attributeId);return attributeIds.get(a)+':'+a.version;};
  const geometryStamp=g=>g.uuid+':'+aid(g.index)+':'+Object.entries(g.attributes).map(([k,a])=>k+':'+aid(a)).join(',');
  function release(cache){cache?.batches.forEach(b=>b.proxy.geometry.dispose());}
  function prepare(root){
    const sources=[];root.traverse(o=>{if(eligible(o))sources.push(o);});
    const keys=sources.map(m=>materialKey(m.material)+'|'+[m.castShadow,m.receiveShadow,m.renderOrder,m.layers.mask,m.frustumCulled,layout(m.geometry)].join('|'));
    const stamp=sources.map((m,i)=>[m.uuid,geometryStamp(m.geometry),keys[i],...m.matrixWorld.elements].join('|')).join('\n');
    const old=caches.get(root);if(old?.stamp===stamp)return old;
    release(old);const cache={stamp,batches:[]};caches.set(root,cache);
    const groups=new Map();sources.forEach((m,i)=>{if(!groups.has(keys[i]))groups.set(keys[i],[]);groups.get(keys[i]).push(m);});
    const inv=root.matrixWorld.clone().invert();
    for(const group of groups.values()){
      if(group.length<2)continue;const geometries=[];
      try{
        for(const m of group){
          // Full geometry and all attributes (including uv1, normals, tangents and vertex colours).
          let g=m.geometry.clone();const transform=new THREE.Matrix4().multiplyMatrices(inv,m.matrixWorld);
          g.applyMatrix4(transform);g.clearGroups();
          if(!g.index){const n=g.attributes.position.count;g.setIndex(Array.from({length:n},(_,i)=>i));}
          if(transform.determinant()<0){const a=g.index.array;for(let i=0;i<a.length;i+=3)[a[i+1],a[i+2]]=[a[i+2],a[i+1]];
            const t=g.attributes.tangent;if(t)for(let i=0;i<t.count;i++)t.setW(i,-t.getW(i));}
          geometries.push(g);
        }
        const geometry=mergeGeometries(geometries,false);if(!geometry)continue;
        geometry.computeBoundingBox();geometry.computeBoundingSphere();const first=group[0],proxy=new THREE.Mesh(geometry,first.material);
        proxy.castShadow=first.castShadow;proxy.receiveShadow=first.receiveShadow;proxy.renderOrder=first.renderOrder;proxy.layers.mask=first.layers.mask;proxy.frustumCulled=first.frustumCulled;
        proxy.name='Agrupación temporal';cache.batches.push({sources:group,proxy});
      }finally{geometries.forEach(g=>g.dispose());}
    }
    return cache;
  }
  renderer.render=function(scene,camera){
    if(rendering)return originalRender.call(this,scene,camera);
    rendering=true;const active=new Set(),swaps=[];
    try{
      scene.updateMatrixWorld(true);
      scene.traverse(o=>{if(o.userData.modeloEq||o.userData.modeloImportado)active.add(o);});
      // Only evict on the main scene, not the full-screen scenes used by post-processing.
      if(active.size&&!mainScene)mainScene=scene;
      if(scene===mainScene)for(const [root,c] of caches)if(!active.has(root)){release(c);caches.delete(root);}
      for(const root of active){if(!visible(root))continue;let cache;
        try{cache=prepare(root);}catch{continue;} // Unsupported asset: keep rendering its original meshes.
        for(const batch of cache.batches){
          swaps.push(batch);batch.sources.forEach(m=>{m.visible=false;});root.add(batch.proxy);
        }
      }
      return originalRender.call(this,scene,camera);
    }finally{
      for(const batch of swaps){batch.proxy.removeFromParent();batch.sources.forEach(m=>{m.visible=true;});}
      rendering=false;
    }
  };
  renderer.dispose=function(){for(const cache of caches.values())release(cache);caches.clear();return originalDispose.call(this);};
  return ()=>{for(const cache of caches.values())release(cache);caches.clear();renderer.render=originalRender;renderer.dispose=originalDispose;};
}
