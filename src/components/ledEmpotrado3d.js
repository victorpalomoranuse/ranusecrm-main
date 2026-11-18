import * as THREE from 'three';

// Subtract the slot from coplanar surface triangles. Interpolate all vertex attributes
// so UVs/normals and the original mesh material groups survive the cut.
export function recortarRanura(mesh, slot) {
  const source=mesh.geometry, pos=source.attributes.position;
  if (!pos || mesh.isSkinnedMesh) return null;
  const attrs=Object.entries(source.attributes).filter(([,a])=>!a.isInterleavedBufferAttribute);
  if(attrs.length!==Object.keys(source.attributes).length)return null;
  const fields=attrs.map(([name,a])=>({name,size:a.itemSize,array:[]}));
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler((slot.inclinacionX||0)*Math.PI/180,-(slot.rot||0)*Math.PI/180,(slot.inclinacionZ||0)*Math.PI/180,'YXZ'));
  const inv=q.clone().invert(),center=new THREE.Vector3(slot.cx*.01,slot.z0*.01,slot.cy*.01);
  const length=Math.hypot(slot.pts[1][0]-slot.pts[0][0],slot.pts[1][1]-slot.pts[0][1])*.01;
  const halfX=length/2+.001,halfZ=(slot.led.ancho||1.2)*.005+.001;
  const index=source.index, count=index?index.count:pos.count, groups=[];let changed=false,total=0;
  const vertex=i=>{
    const data=attrs.map(([,a])=>Array.from({length:a.itemSize},(_,k)=>a.array[i*a.itemSize+k]));
    const world=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld).sub(center).applyQuaternion(inv);
    return {data,p:world};
  };
  const mix=(a,b,t)=>({data:a.data.map((v,i)=>v.map((x,k)=>x+(b.data[i][k]-x)*t)),p:a.p.clone().lerp(b.p,t)});
  const clip=(poly,axis,sign,bound,inside)=>{
    const out=[];if(!poly.length)return out;
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=sign*a.p[axis]-bound,db=sign*b.p[axis]-bound;
      const ia=inside?da<=0:da>=0,ib=inside?db<=0:db>=0;
      if(ia)out.push(a);if(ia!==ib)out.push(mix(a,b,da/(da-db)));
    } return out;
  };
  const emit=(poly,mat)=>{
    const start=total;
    for(let j=1;j+1<poly.length;j++)for(const v of [poly[0],poly[j],poly[j+1]]){fields.forEach((f,i)=>f.array.push(...v.data[i]));total++;}
    if(total>start){const prev=groups[groups.length-1];if(prev&&prev.materialIndex===mat)prev.count+=total-start;else groups.push({start,count:total-start,materialIndex:mat});}
  };
  for(let i=0;i<count;i+=3){
    const tri=[0,1,2].map(j=>vertex(index?index.getX(i+j):i+j));
    const mat=source.groups.find(g=>i>=g.start&&i<g.start+g.count)?.materialIndex||0;
    if(tri.some(v=>Math.abs(v.p.y)>.003) || tri.every(v=>v.p.x>halfX)||tri.every(v=>v.p.x< -halfX)||tri.every(v=>v.p.z>halfZ)||tri.every(v=>v.p.z< -halfZ)){emit(tri,mat);continue;}
    let rest=tri;
    for(const [axis,sign,bound] of [['x',1,halfX],['x',-1,halfX],['z',1,halfZ],['z',-1,halfZ]]) {
      emit(clip(rest,axis,sign,bound,false),mat);rest=clip(rest,axis,sign,bound,true);
    }
    if(rest.length>=3)changed=true;
  }
  if(!changed)return null;
  const out=new THREE.BufferGeometry();fields.forEach(f=>out.setAttribute(f.name,new THREE.Float32BufferAttribute(f.array,f.size)));
  groups.forEach(g=>out.addGroup(g.start,g.count,g.materialIndex));out.computeBoundingBox();out.computeBoundingSphere();return out;
}

export function colocarEmpotrado(hit) {
  const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const tangent=Math.abs(normal.y)>.9?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0);
  tangent.addScaledVector(normal,-tangent.dot(normal)).normalize();
  const cross=new THREE.Vector3().crossVectors(tangent,normal).normalize();
  const matrix=new THREE.Matrix4().makeBasis(tangent,normal,cross),e=new THREE.Euler().setFromRotationMatrix(matrix,'YXZ');
  return {cx:hit.point.x*100,cy:hit.point.z*100,z0:hit.point.y*100,rot:-e.y*180/Math.PI,inclinacionX:e.x*180/Math.PI,inclinacionZ:e.z*180/Math.PI};
}
