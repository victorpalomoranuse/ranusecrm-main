// Cliente mínimo para la API de mensajes de Anthropic (Claude), vía fetch
// directo — sin SDK nueva, igual que ya hicimos con Resend.
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-5-20250929';

/**
 * Llama a Claude con un historial de mensajes y (opcionalmente) tools.
 * Devuelve la respuesta completa de la API (content puede incluir bloques
 * de texto y/o tool_use).
 */
export async function callClaude({ system, messages, tools, maxTokens = 2000 }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no configurada');
  }
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
      ...(tools ? { tools } : {}),
    }),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`Error de la API de Claude (${res.status}): ${detalle}`);
  }
  return res.json();
}
