import { lazy, Suspense, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const Model3D = lazy(() => import('./Model3D').then(m => ({ default: m.Model3D })));
import { LazyImage } from './LazyImage';
import './Landing.css';
import { Stars } from './Stars';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const WA_LINK = 'https://api.whatsapp.com/message/XSSED6I72WM3P1?autoload=1&app_absent=0';

// ── Variantes de animación ──────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 36 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] } },
};

const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.7, ease: 'easeOut' } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
};

const viewport = { once: true, amount: 0.2 };

// ── Datos ───────────────────────────────────────────────────────────
const howWeWork = [
  {
    icon: 'bolt',
    title: 'Rendimiento',
    text: 'Optimizamos el espacio para flujos de trabajo biomecánicos precisos. Cada metro cuadrado tiene un propósito funcional directo en tu preparación física.',
  },
  {
    icon: 'self_improvement',
    title: 'Recuperación',
    text: 'Integramos zonas de regeneración y calma. El descanso es parte del entrenamiento, y tu espacio debe invitar a la desconexión mental activa.',
  },
  {
    icon: 'photo_camera',
    title: 'Imagen Profesional',
    text: 'Diseño estético preparado para la creación de contenido. Tu home gym comunica tu nivel de compromiso y profesionalidad al mundo.',
  },
];

const testimonials = [
  {
    name: 'GLORUM HOMES',
    photo: '/img/rese1.png',
    time: 'Hace 8 meses',
    text: 'Trabajar con Ranuse ha sido una muy buena elección. Captaron nuestro estilo desde el primer momento. Son creativos, profesionales, dan un servicio muy bueno y completo, cumplen con todo lo prometido. ¡Totalmente recomendados!',
  },
  {
    name: 'El mundo Danna',
    photo: '/img/rese2.png',
    time: 'Hace 6 meses',
    text: 'Gran profesional lo recomiendo con toda confianza hace un trabajo espectacular me encanta trabajar con el 100 pts',
  },
  {
    name: 'CRISTOBAL SERVICIOS CONSTRUCTIVOS',
    photo: '/img/rese3.png',
    time: 'Hace 8 meses',
    text: 'Realizan diseños de interiores muy buenos, el servicio es bastante amplio y el personal es muy profesional.',
  },
];

const plans = [
  {
    icon: '💻',
    title: 'Diseño Online',
    subtitle: 'Trabajamos 100% online desde cualquier ciudad',
    description: 'Definimos la identidad, la distribución, el estilo y la atmósfera del espacio mediante un proceso visual y estratégico que puedes ejecutar desde cualquier ciudad.',
    features: ['Diseño estratégico completo', 'Renders y planos técnicos', 'Asesoramiento continuo', 'Sin desplazamientos'],
    link: 'https://api.whatsapp.com/send?phone=+673274303&text=Hola%20me%20llamo%20_%20vengo%20de%20la%20web%20y%20me%20interesa%20contratar%20un%20Dise%C3%B1o%20Online%20para%20_',
  },
  {
    icon: '🔑',
    title: 'Ejecución Llave en Mano',
    subtitle: 'Solo Madrid y ciudades seleccionadas',
    description: 'Nos encargamos del diseño, la obra y la coordinación completa del proyecto hasta entregártelo listo para abrir. Una solución exclusiva para quien quiere olvidarse de gestiones.',
    features: ['Gestión integral del proyecto', 'Coordinación de profesionales', 'Control de presupuesto', 'Entrega lista para abrir'],
    link: 'https://api.whatsapp.com/send?phone=+673274303&text=Hola%20me%20llamo%20_%20vengo%20de%20la%20web%20y%20me%20interesa%20contratar%20un%20Proyecto%20Llave%20en%20Mano%20para%20_',
  },
];

function StarRating() {
  return (
    <div className="stars" aria-label="5 estrellas">
      {[...Array(5)].map((_, i) => (
        <svg key={i} width="16" height="16" viewBox="0 0 24 24" fill="#fbbc04">
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      ))}
    </div>
  );
}

export function Landing() {
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    fetch(`${API_URL}/portfolio`)
      .then(r => r.json())
      .then(d => setProjects(d.projects || []))
      .catch(() => {});
  }, []);

  return (
    <main className="landing">

      {/* ── HERO ─────────────────────────────────── */}
      <section className="hero" id="inicio">
        <Stars count={120} shooting={true} />
        <div className="hero-bg" aria-hidden="true" />
        <div className="hero-inner">
          <motion.div
            className="hero-text"
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.h1 variants={fadeUp}>
              Home gyms para
              <span className="accent"> deportistas de élite</span>
            </motion.h1>
            <motion.p variants={fadeUp}>
              Diseñamos tu espacio de entrenamiento privado para que rinda,
              impresione y comunique tu nivel. Sin concesiones.
            </motion.p>
            <motion.div className="hero-actions" variants={fadeUp}>
              <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="btn btn-hero-cta">
                <span className="hero-cta-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.117 1.528 5.845L.057 23.857l6.174-1.448A11.935 11.935 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.8 9.8 0 01-4.992-1.364l-.358-.213-3.666.861.91-3.567-.233-.375A9.821 9.821 0 012.18 12C2.18 6.57 6.57 2.18 12 2.18c5.43 0 9.82 4.39 9.82 9.82 0 5.43-4.39 9.818-9.82 9.818z"/></svg>
                </span>
                Escríbenos por WhatsApp
              </a>
            </motion.div>
          </motion.div>

          <motion.div
            className="hero-model"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
          >
            <Suspense fallback={<div className="model-placeholder"><span>Cargando modelo…</span></div>}>
              <Model3D />
            </Suspense>
          </motion.div>
        </div>

        {/* ── Tira de logos ── */}
        <motion.div
          className="hero-logos"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.6 }}
        >
          <p className="hero-logos-label">Proyectos realizados para</p>
          <div className="logos-row">
            {['actex.png','afutbal2.png','f11.svg','golf.png','nextera1.png','rayo.png','xthor1.png'].map((logo) => (
              <img key={logo} src={`/logos/${logo}`} alt={logo.split('.')[0]} className="logo-item" />
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── FRASE ────────────────────────────────── */}
      <section className="quote-section">
        <motion.p
          className="quote-text"
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={fadeIn}
        >
          El espacio donde entrenas define el nivel al que llegas.
        </motion.p>
      </section>

      {/* ── CÓMO TRABAJAMOS ──────────────────────── */}
      <section className="how-section">
        <div className="section-inner">
          <motion.h2 initial="hidden" whileInView="visible" viewport={viewport} variants={fadeUp}>
            Cómo trabajamos
          </motion.h2>
          <motion.div
            className="how-grid"
            initial="hidden"
            whileInView="visible"
            viewport={viewport}
            variants={stagger}
          >
            {howWeWork.map((item) => (
              <motion.div key={item.title} className="how-card" variants={fadeUp}>
                <span className="material-symbols-rounded how-icon">{item.icon}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── PROYECTOS (preview) ───────────────────── */}
      <section className="projects-section" id="proyectos">
        <div className="section-inner">
          <motion.div
            className="section-head"
            initial="hidden"
            whileInView="visible"
            viewport={viewport}
            variants={fadeUp}
          >
            <div>
              <h2>Proyectos</h2>
              <p className="section-subtitle">Algunos de nuestros trabajos más recientes</p>
            </div>
            <Link to="/proyectos" className="btn btn-secondary btn-sm">Ver todos →</Link>
          </motion.div>

          <motion.div
            className="projects-grid"
            initial="hidden"
            whileInView="visible"
            viewport={viewport}
            variants={stagger}
          >
            {projects.slice(0, 3).map((project) => {
              const cover = project.cover_url && !project.cover_url.startsWith('blob:')
                ? project.cover_url
                : project.images?.find(u => u && !u.startsWith('blob:'));
              return (
              <motion.div key={project.id} variants={fadeUp}>
                <Link to={`/proyecto/${project.slug}`} className="project-card">
                  <div className="project-img">
                    <LazyImage src={cover} alt={project.title} />
                  </div>
                  <div className="project-info">
                    <h3>{project.title}</h3>
                    <p>{project.description}</p>
                  </div>
                </Link>
              </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* ── TESTIMONIOS ──────────────────────────── */}
      <section className="testimonials-section">
        <div className="section-inner">
          <motion.h2 initial="hidden" whileInView="visible" viewport={viewport} variants={fadeUp}>
            Lo que dicen nuestros clientes
          </motion.h2>
          <motion.div
            className="testimonials-grid"
            initial="hidden"
            whileInView="visible"
            viewport={viewport}
            variants={stagger}
          >
            {testimonials.map((t) => (
              <motion.div key={t.name} className="testimonial-card" variants={fadeUp}>
                <div className="testimonial-top">
                  <div className="testimonial-avatar">
                    {t.photo
                      ? <img src={t.photo} alt={t.name} />
                      : t.name.charAt(0)
                    }
                  </div>
                  <div>
                    <p className="testimonial-name">{t.name}</p>
                    <StarRating />
                  </div>
                  <div className="google-logo" aria-label="Google">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                  </div>
                </div>
                <p className="testimonial-time">{t.time}</p>
                <p className="testimonial-text">{t.text}</p>
                <a
                  href="https://www.google.com/maps/place/Ranuse+Design+-+Dise%C3%B1o+de+Interiores/@40.5457207,-3.6421074,1269m/data=!3m1!1e3!4m8!3m7!1s0x80af68b513398a6f:0x17fd93af2e3bfedf!8m2!3d40.5461673!4d-3.6432671!9m1!1b1!16s%2Fg%2F11mcnlq3r7?entry=ttu&g_ep=EgoyMDI2MDIyNS4wIKXMDSoASAFQAw%3D%3D"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="testimonial-link"
                >
                  Ver en Google
                </a>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── PLANES ───────────────────────────────── */}
      <section className="plans-section" id="servicios">
        <div className="section-inner">
          <motion.h2 initial="hidden" whileInView="visible" viewport={viewport} variants={fadeUp}>
            Nuestros servicios
          </motion.h2>
          <motion.div
            className="plans-grid"
            initial="hidden"
            whileInView="visible"
            viewport={viewport}
            variants={stagger}
          >
            {plans.map((plan) => (
              <motion.div key={plan.title} className="plan-card" variants={fadeUp}>
                <div className="plan-top">
                  <span className="plan-icon">{plan.icon}</span>
                </div>
                <h3 className="plan-title">{plan.title}</h3>
                <p className="plan-subtitle">{plan.subtitle}</p>
                <p className="plan-desc">{plan.description}</p>
                <ul className="plan-features">
                  {plan.features.map((f) => (
                    <li key={f}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#beb0a2" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <a href={plan.link} target="_blank" rel="noopener noreferrer" className="btn btn-primary plan-btn">
                  Consultar servicio
                </a>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── CTA FINAL ────────────────────────────── */}
      <section className="cta-section">
        <motion.div
          className="section-inner cta-inner"
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp}>
            El rendimiento no es casual.<br />
            <span className="cta-highlight"><span className="accent">Es diseño.</span></span>
          </motion.h2>
          <motion.p variants={fadeUp}>
            Lleva tu preparación al siguiente nivel con un espacio a la altura de tu ambición.
          </motion.p>
          <motion.a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            variants={fadeUp}
          >
            Hablemos
          </motion.a>
        </motion.div>
      </section>

    </main>
  );
}
