import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

const PHASE_LABELS = ['Diagnóstico', 'Prediseño', 'Diseño detallado', 'Compras', 'Dirección de obra'];

function computeTotals(items, feeType, feeValue, designHours) {
  const itemCost = items.reduce((s, i) => s + (parseFloat(i.unit_cost) || 0) * (parseFloat(i.quantity) || 1), 0);
  const itemRevenue = items.reduce((s, i) => s + (parseFloat(i.unit_price) || 0) * (parseFloat(i.quantity) || 1), 0);
  const feeVal = parseFloat(feeValue) || 0;
  let designFee = 0;
  if (feeType === 'flat') designFee = feeVal;
  else if (feeType === 'percentage') designFee = itemRevenue * feeVal / 100;
  else if (feeType === 'hourly') designFee = (parseFloat(designHours) || 0) * feeVal;
  const totalRevenue = itemRevenue + designFee;
  const totalProfit = totalRevenue - itemCost;
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  return { itemCost, itemRevenue, designFee, totalRevenue, totalProfit, margin };
}

// ── Dashboard stats ────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const [budgetsRes, projectsRes] = await Promise.all([
      supabase.from('budgets').select('*, project:client_projects(id, client_name, project_name, phase, created_at), items:budget_items(unit_cost, unit_price, quantity, category, created_at)'),
      supabase.from('client_projects').select('id, phase, created_at'),
    ]);
    if (budgetsRes.error) throw budgetsRes.error;

    const allBudgets = (budgetsRes.data || []).map(b => ({
      ...b,
      ...computeTotals(b.items || [], b.design_fee_type, b.design_fee_value, b.design_hours),
    }));
    const allProjects = projectsRes.data || [];

    // Summary (approved + all)
    const approved = allBudgets.filter(b => b.status === 'aprobado');
    const totalRevenue = approved.reduce((s, b) => s + b.totalRevenue, 0);
    const totalCost = approved.reduce((s, b) => s + b.itemCost, 0);
    const totalProfit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    // Pipeline
    const pipeline = [1,2,3,4,5].map(phase => ({
      phase,
      label: PHASE_LABELS[phase - 1],
      count: allProjects.filter(p => p.phase === phase).length,
    }));

    // Monthly (last 6 months) — based on when budget was created
    const now = new Date();
    const monthly = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yr = d.getFullYear(), mo = d.getMonth();
      const label = d.toLocaleDateString('es-ES', { month: 'short' });
      const group = allBudgets.filter(b => {
        const bd = new Date(b.created_at);
        return bd.getFullYear() === yr && bd.getMonth() === mo;
      });
      monthly.push({
        month: label.charAt(0).toUpperCase() + label.slice(1),
        revenue: group.reduce((s, b) => s + b.totalRevenue, 0),
        cost: group.reduce((s, b) => s + b.itemCost, 0),
        profit: group.reduce((s, b) => s + b.totalProfit, 0),
      });
    }

    // By category
    const catMap = {};
    allBudgets.forEach(b => {
      (b.items || []).forEach(item => {
        const cat = item.category || 'otro';
        if (!catMap[cat]) catMap[cat] = { cost: 0, revenue: 0 };
        catMap[cat].cost += (parseFloat(item.unit_cost) || 0) * (parseFloat(item.quantity) || 1);
        catMap[cat].revenue += (parseFloat(item.unit_price) || 0) * (parseFloat(item.quantity) || 1);
      });
    });
    const CAT_LABELS = { material: 'Material', mobiliario: 'Mobiliario', instalacion: 'Instalación', transporte: 'Transporte', otro: 'Otro' };
    const byCategory = Object.entries(catMap).map(([cat, v]) => ({
      category: cat, label: CAT_LABELS[cat] || cat, ...v,
    }));

    // Recent budgets
    const recentBudgets = [...allBudgets]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 6)
      .map(({ items: _items, ...b }) => b);

    res.json({ summary: { totalRevenue, totalCost, totalProfit, margin, activeProjects: allProjects.length, budgetsCount: allBudgets.length }, monthly, byCategory, pipeline, recentBudgets });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar dashboard' });
  }
});

// ── List budgets ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('budgets')
      .select('*, project:client_projects(id, client_name, project_name, phase), items:budget_items(unit_cost, unit_price, quantity)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const budgets = (data || []).map(({ items, ...b }) => ({
      ...b,
      ...computeTotals(items || [], b.design_fee_type, b.design_fee_value, b.design_hours),
    }));
    res.json({ budgets });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar presupuestos' });
  }
});

// ── Get one budget ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('budgets')
      .select('*, project:client_projects(id, client_name, project_name, phase), items:budget_items(*)')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    const items = (data.items || []).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    res.json({ budget: { ...data, items } });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener presupuesto' });
  }
});

// ── Create budget ──────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id requerido' });
    const { data, error } = await supabase
      .from('budgets')
      .insert({ project_id, status: 'borrador', design_fee_type: 'flat', design_fee_value: 0, design_hours: 0 })
      .select('*, project:client_projects(id, client_name, project_name, phase)')
      .single();
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Este proyecto ya tiene presupuesto' });
      throw error;
    }
    res.status(201).json({ budget: { ...data, items: [], ...computeTotals([], 'flat', 0, 0) } });
  } catch (err) {
    res.status(500).json({ error: 'Error al crear presupuesto' });
  }
});

// ── Update budget meta ─────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { status, design_fee_type, design_fee_value, design_hours, notes } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (status !== undefined) updates.status = status;
    if (design_fee_type !== undefined) updates.design_fee_type = design_fee_type;
    if (design_fee_value !== undefined) updates.design_fee_value = parseFloat(design_fee_value) || 0;
    if (design_hours !== undefined) updates.design_hours = parseFloat(design_hours) || 0;
    if (notes !== undefined) updates.notes = notes;
    const { data, error } = await supabase.from('budgets').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ budget: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar presupuesto' });
  }
});

// ── Delete budget ──────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('budgets').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Presupuesto eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar presupuesto' });
  }
});

// ── Add item ───────────────────────────────────────────────────────────────
router.post('/:id/items', async (req, res) => {
  try {
    const { name, category, quantity, unit, unit_cost, markup_pct, unit_price, catalog_product_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'nombre requerido' });
    const cost = parseFloat(unit_cost) || 0;
    const markup = parseFloat(markup_pct) ?? 20;
    const price = unit_price !== undefined ? parseFloat(unit_price) || 0 : parseFloat((cost * (1 + markup / 100)).toFixed(2));
    const { data: maxRow } = await supabase.from('budget_items').select('display_order').eq('budget_id', req.params.id).order('display_order', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('budget_items').insert({
      budget_id: req.params.id,
      catalog_product_id: catalog_product_id || null,
      name: name.trim(), category: category || 'material',
      quantity: parseFloat(quantity) || 1, unit: unit || 'ud',
      unit_cost: cost, markup_pct: markup, unit_price: price,
      display_order: (maxRow?.display_order ?? -1) + 1,
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ item: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al añadir partida' });
  }
});

// ── Update item ────────────────────────────────────────────────────────────
router.put('/:id/items/:itemId', async (req, res) => {
  try {
    const { name, category, quantity, unit, unit_cost, markup_pct, unit_price } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (category !== undefined) updates.category = category;
    if (quantity !== undefined) updates.quantity = parseFloat(quantity) || 1;
    if (unit !== undefined) updates.unit = unit;
    if (unit_cost !== undefined) updates.unit_cost = parseFloat(unit_cost) || 0;
    if (markup_pct !== undefined) updates.markup_pct = parseFloat(markup_pct) ?? 20;
    if (unit_price !== undefined) updates.unit_price = parseFloat(unit_price) || 0;
    const { data, error } = await supabase.from('budget_items').update(updates).eq('id', req.params.itemId).eq('budget_id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ item: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar partida' });
  }
});

// ── Delete item ────────────────────────────────────────────────────────────
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const { error } = await supabase.from('budget_items').delete().eq('id', req.params.itemId).eq('budget_id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Partida eliminada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar partida' });
  }
});

// ── Import from project catalog assignments ────────────────────────────────
router.post('/:id/import', async (req, res) => {
  try {
    const { data: budget } = await supabase.from('budgets').select('project_id').eq('id', req.params.id).single();
    if (!budget) return res.status(404).json({ error: 'Presupuesto no encontrado' });

    const { data: existing } = await supabase.from('budget_items').select('catalog_product_id').eq('budget_id', req.params.id);
    const existingIds = new Set((existing || []).map(e => e.catalog_product_id).filter(Boolean));

    const { data: maxRow } = await supabase.from('budget_items').select('display_order').eq('budget_id', req.params.id).order('display_order', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    let nextOrder = (maxRow?.display_order ?? -1) + 1;

    const [matsRes, equipRes] = await Promise.all([
      supabase.from('project_material_selections').select('*, catalog:catalog_products(id, price)').eq('project_id', budget.project_id),
      supabase.from('project_equipment_selections').select('*, catalog:catalog_products(id, price)').eq('project_id', budget.project_id),
    ]);

    const assignments = [
      ...(matsRes.data || []).map(m => ({ ...m, cat: 'material' })),
      ...(equipRes.data || []).map(e => ({ ...e, cat: 'mobiliario' })),
    ].filter(a => !a.catalog_product_id || !existingIds.has(a.catalog_product_id));

    if (assignments.length === 0) return res.json({ items: [], message: 'No hay partidas nuevas para importar' });

    const toInsert = assignments.map(a => {
      const cost = parseFloat(a.catalog?.price) || 0;
      return {
        budget_id: req.params.id,
        catalog_product_id: a.catalog_product_id || null,
        name: a.name, category: a.cat,
        quantity: parseFloat(a.quantity) || 1, unit: 'ud',
        unit_cost: cost, markup_pct: 20,
        unit_price: parseFloat((cost * 1.2).toFixed(2)),
        display_order: nextOrder++,
      };
    });

    const { data, error } = await supabase.from('budget_items').insert(toInsert).select('*');
    if (error) throw error;
    res.json({ items: data || [], message: `${data?.length || 0} partidas importadas` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al importar partidas' });
  }
});

export default router;
