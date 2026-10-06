import multer from 'multer';
import sharp from 'sharp';
import heicConvert from 'heic-convert';

// Configuración de multer para guardar archivos en memoria
const storage = multer.memoryStorage();

// Filtro para aceptar solo imágenes
const imageFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten imágenes (JPG, PNG, WEBP)'), false);
  }
};

// Filtro para aceptar solo PDFs
const pdfFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos PDF'), false);
  }
};

// Middleware para subir fotos de productos (máximo 5)
export const uploadProductPhotos = multer({
  storage: storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB por imagen
    files: 5 // Máximo 5 fotos
  }
}).array('photos', 5);

// Middleware para subir PDFs de proyectos
export const uploadProjectPDF = multer({
  storage: storage,
  fileFilter: pdfFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB por PDF
    files: 1 // 1 PDF a la vez
  }
}).single('pdf');

// Middleware para subir múltiples PDFs
export const uploadProjectPDFs = multer({
  storage: storage,
  fileFilter: pdfFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB por PDF
    files: 10 // Máximo 10 PDFs a la vez
  }
}).array('pdfs', 10);

// Middleware para subir imágenes del portfolio (máximo 20)
export const uploadPortfolioImages = multer({
  storage: storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 8 * 1024 * 1024, // 8MB por imagen
    files: 20
  }
}).array('images', 20);

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg','image/jpg','image/png','image/webp','application/pdf'];
  allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Tipo de archivo no permitido'), false);
};

export const uploadCatalogPhotoFile = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 10*1024*1024, files: 1 } }).single('file');
export const uploadRenderFile = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 20*1024*1024, files: 1 } }).single('file');
export const uploadDocumentFile = multer({ storage, fileFilter, limits: { fileSize: 20*1024*1024, files: 1 } }).single('file');
// Fotos de necesidades/diagnóstico: aceptan también HEIC/HEIF (iPhone) y se
// convierten a JPG en el servidor, además de reducirse y corregir su rotación.
const esHeic = (f) => /heic|heif/i.test(f.mimetype || '') || /\.(heic|heif)$/i.test(f.originalname || '');
const fotoFilter = (req, file, cb) => {
  const ok = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype) || esHeic(file);
  ok ? cb(null, true) : cb(new Error('Solo se permiten imágenes (JPG, PNG, WEBP o HEIC)'), false);
};
const subirFoto = multer({ storage, fileFilter: fotoFilter, limits: { fileSize: 40*1024*1024, files: 1 } }).single('file');
const normalizarFoto = async (req, res, next) => {
  try {
    const f = req.file;
    if (!f) return next();
    let buf = f.buffer;
    if (esHeic(f)) buf = Buffer.from(await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.9 }));
    buf = await sharp(buf).rotate().resize({ width: 2800, height: 2800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
    f.buffer = buf; f.size = buf.length; f.mimetype = 'image/jpeg';
    f.originalname = (f.originalname || 'foto').replace(/\.[^.]+$/, '') + '.jpg';
    next();
  } catch (e) {
    console.error('Error al procesar la foto:', e.message);
    res.status(400).json({ error: 'No se ha podido procesar la imagen. Prueba con otra foto o en formato JPG.' });
  }
};
export const uploadDiagnosisImageFile = [subirFoto, normalizarFoto];
export const uploadCategoryItemFile = multer({ storage, fileFilter, limits: { fileSize: 20*1024*1024, files: 1 } }).single('file');
export const uploadCategoryItemImages = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 15*1024*1024, files: 10 } }).array('images', 10);
const categoryItemFieldFilter = (req, file, cb) => {
  if (file.fieldname === 'images') return imageFilter(req, file, cb);
  return fileFilter(req, file, cb);
};
export const uploadCategoryItemCreate = multer({ storage, fileFilter: categoryItemFieldFilter, limits: { fileSize: 20*1024*1024, files: 11 } }).fields([{ name: 'file', maxCount: 1 }, { name: 'images', maxCount: 10 }]);
export const uploadMoodboardImages = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 15*1024*1024, files: 20 } }).array('images', 20);
export const uploadReferenceImageFile = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 15*1024*1024, files: 1 } }).single('file');

// Handler de errores de multer
export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'Archivo demasiado grande (máximo 40MB para fotos de necesidades y 20MB para el resto de archivos)'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ 
        error: 'Demasiados archivos. Máximo 5 fotos o 10 PDFs' 
      });
    }
    return res.status(400).json({ 
      error: `Error al subir archivo: ${err.message}` 
    });
  }
  
  if (err) {
    return res.status(400).json({ 
      error: err.message 
    });
  }
  
  next();
};