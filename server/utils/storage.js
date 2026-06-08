import { supabase } from '../config/supabase.js';
import { randomUUID } from 'crypto';

// ── Portfolio images ──────────────────────────────────────────────────

export async function uploadPortfolioImage(fileBuffer, fileName, mimeType, projectSlug) {
  const ext = fileName.split('.').pop();
  const filePath = `${projectSlug}/${randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from('portfolio-images')
    .upload(filePath, fileBuffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error('Error al subir imagen: ' + error.message);

  const { data: { publicUrl } } = supabase.storage
    .from('portfolio-images')
    .getPublicUrl(filePath);

  return publicUrl;
}

export async function deletePortfolioImage(imageUrl) {
  try {
    const parts = imageUrl.split('/portfolio-images/');
    if (parts.length < 2) return false;
    const { error } = await supabase.storage.from('portfolio-images').remove([parts[1]]);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Subir una foto de producto a Supabase Storage
 * @param {Buffer} fileBuffer - Buffer del archivo
 * @param {string} fileName - Nombre original del archivo
 * @param {string} mimeType - Tipo MIME del archivo
 * @returns {Promise<string>} URL pública del archivo
 */
export async function uploadProductPhoto(fileBuffer, fileName, mimeType) {
  try {
    // Generar nombre único para el archivo
    const fileExtension = fileName.split('.').pop();
    const uniqueFileName = `${randomUUID()}.${fileExtension}`;
    const filePath = `products/${uniqueFileName}`;

    // Subir a Supabase Storage
    const { data, error } = await supabase.storage
      .from('product-photos')
      .upload(filePath, fileBuffer, {
        contentType: mimeType,
        upsert: false
      });

    if (error) {
      throw error;
    }

    // Obtener URL pública
    const { data: { publicUrl } } = supabase.storage
      .from('product-photos')
      .getPublicUrl(filePath);

    return publicUrl;

  } catch (error) {
    console.error('Error subiendo foto de producto:', error);
    throw new Error('Error al subir la foto');
  }
}

/**
 * Eliminar una foto de producto de Supabase Storage
 * @param {string} photoUrl - URL de la foto a eliminar
 * @returns {Promise<boolean>}
 */
export async function deleteProductPhoto(photoUrl) {
  try {
    // Extraer el path del archivo desde la URL
    const urlParts = photoUrl.split('/product-photos/');
    if (urlParts.length < 2) {
      throw new Error('URL de foto inválida');
    }

    const filePath = urlParts[1];

    // Eliminar de Supabase Storage
    const { error } = await supabase.storage
      .from('product-photos')
      .remove([`products/${filePath}`]);

    if (error) {
      console.error('Error eliminando foto:', error);
      return false;
    }

    return true;

  } catch (error) {
    console.error('Error en deleteProductPhoto:', error);
    return false;
  }
}

/**
 * Subir un PDF de proyecto a Supabase Storage
 * @param {Buffer} fileBuffer - Buffer del archivo
 * @param {string} fileName - Nombre original del archivo
 * @param {string} projectId - ID del proyecto
 * @returns {Promise<string>} URL pública del archivo
 */
export async function uploadProjectPDF(fileBuffer, fileName, projectId) {
  try {
    // Generar nombre único pero mantener el nombre original en parte
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueFileName = `${projectId}/${timestamp}_${sanitizedFileName}`;

    // Subir a Supabase Storage
    const { data, error } = await supabase.storage
      .from('project-pdfs')
      .upload(uniqueFileName, fileBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (error) {
      throw error;
    }

    // Obtener URL pública
    const { data: { publicUrl } } = supabase.storage
      .from('project-pdfs')
      .getPublicUrl(uniqueFileName);

    return publicUrl;

  } catch (error) {
    console.error('Error subiendo PDF:', error);
    throw new Error('Error al subir el PDF');
  }
}

/**
 * Eliminar un PDF de proyecto de Supabase Storage
 * @param {string} pdfUrl - URL del PDF a eliminar
 * @returns {Promise<boolean>}
 */
export async function deleteProjectPDF(pdfUrl) {
  try {
    // Extraer el path del archivo desde la URL
    const urlParts = pdfUrl.split('/project-pdfs/');
    if (urlParts.length < 2) {
      throw new Error('URL de PDF inválida');
    }

    const filePath = urlParts[1];

    // Eliminar de Supabase Storage
    const { error } = await supabase.storage
      .from('project-pdfs')
      .remove([filePath]);

    if (error) {
      console.error('Error eliminando PDF:', error);
      return false;
    }

    return true;

  } catch (error) {
    console.error('Error en deleteProjectPDF:', error);
    return false;
  }
}

// ── Project renders ───────────────────────────────────────────────────
export async function uploadProjectRender(fileBuffer, fileName, mimeType, projectId) {
  const ext = fileName.split('.').pop();
  const filePath = `${projectId}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('project-renders').upload(filePath, fileBuffer, { contentType: mimeType });
  if (error) throw new Error('Error al subir render: ' + error.message);
  const { data: { publicUrl } } = supabase.storage.from('project-renders').getPublicUrl(filePath);
  return publicUrl;
}
export async function deleteProjectRender(url) {
  try {
    const parts = url.split('/project-renders/');
    if (parts.length < 2) return false;
    const { error } = await supabase.storage.from('project-renders').remove([parts[1]]);
    return !error;
  } catch { return false; }
}

// ── Project documents ─────────────────────────────────────────────────
export async function uploadProjectDocument(fileBuffer, fileName, mimeType, projectId) {
  const timestamp = Date.now();
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${projectId}/${timestamp}_${sanitized}`;
  const { error } = await supabase.storage.from('project-documents').upload(filePath, fileBuffer, { contentType: mimeType });
  if (error) throw new Error('Error al subir documento: ' + error.message);
  const { data: { publicUrl } } = supabase.storage.from('project-documents').getPublicUrl(filePath);
  return publicUrl;
}
export async function deleteProjectDocument(url) {
  try {
    const parts = url.split('/project-documents/');
    if (parts.length < 2) return false;
    const { error } = await supabase.storage.from('project-documents').remove([parts[1]]);
    return !error;
  } catch { return false; }
}

// ── Catalog product photos ────────────────────────────────────────────
export async function uploadCatalogPhoto(fileBuffer, fileName, mimeType) {
  const ext = fileName.split('.').pop();
  const filePath = `products/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('catalog-products').upload(filePath, fileBuffer, { contentType: mimeType });
  if (error) throw new Error('Error al subir foto: ' + error.message);
  const { data: { publicUrl } } = supabase.storage.from('catalog-products').getPublicUrl(filePath);
  return publicUrl;
}
export async function deleteCatalogPhoto(url) {
  try {
    const parts = url.split('/catalog-products/');
    if (parts.length < 2) return false;
    const { error } = await supabase.storage.from('catalog-products').remove([parts[1]]);
    return !error;
  } catch { return false; }
}

// ── Diagnosis images ──────────────────────────────────────────────────
export async function uploadDiagnosisImage(fileBuffer, fileName, mimeType, projectId) {
  const ext = fileName.split('.').pop();
  const filePath = `${projectId}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('project-diagnosis').upload(filePath, fileBuffer, { contentType: mimeType });
  if (error) throw new Error('Error al subir imagen: ' + error.message);
  const { data: { publicUrl } } = supabase.storage.from('project-diagnosis').getPublicUrl(filePath);
  return publicUrl;
}
export async function deleteDiagnosisImage(url) {
  try {
    const parts = url.split('/project-diagnosis/');
    if (parts.length < 2) return false;
    const { error } = await supabase.storage.from('project-diagnosis').remove([parts[1]]);
    return !error;
  } catch { return false; }
}