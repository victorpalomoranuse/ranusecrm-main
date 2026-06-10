import express from 'express';
import PDFDocument from 'pdfkit';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdminSuperior } from '../middleware/auth.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
router.use(authenticateToken, requireAdminSuperior);

const PHASE_LABELS = ['Diagnóstico', 'Prediseño', 'Diseño detallado', 'Compras', 'Dirección de obra'];

const BRAND = {
  name: 'Ranuse Design',
  contact: 'Víctor Palomo Díaz',
  address: 'Calle de la Constitución 100, 2ºC',
  city: 'Alcobendas, 28100 Madrid',
  nif: '53853605W',
  phone: '657 589 503',
  email: 'victor.palomo@ranusedesign.com',
  web: 'ranusedesign.com',
  primary: '#beb0a2',
  dark: '#0a0a0a',
};

function generateBudgetNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `${year}${month}${day}-${rand}`;
}

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

function fetchImageBuffer(url) {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;
      const req = client.get(url, { timeout: 5000 }, (res) => {
        if (res.statusCode !== 200) { resolve(null); return; }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

router.get('/dashboard', async (req, res) => {
  try {
    const [budgetsRes, projectsRes] = await Promise.all([
      supabase.from('budgets').select('*, project:client_projects(id, client_name, project_name, phase, created_at), items:budget_items(unit_cost, unit_price, quantity, category, created_at)'),
      supabase.from('client_projects').select('id, phase, created_at'),
    ]);
    if (budgetsRes.error) throw budgetsRes.error;
    const allBudgets = (budgetsRes.data || []).map(b => ({ ...b, ...computeTotals(b.items || [], b.design_fee_type, b.design_fee_value, b.design_hours) }));
    const allProjects = projectsRes.data || [];
    const approved = allBudgets.filter(b => b.status === 'aprobado');
    const totalRevenue = approved.reduce((s, b) => s + b.totalRevenue, 0);
    const totalCost = approved.reduce((s, b) => s + b.itemCost, 0);
    const totalProfit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const pipeline = [1,2,3,4,5].map(phase => ({ phase, label: PHASE_LABELS[phase - 1], count: allProjects.filter(p => p.phase === phase).length }));
    const now = new Date();
    const monthly = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yr = d.getFullYear(), mo = d.getMonth();
      const label = d.toLocaleDateString('es-ES', { month: 'short' });
      const group = allBudgets.filter(b => { const bd = new Date(b.created_at); return bd.getFullYear() === yr && bd.getMonth() === mo; });
      monthly.push({ month: label.charAt(0).toUpperCase() + label.slice(1), revenue: group.reduce((s, b) => s + b.totalRevenue, 0), cost: group.reduce((s, b) => s + b.itemCost, 0), profit: group.reduce((s, b) => s + b.totalProfit, 0) });
    }
    const catMap = {};
    allBudgets.forEach(b => { (b.items || []).forEach(item => { const cat = item.category || 'otro'; if (!catMap[cat]) catMap[cat] = { cost: 0, revenue: 0 }; catMap[cat].cost += (parseFloat(item.unit_cost) || 0) * (parseFloat(item.quantity) || 1); catMap[cat].revenue += (parseFloat(item.unit_price) || 0) * (parseFloat(item.quantity) || 1); }); });
    const CAT_LABELS = { material: 'Material', mobiliario: 'Mobiliario', instalacion: 'Instalacion', transporte: 'Transporte', otro: 'Otro' };
    const byCategory = Object.entries(catMap).map(([cat, v]) => ({ category: cat, label: CAT_LABELS[cat] || cat, ...v }));
    const recentBudgets = [...allBudgets].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6).map(({ items: _items, ...b }) => b);
    res.json({ summary: { totalRevenue, totalCost, totalProfit, margin, activeProjects: allProjects.length, budgetsCount: allBudgets.length }, monthly, byCategory, pipeline, recentBudgets });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al cargar dashboard' }); }
});

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('budgets').select('*, project:client_projects(id, client_name, project_name, phase), items:budget_items(unit_cost, unit_price, quantity)').order('created_at', { ascending: false });
    if (error) throw error;
    const budgets = (data || []).map(({ items, ...b }) => ({ ...b, ...computeTotals(items || [], b.design_fee_type, b.design_fee_value, b.design_hours) }));
    res.json({ budgets });
  } catch (err) { res.status(500).json({ error: 'Error al listar presupuestos' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('budgets').select('*, project:client_projects(id, client_name, project_name, phase, client_nif, client_phone, client_address, client_city, client_email), items:budget_items(*)').eq('id', req.params.id).single();
    if (error) throw error;
    const items = (data.items || []).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    res.json({ budget: { ...data, items } });
  } catch (err) { res.status(500).json({ error: 'Error al obtener presupuesto' }); }
});

router.post('/', async (req, res) => {
  try {
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id requerido' });
    const budget_number = generateBudgetNumber();
    const { data, error } = await supabase.from('budgets').insert({ project_id, budget_number, status: 'borrador', design_fee_type: 'flat', design_fee_value: 0, design_hours: 0 }).select('*, project:client_projects(id, client_name, project_name, phase)').single();
    if (error) { if (error.code === '23505') return res.status(400).json({ error: 'Este proyecto ya tiene presupuesto' }); throw error; }
    res.status(201).json({ budget: { ...data, items: [], ...computeTotals([], 'flat', 0, 0) } });
  } catch (err) { res.status(500).json({ error: 'Error al crear presupuesto' }); }
});

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
  } catch (err) { res.status(500).json({ error: 'Error al actualizar presupuesto' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('budgets').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Presupuesto eliminado' });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar presupuesto' }); }
});

router.post('/:id/items', async (req, res) => {
  try {
    const { name, category, quantity, unit, unit_cost, markup_pct, unit_price, catalog_product_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'nombre requerido' });
    const cost = parseFloat(unit_cost) || 0;
    const markup = parseFloat(markup_pct) ?? 20;
    const price = unit_price !== undefined ? parseFloat(unit_price) || 0 : parseFloat((cost * (1 + markup / 100)).toFixed(2));
    const { data: maxRow } = await supabase.from('budget_items').select('display_order').eq('budget_id', req.params.id).order('display_order', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('budget_items').insert({ budget_id: req.params.id, catalog_product_id: catalog_product_id || null, name: name.trim(), category: category || 'material', quantity: parseFloat(quantity) || 1, unit: unit || 'ud', unit_cost: cost, markup_pct: markup, unit_price: price, display_order: (maxRow?.display_order ?? -1) + 1 }).select('*').single();
    if (error) throw error;
    res.status(201).json({ item: data });
  } catch (err) { res.status(500).json({ error: 'Error al anadir partida' }); }
});

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
  } catch (err) { res.status(500).json({ error: 'Error al actualizar partida' }); }
});

router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const { error } = await supabase.from('budget_items').delete().eq('id', req.params.itemId).eq('budget_id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Partida eliminada' });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar partida' }); }
});

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
    const assignments = [...(matsRes.data || []).map(m => ({ ...m, cat: 'material' })), ...(equipRes.data || []).map(e => ({ ...e, cat: 'mobiliario' }))].filter(a => !a.catalog_product_id || !existingIds.has(a.catalog_product_id));
    if (assignments.length === 0) return res.json({ items: [], message: 'No hay partidas nuevas para importar' });
    const toInsert = assignments.map(a => { const cost = parseFloat(a.catalog?.price) || 0; return { budget_id: req.params.id, catalog_product_id: a.catalog_product_id || null, name: a.name, category: a.cat, quantity: parseFloat(a.quantity) || 1, unit: 'ud', unit_cost: cost, markup_pct: 20, unit_price: parseFloat((cost * 1.2).toFixed(2)), display_order: nextOrder++ }; });
    const { data, error } = await supabase.from('budget_items').insert(toInsert).select('*');
    if (error) throw error;
    res.json({ items: data || [], message: `${data?.length || 0} partidas importadas` });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al importar partidas' }); }
});

router.get('/:id/pdf-cliente', async (req, res) => {
  try {
    const { iva = 21, irpf = 0 } = req.query;

    const { data: budget, error } = await supabase
      .from('budgets')
      .select('*, project:client_projects(id, client_name, project_name, client_nif, client_phone, client_address, client_city, client_email), items:budget_items(*)')
      .eq('id', req.params.id)
      .single();
    if (error || !budget) return res.status(404).json({ error: 'Presupuesto no encontrado' });

    const items = (budget.items || []).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

    const catalogIds = items.filter(i => i.catalog_product_id).map(i => i.catalog_product_id);
    let catalogMap = {};
    if (catalogIds.length > 0) {
      const { data: products } = await supabase.from('catalog_products').select('id, photo_url').in('id', catalogIds);
      (products || []).forEach(p => { catalogMap[p.id] = p.photo_url; });
    }

    const subtotal = items.reduce((s, i) => s + (parseFloat(i.unit_price) || 0) * (parseFloat(i.quantity) || 1), 0);
    const ivaAmount = subtotal * (parseFloat(iva) / 100);
    const irpfAmount = subtotal * (parseFloat(irpf) / 100);
    const total = subtotal + ivaAmount - irpfAmount;
    const fmtEur = n => Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

    const budgetNumber = budget.budget_number || generateBudgetNumber();
    const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });

    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="presupuesto-${budgetNumber}.pdf"`);
    doc.pipe(res);

    const W = 595, H = 842;
    const margin = 45;

    // HEADER negro
    doc.rect(0, 0, W, 110).fill(BRAND.dark);

    // Logo blanco
    const logoPath = path.join(__dirname, '..', 'Icono Blanco.png');
    try { doc.image(logoPath, margin, 18, { height: 70 }); } catch {}

    // Nombre marca
    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text('RANUSE', margin + 82, 32);
    doc.fillColor(BRAND.primary).fontSize(9).font('Helvetica').text('DESIGN', margin + 82, 52);

    // Numero y fecha derecha
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold').text(`N ${budgetNumber}`, 0, 32, { align: 'right', width: W - margin });
    doc.fillColor('rgba(255,255,255,0.55)').fontSize(8).font('Helvetica').text(dateStr, 0, 48, { align: 'right', width: W - margin });

    // INFO BLOCK
    const infoY = 125;

    // DE — Ranuse
    doc.fillColor(BRAND.primary).fontSize(7).font('Helvetica-Bold').text('DE', margin, infoY);
    doc.fillColor(BRAND.dark).fontSize(9).font('Helvetica-Bold').text(BRAND.contact, margin, infoY + 12);
    doc.fillColor('#555555').fontSize(8).font('Helvetica')
      .text(BRAND.name, margin, infoY + 25)
      .text(BRAND.address, margin, infoY + 36)
      .text(BRAND.city, margin, infoY + 47)
      .text(`NIF: ${BRAND.nif}`, margin, infoY + 58)
      .text(`Tel: ${BRAND.phone}`, margin, infoY + 69)
      .text(BRAND.email, margin, infoY + 80);

    // PARA — Cliente
    const colR = W / 2 + 10;
    const p = budget.project;
    doc.fillColor(BRAND.primary).fontSize(7).font('Helvetica-Bold').text('PARA', colR, infoY);
    doc.fillColor(BRAND.dark).fontSize(9).font('Helvetica-Bold').text(p?.client_name || '', colR, infoY + 12);
    doc.fillColor('#555555').fontSize(8).font('Helvetica');
    let clientY = infoY + 25;
    if (p?.project_name) { doc.text(p.project_name, colR, clientY); clientY += 11; }
    if (p?.client_address) { doc.text(p.client_address, colR, clientY); clientY += 11; }
    if (p?.client_city) { doc.text(p.client_city, colR, clientY); clientY += 11; }
    if (p?.client_nif) { doc.text(`NIF: ${p.client_nif}`, colR, clientY); clientY += 11; }
    if (p?.client_phone) { doc.text(`Tel: ${p.client_phone}`, colR, clientY); clientY += 11; }
    if (p?.client_email) { doc.text(p.client_email, colR, clientY); }

    // Linea separadora
    const lineY = infoY + 100;
    doc.moveTo(margin, lineY).lineTo(W - margin, lineY).strokeColor(BRAND.primary).lineWidth(0.5).stroke();

    // TABLA
    let y = lineY + 16;

    // Cabecera
    doc.rect(margin, y, W - margin * 2, 20).fill('#f5f3f0');
    doc.fillColor('#888888').fontSize(7).font('Helvetica-Bold')
      .text('N', margin + 4, y + 6)
      .text('PRODUCTO / DESCRIPCION', margin + 22, y + 6)
      .text('CANT.', W - margin - 110, y + 6, { width: 50, align: 'right' })
      .text('UNIDAD', W - margin - 55, y + 6, { width: 55, align: 'right' });
    y += 22;

    let rowNum = 1;
    for (const item of items) {
      const imageUrl = item.image_url || (item.catalog_product_id ? catalogMap[item.catalog_product_id] : null);
      const imgH = 38;
      const rowH = imgH + 14;

      if (y + rowH > H - 140) { doc.addPage(); y = margin; }

      if (rowNum % 2 === 0) doc.rect(margin, y, W - margin * 2, rowH).fill('#faf9f8');

      // Numero fila
      doc.fillColor(BRAND.primary).fontSize(7.5).font('Helvetica-Bold').text(String(rowNum).padStart(2, '0'), margin + 4, y + rowH / 2 - 5);

      // Imagen
      const imgX = margin + 22;
      if (imageUrl) {
        const buf = await fetchImageBuffer(imageUrl);
        if (buf) { try { doc.image(buf, imgX, y + 6, { width: imgH, height: imgH, cover: [imgH, imgH] }); } catch {} }
      }

      // Nombre y categoria
      const textX = imgX + imgH + 8;
      const textW = W - margin - textX - 120;
      doc.fillColor(BRAND.dark).fontSize(9).font('Helvetica-Bold').text(item.name, textX, y + 10, { width: textW, lineBreak: false });
      if (item.category) doc.fillColor('#aaaaaa').fontSize(7.5).font('Helvetica').text(item.category.charAt(0).toUpperCase() + item.category.slice(1), textX, y + 24, { width: textW });

      // Cantidad y unidad
      doc.fillColor(BRAND.dark).fontSize(9).font('Helvetica')
        .text(String(item.quantity || 1), W - margin - 110, y + rowH / 2 - 5, { width: 50, align: 'right' })
        .text(item.unit || 'ud', W - margin - 55, y + rowH / 2 - 5, { width: 55, align: 'right' });

      doc.moveTo(margin, y + rowH).lineTo(W - margin, y + rowH).strokeColor('#eeeeee').lineWidth(0.3).stroke();
      y += rowH;
      rowNum++;
    }

    // TOTALES
    y += 20;
    if (y > H - 130) { doc.addPage(); y = margin + 20; }

    const totW = 220;
    const totX = W - margin - totW;

    doc.moveTo(totX, y - 4).lineTo(W - margin, y - 4).strokeColor('#dddddd').lineWidth(0.5).stroke();
    y += 4;

    const drawRow = (label, value, bold = false, color = BRAND.dark) => {
      doc.fillColor('#888888').fontSize(8.5).font('Helvetica').text(label, totX, y);
      doc.fillColor(color).fontSize(8.5).font(bold ? 'Helvetica-Bold' : 'Helvetica').text(value, totX, y, { width: totW, align: 'right' });
      y += 16;
    };

    drawRow('Subtotal', fmtEur(subtotal));
    if (parseFloat(iva) > 0) drawRow(`IVA (${iva}%)`, fmtEur(ivaAmount));
    if (parseFloat(irpf) > 0) drawRow(`Retencion IRPF (${irpf}%)`, `-${fmtEur(irpfAmount)}`, false, '#cc3333');

    y += 4;
    doc.rect(totX - 10, y - 4, totW + 10, 28).fill('#f5f3f0');
    doc.fillColor(BRAND.dark).fontSize(11).font('Helvetica-Bold').text('TOTAL', totX, y + 4);
    doc.fillColor(BRAND.dark).fontSize(13).font('Helvetica-Bold').text(fmtEur(total), totX, y + 2, { width: totW, align: 'right' });

    // FOOTER con solo logo
    doc.rect(0, H - 42, W, 42).fill(BRAND.dark);
    try {
      const logoBuf = await fetchImageBuffer(`file://${path.join(__dirname, '..', 'Icono Blanco.png')}`);
      if (logoBuf) doc.image(logoBuf, W / 2 - 15, H - 36, { height: 24 });
      else doc.image(logoPath, W / 2 - 15, H - 36, { height: 24 });
    } catch {
      try { doc.image(logoPath, W / 2 - 15, H - 36, { height: 24 }); } catch {}
    }

    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar PDF' });
  }
});

export default router;
