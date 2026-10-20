import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Plus, Trash2, Copy, FileDown, ArrowLeft, Table2, Undo2, Redo2, Bold, Italic, AlignLeft, AlignCenter, AlignRight, Sigma, FileText } from 'lucide-react';
import api from '../services/api';
import { calculaHoja, textoCelda, refA1, colLetra, parseRef, insertaEliminaEje, desplazaFormula } from '../utils/hojaFormulas';
import './SectionHojas.css';

// Hojas: un «Excel» sencillo dentro del CRM para listados y cuentas rápidas. Se guardan solas, llevan fórmulas
// (=SUMA(B2:B9), =B2*C2, =SI(…)), se pegan desde Excel y se exportan a PDF o CSV. Cada persona ve las suyas.

const COLS0 = 8, FILAS0 = 30, ANCHO0 = 110;
const FORMATOS = [['gen', 'General'], ['n0', 'Número'], ['n2', '0,00'], ['eur', 'Euros €'], ['pct', 'Porcentaje %']];
const COLORES_TXT = ['#2a2622', '#b3402f', '#1f6f78', '#2f7d4f', '#8f8173'];
const COLORES_BG = ['', '#f1ede7', '#fdf3c8', '#d9efe0', '#d9e8f5', '#f6dcd5'];

const vacia = (cols = COLS0, filas = FILAS0) => ({ v: 1, cols, filas, celdas: {}, anchos: {}, alturas: {} });
const PLANTILLAS = [
  { id: 'blanco', nombre: 'En blanco', desc: 'Para lo que se te ocurra', datos: () => vacia() },
  {
    id: 'materiales', nombre: 'Lista de materiales', desc: 'Concepto, cantidad, precio y total', datos: () => {
      const d = vacia(5, 24); const c = d.celdas, enc = { b: true, bg: '#f1ede7' };
      ['Concepto', 'Cantidad', 'Precio ud.', 'Total', 'Notas'].forEach((t, i) => { c[refA1(i, 0)] = { v: t, f: enc }; });
      for (let r = 1; r <= 14; r++) { c[refA1(3, r)] = { v: `=B${r + 1}*C${r + 1}`, f: { fmt: 'eur' } }; c[refA1(2, r)] = { v: '', f: { fmt: 'eur' } }; }
      c[refA1(0, 16)] = { v: 'TOTAL', f: { b: true } }; c[refA1(3, 16)] = { v: '=SUMA(D2:D15)', f: { b: true, fmt: 'eur' } };
      d.anchos = { A: 240, E: 200 }; return d;
    },
  },
  {
    id: 'cuentas', nombre: 'Cuentas rápidas', desc: 'Ingresos, gastos y saldo', datos: () => {
      const d = vacia(5, 30); const c = d.celdas, enc = { b: true, bg: '#f1ede7' };
      ['Fecha', 'Concepto', 'Ingreso', 'Gasto', 'Saldo'].forEach((t, i) => { c[refA1(i, 0)] = { v: t, f: enc }; });
      for (let r = 1; r <= 24; r++) { c[refA1(2, r)] = { v: '', f: { fmt: 'eur' } }; c[refA1(3, r)] = { v: '', f: { fmt: 'eur' } }; c[refA1(4, r)] = { v: `=SUMA(C$2:C${r + 1})-SUMA(D$2:D${r + 1})`, f: { fmt: 'eur', b: true } }; }
      d.anchos = { B: 240 }; return d;
    },
  },
  {
    id: 'presupuesto', nombre: 'Presupuesto rápido', desc: 'Partidas con IVA y total', datos: () => {
      const d = vacia(5, 26); const c = d.celdas, enc = { b: true, bg: '#f1ede7' };
      ['Partida', 'Medición', 'Unidad', 'Precio', 'Importe'].forEach((t, i) => { c[refA1(i, 0)] = { v: t, f: enc }; });
      for (let r = 1; r <= 16; r++) { c[refA1(3, r)] = { v: '', f: { fmt: 'eur' } }; c[refA1(4, r)] = { v: `=B${r + 1}*D${r + 1}`, f: { fmt: 'eur' } }; }
      c[refA1(3, 18)] = { v: 'Subtotal', f: { b: true, a: 'r' } }; c[refA1(4, 18)] = { v: '=SUMA(E2:E17)', f: { b: true, fmt: 'eur' } };
      c[refA1(3, 19)] = { v: 'IVA 21 %', f: { a: 'r' } }; c[refA1(4, 19)] = { v: '=E19*21%', f: { fmt: 'eur' } };
      c[refA1(3, 20)] = { v: 'TOTAL', f: { b: true, a: 'r' } }; c[refA1(4, 20)] = { v: '=E19+E20', f: { b: true, fmt: 'eur', bg: '#d9efe0' } };
      d.anchos = { A: 260 }; return d;
    },
  },
];

const clona = (o) => JSON.parse(JSON.stringify(o));
const ahora = (iso) => { const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return 'hace un momento'; if (s < 3600) return `hace ${Math.round(s / 60)} min`; if (s < 86400) return `hace ${Math.round(s / 3600)} h`; return new Date(iso).toLocaleDateString('es-ES'); };

export function SectionHojas() {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const [abierta, setAbierta] = useState(null); // { id, nombre, datos }
  const [nueva, setNueva] = useState(false);

  const cargar = useCallback(async () => {
    try { const { data } = await api.get('/hojas'); setLista(data.hojas || []); setError(''); }
    catch (e) { setLista([]); setError(e.response?.data?.error || 'No se pudieron cargar las hojas'); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const crear = async (pl) => {
    setNueva(false);
    try { const { data } = await api.post('/hojas', { nombre: pl.id === 'blanco' ? 'Hoja sin título' : pl.nombre, datos: pl.datos() }); setAbierta({ id: data.hoja.id, nombre: data.hoja.nombre, datos: data.hoja.datos }); }
    catch (e) { setError(e.response?.data?.error || 'No se pudo crear la hoja'); }
  };
  const abrir = async (id) => {
    try { const { data } = await api.get(`/hojas/${id}`); setAbierta({ id, nombre: data.hoja.nombre, datos: data.hoja.datos && data.hoja.datos.celdas ? data.hoja.datos : vacia() }); }
    catch (e) { setError(e.response?.data?.error || 'No se pudo abrir la hoja'); }
  };
  const duplicar = async (id) => {
    try { const { data } = await api.get(`/hojas/${id}`); await api.post('/hojas', { nombre: `${data.hoja.nombre} (copia)`, datos: data.hoja.datos }); cargar(); }
    catch (e) { setError(e.response?.data?.error || 'No se pudo duplicar'); }
  };
  const borrar = async (h) => {
    if (!window.confirm(`¿Borrar la hoja «${h.nombre}»? No se puede deshacer.`)) return;
    try { await api.delete(`/hojas/${h.id}`); cargar(); } catch (e) { setError(e.response?.data?.error || 'No se pudo borrar'); }
  };

  if (abierta) return <EditorHoja hoja={abierta} onSalir={() => { setAbierta(null); cargar(); }} />;

  return (
    <div className="hj">
      <div className="hj-top">
        <div>
          <h2 className="hj-h"><Table2 size={20} /> Hojas</h2>
          <p className="hj-sub">Hojas de cálculo rápidas para listados y cuentas. Se guardan solas y se exportan a PDF.</p>
        </div>
        <button type="button" className="hj-btn hj-pri" onClick={() => setNueva(n => !n)}><Plus size={14} /> Nueva hoja</button>
      </div>
      {error && <p className="hj-err">{error}</p>}
      {nueva && (
        <div className="hj-plantillas">
          {PLANTILLAS.map(p => (
            <button key={p.id} type="button" className="hj-plant" onClick={() => crear(p)}><b>{p.nombre}</b><span>{p.desc}</span></button>
          ))}
        </div>
      )}
      {lista === null && <p className="hj-sub">Cargando…</p>}
      {lista && lista.length === 0 && !error && <p className="hj-sub" style={{ marginTop: 18 }}>Todavía no tienes hojas. Pulsa «Nueva hoja» para empezar.</p>}
      <div className="hj-grid">
        {(lista || []).map(h => (
          <div key={h.id} className="hj-card" onClick={() => abrir(h.id)}>
            <Table2 size={18} className="hj-card-i" />
            <div className="hj-card-t"><b>{h.nombre}</b><span>Editada {ahora(h.updated_at)}</span></div>
            <button type="button" className="hj-ico" title="Duplicar" onClick={e => { e.stopPropagation(); duplicar(h.id); }}><Copy size={14} /></button>
            <button type="button" className="hj-ico" title="Borrar" onClick={e => { e.stopPropagation(); borrar(h); }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── editor ─────────────────────────
function EditorHoja({ hoja, onSalir }) {
  const [nombre, setNombre] = useState(hoja.nombre);
  const [datos, setDatosRaw] = useState(() => ({ ...vacia(), ...hoja.datos }));
  const [guardado, setGuardado] = useState('Guardado');
  const [sel, setSel] = useState({ ac: 0, af: 0, c: 0, f: 0 }); // ancla y celda activa
  const [ed, setEd] = useState(null); // { c, f, texto }
  const hist = useRef([]); const rehacer = useRef([]);
  const sucio = useRef(false); const temporizador = useRef(0);
  const datosRef = useRef(datos); datosRef.current = datos;
  const nombreRef = useRef(nombre); nombreRef.current = nombre;
  const caja = useRef(null); const inputEd = useRef(null);
  const arrastrando = useRef(false);

  const calc = useMemo(() => calculaHoja(datos), [datos]);

  const guardar = useCallback(async () => {
    clearTimeout(temporizador.current);
    if (!sucio.current) return;
    sucio.current = false; setGuardado('Guardando…');
    try { await api.put(`/hojas/${hoja.id}`, { nombre: nombreRef.current, datos: datosRef.current }); setGuardado('Guardado'); }
    catch (e) { sucio.current = true; setGuardado(e.response?.data?.error || 'No se pudo guardar'); }
  }, [hoja.id]);
  const programa = useCallback(() => { sucio.current = true; setGuardado('Sin guardar…'); clearTimeout(temporizador.current); temporizador.current = setTimeout(guardar, 1100); }, [guardar]);
  useEffect(() => () => { clearTimeout(temporizador.current); if (sucio.current) api.put(`/hojas/${hoja.id}`, { nombre: nombreRef.current, datos: datosRef.current }).catch(() => {}); }, [hoja.id]);

  // todo cambio pasa por aquí: guarda el estado anterior para deshacer
  const cambia = useCallback((fn, sinHistoria) => {
    setDatosRaw(prev => { const nuevo = fn(clona(prev)); if (!sinHistoria) { hist.current.push(prev); if (hist.current.length > 60) hist.current.shift(); rehacer.current = []; } return nuevo; });
    programa();
  }, [programa]);
  const deshacer = () => { const p = hist.current.pop(); if (!p) return; rehacer.current.push(datosRef.current); setDatosRaw(p); programa(); };
  const rehace = () => { const p = rehacer.current.pop(); if (!p) return; hist.current.push(datosRef.current); setDatosRaw(p); programa(); };

  const r = { c0: Math.min(sel.ac, sel.c), c1: Math.max(sel.ac, sel.c), f0: Math.min(sel.af, sel.f), f1: Math.max(sel.af, sel.f) };
  const key = (c, f) => refA1(c, f);
  const crudo = (c, f) => (datos.celdas[key(c, f)] || {}).v ?? '';
  const estilo = (c, f) => (datos.celdas[key(c, f)] || {}).f || {};

  const poner = (d, c, f, v) => { const k = key(c, f); const cel = d.celdas[k] || {}; if (v === '' && !cel.f) delete d.celdas[k]; else d.celdas[k] = { ...cel, v }; return d; };
  const ponEstilo = (d, c, f, parche) => { const k = key(c, f); const cel = d.celdas[k] || { v: '' }; const nf = { ...(cel.f || {}), ...parche }; Object.keys(nf).forEach(x => { if (nf[x] === false || nf[x] === '' || nf[x] == null || (x === 'a' && nf[x] === 'auto') || (x === 'fmt' && nf[x] === 'gen')) delete nf[x]; }); d.celdas[k] = { ...cel, f: nf }; if (cel.v === '' && !Object.keys(nf).length) delete d.celdas[k]; return d; };
  const alRango = (fn) => cambia(d => { for (let f = r.f0; f <= r.f1; f++) for (let c = r.c0; c <= r.c1; c++) fn(d, c, f); return d; });

  const mover = (dc, df, ext) => setSel(s => { const c = Math.max(0, Math.min(datosRef.current.cols - 1, s.c + dc)), f = Math.max(0, Math.min(datosRef.current.filas - 1, s.f + df)); return ext ? { ...s, c, f } : { ac: c, af: f, c, f }; });

  const empezarEdicion = (c, f, textoInicial) => { setEd({ c, f, texto: textoInicial ?? String(crudo(c, f)) }); setTimeout(() => { const i = inputEd.current; if (i) { i.focus(); if (textoInicial == null) i.setSelectionRange(i.value.length, i.value.length); } }, 0); };
  const terminarEdicion = (confirmar, dc = 0, df = 0) => {
    if (!ed) return;
    if (confirmar && ed.texto !== String(crudo(ed.c, ed.f))) cambia(d => poner(d, ed.c, ed.f, ed.texto));
    const { c, f } = ed; setEd(null);
    setSel({ ac: Math.max(0, Math.min(datosRef.current.cols - 1, c + dc)), af: Math.max(0, Math.min(datosRef.current.filas - 1, f + df)), c: Math.max(0, Math.min(datosRef.current.cols - 1, c + dc)), f: Math.max(0, Math.min(datosRef.current.filas - 1, f + df)) });
    setTimeout(() => caja.current && caja.current.focus(), 0);
  };

  const copiar = (cortar) => {
    const filas = []; const interno = { w: r.c1 - r.c0 + 1, h: r.f1 - r.f0 + 1, celdas: [], c0: r.c0, f0: r.f0 };
    for (let f = r.f0; f <= r.f1; f++) { const fila = []; for (let c = r.c0; c <= r.c1; c++) { fila.push(textoCelda(calc.valor(c, f), estilo(c, f).fmt)); interno.celdas.push(clona(datos.celdas[key(c, f)] || null)); } filas.push(fila.join('\t')); }
    window.__hojaPortapapeles = interno;
    if (cortar) alRango((d, c, f) => { delete d.celdas[key(c, f)]; });
    return filas.join('\n');
  };
  const pegar = (texto) => {
    const interno = window.__hojaPortapapeles;
    const filas = texto.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
    const igual = interno && interno.celdas.length === filas.length * (filas[0] || []).length && interno.celdas.every((_, i) => true);
    cambia(d => {
      const f0 = sel.af <= sel.f ? sel.af : sel.f, c0 = Math.min(sel.ac, sel.c);
      let maxF = d.filas, maxC = d.cols;
      if (igual && interno && filas.length === interno.h && (filas[0] || []).length === interno.w) {
        interno.celdas.forEach((cel, i) => {
          const dc = i % interno.w, df = Math.floor(i / interno.w), c = c0 + dc, f = f0 + df;
          if (c >= 40 || f >= 500) return;
          maxF = Math.max(maxF, f + 1); maxC = Math.max(maxC, c + 1);
          if (!cel) delete d.celdas[key(c, f)]; else { const n = clona(cel); if (typeof n.v === 'string' && n.v[0] === '=') n.v = desplazaFormula(n.v, c - (interno.c0 + dc), f - (interno.f0 + df)); d.celdas[key(c, f)] = n; }
        });
      } else {
        filas.forEach((fila, df) => fila.forEach((v, dc) => { const c = c0 + dc, f = f0 + df; if (c >= 40 || f >= 500) return; maxF = Math.max(maxF, f + 1); maxC = Math.max(maxC, c + 1); poner(d, c, f, v); }));
      }
      d.filas = maxF; d.cols = maxC; return d;
    });
  };

  const alTeclado = (e) => {
    if (ed) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? rehace() : deshacer(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); rehace(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); alternar('b'); return; }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); alternar('i'); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); cambia(d => { for (let f = r.f0 + 1; f <= r.f1; f++) for (let c = r.c0; c <= r.c1; c++) { const o = d.celdas[key(c, r.f0)]; if (o) { const n = clona(o); if (typeof n.v === 'string' && n.v[0] === '=') n.v = desplazaFormula(n.v, 0, f - r.f0); d.celdas[key(c, f)] = n; } else delete d.celdas[key(c, f)]; } return d; }); return; }
    if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); cambia(d => { for (let c = r.c0 + 1; c <= r.c1; c++) for (let f = r.f0; f <= r.f1; f++) { const o = d.celdas[key(r.c0, f)]; if (o) { const n = clona(o); if (typeof n.v === 'string' && n.v[0] === '=') n.v = desplazaFormula(n.v, c - r.c0, 0); d.celdas[key(c, f)] = n; } else delete d.celdas[key(c, f)]; } return d; }); return; }
    if (mod) return; // copiar, cortar y pegar: eventos propios
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); mover(0, 1, e.shiftKey); break;
      case 'ArrowUp': e.preventDefault(); mover(0, -1, e.shiftKey); break;
      case 'ArrowLeft': e.preventDefault(); mover(-1, 0, e.shiftKey); break;
      case 'ArrowRight': e.preventDefault(); mover(1, 0, e.shiftKey); break;
      case 'Tab': e.preventDefault(); mover(e.shiftKey ? -1 : 1, 0); break;
      case 'Enter': e.preventDefault(); empezarEdicion(sel.c, sel.f); break;
      case 'F2': e.preventDefault(); empezarEdicion(sel.c, sel.f); break;
      case 'Delete': case 'Backspace': e.preventDefault(); alRango((d, c, f) => { const k = key(c, f), cel = d.celdas[k]; if (!cel) return; if (cel.f && Object.keys(cel.f).length) d.celdas[k] = { ...cel, v: '' }; else delete d.celdas[k]; }); break;
      case 'Escape': break;
      default:
        if (e.key.length === 1 && !e.altKey) { e.preventDefault(); empezarEdicion(sel.c, sel.f, e.key); }
    }
  };
  const alCopiar = (e, cortar) => { if (ed) return; e.preventDefault(); e.clipboardData.setData('text/plain', copiar(cortar)); };
  const alPegar = (e) => { if (ed) return; e.preventDefault(); pegar(e.clipboardData.getData('text/plain') || ''); };

  const alternar = (campo) => { const actual = !!estilo(sel.c, sel.f)[campo]; alRango((d, c, f) => ponEstilo(d, c, f, { [campo]: !actual })); };
  const poneAlineacion = (a) => alRango((d, c, f) => ponEstilo(d, c, f, { a }));
  const poneFormato = (fmt) => alRango((d, c, f) => ponEstilo(d, c, f, { fmt }));
  const poneColor = (col) => alRango((d, c, f) => ponEstilo(d, c, f, { col }));
  const poneFondo = (bg) => alRango((d, c, f) => ponEstilo(d, c, f, { bg }));

  const autosuma = () => {
    cambia(d => {
      const { c, f } = sel;
      if (r.c0 !== r.c1 || r.f0 !== r.f1) { // un rango: la suma va justo debajo (o a la derecha si es una fila)
        if (r.c0 === r.c1 || r.f0 !== r.f1) { poner(d, r.c0, r.f1 + 1, `=SUMA(${refA1(r.c0, r.f0)}:${refA1(r.c0, r.f1)})`); d.filas = Math.max(d.filas, r.f1 + 2); if (r.c1 > r.c0) for (let cc = r.c0 + 1; cc <= r.c1; cc++) poner(d, cc, r.f1 + 1, `=SUMA(${refA1(cc, r.f0)}:${refA1(cc, r.f1)})`); }
        else poner(d, r.c1 + 1, r.f0, `=SUMA(${refA1(r.c0, r.f0)}:${refA1(r.c1, r.f0)})`);
        return d;
      }
      let ff = f - 1; while (ff >= 0 && typeof calc.valor(c, ff) === 'number') ff--; // números seguidos encima de la celda
      if (ff < f - 1) poner(d, c, f, `=SUMA(${refA1(c, ff + 1)}:${refA1(c, f - 1)})`);
      return d;
    });
  };
  const insertaFila = (delta) => cambia(d => insertaEliminaEje(d, 'f', delta > 0 ? sel.f + 1 : sel.f, delta));
  const insertaCol = (delta) => cambia(d => insertaEliminaEje(d, 'c', delta > 0 ? sel.c + 1 : sel.c, delta));

  // exportaciones
  const rangoUsado = () => { let mf = -1, mc = -1; Object.keys(datos.celdas).forEach(k => { const p = parseRef(k); const cel = datos.celdas[k]; if (p && (cel.v !== '' || (cel.f && cel.f.bg))) { mf = Math.max(mf, p.f); mc = Math.max(mc, p.c); } }); return { mf, mc }; };
  const exportarPDF = async () => {
    const { mf, mc } = rangoUsado();
    if (mf < 0) { window.alert('La hoja está vacía'); return; }
    await guardar();
    const filas = []; for (let f = 0; f <= mf; f++) { const fila = []; for (let c = 0; c <= mc; c++) { const v = calc.valor(c, f), st = estilo(c, f); fila.push({ t: textoCelda(v, st.fmt), b: !!st.b, i: !!st.i, a: st.a || (typeof v === 'number' ? 'r' : 'l'), col: st.col || '', bg: st.bg || '' }); } filas.push(fila); }
    try {
      const { data } = await api.post('/hojas/pdf', { titulo: nombre, filas, anchos: Array.from({ length: mc + 1 }, (_, c) => datos.anchos[colLetra(c)] || ANCHO0) }, { responseType: 'blob' });
      const url = URL.createObjectURL(data), a = document.createElement('a'); a.href = url; a.download = `${nombre.replace(/[^\w\- ]+/g, '').trim() || 'hoja'}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { window.alert('No se pudo crear el PDF'); }
  };
  const exportarCSV = () => {
    const { mf, mc } = rangoUsado(); if (mf < 0) return;
    const esc = (t) => (/[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
    const csv = Array.from({ length: mf + 1 }, (_, f) => Array.from({ length: mc + 1 }, (_, c) => esc(textoCelda(calc.valor(c, f), estilo(c, f).fmt))).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${nombre.replace(/[^\w\- ]+/g, '').trim() || 'hoja'}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  // redimensionar columnas
  const redim = (c, e) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = datos.anchos[colLetra(c)] || ANCHO0;
    const mueve = (ev) => cambia(d => { d.anchos[colLetra(c)] = Math.max(40, Math.min(600, Math.round(w0 + ev.clientX - x0))); return d; }, true);
    const suelta = () => { window.removeEventListener('mousemove', mueve); window.removeEventListener('mouseup', suelta); };
    window.addEventListener('mousemove', mueve); window.addEventListener('mouseup', suelta);
  };

  const celdaActiva = datos.celdas[key(sel.c, sel.f)] || {};
  const st = celdaActiva.f || {};
  const enSel = (c, f) => c >= r.c0 && c <= r.c1 && f >= r.f0 && f <= r.f1;

  return (
    <div className="hj hj-ed">
      <div className="hj-top">
        <button type="button" className="hj-btn" onClick={async () => { await guardar(); onSalir(); }}><ArrowLeft size={14} /> Hojas</button>
        <input className="hj-nombre" value={nombre} maxLength={120} onChange={e => { setNombre(e.target.value); programa(); }} aria-label="Nombre de la hoja" />
        <span className="hj-estado">{guardado}</span>
        <div className="hj-grupo">
          <button type="button" className="hj-btn" onClick={exportarPDF}><FileDown size={14} /> PDF</button>
          <button type="button" className="hj-btn" onClick={exportarCSV}><FileText size={14} /> CSV</button>
        </div>
      </div>

      <div className="hj-barra">
        <button type="button" className="hj-ico" title="Deshacer (Ctrl+Z)" onClick={deshacer}><Undo2 size={15} /></button>
        <button type="button" className="hj-ico" title="Rehacer (Ctrl+Y)" onClick={rehace}><Redo2 size={15} /></button>
        <span className="hj-sep" />
        <button type="button" className={'hj-ico' + (st.b ? ' on' : '')} title="Negrita (Ctrl+B)" onClick={() => alternar('b')}><Bold size={15} /></button>
        <button type="button" className={'hj-ico' + (st.i ? ' on' : '')} title="Cursiva (Ctrl+I)" onClick={() => alternar('i')}><Italic size={15} /></button>
        <button type="button" className={'hj-ico' + (st.a === 'l' ? ' on' : '')} title="Alinear a la izquierda" onClick={() => poneAlineacion('l')}><AlignLeft size={15} /></button>
        <button type="button" className={'hj-ico' + (st.a === 'c' ? ' on' : '')} title="Centrar" onClick={() => poneAlineacion('c')}><AlignCenter size={15} /></button>
        <button type="button" className={'hj-ico' + (st.a === 'r' ? ' on' : '')} title="Alinear a la derecha" onClick={() => poneAlineacion('r')}><AlignRight size={15} /></button>
        <span className="hj-sep" />
        <select className="hj-sel" value={st.fmt || 'gen'} onChange={e => poneFormato(e.target.value)} title="Formato de número">{FORMATOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        <span className="hj-colores" title="Color del texto">{COLORES_TXT.map(c => <button key={c} type="button" className={'hj-col' + (st.col === c ? ' on' : '')} style={{ background: c }} onClick={() => poneColor(c)} aria-label={`Texto ${c}`} />)}</span>
        <span className="hj-colores" title="Color de fondo">{COLORES_BG.map(c => <button key={c || 'nada'} type="button" className={'hj-col hj-fondo' + ((st.bg || '') === c ? ' on' : '')} style={{ background: c || '#fff' }} onClick={() => poneFondo(c)} aria-label={c ? `Fondo ${c}` : 'Sin fondo'}>{c ? '' : '∅'}</button>)}</span>
        <span className="hj-sep" />
        <button type="button" className="hj-btn hj-peq" title="Suma los números de encima (o del rango seleccionado)" onClick={autosuma}><Sigma size={14} /> Autosuma</button>
        <button type="button" className="hj-btn hj-peq" onClick={() => insertaFila(1)}>+ Fila</button>
        <button type="button" className="hj-btn hj-peq" onClick={() => insertaFila(-1)}>− Fila</button>
        <button type="button" className="hj-btn hj-peq" onClick={() => insertaCol(1)}>+ Col.</button>
        <button type="button" className="hj-btn hj-peq" onClick={() => insertaCol(-1)}>− Col.</button>
      </div>

      <div className="hj-formula">
        <span className="hj-celda">{r.c0 === r.c1 && r.f0 === r.f1 ? refA1(sel.c, sel.f) : `${refA1(r.c0, r.f0)}:${refA1(r.c1, r.f1)}`}</span>
        <input className="hj-f" value={ed && ed.c === sel.c && ed.f === sel.f ? ed.texto : String(crudo(sel.c, sel.f))} placeholder="Escribe un valor o una fórmula (=SUMA(B2:B9))"
          onFocus={() => { if (!ed) empezarEdicion(sel.c, sel.f); }}
          onChange={e => setEd({ c: sel.c, f: sel.f, texto: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); terminarEdicion(true, 0, 1); } else if (e.key === 'Escape') { terminarEdicion(false); } }} />
      </div>

      <div className="hj-scroll" ref={caja} tabIndex={0} onKeyDown={alTeclado} onCopy={e => alCopiar(e, false)} onCut={e => alCopiar(e, true)} onPaste={alPegar} onMouseUp={() => { arrastrando.current = false; }}>
        <table className="hj-tabla">
          <colgroup><col style={{ width: 38 }} />{Array.from({ length: datos.cols }, (_, c) => <col key={c} style={{ width: datos.anchos[colLetra(c)] || ANCHO0 }} />)}</colgroup>
          <thead>
            <tr>
              <th className="hj-esq" onClick={() => setSel({ ac: 0, af: 0, c: datos.cols - 1, f: datos.filas - 1 })} />
              {Array.from({ length: datos.cols }, (_, c) => (
                <th key={c} className={'hj-cab' + (c >= r.c0 && c <= r.c1 ? ' on' : '')} onClick={e => setSel(s => (e.shiftKey ? { ...s, c, af: 0, f: datos.filas - 1 } : { ac: c, af: 0, c, f: datos.filas - 1 }))}>
                  {colLetra(c)}<i className="hj-asa" onMouseDown={e => redim(c, e)} onClick={e => e.stopPropagation()} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: datos.filas }, (_, f) => (
              <tr key={f}>
                <th className={'hj-cab hj-fila' + (f >= r.f0 && f <= r.f1 ? ' on' : '')} onClick={e => setSel(s => (e.shiftKey ? { ...s, f, ac: 0, c: datos.cols - 1 } : { ac: 0, af: f, c: datos.cols - 1, f }))}>{f + 1}</th>
                {Array.from({ length: datos.cols }, (_, c) => {
                  const cel = datos.celdas[key(c, f)]; const s = (cel && cel.f) || {}; const v = calc.valor(c, f);
                  const editando = ed && ed.c === c && ed.f === f;
                  const activa = sel.c === c && sel.f === f;
                  const alin = s.a || (typeof v === 'number' ? 'r' : 'l');
                  return (
                    <td key={c} className={'hj-td' + (enSel(c, f) ? ' sel' : '') + (activa ? ' act' : '') + (v && typeof v === 'object' ? ' err' : '')}
                      style={{ textAlign: alin === 'c' ? 'center' : alin === 'r' ? 'right' : 'left', fontWeight: s.b ? 700 : undefined, fontStyle: s.i ? 'italic' : undefined, color: s.col || undefined, background: s.bg && !enSel(c, f) ? s.bg : undefined }}
                      onMouseDown={e => { if (ed && !(ed.c === c && ed.f === f)) terminarEdicion(true); arrastrando.current = true; setSel(p => (e.shiftKey ? { ...p, c, f } : { ac: c, af: f, c, f })); if (caja.current && !editando) setTimeout(() => caja.current && caja.current.focus(), 0); }}
                      onMouseEnter={() => { if (arrastrando.current) setSel(p => ({ ...p, c, f })); }}
                      onDoubleClick={() => empezarEdicion(c, f)}>
                      {editando
                        ? <input ref={inputEd} className="hj-in" value={ed.texto} onChange={e => setEd({ ...ed, texto: e.target.value })} onBlur={() => terminarEdicion(true)}
                          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); terminarEdicion(true, 0, 1); } else if (e.key === 'Tab') { e.preventDefault(); terminarEdicion(true, e.shiftKey ? -1 : 1, 0); } else if (e.key === 'Escape') { e.preventDefault(); terminarEdicion(false); } }} />
                        : textoCelda(v, s.fmt)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hj-mas">
          <button type="button" className="hj-btn hj-peq" onClick={() => cambia(d => { d.filas = Math.min(500, d.filas + 20); return d; }, true)}>+ 20 filas</button>
          <button type="button" className="hj-btn hj-peq" onClick={() => cambia(d => { d.cols = Math.min(40, d.cols + 4); return d; }, true)}>+ 4 columnas</button>
        </div>
      </div>
      <p className="hj-ayuda">Haz doble clic o escribe en una celda · Enter baja · Tab avanza · Ctrl+C / V copia y pega (también desde Excel) · Ctrl+D rellena hacia abajo · fórmulas como =SUMA(B2:B9), =B2*C2, =SI(B2&gt;0;"sí";"no")</p>
    </div>
  );
}
