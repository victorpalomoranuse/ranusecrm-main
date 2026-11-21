import * as THREE from 'three';

const fondo = new THREE.Color('#c9cdd1');
// A modeling frame uses its own studio. Restore all authored render settings afterwards.
export function dibujarModelar(renderer, scene, camera, sol, hemi, estudio, opc) {
  const luces = [], materiales = [], vistos = new Set();
  const anterior = { environment: scene.environment, environmentIntensity: scene.environmentIntensity, background: scene.background, backgroundIntensity: scene.backgroundIntensity, environmentRotation: scene.environmentRotation.clone(), exposure: renderer.toneMappingExposure, tone: renderer.toneMapping };
  scene.traverse(o => {
    if (o.isLight) { luces.push([o, o.visible]); o.visible = o === sol || o === hemi; }
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || vistos.has(m)) continue; vistos.add(m);
      materiales.push([m, m.emissiveIntensity, m.envMap, m.envMapIntensity]);
      if (m.emissive) m.emissiveIntensity = 0;
      if (m.envMap) { m.envMap = estudio; m.envMapIntensity = (opc && opc.env) || 0.35; }
    }
  });
  try {
    scene.environment = estudio; scene.environmentIntensity = (opc && opc.env) || 0.35; scene.environmentRotation.set(0, 0, 0);
    scene.background = (opc && opc.fondo) ? new THREE.Color(opc.fondo) : fondo; scene.backgroundIntensity = 1;
    renderer.toneMappingExposure = 1; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.render(scene, camera);
  } finally {
    luces.forEach(([o, v]) => { o.visible = v; });
    materiales.forEach(([m, e, env, i]) => { m.emissiveIntensity = e; m.envMap = env; m.envMapIntensity = i; });
    scene.environment = anterior.environment; scene.environmentIntensity = anterior.environmentIntensity;
    scene.environmentRotation.copy(anterior.environmentRotation); scene.background = anterior.background; scene.backgroundIntensity = anterior.backgroundIntensity;
    renderer.toneMappingExposure = anterior.exposure; renderer.toneMapping = anterior.tone;
  }
}
