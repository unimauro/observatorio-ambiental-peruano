import { NavLink, Outlet, Link } from 'react-router-dom'

const nav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/mapa', label: 'Mapa' },
  { to: '/biblioteca', label: 'Biblioteca' },
  { to: '/acerca', label: 'Acerca' },
]

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-forest-dark text-white sticky top-0 z-[1000] shadow">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 group">
            <span className="text-2xl">🌎</span>
            <div className="leading-tight">
              <div className="font-extrabold tracking-tight">Observatorio Ambiental Peruano</div>
              <div className="text-[11px] text-forest-light/90 hidden sm:block">
                Datos abiertos para comprender el territorio y proteger el futuro
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md transition ${
                    isActive ? 'bg-white/20 font-semibold' : 'hover:bg-white/10'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>

      <footer className="bg-ink text-slate-300 text-sm">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col sm:flex-row gap-3 justify-between">
          <p>
            Dirección, tecnología y datos: <strong className="text-white">Carlos Cárdenas Fernández</strong>
          </p>
          <p className="text-slate-400">
            Código y datos: open source · Fase 1 — Observatorio
          </p>
        </div>
      </footer>
    </div>
  )
}
