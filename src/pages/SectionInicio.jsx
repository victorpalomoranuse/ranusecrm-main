import { useState } from 'react';
import { Search, Star } from 'lucide-react';
import { GRUPOS, SUELTOS } from '../components/NavLateral';
import { PanelTareasEventos } from '../components/PanelTareasEventos';

// Inicio: pantalla de entrada al CRM. Accesos a todas las secciones a las que
// la persona tiene permiso, agrupadas por familia, con sus favoritos y las
// últimas que ha usado, y un buscador para saltar directo a una sección.

const DESCRIPCION = {
  'mi-dia': 'Tus llamadas, leads y comisiones de hoy',
  dashboard: 'Visión global del negocio',
  trabajos: 'Trabajos que se enseñan en la web',
  leads: 'Listado anterior de leads y su seguimiento',
  setting: 'Métricas del setting: llamadas, cierres y ventas',
  'asistente-setter': 'IA que mete leads y agenda llamadas',
  'mi-agenda': 'Calendario de llamadas',
  ventas: 'Ventas, cobros y objetivos',
  'mis-comisiones': 'Lo que llevas ganado',
  proyectos: 'Proyectos de cliente, fases y documentos',
  planos: 'Planos y mediciones, con sus láminas en PDF',
  clientes: 'Cuentas de cliente',
  empleados: 'Equipo y su actividad',
  roles: 'Qué puede ver cada categoría',
  presupuestos: 'Presupuestos y sus partidas',
  asistente: 'IA para preparar presupuestos',
  pedidos: 'Pedidos a proveedor y su estado',
  finanzas: 'Ingresos, gastos y resultados',
  'asistente-finanzas': 'Pregunta a la IA por las cuentas',
  obra: 'Seguimiento económico de obra',
  tareas: 'Tareas del equipo',
  catalogo: 'Productos, materiales y precios',
  referencias: 'Referencias e inspiración',
  recursos: 'Documentos y plantillas',
  contactos: 'Proveedores y contactos',
  ajustes: 'Configuración y biblioteca de las IA',
};

function Tarjeta({ item, ir, esFav, onFav }) {
  return (
    <div onClick={() => ir(item.id)} style={{ position: 'relative', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '0.9rem 1rem', display: 'flex', gap: 12, alignItems: 'flex-start', transition: 'border-color 0.15s, background 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(186,175,165,0.5)'; e.currentTarget.style.background = 'rgba(186,175,165,0.06)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}>
      <item.Icon size={20} style={{ color: '#baafa5', flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0, paddingRight: 18 }}>
        <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{item.label}</div>
        {DESCRIPCION[item.id] && <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)', marginTop: 2, lineHeight: 1.35 }}>{DESCRIPCION[item.id]}</div>}
      </div>
      <button title={esFav ? 'Quitar de favoritos' : 'Fijar en favoritos'} onClick={(e) => { e.stopPropagation(); onFav(item.id); }}
        style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: esFav ? '#baafa5' : 'rgba(255,255,255,0.25)', display: 'flex' }}>
        <Star size={14} fill={esFav ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

function Bloque({ titulo, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <p style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', margin: '0 0 10px' }}>{titulo}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>{children}</div>
    </div>
  );
}

export function SectionInicio({ items, ir, prefs, user }) {
  const [q, setQ] = useState('');
  const porId = Object.fromEntries(items.map(i => [i.id, i]));
  const { favs, toggleFav, recientes } = prefs;
  const nombre = (user?.name || '').split(' ')[0];
  const hora = new Date().getHours();
  const saludo = hora < 6 ? 'Buenas noches' : hora < 14 ? 'Buenos días' : hora < 21 ? 'Buenas tardes' : 'Buenas noches';
  const fecha = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const sinInicio = items.filter(i => i.id !== 'inicio');
  const tarjeta = (i) => <Tarjeta key={i.id} item={i} ir={ir} esFav={favs.includes(i.id)} onFav={toggleFav} />;

  const busqueda = q.trim().toLowerCase();
  const resultados = busqueda ? sinInicio.filter(i => `${i.label} ${DESCRIPCION[i.id] || ''}`.toLowerCase().includes(busqueda)) : null;

  const favItems = favs.map(id => porId[id]).filter(Boolean);
  const recItems = recientes.map(id => porId[id]).filter(i => i && !favs.includes(i.id)).slice(0, 4);
  const destacados = SUELTOS.map(id => porId[id]).filter(i => i && i.id !== 'inicio');
  const conocidos = new Set([...SUELTOS, ...GRUPOS.flatMap(g => g.ids)]);
  const otros = sinInicio.filter(i => !conocidos.has(i.id));

  return (
    <div className="ap-section">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>{saludo}{nombre ? `, ${nombre}` : ''}</h1>
        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.45)', textTransform: 'capitalize' }}>{fecha}</p>
      </div>

      <PanelTareasEventos puedeVerTareas={!!porId.tareas} ir={ir} />

      <div style={{ position: 'relative', maxWidth: 420, marginBottom: 22 }}>
        <Search size={15} style={{ position: 'absolute', left: 11, top: 12, opacity: 0.4 }} />
        <input className="ap-field-input" style={{ paddingLeft: 34, width: '100%' }} placeholder="¿A dónde quieres ir? (planos, ventas, catálogo…)" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {resultados ? (
        resultados.length
          ? <Bloque titulo={`${resultados.length} resultado${resultados.length === 1 ? '' : 's'}`}>{resultados.map(tarjeta)}</Bloque>
          : <p style={{ fontSize: '0.84rem', color: 'rgba(255,255,255,0.45)' }}>No hay ninguna sección con ese nombre.</p>
      ) : (
        <>
          {destacados.length > 0 && <Bloque titulo="Lo tuyo">{destacados.map(tarjeta)}</Bloque>}
          {favItems.length > 0 && <Bloque titulo="Favoritos">{favItems.map(tarjeta)}</Bloque>}
          {recItems.length > 0 && <Bloque titulo="Seguir donde lo dejaste">{recItems.map(tarjeta)}</Bloque>}
          {favItems.length === 0 && <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', margin: '-8px 0 20px' }}>Pulsa la estrella de cualquier sección para fijarla aquí y en el menú.</p>}
          {[...GRUPOS, { id: 'otros', label: 'Otros', ids: otros.map(o => o.id) }].map(g => {
            const lista = g.ids.map(id => porId[id]).filter(Boolean);
            return lista.length ? <Bloque key={g.id} titulo={g.label}>{lista.map(tarjeta)}</Bloque> : null;
          })}
        </>
      )}
    </div>
  );
}
