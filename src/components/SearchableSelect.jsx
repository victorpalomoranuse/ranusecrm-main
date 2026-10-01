import { useEffect, useRef, useState } from 'react';

// Select con buscador por texto, para listas largas (ej. elegir una venta a
// la que enlazar un movimiento) donde desplazarse por un <select> nativo es
// lento. Mismo aspecto que un ap-select normal; al escribir filtra por el
// texto de cada opción, y al enfocarlo (sin escribir nada) se ve la lista
// entera, igual que al abrir un <select> normal.
//
// emptyLabel: si se pasa, añade una fila arriba para dejar el campo vacío
// (value=""). Omítelo en campos obligatorios donde no tenga sentido.
// allowCustom: si es true, cuando lo escrito no coincide con ninguna opción
// aparece una fila para usarlo tal cual como valor nuevo (ej. categorías,
// donde además de elegir una existente se puede crear una sobre la marcha).
export function SearchableSelect({ value, onChange, options, emptyLabel, allowCustom = false, placeholder = 'Buscar…', className = 'ap-select' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);

  const selected = options.find(o => o.value === value);
  // Si el valor actual no está en la lista de opciones (ej. una categoría
  // escrita a mano que ya se guardó antes), se muestra tal cual en vez de
  // dejar el campo vacío — así no parece que "se ha borrado".
  const displayValue = selected ? selected.label : (value || '');

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

  const q = query.trim();
  const filtered = q
    ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;
  const exactMatch = q && options.some(o => o.label.toLowerCase() === q.toLowerCase());
  const showCustomRow = allowCustom && q && !exactMatch;

  const pick = (optValue) => {
    onChange(optValue);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="ap-ssel" ref={containerRef}>
      <input
        className={className}
        value={open ? query : displayValue}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(''); }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div className="ap-ssel-menu">
          {emptyLabel && (
            <div className="ap-ssel-option ap-ssel-option--empty" onMouseDown={e => e.preventDefault()} onClick={() => pick('')}>{emptyLabel}</div>
          )}
          {showCustomRow && (
            <div className="ap-ssel-option ap-ssel-option--custom" onMouseDown={e => e.preventDefault()} onClick={() => pick(query.trim())}>
              + Usar "{query.trim()}"
            </div>
          )}
          {filtered.length === 0 && !showCustomRow ? (
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
