// Calcula cómo debe guardarse el precio de un producto del catálogo como
// partida de presupuesto (budget_items), replicando el criterio que Víctor
// ya usa a mano:
//
// - Si el producto tiene un dto. de compra configurado (purchase_dto > 0),
//   el precio de catálogo es el PVP: se guarda en modo "pvp" (pvp_ref +
//   purchase_dto), igual que cuando él mismo marca esa partida como PVP+Dto
//   en un presupuesto.
// - Si no tiene dto., el precio de catálogo es su coste: se guarda en modo
//   "margin" (unit_cost + markup_pct), usando el margen por defecto del
//   producto o, si no hay ninguno configurado, 20%.
//
// Se usa desde tres sitios que insertan partidas a partir de un producto de
// catálogo: el Asistente IA, "Importar del proyecto" y (en el frontend)
// "Insertar desde catálogo" — así los tres aplican siempre el mismo criterio.
export function computeCatalogPricing(product) {
  const price = Number(product?.price) || 0;
  const dto = Number(product?.purchase_dto) || 0;
  const unit = product?.pricing_unit || 'ud';

  if (dto > 0) {
    return {
      pricing_mode: 'pvp',
      pvp_ref: price,
      purchase_dto: dto,
      unit_cost: parseFloat((price * (1 - dto / 100)).toFixed(2)),
      markup_pct: 0,
      unit_price: price,
      unit,
    };
  }

  const margin = product?.default_margin_pct != null && product?.default_margin_pct !== ''
    ? Number(product.default_margin_pct)
    : 20;
  return {
    pricing_mode: 'margin',
    pvp_ref: null,
    purchase_dto: null,
    unit_cost: price,
    markup_pct: margin,
    unit_price: parseFloat((price * (1 + margin / 100)).toFixed(2)),
    unit,
  };
}
