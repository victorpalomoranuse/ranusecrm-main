// Script de un solo uso para subir modelo.glb a Supabase Storage
// Ejecutar desde la carpeta server: node upload-model.js

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BUCKET = 'assets';
const FILE_PATH = resolve('../public/modelo-opt.glb');
const DEST_PATH = 'modelo.glb';

async function upload() {
  console.log('📦 Creando bucket "assets" si no existe...');
  const { error: bucketError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
  });
  if (bucketError && !bucketError.message.includes('already exists')) {
    console.error('Error al crear bucket:', bucketError.message);
    process.exit(1);
  }

  console.log('⬆️  Subiendo modelo.glb (190MB, puede tardar un momento)...');
  const file = readFileSync(FILE_PATH);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(DEST_PATH, file, {
      contentType: 'model/gltf-binary',
      upsert: true,
    });

  if (error) {
    console.error('Error al subir:', error.message);
    process.exit(1);
  }

  const { data: { publicUrl } } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(DEST_PATH);

  console.log('\n✅ Subido correctamente!');
  console.log('\n🔗 URL pública:');
  console.log(publicUrl);
  console.log('\n👉 Copia esta URL y pégala en src/components/Model3D.jsx');
}

upload();
