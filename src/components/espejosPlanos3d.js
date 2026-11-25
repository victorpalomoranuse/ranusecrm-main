// Reflejo plano y perfecto para los espejos rectangulares (en Render con efectos): la sala se vuelve a dibujar vista desde el otro lado del espejo
// y se pega en él, como en D5 o Coohom. Los espejos que no son rectángulos siguen con la reflexión aproximada de siempre.
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

const SHADER_ESPEJO = {
  name: 'EspejoRanuse',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
  vertexShader: 'uniform mat4 textureMatrix; varying vec4 vUv; void main() { vUv = textureMatrix * vec4( position, 1.0 ); gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
  // sin tonemapping ni conversión de color: el resultado sigue en el rango HDR de la escena y lo trata el pase final como al resto
  fragmentShader: 'uniform vec3 color; uniform sampler2D tDiffuse; varying vec4 vUv; void main() { vec4 b = texture2DProj( tDiffuse, vUv ); gl_FragColor = vec4( b.rgb * color, 1.0 ); }',
};

const esEspejo = o => o.isMesh && o.visible && o.geometry && (o.userData.espejoDeco || (o.material && !Array.isArray(o.material) && o.material.map && o.material.map.userData && o.material.map.userData.espejo));

// La cara plana del espejo: el espesor es la dimensión más pequeña; se elige la cara que mira hacia el interior de la sala
function caraPlana(mesh, centroSala) {
  const g = mesh.geometry; g.computeBoundingBox(); const bb = g.boundingBox, tam = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
  const pos = g.attributes.position; if (!pos) return null;
  const unicos = new Set(); for (let i = 0; i < pos.count; i++) unicos.add(Math.round(pos.getX(i) * 1000) + ',' + Math.round(pos.getY(i) * 1000) + ',' + Math.round(pos.getZ(i) * 1000));
  if (unicos.size > 16) return null; // forma curva o compleja
  const dims = [tam.x, tam.y, tam.z], eje = dims.indexOf(Math.min(...dims)), a1 = (eje + 1) % 3, a2 = (eje + 2) % 3;
  if (dims[a1] < 0.1 || dims[a2] < 0.1) return null;
  mesh.updateWorldMatrix(true, false);
  const nL = new THREE.Vector3(); nL.setComponent(eje, 1);
  const mundo = mesh.matrixWorld, escala = new THREE.Vector3().setFromMatrixScale(mundo);
  const caras = [1, -1].map(s => {
    const pL = c.clone(); pL.setComponent(eje, c.getComponent(eje) + s * dims[eje] / 2);
    const p = pL.clone().applyMatrix4(mundo), n = nL.clone().multiplyScalar(s).transformDirection(mundo);
    return { p, n, d: n.dot(centroSala.clone().sub(p)) };
  });
  const cara = caras[0].d >= caras[1].d ? caras[0] : caras[1];
  // ejes de la cara en el mundo: u horizontal, v hacia arriba
  const ux = new THREE.Vector3(); ux.setComponent(a1, 1); ux.transformDirection(mundo);
  const uy = new THREE.Vector3(); uy.setComponent(a2, 1); uy.transformDirection(mundo);
  let u, v, an, al;
  if (Math.abs(uy.y) > Math.abs(ux.y)) { v = uy; u = ux; an = dims[a1] * escala.getComponent(a1); al = dims[a2] * escala.getComponent(a2); } else { v = ux; u = uy; an = dims[a2] * escala.getComponent(a2); al = dims[a1] * escala.getComponent(a1); }
  // base derecha: u × v = n
  const n = cara.n.clone(); v = v.clone().sub(n.clone().multiplyScalar(v.dot(n))).normalize(); u = new THREE.Vector3().crossVectors(v, n).normalize();
  return { p: cara.p, n, u, v, an, al };
}

// Pone (o quita) los reflejos planos. Se llama cuando cambian los materiales o el modo; es idempotente.
export function planosEspejo(a, scene, activo) {
  (a.planosEsp || []).forEach(({ reflector, mesh, antes }) => {
    scene.remove(reflector); reflector.geometry.dispose(); reflector.material.dispose(); if (reflector.getRenderTarget) reflector.getRenderTarget().dispose();
    if (mesh.material && antes) { mesh.material.colorWrite = antes.cw; mesh.material.depthWrite = antes.dw; mesh.material.needsUpdate = true; }
  });
  a.planosEsp = [];
  if (!activo) return;
  const centro = a.centro ? a.centro.clone() : new THREE.Vector3(0, 1.2, 0);
  const lista = []; scene.traverse(o => { if (esEspejo(o) && !o.userData.esReflejo) lista.push(o); });
  for (const mesh of lista.slice(0, 4)) {
    const cara = caraPlana(mesh, centro); if (!cara) continue;
    const refl = new Reflector(new THREE.PlaneGeometry(cara.an, cara.al), { textureWidth: 1024, textureHeight: Math.max(256, Math.round(1024 * cara.al / Math.max(0.01, cara.an))), clipBias: 0.003, color: new THREE.Color(0.92, 0.92, 0.92), multisample: 0, shader: SHADER_ESPEJO });
    refl.matrixAutoUpdate = false;
    refl.matrix.makeBasis(cara.u, cara.v, cara.n); refl.matrix.setPosition(cara.p.clone().addScaledVector(cara.n, 0.003));
    refl.matrixWorld.copy(refl.matrix); refl.matrixWorldNeedsUpdate = false;
    refl.userData.esReflejo = true; refl.raycast = () => {}; refl.renderOrder = 1; refl.frustumCulled = true;
    refl.material.polygonOffset = true; refl.material.polygonOffsetFactor = -2; refl.material.polygonOffsetUnits = -2;
    // no se reflejan a sí mismos ni se pintan en los pases auxiliares (sombras de contacto…)
    const orig = refl.onBeforeRender; refl.onBeforeRender = function (r, s, c, ...resto) {
      if (s.overrideMaterial) return;
      // Reflector restores only the target; cube captures also need the face and mip level.
      const target = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
      const xr = r.xr.enabled, shadows = r.shadowMap.autoUpdate, visible = this.visible;
      try { orig.call(this, r, s, c, ...resto); }
      finally {
        r.setRenderTarget(target, face, mip);
        r.xr.enabled = xr; r.shadowMap.autoUpdate = shadows; this.visible = visible;
      }
    };
    const antes = { cw: mesh.material.colorWrite, dw: mesh.material.depthWrite };
    mesh.material.colorWrite = false; mesh.material.depthWrite = false; mesh.material.needsUpdate = true; // la superficie original ya no se pinta: la sustituye el reflejo
    scene.add(refl); a.planosEsp.push({ reflector: refl, mesh, antes });
  }
}
