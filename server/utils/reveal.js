// Trabajo "Antes y después" del Estudio de vídeo: valida lo que manda el panel y devuelve el trabajo listo para la cola.
import crypto from 'crypto';

const limpia = (t, n) => String(t ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
const rutaOk = (r) => typeof r === 'string' && /^entradas\/[\w./-]+$/.test(r) && !r.includes('..');
const num = (v, min, max, def) => { if (v === null || v === undefined || v === '') return def; const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

function fuente(f, etiqueta) {
  if (f?.base?.id) {
    if (!/^[\w-]{10,60}$/.test(f.base.id)) throw new Error('Fuente de Drive no válida: ' + etiqueta);
    return { nombre: limpia(f.nombre || f.base.nombre, 160), base: { id: limpia(f.base.id, 80), nombre: limpia(f.base.nombre, 160) } };
  }
  if (!rutaOk(f?.archivo)) throw new Error('Falta subir ' + etiqueta);
  return { nombre: limpia(f.nombre, 160), archivo: f.archivo };
}

export function creaTrabajoReveal(b = {}, usuario = null) {
  const antes = fuente(b.antes, 'el clip de antes');
  if (!Array.isArray(b.despues) || b.despues.length < 1) throw new Error('Añade al menos un clip del resultado');
  if (b.despues.length > 20) throw new Error('Como máximo 20 clips del resultado');
  const despues = b.despues.map((f, i) => fuente(f, 'el clip ' + (i + 1) + ' del resultado'));
  if (!rutaOk(b.cancion)) throw new Error('Falta subir la canción');
  const handle = limpia(b.textos?.handle, 40).replace(/^@+/, '');
  if (handle && !/^[\w.]{1,30}$/.test(handle)) throw new Error('El usuario solo puede llevar letras, números, punto y guion bajo');
  const textos = { intro: limpia(b.textos?.intro, 60), reveal: limpia(b.textos?.reveal, 60), cta: limpia(b.textos?.cta, 80), handle };
  const a = b.ajustes || {};
  const ajustes = {
    antes_inicio: num(a.antes_inicio, 0, 3600, 0), antes_x: num(a.antes_x, 0, 100, 50), antes_x_fin: a.antes_x_fin === null || a.antes_x_fin === undefined || a.antes_x_fin === '' ? null : num(a.antes_x_fin, 0, 100, 50),
    antes_seg: num(a.antes_seg, 3, 8, 4.7),
  };
  return {
    id: crypto.randomUUID().slice(0, 8), creado: new Date().toISOString(), por: usuario?.name || usuario?.email || null,
    tipo: 'reveal', formato: 'reveal', formato_nombre: 'Antes y después', receta: {}, reglas: '', musica: 'propia',
    nombre_archivo: limpia(b.nombre, 120) || 'Antes y después', antes, despues, cancion: b.cancion, textos, ajustes,
    estado: 'pendiente', progreso: 'En cola', version: 1, origen: null,
  };
}
