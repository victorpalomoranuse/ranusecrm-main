import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware.js';
import { uploadProductPhotos, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadProductPhoto, deleteProductPhoto } from '../utils/storage.js';
import { supabase } from '../config/supabase.js';

const router = express.Router();

/**
 * GET /api/products
 * Listar todos los productos con búsqueda y filtros
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { search, type, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('products')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    // Filtro por búsqueda (nombre o descripción)
    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Filtro por tipo
    if (type) {
      query = query.eq('type', type);
    }

    // Paginación
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    res.json({
      products: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Error al listar productos:', error);
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

/**
 * GET /api/products/types
 * Obtener lista de tipos únicos de productos
 */
router.get('/types', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('type')
      .order('type');

    if (error) {
      throw error;
    }

    // Extraer tipos únicos
    const types = [...new Set(data.map(p => p.type))];

    res.json({ types });

  } catch (error) {
    console.error('Error al obtener tipos:', error);
    res.status(500).json({ error: 'Error al obtener tipos de productos' });
  }
});

/**
 * GET /api/products/:id
 * Obtener un producto por ID
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json(data);

  } catch (error) {
    console.error('Error al obtener producto:', error);
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

/**
 * POST /api/products
 * Crear un nuevo producto
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, description, price, link, type, provider } = req.body;

    // Validación
    if (!name || !price || !type) {
      return res.status(400).json({ 
        error: 'Nombre, precio y tipo son requeridos' 
      });
    }

    // Crear producto
    const { data, error } = await supabase
      .from('products')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        price: parseFloat(price),
        link: link?.trim() || null,
        type: type.trim(),
        provider: provider?.trim() || null,
        photos: [],
        main_photo_index: 0,
        created_by: req.user.id
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json({
      message: 'Producto creado exitosamente',
      product: data
    });

  } catch (error) {
    console.error('Error al crear producto:', error);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

/**
 * POST /api/products/:id/photos
 * Subir fotos a un producto existente
 */
router.post('/:id/photos', 
  authenticateToken, 
  requireAdmin, 
  uploadProductPhotos,
  handleMulterError,
  async (req, res) => {
    try {
      const { id } = req.params;
      const files = req.files;

      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No se enviaron fotos' });
      }

      // Obtener producto actual
      const { data: product, error: fetchError } = await supabase
        .from('products')
        .select('photos')
        .eq('id', id)
        .single();

      if (fetchError || !product) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      const currentPhotos = product.photos || [];

      // Validar que no exceda el límite de 5 fotos
      if (currentPhotos.length + files.length > 5) {
        return res.status(400).json({ 
          error: `Solo puedes tener máximo 5 fotos. Actualmente tienes ${currentPhotos.length}` 
        });
      }

      // Subir las fotos a Supabase Storage
      const uploadPromises = files.map(file => 
        uploadProductPhoto(file.buffer, file.originalname, file.mimetype)
      );

      const photoUrls = await Promise.all(uploadPromises);

      // Actualizar producto con las nuevas URLs
      const updatedPhotos = [...currentPhotos, ...photoUrls];

      const { data: updatedProduct, error: updateError } = await supabase
        .from('products')
        .update({ photos: updatedPhotos })
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      res.json({
        message: 'Fotos subidas exitosamente',
        product: updatedProduct
      });

    } catch (error) {
      console.error('Error al subir fotos:', error);
      res.status(500).json({ error: 'Error al subir fotos' });
    }
  }
);

/**
 * DELETE /api/products/:id/photos/:photoIndex
 * Eliminar una foto específica de un producto
 */
router.delete('/:id/photos/:photoIndex', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, photoIndex } = req.params;
    const index = parseInt(photoIndex);

    // Obtener producto actual
    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('photos, main_photo_index')
      .eq('id', id)
      .single();

    if (fetchError || !product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const photos = product.photos || [];

    if (index < 0 || index >= photos.length) {
      return res.status(400).json({ error: 'Índice de foto inválido' });
    }

    // Eliminar de Supabase Storage
    await deleteProductPhoto(photos[index]);

    // Eliminar del array
    const updatedPhotos = photos.filter((_, i) => i !== index);

    // Ajustar main_photo_index si es necesario
    let newMainPhotoIndex = product.main_photo_index;
    if (index === product.main_photo_index) {
      newMainPhotoIndex = 0;
    } else if (index < product.main_photo_index) {
      newMainPhotoIndex--;
    }

    // Actualizar producto
    const { data: updatedProduct, error: updateError } = await supabase
      .from('products')
      .update({ 
        photos: updatedPhotos,
        main_photo_index: newMainPhotoIndex
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    res.json({
      message: 'Foto eliminada exitosamente',
      product: updatedProduct
    });

  } catch (error) {
    console.error('Error al eliminar foto:', error);
    res.status(500).json({ error: 'Error al eliminar foto' });
  }
});

/**
 * PUT /api/products/:id/main-photo
 * Cambiar la foto principal de un producto
 */
router.put('/:id/main-photo', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { photoIndex } = req.body;

    if (photoIndex === undefined || photoIndex < 0 || photoIndex > 4) {
      return res.status(400).json({ error: 'Índice de foto inválido (0-4)' });
    }

    const { data, error } = await supabase
      .from('products')
      .update({ main_photo_index: parseInt(photoIndex) })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      message: 'Foto principal actualizada',
      product: data
    });

  } catch (error) {
    console.error('Error al actualizar foto principal:', error);
    res.status(500).json({ error: 'Error al actualizar foto principal' });
  }
});

/**
 * PUT /api/products/:id
 * Actualizar un producto
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, link, type, provider } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (price !== undefined) updates.price = parseFloat(price);
    if (link !== undefined) updates.link = link?.trim() || null;
    if (type !== undefined) updates.type = type.trim();
    if (provider !== undefined) updates.provider = provider?.trim() || null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No hay datos para actualizar' });
    }

    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      message: 'Producto actualizado exitosamente',
      product: data
    });

  } catch (error) {
    console.error('Error al actualizar producto:', error);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

/**
 * DELETE /api/products/:id
 * Eliminar un producto
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener producto para eliminar sus fotos
    const { data: product } = await supabase
      .from('products')
      .select('photos')
      .eq('id', id)
      .single();

    // Eliminar fotos de Storage
    if (product?.photos && product.photos.length > 0) {
      await Promise.all(
        product.photos.map(photoUrl => deleteProductPhoto(photoUrl))
      );
    }

    // Eliminar producto
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }

    res.json({ message: 'Producto eliminado exitosamente' });

  } catch (error) {
    console.error('Error al eliminar producto:', error);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

export default router;