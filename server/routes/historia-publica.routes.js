import express from 'express';
import archiver from 'archiver';
import { supabase } from '../config/supabase.js';
import { getHistoriaPublica } from '../utils/historia.js';
import { generarHistoriaPdf } from '../utils/historia-pdf.js';

// Descargas públicas (con el código de acceso del cliente) de la historia.
// Solo sirven lo que el cliente ya ve en su portal.
const router = express.Router();

const limpio = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
const extension = (url, tipoMime) => {
  const m = /\.(png|jpe?g|webp)(\?|$)/i.exec(url);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  if (tipoMime?.includes('png')) return 'png';
  if (tipoMime?.includes('webp')) return 'webp';
  return 'jpg';
};

// ZIP con todos los renders del proyecto: el principal de cada capítulo y las
// imágenes de sus bloques, en el orden de la historia.
router.get('/:code/renders.zip', async (req, res) => {
  try {
    const { data: project } = await supabase.from('client_projects').select('id, project_name').eq('access_code', String(req.params.code).toUpperCase()).single();
    if (!project) return res.status(404).json({ error: 'Código no válido' });
    const historia = await getHistoriaPublica(project.id);
    if (!historia) return res.status(404).json({ error: 'Este proyecto no tiene historia' });

    const imagenes = [];
    historia.capitulos.forEach((c, ci) => {
      const prefijo = `${String(ci + 1).padStart(2, '0')}-${limpio(c.titulo)}`;
      let n = 0;
      if (c.render_url) imagenes.push({ url: c.render_url, nombre: `${prefijo}-${++n}` });
      c.bloques.filter(b => b.imagen_url).forEach(b => imagenes.push({ url: b.imagen_url, nombre: `${prefijo}-${++n}` }));
    });
    if (!imagenes.length) return res.status(404).json({ error: 'Todavía no hay renders para descargar' });

    const nombreZip = `renders-${limpio(project.project_name)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreZip}"`);

    const zip = archiver('zip', { zlib: { level: 0 } }); // las imágenes ya van comprimidas
    zip.on('error', (e) => { console.error('Error al crear el ZIP de renders:', e); res.destroy(e); });
    zip.pipe(res);

    for (const img of imagenes) {
      try {
        const r = await fetch(img.url);
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        zip.append(buf, { name: `${img.nombre}.${extension(img.url, r.headers.get('content-type'))}` });
      } catch (e) { console.error('No se pudo añadir una imagen al ZIP:', e.message); }
    }
    await zip.finalize();
  } catch (e) {
    console.error('Error en la descarga de renders:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Error al preparar la descarga' });
  }
});

// PDF de la historia (portada, atmósfera, capítulos, dossier y siguiente paso)
router.get('/:code/historia.pdf', async (req, res) => {
  try {
    const { data: project } = await supabase.from('client_projects')
      .select('id, client_name, project_name, cover_image_url, moodboard_description, moodboard_palette, responsible:employees!responsible_id(name, email)')
      .eq('access_code', String(req.params.code).toUpperCase()).single();
    if (!project) return res.status(404).json({ error: 'Código no válido' });
    const historia = await getHistoriaPublica(project.id);
    if (!historia) return res.status(404).json({ error: 'Este proyecto no tiene historia' });
    const { data: imagenes } = await supabase.from('project_moodboard_images').select('url').eq('project_id', project.id).order('display_order', { ascending: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="proyecto-creativo-${limpio(project.project_name)}.pdf"`);
    await generarHistoriaPdf(res, {
      project, historia,
      moodboard: { description: project.moodboard_description || '', palette: project.moodboard_palette || [], images: imagenes || [] },
      responsable: project.responsible,
    });
  } catch (e) {
    console.error('Error al generar el PDF de la historia:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar el PDF' });
    else res.end();
  }
});

export default router;
