import { useState } from 'react';
import './Footer.css';

export function Footer() {
  const [modalOpen, setModalOpen] = useState(null);

  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-content">
          {/* Logo y marca */}
          <div className="footer-brand">
            <div className="footer-logo">
              <img src="/iconoRanuse.ico" alt="Ranuse Design Logo" />
            </div>
            <span className="footer-brand-text">Ranuse Design</span>
          </div>

          {/* Enlaces de navegación */}
          <nav className="footer-nav">
            <a href="/proyectos" className="footer-link">Proyectos</a>
            <a href="/#servicios" className="footer-link">Servicios</a>
          </nav>

          {/* Datos de contacto y redes sociales */}
          <div className="footer-contact">
            <a
              href="https://api.whatsapp.com/message/XSSED6I72WM3P1?autoload=1&app_absent=0"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-contact-item footer-contact-wa"
            >
              WhatsApp
            </a>
            <a href="mailto:administracion@ranusedesign.com" className="footer-contact-item footer-contact-email">
              Email
            </a>
            
            {/* Redes sociales */}
            <div className="footer-socials">
              <a 
                href="https://www.instagram.com/ranuse.design/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="footer-social-link instagram"
                aria-label="Instagram"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
              </a>

              <a 
                href="https://www.tiktok.com/@ranuse.design" 
                target="_blank" 
                rel="noopener noreferrer"
                className="footer-social-link tiktok"
                aria-label="TikTok"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* Copyright y enlaces legales */}
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} Ranuse Design. Todos los derechos reservados.</p>
          <div className="footer-legal">
            <button onClick={() => setModalOpen('privacy')} className="footer-legal-link">
              Política de Privacidad
            </button>
            <span className="footer-separator">•</span>
            <button onClick={() => setModalOpen('terms')} className="footer-legal-link">
              Términos y Condiciones
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Privacidad */}
      {modalOpen === 'privacy' && (
        <div className="legal-modal-overlay" onClick={() => setModalOpen(null)}>
          <div className="legal-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="legal-modal-close" onClick={() => setModalOpen(null)}>✕</button>
            
            <h2 className="legal-modal-title">Política de Privacidad</h2>
            
            <div className="legal-modal-body">
              <div className="legal-section">
                <h3>Responsable</h3>
                <p>Ranuse Design (Victor Palomo).</p>
              </div>

              <div className="legal-section">
                <h3>Contacto</h3>
                <p>administracion@ranusedesign.com • Tel: +34 673 27 43 03</p>
              </div>

              <div className="legal-section">
                <h3>Datos que tratamos</h3>
                <p>Nombre, email, teléfono, mensajes que nos envíes y, de forma agregada, datos de analítica (cookies/medición anónima).</p>
              </div>

              <div className="legal-section">
                <h3>Finalidades</h3>
                <p>Responder a tus consultas, gestionar presupuestos/contratos, prestar los servicios solicitados, facturación y mejora del sitio web.</p>
              </div>

              <div className="legal-section">
                <h3>Base legal</h3>
                <p>Tu consentimiento y la ejecución de un contrato o medidas precontractuales.</p>
              </div>

              <div className="legal-section">
                <h3>Conservación</h3>
                <p>Mientras dure la relación y el tiempo necesario por obligaciones legales.</p>
              </div>

              <div className="legal-section">
                <h3>Cesiones</h3>
                <p>Solo a proveedores imprescindibles (hosting, analítica, herramientas de gestión) bajo contratos de encargo y dentro del EEE o con garantías adecuadas.</p>
              </div>

              <div className="legal-section">
                <h3>Derechos</h3>
                <p>Acceso, rectificación, supresión, oposición, limitación y portabilidad. Puedes ejercerlos escribiendo a nuestro email de contacto.</p>
              </div>

              <div className="legal-section">
                <h3>Cookies</h3>
                <p>Utilizamos cookies técnicas y de medición. Puedes configurar o revocar tu consentimiento desde la configuración de tu navegador.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Términos */}
      {modalOpen === 'terms' && (
        <div className="legal-modal-overlay" onClick={() => setModalOpen(null)}>
          <div className="legal-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="legal-modal-close" onClick={() => setModalOpen(null)}>✕</button>
            
            <h2 className="legal-modal-title">Términos y Condiciones</h2>
            
            <div className="legal-modal-body">
              <div className="legal-section">
                <h3>Objeto</h3>
                <p>Estas condiciones regulan el acceso y uso del sitio web de Ranuse Design y, en su caso, la contratación de nuestros servicios.</p>
              </div>

              <div className="legal-section">
                <h3>Uso del sitio</h3>
                <p>Te comprometes a hacer un uso lícito, diligente y respetuoso con estas condiciones y la legislación vigente.</p>
              </div>

              <div className="legal-section">
                <h3>Servicios y presupuestos</h3>
                <p>Toda propuesta comercial indicará alcance, plazos y precio. La contratación se perfecciona al aceptar el presupuesto y las condiciones particulares.</p>
              </div>

              <div className="legal-section">
                <h3>Propiedad intelectual</h3>
                <p>Los contenidos del sitio pertenecen a sus titulares. No se permite su reproducción o explotación sin autorización.</p>
              </div>

              <div className="legal-section">
                <h3>Responsabilidad</h3>
                <p>El sitio se ofrece "tal cual". No garantizamos la disponibilidad ininterrumpida ni la ausencia de errores, aunque trabajamos para minimizarlos.</p>
              </div>

              <div className="legal-section">
                <h3>Enlaces externos</h3>
                <p>Los enlaces a terceros son informativos; Ranuse Design no es responsable de su contenido.</p>
              </div>

              <div className="legal-section">
                <h3>Ley aplicable y jurisdicción</h3>
                <p>Española. Para cualquier controversia, las partes se someten a los juzgados y tribunales de Madrid (salvo norma imperativa).</p>
              </div>

              <div className="legal-section">
                <h3>Contacto</h3>
                <p>Para dudas sobre estos términos, escríbenos a nuestro email de contacto.</p>
              </div>

              <div className="legal-section">
                <p><em>Última actualización: 10/11/2025</em></p>
              </div>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}