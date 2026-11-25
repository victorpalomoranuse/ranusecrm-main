// Tour de renders del cliente: los renders finales de la galería que se han publicado en su historia y que guardan desde dónde se hicieron.
// Cada uno lleva la cámara (posición, objetivo, apertura) para que el visor coloque solo los saltos de una imagen a otra.
export function fotosDeTour(escena3d) {
  return (escena3d?.renders || [])
    .filter(r => r && r.tipo !== '360' && r.publicado && r.url && r.meta?.camara && Number.isFinite(r.meta.camara.px) && Number.isFinite(r.meta.camara.pz))
    .sort((a, b) => String(a.creado).localeCompare(String(b.creado)))
    .slice(0, 40)
    .map(r => {
      const c = r.meta.camara;
      return {
        id: r.id, nombre: String(r.nombre || 'Vista').slice(0, 80), nota: r.nota ? String(r.nota).slice(0, 300) : '', url: r.url, thumb: r.thumb || r.url,
        cam: { px: c.px, py: Number.isFinite(c.py) ? c.py : 1.6, pz: c.pz, tx: Number.isFinite(c.tx) ? c.tx : c.px, ty: Number.isFinite(c.ty) ? c.ty : (Number.isFinite(c.py) ? c.py : 1.6), tz: Number.isFinite(c.tz) ? c.tz : c.pz + 1, fov: Number.isFinite(c.fov) && c.fov > 5 && c.fov < 140 ? c.fov : 50 },
        shift: Number.isFinite(Number(r.meta.shift)) ? Number(r.meta.shift) : 0,
      };
    });
}
