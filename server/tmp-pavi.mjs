import 'dotenv/config';
import sharp from 'sharp';
import fs from 'fs';
import { supabase } from './config/supabase.js';
const dir = process.env.TEMP + '/pavi', N = 2048;
const nombres = fs.readdirSync(dir).filter(f => /\.png$/i.test(f));
const out = [];
for (const f of nombres) {
  const base = f.replace(/\.png$/i, ''), slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const { data, info } = await sharp(dir + '/' + f).resize(N, N, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // luz pareja: se divide por el desenfoque de muy baja frecuencia (quita viñeteos y degradados de la foto) y se conserva el color medio
  const bajo = await sharp(data, { raw: { width: N, height: N, channels: 3 } }).resize(12, 12, { kernel: 'cubic' }).resize(N, N, { kernel: 'cubic' }).raw().toBuffer();
  const media = [0, 0, 0]; for (let i = 0; i < bajo.length; i += 3 * 97) { media[0] += bajo[i]; media[1] += bajo[i + 1]; media[2] += bajo[i + 2]; } const cnt = Math.floor(bajo.length / (3 * 97)) + 1; for (let c = 0; c < 3; c++) media[c] /= cnt;
  const res = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 3) for (let c = 0; c < 3; c++) { const v = data[i + c] * (media[c] / Math.max(8, bajo[i + c])); res[i + c] = v > 255 ? 255 : v < 0 ? 0 : v; }
  const jpg = await sharp(res, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
  const ruta = 'biblioteca3d/paviflex/' + slug + '.jpg';
  const up = await supabase.storage.from('project-documents').upload(ruta, jpg, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' });
  if (up.error) { console.log('ERROR', base, up.error.message); continue; }
  console.log(base, '->', slug + '.jpg', (jpg.length / 1e6).toFixed(2) + ' MB', 'media', media.map(x => Math.round(x)).join(','));
  out.push(slug);
}
process.exit(0);
