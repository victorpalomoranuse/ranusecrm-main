import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Star } from 'lucide-react';

// Menú lateral agrupado: secciones por familias que se pliegan, y favoritos
// (estrella) que quedan fijados arriba. Todo se recuerda por persona en este
// dispositivo; no cambia a qué secciones tiene acceso cada usuario.

const GRUPOS = [
  { id: 'comercial', label: 'Comercial', ids: ['leads', 'setting', 'asistente-setter', 'mi-agenda', 'ventas', 'mis-comisiones'] },
  { id: 'proyectos', label: 'Proyectos', ids: ['proyectos', 'planos', 'clientes', 'trabajos', 'presupuestos', 'asistente', 'pedidos', 'obra', 'tareas'] },
  { id: 'finanzas', label: 'Finanzas', ids: ['finanzas', 'asistente-finanzas'] },
  { id: 'biblioteca', label: 'Biblioteca', ids: ['catalogo', 'referencias', 'recursos', 'contactos'] },
  { id: 'gestion', label: 'Equipo y ajustes', ids: ['empleados', 'roles', 'ajustes'] },
];
const SUELTOS = ['mi-dia', 'dashboard']; // siempre a la vista, arriba

function leer(clave, def) {
  try { const v = JSON.parse(localStorage.getItem(clave)); return v ?? def; } catch { return def; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
}

export function NavLateral({ items, section, onPick, userKey }) {
  const kFav = `ap_nav_fav_${userKey}`, kCerr = `ap_nav_abiertos_${userKey}`;
  const [favs, setFavs] = useState(() => leer(kFav, []));
  const [abiertos, setAbiertos] = useState(() => leer(kCerr, null)); // null = aún sin elegir
  useEffect(() => { guardar(kFav, favs); }, [favs, kFav]);
  useEffect(() => { if (abiertos) guardar(kCerr, abiertos); }, [abiertos, kCerr]);
  // Al ir a una sección, su grupo se abre
  useEffect(() => {
    const g = GRUPOS.find(x => x.ids.includes(section))?.id;
    if (g) setAbiertos(prev => { const l = prev ?? [g]; return l.includes(g) ? prev : [...l, g]; });
  }, [section]);

  const porId = Object.fromEntries(items.map(i => [i.id, i]));
  const grupoDe = (id) => GRUPOS.find(g => g.ids.includes(id))?.id;
  const conocidos = new Set([...SUELTOS, ...GRUPOS.flatMap(g => g.ids)]);
  const otros = items.filter(i => !conocidos.has(i.id));

  // Mientras no se haya elegido nada, solo se abre el grupo de la sección actual
  const actual = grupoDe(section);
  const lista0 = abiertos ?? (actual ? [actual] : []);
  const estaAbierto = (gid) => lista0.includes(gid);
  const alternar = (gid) => setAbiertos(lista0.includes(gid) ? lista0.filter(x => x !== gid) : [...lista0, gid]);
  const alternarFav = (e, id) => {
    e.stopPropagation();
    setFavs(f => (f.includes(id) ? f.filter(x => x !== id) : [...f, id]));
  };

  const renderItem = (item, clave) => (
    <div key={clave} className="ap-nav-row">
      <button className={`ap-nav-item${section === item.id ? ' active' : ''}`} onClick={() => onPick(item.id)}>
        <item.Icon size={17} className="ap-nav-icon" /><span>{item.label}</span>
      </button>
      <button className={`ap-nav-star${favs.includes(item.id) ? ' on' : ''}`} title={favs.includes(item.id) ? 'Quitar de favoritos' : 'Fijar en favoritos'} onClick={(e) => alternarFav(e, item.id)}>
        <Star size={13} fill={favs.includes(item.id) ? 'currentColor' : 'none'} />
      </button>
    </div>
  );

  const favItems = favs.map(id => porId[id]).filter(Boolean);
  const sueltos = SUELTOS.map(id => porId[id]).filter(Boolean);

  return (
    <nav className="ap-nav">
      {sueltos.map(i => renderItem(i, i.id))}
      {favItems.length > 0 && (
        <div className="ap-nav-group">
          <div className="ap-nav-group-title ap-nav-group-fav"><Star size={11} fill="currentColor" /> Favoritos</div>
          {favItems.map(i => renderItem(i, `fav-${i.id}`))}
        </div>
      )}
      {[...GRUPOS, { id: 'otros', label: 'Otros', ids: otros.map(o => o.id) }].map(g => {
        const lista = g.ids.map(id => porId[id]).filter(Boolean);
        if (!lista.length) return null;
        const abierto = estaAbierto(g.id);
        return (
          <div key={g.id} className="ap-nav-group">
            <button className="ap-nav-group-title" onClick={() => alternar(g.id)}>
              {abierto ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {g.label}
              <span className="ap-nav-group-count">{lista.length}</span>
            </button>
            {abierto && lista.map(i => renderItem(i, i.id))}
          </div>
        );
      })}
    </nav>
  );
}
