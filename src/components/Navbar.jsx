import { Link, NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import './Navbar.css';

export function Navbar() {
  const navigate = useNavigate();

  return (
    <motion.header
      className="navbar"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="navbar-pill">
        <nav className="navbar-links">
          <NavLink to="/proyectos" className="nav-link">Proyectos</NavLink>
        </nav>

        <Link to="/" className="navbar-logo">
          <div className="logo-icon">
            <img src="/iconoRanuse.ico" alt="Ranuse Design Logo" />
          </div>
          <span className="logo-text">Ranuse Design</span>
        </Link>

        <button className="navbar-button" onClick={() => navigate('/cliente')}>
          <span className="button-text-default">Clientes</span>
          <span className="button-text-hover">Entrar</span>
        </button>
      </div>
    </motion.header>
  );
}
