import { useState, useEffect } from 'react';
import api from '../services/api';
import { TrendingUp, TrendingDown, Euro, Briefcase, BarChart2, PieChart } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart as RechartsPie, Pie, Cell, Sector,
} from 'recharts';
import './SectionDashboard.css';

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1000) return v.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  return v.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
}

const STATUS_LABEL = { borrador: 'Borrador', enviado: 'Enviado', aprobado: 'Aprobado' };
const STATUS_COLOR = { borrador: 'rgba(255,255,255,0.3)', enviado: '#8b9eae', aprobado: '#8bae8f' };
const CAT_COLORS   = ['#beb0a2', '#8b9eae', '#ae9e8b', '#8bae8f', '#9e8b9e'];

const PHASE_LABELS = ['Diagnóstico', 'Prediseño', 'Diseño', 'Compras', 'Obra'];

// ── Stat card ──────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="dash-stat-card">
      <div className="dash-stat-icon"><Icon size={18} /></div>
      <div className="dash-stat-body">
        <span className="dash-stat-label">{label}</span>
        <strong className="dash-stat-value" style={color ? { color } : {}}>{value}</strong>
        {sub && <span className="dash-stat-sub">{sub}</span>}
      </div>
    </div>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dash-tooltip">
      <p className="dash-tooltip-label">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {fmt(p.value)}
        </p>
      ))}
    </div>
  );
}

// ── Donut tooltip ──────────────────────────────────────────────────────────
function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dash-tooltip">
      <p style={{ color: payload[0].payload.fill }}>{payload[0].name}</p>
      <p>{fmt(payload[0].value)}</p>
    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────
export function SectionDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeDonut, setActiveDonut] = useState(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    api.get('/budgets/dashboard')
      .then(r => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="ap-section">
      <div className="ap-section-head"><h1>Dashboard</h1></div>
      <div className="ap-loading">Cargando métricas…</div>
    </div>
  );

  const s = stats?.summary || {};
  const monthly    = stats?.monthly    || [];
  const byCategory = stats?.byCategory || [];
  const pipeline   = stats?.pipeline   || [];
  const recent     = stats?.recentBudgets || [];

  const maxPipeline = Math.max(...pipeline.map(p => p.count), 1);

  const donutData = byCategory
    .filter(c => c.cost > 0)
    .map((c, i) => ({ name: c.label, value: c.cost, fill: CAT_COLORS[i % CAT_COLORS.length] }));

  const totalCatCost = donutData.reduce((s, d) => s + d.value, 0);

  return (
    <div className="ap-section" style={{ position: 'relative' }}>
      {!revealed && (
        <div
          onClick={() => setRevealed(true)}
          style={{
            position: 'absolute', inset: 0, zIndex: 10,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'rgba(10,10,10,0.55)', borderRadius: 12, padding: '0.9rem 1.6rem',
            color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', letterSpacing: '0.06em',
            textTransform: 'uppercase', pointerEvents: 'none', userSelect: 'none',
          }}>
            Clic para revelar
          </div>
        </div>
      )}
      <div style={{ filter: revealed ? 'none' : 'blur(8px)', transition: 'filter 0.4s ease', pointerEvents: revealed ? 'auto' : 'none' }}>
      <div className="ap-section-head">
        <div>
          <h1>Dashboard</h1>
          <p>Visión global de ingresos, costes y márgenes.</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="dash-stats">
        <StatCard
          label="Ingresos totales"
          value={fmt(s.totalRevenue)}
          sub={`${s.budgetsCount || 0} presupuestos`}
          icon={TrendingUp}
          color="#8bae8f"
        />
        <StatCard
          label="Costes totales"
          value={fmt(s.totalCost)}
          sub="Presupuestos aprobados"
          icon={TrendingDown}
          color="#ae8b8b"
        />
        <StatCard
          label="Beneficio bruto"
          value={fmt(s.totalProfit)}
          sub={`Margen ${Number(s.margin || 0).toFixed(1)}%`}
          icon={Euro}
          color={s.totalProfit >= 0 ? '#8bae8f' : '#ae8b8b'}
        />
        <StatCard
          label="Proyectos activos"
          value={s.activeProjects || 0}
          sub="Total en sistema"
          icon={Briefcase}
        />
      </div>

      {/* Charts row */}
      <div className="dash-charts-row">
        {/* Bar chart */}
        <div className="dash-chart-card dash-chart-card--wide">
          <div className="dash-chart-head">
            <BarChart2 size={15} />
            <span>Ingresos vs Costes — últimos 6 meses</span>
          </div>
          {monthly.every(m => m.revenue === 0 && m.cost === 0) ? (
            <div className="dash-empty-chart">Sin datos de presupuestos aún</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthly} barCategoryGap="30%" barGap={3}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="month"
                  tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 11 }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k€` : `${v}€`}
                  tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                  axisLine={false} tickLine={false} width={48}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Legend
                  formatter={v => <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{v}</span>}
                  iconType="circle" iconSize={8}
                  wrapperStyle={{ paddingTop: 8 }}
                />
                <Bar dataKey="revenue" name="Ingresos" fill="#beb0a2" radius={[3,3,0,0]} />
                <Bar dataKey="cost"    name="Costes"   fill="rgba(255,255,255,0.12)" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Donut chart */}
        <div className="dash-chart-card">
          <div className="dash-chart-head">
            <PieChart size={15} />
            <span>Coste por categoría</span>
          </div>
          {donutData.length === 0 ? (
            <div className="dash-empty-chart">Sin partidas registradas</div>
          ) : (
            <div className="dash-donut-wrap">
              <ResponsiveContainer width="100%" height={180}>
                <RechartsPie>
                  <Pie
                    data={donutData}
                    cx="50%" cy="50%"
                    innerRadius={52} outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    onMouseEnter={(_, i) => setActiveDonut(i)}
                    onMouseLeave={() => setActiveDonut(null)}
                  >
                    {donutData.map((d, i) => (
                      <Cell
                        key={i} fill={d.fill}
                        opacity={activeDonut === null || activeDonut === i ? 1 : 0.45}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<DonutTooltip />} />
                </RechartsPie>
              </ResponsiveContainer>
              <div className="dash-donut-legend">
                {donutData.map((d, i) => (
                  <div key={i} className="dash-legend-item">
                    <span className="dash-legend-dot" style={{ background: d.fill }} />
                    <span className="dash-legend-name">{d.name}</span>
                    <span className="dash-legend-val">{totalCatCost > 0 ? `${((d.value/totalCatCost)*100).toFixed(0)}%` : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="dash-bottom-row">
        {/* Pipeline */}
        <div className="dash-chart-card">
          <div className="dash-chart-head">
            <span>Pipeline de proyectos</span>
          </div>
          <div className="dash-pipeline">
            {pipeline.map((p, i) => (
              <div key={p.phase} className="dash-pipe-item">
                <div className="dash-pipe-meta">
                  <span className="dash-pipe-phase">Fase {p.phase}</span>
                  <span className="dash-pipe-label">{PHASE_LABELS[i] || ''}</span>
                  <span className="dash-pipe-count">{p.count}</span>
                </div>
                <div className="dash-pipe-bar-wrap">
                  <div
                    className="dash-pipe-bar-fill"
                    style={{ width: `${(p.count / maxPipeline) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {pipeline.every(p => p.count === 0) && (
              <p className="dash-empty-small">No hay proyectos aún</p>
            )}
          </div>
        </div>

        {/* Recent budgets */}
        <div className="dash-chart-card dash-chart-card--wide">
          <div className="dash-chart-head">
            <span>Presupuestos recientes</span>
          </div>
          {recent.length === 0 ? (
            <div className="dash-empty-chart">Sin presupuestos todavía</div>
          ) : (
            <table className="dash-recent-table">
              <thead>
                <tr>
                  <th>Cliente</th><th>Proyecto</th><th>Estado</th>
                  <th>PVP total</th><th>Beneficio</th><th>Margen</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(b => (
                  <tr key={b.id}>
                    <td>{b.project?.client_name || '—'}</td>
                    <td>{b.project?.project_name || '—'}</td>
                    <td>
                      <span className="dash-recent-status" style={{ color: STATUS_COLOR[b.status] }}>
                        {STATUS_LABEL[b.status] || b.status}
                      </span>
                    </td>
                    <td className="dash-num">{fmt(b.totalRevenue)}</td>
                    <td className="dash-num" style={{ color: b.totalProfit >= 0 ? '#8bae8f' : '#ae8b8b' }}>
                      {fmt(b.totalProfit)}
                    </td>
                    <td className="dash-num" style={{ color: b.margin >= 20 ? '#8bae8f' : b.margin >= 10 ? '#beb0a2' : '#ae8b8b' }}>
                      {Number(b.margin || 0).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
