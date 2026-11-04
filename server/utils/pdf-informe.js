import PDFDocument from 'pdfkit';

// PDF sencillo con la imagen de Ranuse a partir de texto con formato mínimo:
//   "# Título", "## Subtítulo", "- viñeta", y el resto, párrafos.
const COL = { marca: '#beb0a2', oscuro: '#0a0a0a', texto: '#2b2622', gris: '#6b6259' };
const W = 595, H = 842, M = 54;

export function crearInformePdf({ titulo, contenido }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: M + 14, left: M, right: M }, bufferPages: true });
    const trozos = []; doc.on('data', c => trozos.push(c)); doc.on('end', () => resolve(Buffer.concat(trozos))); doc.on('error', reject);

    doc.rect(0, 0, W, 120).fill(COL.oscuro);
    doc.fillColor(COL.marca).font('Helvetica-Bold').fontSize(9).text('RANUSE DESIGN', M, 38, { characterSpacing: 2 });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text(titulo, M, 58, { width: W - 2 * M });
    doc.fillColor(COL.marca).font('Helvetica').fontSize(9).text(new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }), M, 100);
    doc.y = 150; doc.x = M;

    const espacio = (n) => { if (doc.y + n > H - M - 20) { doc.addPage(); doc.y = M; } };
    for (const crudo of String(contenido || '').split('\n')) {
      const l = crudo.replace(/\s+$/, '');
      if (!l.trim()) { doc.moveDown(0.4); continue; }
      if (/^# /.test(l)) { espacio(40); doc.moveDown(0.6).fillColor(COL.oscuro).font('Helvetica-Bold').fontSize(15).text(l.slice(2), M, doc.y, { width: W - 2 * M }); doc.moveTo(M, doc.y + 2).lineTo(W - M, doc.y + 2).strokeColor(COL.marca).lineWidth(0.6).stroke(); doc.moveDown(0.5); }
      else if (/^## /.test(l)) { espacio(30); doc.moveDown(0.4).fillColor(COL.gris).font('Helvetica-Bold').fontSize(11.5).text(l.slice(3), M, doc.y, { width: W - 2 * M }); doc.moveDown(0.2); }
      else if (/^\s*[-•*] /.test(l)) { espacio(18); doc.fillColor(COL.texto).font('Helvetica').fontSize(10.5).text('•  ' + l.replace(/^\s*[-•*] /, ''), M + 10, doc.y, { width: W - 2 * M - 10, indent: 0 }); doc.x = M; }
      else { espacio(18); doc.fillColor(COL.texto).font('Helvetica').fontSize(10.5).text(l, M, doc.y, { width: W - 2 * M, align: 'left' }); }
    }

    const n = doc.bufferedPageRange().count;
    for (let i = 0; i < n; i++) { doc.switchToPage(i); doc.fillColor(COL.gris).font('Helvetica').fontSize(8).text('Ranuse Design · ranusedesign.com   ·   ' + (i + 1) + '/' + n, M, H - 36, { width: W - 2 * M, align: 'center', lineBreak: false }); }
    doc.end();
  });
}
