import PDFDocument from 'pdfkit';

// PDF de la historia del Proyecto creativo (formato apaisado, para
// presentar o imprimir). Usa los mismos datos que ve el cliente en su
// portal: capítulos visibles, bloques con contenido, servicios y planos
// marcados como visibles. pdfkit solo admite JPG y PNG: las imágenes en
// otro formato (webp) se omiten sin romper el documento.

const W = 841.89;
const H = 595.28;
const M = 48;
const INK = '#2a2622';
const BEIGE = '#beb0a2';
const BEIGE_D = '#8f8173';
const PAPER = '#faf8f5';
const SOFT = '#f1ede7';
const TXT = '#5d554d';

// sharp (si está disponible) reduce y convierte a JPG para que el PDF pese poco
// y admita también webp; sin sharp se usan los PNG/JPG tal cual.
let sharpPromise = null;
const cargarSharp = () => (sharpPromise ||= import('sharp').then(m => m.default).catch(() => null));

// Devuelve un data URI (pdfkit lo cachea por valor: la misma imagen usada
// varias veces se incrusta una sola vez en el PDF).
async function descargarImagen(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    let buf = Buffer.from(await r.arrayBuffer());
    const sharp = await cargarSharp();
    if (sharp) {
      try {
        buf = await sharp(buf).rotate().resize({ width: 1800, height: 1200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
        return `data:image/jpeg;base64,${buf.toString('base64')}`;
      } catch { /* cae al formato original */ }
    }
    const png = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
    const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
    if (png) return `data:image/png;base64,${buf.toString('base64')}`;
    if (jpg) return `data:image/jpeg;base64,${buf.toString('base64')}`;
    return null;
  } catch { return null; }
}

function cubrir(doc, buf, x, y, w, h) {
  if (!buf) {
    doc.save().rect(x, y, w, h).fill(SOFT).restore();
    return;
  }
  try {
    doc.save();
    doc.rect(x, y, w, h).clip();
    doc.image(buf, x, y, { cover: [w, h], align: 'center', valign: 'center' });
    doc.restore();
  } catch {
    doc.restore();
    doc.save().rect(x, y, w, h).fill(SOFT).restore();
  }
}

function velo(doc, x, y, w, h, opacidad, color = '#14110f') {
  doc.save().fillOpacity(opacidad).fillColor(color).rect(x, y, w, h).fill().restore();
}

export async function generarHistoriaPdf(res, { project, historia, moodboard, responsable }) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false, info: { Title: `${project.project_name} — Proyecto creativo`, Author: 'Ranuse Design' } });
  doc.pipe(res);

  const nuevaPagina = (fondo = PAPER) => {
    doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
    if (fondo) doc.save().rect(0, 0, W, H).fill(fondo).restore();
  };
  const pie = (texto) => {
    doc.font('Helvetica').fontSize(7.5).fillColor(BEIGE_D).text(`RANUSE DESIGN  ·  ${texto}`.toUpperCase(), M, H - 28, { width: W - M * 2, characterSpacing: 1.2, lineBreak: false });
  };

  const capitulos = historia.capitulos;
  const esHome = historia.tipo_proyecto === 'home_gym';

  // Imágenes: se descargan todas en paralelo antes de dibujar
  const urls = new Set();
  if (project.cover_image_url) urls.add(project.cover_image_url);
  (moodboard?.images || []).slice(0, 4).forEach(i => urls.add(i.url));
  capitulos.forEach(c => {
    if (c.render_url) urls.add(c.render_url);
    c.bloques.forEach(b => b.imagen_url && urls.add(b.imagen_url));
    c.servicios.forEach(s => s.imagen_url && urls.add(s.imagen_url));
  });
  const lista = [...urls];
  const buffers = await Promise.all(lista.map(descargarImagen));
  const img = (url) => (url ? buffers[lista.indexOf(url)] || null : null);

  // ── Portada ─────────────────────────────────────────────────────────
  nuevaPagina('#2a2622');
  const portada = img(project.cover_image_url) || img(capitulos.find(c => c.render_url)?.render_url);
  if (portada) { cubrir(doc, portada, 0, 0, W, H); velo(doc, 0, 0, W, H, 0.5); }
  doc.font('Helvetica').fontSize(9).fillColor('#ffffff').fillOpacity(0.85)
    .text(`PROYECTO CREATIVO  ·  ${String(project.client_name || '').toUpperCase()}`, M + 24, H - 230, { width: W - 2 * M, characterSpacing: 3 });
  doc.fillOpacity(1).font('Helvetica-Bold').fontSize(40).fillColor('#ffffff')
    .text(project.project_name || 'Un día en tu espacio', M + 24, H - 205, { width: W - 2 * M - 80 });
  doc.font('Helvetica').fontSize(12).fillColor('#ffffff').fillOpacity(0.9)
    .text(`Antes de dibujar un solo plano, hemos imaginado cómo se vive cada momento. Esta es la historia de ${esHome ? 'tu home gym' : 'tu gimnasio'}.`, M + 24, H - 120, { width: 460 });
  doc.fillOpacity(1);

  // ── La atmósfera ────────────────────────────────────────────────────
  const paleta = moodboard?.palette || [];
  const imgsMood = (moodboard?.images || []).slice(0, 4);
  if (moodboard?.description || paleta.length || imgsMood.length) {
    nuevaPagina();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BEIGE_D).text('LA ATMÓSFERA', M, 56, { characterSpacing: 3 });
    doc.font('Helvetica').fontSize(26).fillColor(INK).text('El estilo que guía todo el proyecto.', M, 76, { width: W - 2 * M });
    if (moodboard?.description) doc.font('Helvetica').fontSize(11).fillColor(TXT).text(moodboard.description, M, 120, { width: 460, height: 90, ellipsis: true });
    paleta.slice(0, 8).forEach((hex, i) => {
      doc.save().circle(M + 22 + i * 52, 250, 20).fillAndStroke(hex, '#e4ddd3').restore();
    });
    if (imgsMood.length) {
      const gap = 12; const w = (W - 2 * M - gap * (imgsMood.length - 1)) / imgsMood.length;
      imgsMood.forEach((m, i) => cubrir(doc, img(m.url), M + i * (w + gap), 300, w, 220));
    }
    pie(project.project_name);
  }

  // ── Capítulos ───────────────────────────────────────────────────────
  for (let ci = 0; ci < capitulos.length; ci++) {
    const c = capitulos[ci];
    const num = String(ci + 1).padStart(2, '0');
    const render = img(c.render_url);

    // Página de apertura: render a pantalla completa con el título encima
    nuevaPagina(render ? '#14110f' : PAPER);
    if (render) {
      cubrir(doc, render, 0, 0, W, H);
      velo(doc, 0, H * 0.42, W, H * 0.58, 0.28);
      velo(doc, 0, H * 0.62, W, H * 0.38, 0.32);
    }
    const claro = render ? '#ffffff' : INK;
    doc.font('Helvetica').fontSize(54).fillColor(render ? BEIGE : BEIGE).text(num, M + 24, H - 230, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(26).fillColor(claro).text(c.titulo, M + 24, H - 165, { width: W - 2 * M - 80 });
    if (c.texto) doc.font('Helvetica').fontSize(11).fillColor(claro).text(c.texto, M + 24, H - 128, { width: 520, height: 80, ellipsis: true });

    // Contenido del capítulo (bloques + servicios) en páginas siguientes
    const hayContenido = c.bloques.length || c.servicios.length;
    if (!hayContenido) continue;

    let y = 0;
    const paginaContenido = () => {
      nuevaPagina();
      doc.font('Helvetica-Bold').fontSize(8).fillColor(BEIGE_D).text(`${num}  ·  ${c.titulo.toUpperCase()}`, M, 40, { characterSpacing: 2.5, lineBreak: false });
      pie(project.project_name);
      y = 70;
    };
    const necesito = (alto) => { if (y + alto > H - 50) paginaContenido(); };
    paginaContenido();

    // Agrupa zonas / detalles consecutivos
    const grupos = [];
    c.bloques.forEach(b => {
      // Todas las zonas (y detalles) del capítulo juntos, en la posición de la primera
      const existente = (b.tipo === 'zona' || b.tipo === 'detalle') ? grupos.find(g => g.tipo === b.tipo) : null;
      if (existente) existente.items.push(b);
      else grupos.push({ tipo: b.tipo, items: [b] });
    });

    for (const g of grupos) {
      if (g.tipo === 'render') {
        for (const b of g.items) {
          necesito(236);
          cubrir(doc, img(b.imagen_url), M, y, W - 2 * M, 200);
          const pieTxt = [b.titulo, b.texto].filter(Boolean).join(' — ');
          if (pieTxt) doc.font('Helvetica').fontSize(8.5).fillColor(BEIGE_D).text(pieTxt, M, y + 206, { width: W - 2 * M, height: 24, ellipsis: true });
          y += 236;
        }
      } else if (g.tipo === 'imagen_texto') {
        const b = g.items[0];
        necesito(224);
        const imgDerecha = b.lado !== 'izquierda';
        const wi = 330; const wt = W - 2 * M - wi - 36;
        const xi = imgDerecha ? W - M - wi : M; const xt = imgDerecha ? M : M + wi + 36;
        if (b.imagen_url) cubrir(doc, img(b.imagen_url), xi, y, wi, 190);
        if (b.titulo) doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(b.titulo, b.imagen_url ? xt : M, y + 10, { width: b.imagen_url ? wt : 520 });
        if (b.texto) doc.font('Helvetica').fontSize(10.5).fillColor(TXT).text(b.texto, b.imagen_url ? xt : M, doc.y + 8, { width: b.imagen_url ? wt : 520, height: 150, ellipsis: true });
        y += 224;
      } else if (g.tipo === 'zona') {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(BEIGE_D);
        necesito(230);
        doc.text(g.items.length > 1 ? 'LAS ZONAS' : 'LA ZONA', M, y, { characterSpacing: 2.5, lineBreak: false });
        y += 20;
        const cols = 3; const gap = 14; const wc = (W - 2 * M - gap * (cols - 1)) / cols;
        for (let i = 0; i < g.items.length; i += cols) {
          necesito(230);
          g.items.slice(i, i + cols).forEach((z, k) => {
            const x = M + k * (wc + gap);
            doc.save().rect(x, y, wc, 205).fill(SOFT).restore();
            let yy = y;
            if (z.imagen_url) { cubrir(doc, img(z.imagen_url), x, y, wc, 95); yy = y + 95; }
            doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(z.titulo || '', x + 12, yy + 10, { width: wc - 24, lineBreak: false });
            if (z.texto) doc.font('Helvetica').fontSize(8.5).fillColor(TXT).text(z.texto, x + 12, yy + 26, { width: wc - 24, height: 24, ellipsis: true });
            (z.elementos || []).slice(0, 4).forEach((el, ei) => {
              doc.font('Helvetica').fontSize(8.5).fillColor(TXT).text(`·  ${el}`, x + 12, yy + (z.texto ? 54 : 30) + ei * 12, { width: wc - 24, lineBreak: false });
            });
          });
          y += 220;
        }
      } else if (g.tipo === 'detalle') {
        necesito(210);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(BEIGE_D).text('DETALLES QUE MARCAN LA DIFERENCIA', M, y, { characterSpacing: 2.5, lineBreak: false });
        y += 20;
        const cols = 4; const gap = 14; const wc = (W - 2 * M - gap * (cols - 1)) / cols;
        for (let i = 0; i < g.items.length; i += cols) {
          necesito(190);
          g.items.slice(i, i + cols).forEach((d, k) => {
            const x = M + k * (wc + gap);
            if (d.imagen_url) cubrir(doc, img(d.imagen_url), x, y, wc, 110);
            doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(d.titulo || '', x, y + 118, { width: wc, lineBreak: false });
            if (d.texto) doc.font('Helvetica').fontSize(8.5).fillColor(TXT).text(d.texto, x, y + 133, { width: wc, height: 36, ellipsis: true });
          });
          y += 180;
        }
      }
    }

    if (c.servicios.length) {
      necesito(130);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(BEIGE_D).text('SERVICIOS EN ESTE MOMENTO', M, y, { characterSpacing: 2.5, lineBreak: false });
      y += 20;
      const cols = 3; const gap = 14; const wc = (W - 2 * M - gap * (cols - 1)) / cols;
      for (let i = 0; i < c.servicios.length; i += cols) {
        necesito(110);
        c.servicios.slice(i, i + cols).forEach((s, k) => {
          const x = M + k * (wc + gap);
          doc.save().roundedRect(x, y, wc, 96, 4).lineWidth(0.7).strokeColor('#e4ddd3').stroke().restore();
          const etiqueta = s.etiqueta === 'wow' ? 'WOW' : s.etiqueta === 'extra' ? 'EXTRA' : 'INCLUIDO';
          doc.font('Helvetica-Bold').fontSize(6.5).fillColor(s.etiqueta === 'wow' ? INK : BEIGE_D).text(etiqueta, x + 12, y + 11, { characterSpacing: 1.5, lineBreak: false });
          doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(s.nombre, x + 12, y + 25, { width: wc - 24, lineBreak: false });
          if (s.descripcion) doc.font('Helvetica').fontSize(8.5).fillColor(TXT).text(s.descripcion, x + 12, y + 42, { width: wc - 24, height: 46, ellipsis: true });
        });
        y += 110;
      }
    }
  }

  // ── Dossier ─────────────────────────────────────────────────────────
  nuevaPagina();
  doc.font('Helvetica-Bold').fontSize(8).fillColor(BEIGE_D).text('TU DOSSIER', M, 56, { characterSpacing: 3 });
  doc.font('Helvetica').fontSize(26).fillColor(INK).text('Todo lo que necesitas para avanzar, en un solo lugar.', M, 76, { width: 600 });
  const planos = historia.entregables || [];
  let yy = 150;
  if (planos.length) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Planos y documentos entregados', M, yy, { lineBreak: false });
    yy += 22;
    planos.slice(0, 10).forEach(p => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(p.nombre, M, yy, { width: 260, lineBreak: false });
      if (p.descripcion) doc.font('Helvetica').fontSize(9).fillColor(TXT).text(p.descripcion, M + 280, yy, { width: W - 2 * M - 280, height: 24, ellipsis: true });
      yy += 28;
    });
    yy += 6;
  }
  doc.font('Helvetica').fontSize(10.5).fillColor(TXT).text('Los materiales, el mobiliario, el programa de necesidades y todos los archivos están siempre disponibles en tu portal del proyecto, donde también puedes descargar todos los renders.', M, yy, { width: 560 });
  pie(project.project_name);

  // ── Siguiente paso ─────────────────────────────────────────────────
  nuevaPagina('#2a2622');
  doc.font('Helvetica-Bold').fontSize(8).fillColor(BEIGE).text('EL SIGUIENTE PASO', M, 150, { width: W - 2 * M, align: 'center', characterSpacing: 3 });
  doc.font('Helvetica').fontSize(34).fillColor('#ffffff').text('De la historia a la obra', M, 175, { width: W - 2 * M, align: 'center' });
  doc.font('Helvetica').fontSize(12).fillColor('#cfc6bb').text('Con la experiencia diseñada, nos ocupamos de que se construya exactamente así: documentación técnica, proveedores, partidas y acompañamiento.', 160, 235, { width: W - 320, align: 'center' });
  const pasos = ['Documentación técnica y especificaciones', 'Proveedores y partidas', 'Acompañamiento en obra'];
  pasos.forEach((p, i) => {
    const x = 160 + i * 190;
    doc.save().moveTo(x, 320).lineTo(x + 170, 320).lineWidth(0.7).strokeColor('#4a433c').stroke().restore();
    doc.font('Helvetica').fontSize(9.5).fillColor('#cfc6bb').text(p, x, 330, { width: 170 });
  });
  if (responsable?.email) doc.font('Helvetica-Bold').fontSize(11).fillColor(BEIGE).text(responsable.email, M, 420, { width: W - 2 * M, align: 'center' });

  doc.end();
}
