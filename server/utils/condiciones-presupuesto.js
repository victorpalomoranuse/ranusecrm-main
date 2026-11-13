import { supabase } from '../config/supabase.js';

// Condiciones del contrato que salen al final del PDF del presupuesto. Hay una plantilla general (editable) y cada presupuesto puede tener su propia versión.
// Se guardan en un solo archivo del almacenamiento: crm/presupuestos/condiciones.json  { base, presupuestos: { <id>: { texto, incluir, hitosSoloFirme } } }
const BUCKET = 'project-documents', RUTA = 'crm/presupuestos/condiciones.json';

export const TEXTO_BASE = [
  '1. Aceptación. Este presupuesto tiene una validez de 30 días. La firma del mismo o el pago del primer hito supone su aceptación, y estas condiciones forman parte del contrato.',
  '2. Alcance. El contrato incluye únicamente las partidas descritas. No incluye licencias, tasas, proyectos técnicos, boletines o legalizaciones de instalaciones, ni mobiliario o maquinaria no detallados, salvo que se indique expresamente.',
  '3. Plazo de ejecución. El plazo se fijará al firmar y comenzará cuando exista acceso libre al local y se haya recibido el primer pago. Se ampliará por demoras ajenas a Ranuse Design (decisiones tardías del cliente, permisos, falta de acceso, fuerza mayor).',
  '4. Modificaciones. Cualquier cambio o trabajo adicional se solicitará por escrito, indicando su precio y su efecto en el plazo, y solo se ejecutará tras la aprobación del cliente.',
  '5. Partidas pendientes de definir. Son trabajos conocidos cuyas características todavía no están decididas (capítulo «Reserva por pendientes de definir»). No están contratadas hasta que el cliente apruebe el presupuesto cerrado de cada una. El importe que figura es solo una estimación. El cliente se compromete a decidir antes de la fase de obra en que se necesiten; si no, el plazo se ampliará en consecuencia. Cada partida se factura únicamente por su importe real aprobado, y lo que no se ejecute no se factura.',
  '6. Imprevistos. Se consideran imprevistos los elementos ocultos o no visibles antes de abrir (humedades, instalaciones en mal estado, estructura, materiales peligrosos…). Ranuse Design avisará por escrito, con foto y valoración, antes de ejecutar. No se ejecutará sin aprobación del cliente, salvo urgencia de seguridad hasta [___ €]. Se valorarán con los precios unitarios del presupuesto o, si no existen, a coste más [__ %].',
  '7. Reservas. Las reservas (pendientes de definir e imprevistos) solo se facturan por lo realmente ejecutado y aprobado. Lo no utilizado se descuenta de la factura final. No están incluidas en los hitos de pago.',
  '8. Materiales con precio de referencia. Las partidas con «valor 20 €/m²» u otro precio similar son precios base. Si el cliente elige un material de precio distinto, la diferencia se factura o se abona al coste real.',
  '9. Hitos de pago. Los pagos se realizan por transferencia en los hitos indicados en «Datos de pago», calculados sobre el importe firme (sin las reservas). Un hito se entiende cumplido cuando Ranuse Design comunica por escrito que se ha terminado lo que describe; la factura se emite en ese momento y se paga en un máximo de [__] días. El retraso devenga el interés legal de demora, y Ranuse Design podrá paralizar la obra mientras haya pagos vencidos. Los materiales suministrados siguen siendo de Ranuse Design hasta su pago.',
  '10. Recepción y garantía. La obra se entrega con un acta de recepción. Los defectos visibles se comunican en [__] días y los remates se corrigen en un plazo razonable. Los productos cuentan con la garantía del fabricante, y la ejecución con la garantía legal y la que se pacte.',
  '11. Revisión de precios. Si el coste de los materiales sube más de un [__ %] entre la firma y la compra, se revisará la partida afectada con justificante.',
  '12. Resolución y jurisdicción. Cualquiera de las partes podrá resolver el contrato por incumplimiento grave de la otra. Será de aplicación la ley española, con sometimiento a los juzgados y tribunales de Madrid.',
].join('\n\n');

async function leer() {
  try { const { data, error } = await supabase.storage.from(BUCKET).download(RUTA); if (error || !data) return { base: null, presupuestos: {} }; const j = JSON.parse(await data.text()); return { base: typeof j.base === 'string' ? j.base : null, presupuestos: j.presupuestos && typeof j.presupuestos === 'object' ? j.presupuestos : {} }; }
  catch { return { base: null, presupuestos: {} }; }
}
async function guardar(j) {
  const { error } = await supabase.storage.from(BUCKET).upload(RUTA, Buffer.from(JSON.stringify(j)), { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw error;
}
export async function leerBase() { const j = await leer(); return j.base ?? TEXTO_BASE; }
export async function guardarBase(texto) { const j = await leer(); j.base = String(texto || '').slice(0, 20000); await guardar(j); }
export async function condicionesDe(id) {
  const j = await leer(), p = j.presupuestos[id] || {};
  return { texto: p.texto != null ? p.texto : (j.base ?? TEXTO_BASE), personalizado: p.texto != null, incluir: p.incluir !== false, hitosSoloFirme: !!p.hitosSoloFirme };
}
export async function guardarDe(id, { texto, incluir, hitosSoloFirme }) {
  const j = await leer(), p = { ...(j.presupuestos[id] || {}) };
  if (texto === null) delete p.texto; else if (typeof texto === 'string') p.texto = texto.slice(0, 20000);
  if (typeof incluir === 'boolean') p.incluir = incluir;
  if (typeof hitosSoloFirme === 'boolean') p.hitosSoloFirme = hitosSoloFirme;
  j.presupuestos[id] = p; await guardar(j);
}
