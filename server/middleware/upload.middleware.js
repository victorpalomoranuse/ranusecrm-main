import multer from 'multer';

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
export const uploadDiagnosisImageFile = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 10*1024*1024, files: 1 } }).single('file');

// Handler de errores de multer
export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'Archivo demasiado grande. Máximo 5MB para imágenes y 10MB para PDFs' 
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