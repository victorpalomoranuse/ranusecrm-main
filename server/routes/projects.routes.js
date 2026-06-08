import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin, requireClient } from '../middleware/auth.middleware.js';
import { uploadProjectPDF, uploadProjectPDFs, handleMulterError } from '../middleware/upload.middleware.js';
import { uploadProjectPDF as uploadPDFToStorage, deleteProjectPDF as deletePDFFromStorage } from '../utils/storage.js';

const router = express.Router();

/**
 * GET /api/projects
 * Listar proyectos (admin ve todos, cliente ve solo los suyos)
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = supabase
      .from('projects')
      .select(`
        *,
        client:users!client_id(id, email),
        _count:project_products(count)
      `)
      .order('created_at', { ascending: false });

    // Si es cliente, solo ve sus proyectos
    if (req.user.role === 'cliente') {
      query = query.eq('client_id', req.user.id);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    res.json({ projects: data });

  } catch (error) {
    console.error('Error al listar proyectos:', error);
    res.status(500).json({ error: 'Error al listar proyectos' });
  }
});

/**
 * GET /api/projects/:id
 * Obtener detalle completo de un proyecto
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener proyecto
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select(`
        *,
        client:users!client_id(id, email)
      `)
      .eq('id', id)
      .single();

    if (projectError || !project) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    // Verificar permisos: admin ve todo, cliente solo ve sus proyectos
    if (req.user.role === 'cliente' && project.client_id !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permiso para ver este proyecto' });
    }

    // Obtener productos asignados
    const { data: projectProducts, error: productsError } = await supabase
      .from('project_products')
      .select(`
        *,
        product:products(*)
      `)
      .eq('project_id', id)
      .order('assigned_at', { ascending: false });

    if (productsError) {
      throw productsError;
    }

    // Obtener PDFs
    const { data: pdfs, error: pdfsError } = await supabase
      .from('project_pdfs')
      .select('*')
      .eq('project_id', id)
      .order('uploaded_at', { ascending: false });

    if (pdfsError) {
      throw pdfsError;
    }

    res.json({
      ...project,
      products: projectProducts,
      pdfs: pdfs
    });

  } catch (error) {
    console.error('Error al obtener proyecto:', error);
    res.status(500).json({ error: 'Error al obtener proyecto' });
  }
});

/**
 * POST /api/projects
 * Crear un nuevo proyecto
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, client_id, status = 'en_diseño', budget } = req.body;

    // Validación
    if (!name || !client_id) {
      return res.status(400).json({ 
        error: 'Nombre y cliente son requeridos' 
      });
    }

    // Verificar que el cliente existe y es cliente
    const { data: client, error: clientError } = await supabase
      .from('users')
      .select('role')
      .eq('id', client_id)
      .single();

    if (clientError || !client || client.role !== 'cliente') {
      return res.status(400).json({ 
        error: 'Cliente inválido' 
      });
    }

    // Crear proyecto
    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: name.trim(),
        client_id,
        status,
        budget: budget ? parseFloat(budget) : null,
        created_by: req.user.id
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json({
      message: 'Proyecto creado exitosamente',
      project: data
    });

  } catch (error) {
    console.error('Error al crear proyecto:', error);
    res.status(500).json({ error: 'Error al crear proyecto' });
  }
});

/**
 * PUT /api/projects/:id
 * Actualizar un proyecto
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status, budget } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (status !== undefined) updates.status = status;
    if (budget !== undefined) updates.budget = budget ? parseFloat(budget) : null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No hay datos para actualizar' });
    }

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      message: 'Proyecto actualizado exitosamente',
      project: data
    });

  } catch (error) {
    console.error('Error al actualizar proyecto:', error);
    res.status(500).json({ error: 'Error al actualizar proyecto' });
  }
});

/**
 * DELETE /api/projects/:id
 * Eliminar un proyecto
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener PDFs para eliminarlos del storage
    const { data: pdfs } = await supabase
      .from('project_pdfs')
      .select('file_url')
      .eq('project_id', id);

    // Eliminar PDFs del storage
    if (pdfs && pdfs.length > 0) {
      await Promise.all(
        pdfs.map(pdf => deletePDFFromStorage(pdf.file_url))
      );
    }

    // Eliminar proyecto (cascade eliminará project_products y project_pdfs)
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }

    res.json({ message: 'Proyecto eliminado exitosamente' });

  } catch (error) {
    console.error('Error al eliminar proyecto:', error);
    res.status(500).json({ error: 'Error al eliminar proyecto' });
  }
});

/**
 * POST /api/projects/:id/products
 * Asignar un producto al proyecto
 */
router.post('/:id/products', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id: project_id } = req.params;
    const { product_id, quantity } = req.body;

    // Validación
    if (!product_id || !quantity || quantity < 1) {
      return res.status(400).json({ 
        error: 'Producto y cantidad (mayor a 0) son requeridos' 
      });
    }

    // Verificar que el producto existe
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id')
      .eq('id', product_id)
      .single();

    if (productError || !product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // Verificar que el proyecto existe
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', project_id)
      .single();

    if (projectError || !project) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    // Asignar producto al proyecto
    const { data, error } = await supabase
      .from('project_products')
      .insert({
        project_id,
        product_id,
        quantity: parseInt(quantity),
        assigned_by: req.user.id
      })
      .select(`
        *,
        product:products(*)
      `)
      .single();

    if (error) {
      // Si ya existe, lanzar error específico
      if (error.code === '23505') { // unique violation
        return res.status(400).json({ 
          error: 'Este producto ya está asignado al proyecto' 
        });
      }
      throw error;
    }

    res.status(201).json({
      message: 'Producto asignado exitosamente',
      projectProduct: data
    });

  } catch (error) {
    console.error('Error al asignar producto:', error);
    res.status(500).json({ error: 'Error al asignar producto' });
  }
});

/**
 * PUT /api/projects/:projectId/products/:productId
 * Actualizar cantidad de un producto asignado
 */
router.put('/:projectId/products/:productId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { projectId, productId } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      return res.status(400).json({ 
        error: 'Cantidad debe ser mayor a 0' 
      });
    }

    const { data, error } = await supabase
      .from('project_products')
      .update({ quantity: parseInt(quantity) })
      .eq('project_id', projectId)
      .eq('product_id', productId)
      .select(`
        *,
        product:products(*)
      `)
      .single();

    if (error) {
      throw error;
    }

    res.json({
      message: 'Cantidad actualizada exitosamente',
      projectProduct: data
    });

  } catch (error) {
    console.error('Error al actualizar cantidad:', error);
    res.status(500).json({ error: 'Error al actualizar cantidad' });
  }
});

/**
 * DELETE /api/projects/:projectId/products/:productId
 * Eliminar un producto del proyecto
 */
router.delete('/:projectId/products/:productId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { projectId, productId } = req.params;

    const { error } = await supabase
      .from('project_products')
      .delete()
      .eq('project_id', projectId)
      .eq('product_id', productId);

    if (error) {
      throw error;
    }

    res.json({ message: 'Producto eliminado del proyecto exitosamente' });

  } catch (error) {
    console.error('Error al eliminar producto del proyecto:', error);
    res.status(500).json({ error: 'Error al eliminar producto del proyecto' });
  }
});

/**
 * PUT /api/projects/:projectId/products/:productId/feedback
 * Cliente marca si le gusta un producto y deja comentario
 */
router.put('/:projectId/products/:productId/feedback', authenticateToken, async (req, res) => {
  try {
    const { projectId, productId } = req.params;
    const { liked, comment } = req.body;

    // Si es cliente, verificar que el proyecto es suyo
    if (req.user.role === 'cliente') {
      const { data: project } = await supabase
        .from('projects')
        .select('client_id')
        .eq('id', projectId)
        .single();

      if (!project || project.client_id !== req.user.id) {
        return res.status(403).json({ error: 'No tienes permiso para este proyecto' });
      }
    }

    const updates = {};
    if (liked !== undefined) updates.client_liked = liked;
    if (comment !== undefined) updates.client_comment = comment?.trim() || null;

    const { data, error } = await supabase
      .from('project_products')
      .update(updates)
      .eq('project_id', projectId)
      .eq('product_id', productId)
      .select(`
        *,
        product:products(*)
      `)
      .single();

    if (error) {
      throw error;
    }

    res.json({
      message: 'Feedback actualizado exitosamente',
      projectProduct: data
    });

  } catch (error) {
    console.error('Error al actualizar feedback:', error);
    res.status(500).json({ error: 'Error al actualizar feedback' });
  }
});

/**
 * POST /api/projects/:id/pdfs
 * Subir un PDF al proyecto
 */
router.post('/:id/pdfs',
  authenticateToken,
  requireAdmin,
  uploadProjectPDF,
  handleMulterError,
  async (req, res) => {
    try {
      const { id: project_id } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'No se envió ningún archivo PDF' });
      }

      // Verificar que el proyecto existe
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id')
        .eq('id', project_id)
        .single();

      if (projectError || !project) {
        return res.status(404).json({ error: 'Proyecto no encontrado' });
      }

      // Subir PDF a Supabase Storage
      const fileUrl = await uploadPDFToStorage(
        file.buffer,
        file.originalname,
        project_id
      );

      // Guardar referencia en la BD
      const { data, error } = await supabase
        .from('project_pdfs')
        .insert({
          project_id,
          file_name: file.originalname,
          file_url: fileUrl,
          uploaded_by: req.user.id
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      res.status(201).json({
        message: 'PDF subido exitosamente',
        pdf: data
      });

    } catch (error) {
      console.error('Error al subir PDF:', error);
      res.status(500).json({ error: 'Error al subir PDF' });
    }
  }
);

/**
 * DELETE /api/projects/:projectId/pdfs/:pdfId
 * Eliminar un PDF del proyecto
 */
router.delete('/:projectId/pdfs/:pdfId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { projectId, pdfId } = req.params;

    // Obtener PDF para eliminar del storage
    const { data: pdf, error: fetchError } = await supabase
      .from('project_pdfs')
      .select('file_url')
      .eq('id', pdfId)
      .eq('project_id', projectId)
      .single();

    if (fetchError || !pdf) {
      return res.status(404).json({ error: 'PDF no encontrado' });
    }

    // Eliminar del storage
    await deletePDFFromStorage(pdf.file_url);

    // Eliminar de la BD
    const { error } = await supabase
      .from('project_pdfs')
      .delete()
      .eq('id', pdfId);

    if (error) {
      throw error;
    }

    res.json({ message: 'PDF eliminado exitosamente' });

  } catch (error) {
    console.error('Error al eliminar PDF:', error);
    res.status(500).json({ error: 'Error al eliminar PDF' });
  }
});

export default router;