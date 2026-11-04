// Página pública con la política de privacidad (misma información que el modal del pie de la web, con dirección propia
// para poder enlazarla desde Meta/WhatsApp y otros servicios que piden una URL).
const SECCIONES = [
  ['Responsable', 'Ranuse Design (Victor Palomo).'],
  ['Contacto', 'administracion@ranusedesign.com • Tel: +34 673 27 43 03'],
  ['Datos que tratamos', 'Nombre, email, teléfono, mensajes que nos envíes (incluidos los de WhatsApp) y, de forma agregada, datos de analítica (cookies/medición anónima).'],
  ['Finalidades', 'Responder a tus consultas, gestionar presupuestos/contratos, prestar los servicios solicitados, facturación y mejora del sitio web.'],
  ['Base legal', 'Tu consentimiento y la ejecución de un contrato o medidas precontractuales.'],
  ['Conservación', 'Mientras dure la relación y el tiempo necesario por obligaciones legales.'],
  ['Cesiones', 'Solo a proveedores imprescindibles (hosting, analítica, mensajería, herramientas de gestión) bajo contratos de encargo y dentro del EEE o con garantías adecuadas.'],
  ['Derechos', 'Acceso, rectificación, supresión, oposición, limitación y portabilidad. Puedes ejercerlos escribiendo a nuestro email de contacto.'],
  ['Cookies', 'Utilizamos cookies técnicas y de medición. Puedes configurar o revocar tu consentimiento desde la configuración de tu navegador.'],
];

export function Privacidad() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 20px', fontFamily: 'system-ui, sans-serif', color: '#1c1a18', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: '1.8rem', marginBottom: 24 }}>Política de Privacidad</h1>
      {SECCIONES.map(([t, x]) => (
        <section key={t} style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 4px' }}>{t}</h2>
          <p style={{ margin: 0 }}>{x}</p>
        </section>
      ))}
    </div>
  );
}
