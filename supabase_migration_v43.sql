-- v43: Envío e instalación como "pendiente de valorar" en vez de un precio
-- fijo — varía demasiado según ciudad, acceso, planta, etc. Cuando el
-- Asistente IA arma un presupuesto, deja esta nota en vez de inventarse un
-- precio de envío/instalación. También editable a mano en cualquier
-- presupuesto.

ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS install_shipping_note text;
