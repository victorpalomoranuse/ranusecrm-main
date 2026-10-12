import sharp from 'sharp';
import { callClaude } from './anthropic.js';
import { generarBloques } from './bloques-ia.js';
import { generarBloques3D } from './bloques-3d.js';

// Mira la foto antes de generar: el modelo 3D automático reconstruye TODO lo que ve (personas, suelo, fondo),
// así que si hay una persona o un ambiente el resultado sale con su silueta. En ese caso se usa el ensamblaje
// de piezas guiado por la IA, que sí puede ignorar lo que no es el producto.
export async function analizarFoto(imagen) {
  try {
    const jpg = await sharp(imagen).rotate().resize(768, 768, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
    const r = await callClaude({
      system: 'Analizas fotos de productos para un estudio de interiorismo. Responde SOLO con un JSON: {"persona":bool,"ambiente":bool,"varios_objetos":bool}. persona = aparece alguna persona (aunque sea parcial). ambiente = el producto está en una escena (habitación, gimnasio, escaleras, ventana) en vez de sobre fondo liso o recortado. varios_objetos = hay otros objetos relevantes además del producto.',
      maxTokens: 120,
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpg.toString('base64') } }, { type: 'text', text: 'Analiza la foto.' }] }],
    });
    const t = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const j = JSON.parse((t.match(/\{[\s\S]*\}/) || ['{}'])[0]);
    return { persona: !!j.persona, ambiente: !!j.ambiente, varios: !!j.varios_objetos };
  } catch { return { persona: false, ambiente: false, varios: false }; }
}

export async function generarBloquesAuto({ imagen, largo, fondo, alto, nombre }) {
  const f = await analizarFoto(imagen);
  const sucia = f.persona || f.ambiente || f.varios;
  if (!sucia) {
    try { return await generarBloques3D({ imagen, largo, fondo, alto }); }
    catch (e) { console.error('bloques 3D no disponible, se usa el ensamblaje de piezas:', e.message); }
  }
  const b = await generarBloques({ imagen, largo, fondo, alto, nombre });
  b.metodo = 'piezas';
  if (sucia) b.nota = ('La foto tiene ' + (f.persona ? 'una persona' : 'un ambiente') + ' (se ha ignorado). ' + (b.nota || '')).slice(0, 300);
  return b;
}
