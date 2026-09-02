// Envío de emails transaccionales vía Resend (https://resend.com), usando
// fetch directamente — sin dependencia nueva. Si RESEND_API_KEY no está
// configurada (p.ej. en local), no falla: solo avisa por consola y sigue.
const RESEND_FROM = process.env.RESEND_FROM || 'Ranuse Design <onboarding@resend.dev>';

export async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY no configurada — no se envía "${subject}" a ${to}`);
    return { sent: false };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      console.error(`[email] Error al enviar "${subject}" a ${to}:`, res.status, detalle);
      return { sent: false };
    }
    return { sent: true };
  } catch (error) {
    console.error(`[email] Error al enviar "${subject}" a ${to}:`, error.message);
    return { sent: false };
  }
}
