// Modelo 3D a partir de VARIAS fotos: la IA clasifica cada foto por vista (frente, atrás, izquierda, derecha) y, si hay al menos dos vistas,
// se usa el modelo multivista de Hunyuan3D (mucho más fiel que con una sola foto); si no, el de una foto.
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { Client, handle_file } from '@gradio/client';
import { callClaude } from './anthropic.js';
import { mallaDesdeFoto } from './bloques-3d.js';

const SPACE_MV = 'tencent/Hunyuan3D-2mv';

async function aJpg(buf) { return sharp(buf).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer(); }

// Qué vista es cada foto (para colocarla donde el modelo la espera)
export async function clasificaVistas(jpgs) {
  try {
    const contenido = [];
    jpgs.forEach((b, i) => { contenido.push({ type: 'text', text: 'Foto ' + i + ':' }); contenido.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } }); });
    contenido.push({ type: 'text', text: 'Clasifica cada foto del MISMO objeto según desde dónde está tomada.' });
    const r = await callClaude({ system: 'Recibes fotos de un mismo objeto (una máquina o mueble). Para cada foto indica la vista: "frente" (lo que sería la parte delantera, de cara), "trasera", "izquierda" (lateral izquierdo visto desde delante), "derecha", "arriba", "perspectiva" (en diagonal, 3/4) u "otra" (detalle o no sirve). Y una calidad de 1 a 5 (objeto entero, limpio, sin personas). Devuelves SOLO JSON {"fotos":[{"i":0,"vista":"frente","calidad":4}]}.', messages: [{ role: 'user', content: contenido }], maxTokens: 600 });
    const j = JSON.parse(((r.content || []).map(c => c.text || '').join('').match(/\{[\s\S]*\}/) || ['{}'])[0]);
    return (j.fotos || []).filter(x => Number.isInteger(x.i) && x.i >= 0 && x.i < jpgs.length);
  } catch { return []; }
}

// El servicio gratuito a veces está ocupado: se reintenta una vez antes de rendirse
async function reintenta(fn, veces = 2) { let ult; for (let i = 0; i < veces; i++) { try { return await fn(); } catch (e) { ult = e; await new Promise(r => setTimeout(r, 6000)); } } throw ult; }
function mejor(cl, vistas) { return cl.filter(x => vistas.includes(x.vista)).sort((a, b) => (b.calidad || 0) - (a.calidad || 0))[0]; }

async function mallaMultivista(sel) {
  const tmps = {};
  try {
    for (const [k, buf] of Object.entries(sel)) { const f = path.join(os.tmpdir(), 'mv-' + k + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jpg'); fs.writeFileSync(f, buf); tmps[k] = f; }
    const client = await Client.connect(SPACE_MV, process.env.HF_TOKEN ? { token: process.env.HF_TOKEN } : {});
    const r = await client.predict('/shape_generation', { caption: '', image: null, mv_image_front: tmps.front ? handle_file(tmps.front) : null, mv_image_back: tmps.back ? handle_file(tmps.back) : null, mv_image_left: tmps.left ? handle_file(tmps.left) : null, mv_image_right: tmps.right ? handle_file(tmps.right) : null, steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 256, check_box_rembg: true, num_chunks: 8000, randomize_seed: false });
    const f = r.data?.[0], url = f?.value?.url || f?.url; if (!url) throw new Error('El servicio 3D no devolvió la malla');
    const resp = await fetch(url); if (!resp.ok) throw new Error('No se pudo descargar la malla 3D');
    return Buffer.from(await resp.arrayBuffer());
  } finally { for (const f of Object.values(tmps)) fs.rmSync(f, { force: true }); }
}

// bufs: fotos originales (Buffer). Devuelve { glb, metodo, usadas }
export async function glbDesdeFotos(bufs) {
  const jpgs = []; for (const b of bufs.slice(0, 8)) { try { jpgs.push(await aJpg(b)); } catch { /* foto no válida */ } }
  if (!jpgs.length) throw new Error('Ninguna foto es válida');
  if (jpgs.length >= 2) {
    const cl = await clasificaVistas(jpgs);
    if (cl.length >= 2) {
      const sel = {}, fr = mejor(cl, ['frente']) || mejor(cl, ['perspectiva']) || cl.slice().sort((a, b) => (b.calidad || 0) - (a.calidad || 0))[0];
      sel.front = jpgs[fr.i];
      for (const [slot, vistas] of [['back', ['trasera']], ['left', ['izquierda']], ['right', ['derecha']]]) { const m = mejor(cl.filter(x => x.i !== fr.i), vistas); if (m) sel[slot] = jpgs[m.i]; }
      if (Object.keys(sel).length >= 2) {
        try { return { glb: await reintenta(() => mallaMultivista(sel)), metodo: 'multivista', usadas: Object.keys(sel).length }; }
        catch (e) { console.error('3D multivista falló, se usa una sola foto:', e.message); }
      }
      return { glb: await reintenta(() => mallaDesdeFoto(jpgs[fr.i])), metodo: 'una foto (' + (cl.length) + ' fotos sin vistas suficientes)', usadas: 1 };
    }
  }
  return { glb: await reintenta(() => mallaDesdeFoto(jpgs[0])), metodo: 'una foto', usadas: 1 };
}
