// The same visible surface must win for selection, dragging and painting.
export function impactoVisible(hit) {
  const mesh = hit?.object;
  if (!mesh?.isMesh) return false;
  for (let o = mesh; o; o = o.parent) {
    const u = o.userData || {};
    if (!o.visible || u.hit || u.eje || u.guia || u.asa || (u.overlay && !u.relleno)) return false;
  }
  const material = Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material;
  return !!material && material.visible !== false && !(material.transparent && material.opacity === 0);
}
