// Miniaturas de los bloques de un producto (planta, alzado y lateral) en su ficha del catálogo.
// El dibujo viene del propio servidor, que solo admite trazos simples (line, rect, circle, polygon, path).

const VISTAS = [['planta', 'Planta'], ['alzado', 'Alzado'], ['lateral', 'Lateral']];

function medidas(b, v) {
  const largo = Number(b.largo) || 100, fondo = Number(b.fondo) || 100, alto = Number(b.alto) || 100;
  return v === 'planta' ? [largo, fondo] : v === 'alzado' ? [largo, alto] : [fondo, alto];
}

export function BloquePreview({ bloques, onOpen }) {
  if (!bloques?.svg) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: '10px 0 4px' }}>
      {VISTAS.map(([v, nombre]) => {
        const frag = bloques.svg[v];
        const [w, h] = medidas(bloques, v);
        const pad = Math.max(w, h) * 0.05;
        const contenido = (frag || '').replace(/#000000|#000\b/g, 'currentColor');
        return (
          <div key={v} onClick={onOpen} title="Abrir el editor de bloques" style={{ cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, height: 110, padding: 6, color: '#e9e5df', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {frag ? (
                <svg
                  viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`}
                  style={{ width: '100%', height: '100%' }}
                  preserveAspectRatio="xMidYMid meet"
                  dangerouslySetInnerHTML={{ __html: `<style>*{vector-effect:non-scaling-stroke;stroke-width:1.2px}</style>${contenido}` }}
                />
              ) : <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)' }}>sin dibujo</span>}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>{nombre} · {Math.round(w)}×{Math.round(h)}</div>
          </div>
        );
      })}
    </div>
  );
}
