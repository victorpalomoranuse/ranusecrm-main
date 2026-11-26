import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {instalarAgrupacionDibujo} from './agrupacionDibujo3d.js';
function fixture(){const scene=new THREE.Scene(),root=new THREE.Group();root.userData.modeloEq=true;scene.add(root);const mat=new THREE.MeshStandardMaterial({color:'#4c5678',roughness:.4});
 for(let i=0;i<5;i++){const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),mat.clone());mesh.name='pieza-'+i;mesh.position.x=i*2;root.add(mesh);}return {scene,root,originals:[...root.children]};}
test('batches identical materials only for drawing; preserves triangles, bounds and source picking',()=>{
 const {scene,root,originals}=fixture();scene.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root),tri=originals.reduce((n,m)=>n+m.geometry.index.count/3,0);let draws=0;
 const renderer={render(){const visible=root.children.filter(x=>x.visible);assert.equal(visible.length,1);assert.equal(visible[0].geometry.index.count/3,tri);assert.ok(new THREE.Box3().setFromObject(visible[0]).equals(box));draws++;},dispose(){}};
 instalarAgrupacionDibujo(renderer);renderer.render(scene,new THREE.PerspectiveCamera());renderer.render(scene,new THREE.PerspectiveCamera());assert.equal(draws,2);assert.deepEqual(root.children,originals);assert.ok(originals.every(x=>x.visible));
 const ray=new THREE.Raycaster(new THREE.Vector3(0,0,5),new THREE.Vector3(0,0,-1));assert.equal(ray.intersectObject(root,true)[0].object,originals[0]);renderer.dispose();
});
test('does not mix different finishes and restores sources after render error',()=>{
 const {scene,root,originals}=fixture();originals[0].material.color.set('#ff0000');originals[1].material.transparent=true;originals[1].material.opacity=.5;
 const renderer={render(){assert.equal(root.children.filter(x=>x.visible).length,3);throw Error('GPU test');},dispose(){}};
 instalarAgrupacionDibujo(renderer);assert.throws(()=>renderer.render(scene,new THREE.PerspectiveCamera()),/GPU test/);assert.deepEqual(root.children,originals);assert.ok(originals.every(m=>m.visible));renderer.dispose();
});
test('refreshes batches after repainting, preserves uv1 and handles mirrored pieces',()=>{
 const {scene,root,originals}=fixture();originals.forEach(m=>m.geometry.setAttribute('uv1',m.geometry.attributes.uv.clone()));originals[0].scale.x=-1;let count=1;
 const renderer={render(){const visible=root.children.filter(x=>x.visible);assert.equal(visible.length,count);assert.ok(visible.at(-1).geometry.attributes.uv1);},dispose(){}};
 instalarAgrupacionDibujo(renderer);renderer.render(scene,new THREE.PerspectiveCamera());originals[0].material.color.set('red');count=2;renderer.render(scene,new THREE.PerspectiveCamera());assert.ok(originals[0].geometry.attributes.uv1);renderer.dispose();
});
