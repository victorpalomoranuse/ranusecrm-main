import { useEffect, useRef, useState } from 'react';

// Select con buscador por texto, para listas largas (ej. elegir una venta a
// la que enlazar un movimiento) donde desplazarse por un <select> nativo es
// lento. Mismo aspecto que un ap-select normal; al escribir filtra por el
// texto de cada opción.
export function SearchableSelect({ value, onChange, options, emptyLabel = '— Ninguno —', placeholder = 'Buscar…', className = 'ap-select' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);

  const selected = options.find(o => o.value === value);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const pick = (optValue) => {
    onChange(optValue);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="ap-ssel" ref={containerRef}>
      <input
        className={className}
        value={open ? query : (selected ? selected.label : '')}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(''); }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div className="ap-ssel-menu">
          <div className="ap-ssel-option ap-ssel-option--empty" onMouseDown={e => e.preventDefault()} onClick={() => pick('')}>{emptyLabel}</div>
          {filtered.length === 0 ? (
            <div className="ap-ssel-empty">Sin resultados</div>
          ) : filtered.map(o => (
            <div
              key={o.value}
              className={`ap-ssel-option${o.value === value ? ' is-selected' : ''}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(o.value)}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
