import { useEffect, useState } from 'react';
import api from '../services/api';

// model-viewer (de Google) se carga desde un CDN solo cuando se abre esta ventana: así no pesa en la web ni en el despliegue.
const MV_URL = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js';
function cargaModelViewer() {
  if (customElements.get('model-viewer')) return Promise.resolve();
  if (!document.querySelector('script[data-hg-mv]')) {
    const s = document.createElement('script');
    s.type = 'module'; s.src = MV_URL; s.dataset.hgMv = '1';
    document.head.appendChild(s);
  }
  return Promise.race([
    customElements.whenDefined('model-viewer'),
    new Promise((_, rej) => setTimeout(() => rej(new Error('El visor de realidad aumentada no se pudo cargar. Revisa tu conexión.')), 15000)),
  ]);
}

// Ventana «Tu gym en tu sala»: pide al servidor el gym completo colocado y a tamaño real (.glb) y lo enseña con model-viewer.
// En el móvil, el botón abre la cámara (AR): se apunta al suelo, se toca para colocarlo y se gira hasta que la placa del suelo
// y la marca blanca de la puerta coincidan con la sala real.
export default function HomeGymAR({ S, items, onClose }) {
  const [e, setE] = useState({ fase: 'cargando', url: '', info: null, error: '' });

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [r] = await Promise.all([
          api.post('/homegym/ar', { sala: { L: S.L, W: S.W, door: S.door }, items: items.map(c => ({ id: c.it.id, x: c.x, y: c.y, w: c.w, d: c.d })) }),
          cargaModelViewer(),
        ]);
        if (!vivo) return;
        const base = String(api.defaults.baseURL || '').replace(/\/$/, '');
        setE({ fase: 'listo', url: base + r.data.path, info: r.data, error: '' });
      } catch (err) {
        if (vivo) setE({ fase: 'error', url: '', info: null, error: err.response?.data?.error || err.message || 'No se pudo preparar la vista. Inténtalo de nuevo.' });
      }
    })();
    const tecla = ev => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', tecla);
    return () => { vivo = false; window.removeEventListener('keydown', tecla); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="hg-modal" role="dialog" aria-modal="true" aria-label="Tu gym en tu sala">
      <div className="hg-modal-box">
        <div className="hg-modal-head">
          <div><span className="hg-kicker">Realidad aumentada</span><h1>Tu gym en tu sala</h1></div>
          <button type="button" className="hg-ghost" onClick={onClose}>Cerrar</button>
        </div>
        {e.fase === 'cargando' && <p className="hg-lead">Preparando tu gym a tamaño real…</p>}
        {e.fase === 'error' && <p className="hg-msg err">{e.error}</p>}
        {e.fase === 'listo' && (
          <>
            <model-viewer src={e.url} alt="Tu home gym a tamaño real" ar ar-modes="webxr scene-viewer quick-look" ar-scale="fixed"
              camera-controls touch-action="pan-y" shadow-intensity="1" exposure="1.1" environment-image="neutral" camera-orbit="35deg 62deg auto" class="hg-mv">
              <button slot="ar-button" type="button" className="hg-primary hg-mv-btn">Verlo en mi sala</button>
            </model-viewer>
            <ol className="hg-why hg-steps">
              <li><span><b>Abre esta página en tu móvil</b> y pulsa «Verlo en mi sala».</span></li>
              <li><span>Apunta al suelo, <b>en el centro de la sala</b>, y toca para colocarlo.</span></li>
              <li><span>Gíralo con dos dedos hasta que la <b>placa del suelo</b> coincida con tus paredes y la <b>marca blanca</b> quede en la puerta.</span></li>
            </ol>
            {e.info?.cajas > 0 && <p className="hg-note">{e.info.cajas} {e.info.cajas === 1 ? 'máquina aún no tiene modelo 3D y sale' : 'máquinas aún no tienen modelo 3D y salen'} como caja con sus medidas reales.</p>}
            <p className="hg-note">En ordenador puedes girar y acercar el modelo, pero la cámara de realidad aumentada solo funciona en el móvil.</p>
          </>
        )}
      </div>
    </div>
  );
}
