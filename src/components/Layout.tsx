import { useEffect, useState } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import Asistente from './Asistente'
import { loadJSON } from '../lib/data'

interface Creditos {
  construccion: string
  atribucion: string
  autorRol: string
  autor: string
  autorLink: string
  presentacion: string[]
}

const nav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/mapa', label: 'Mapa' },
  { to: '/temas', label: 'Temas' },
  { to: '/biblioteca', label: 'Biblioteca' },
  { to: '/faq', label: 'FAQ' },
  { to: '/acerca', label: 'Acerca' },
]

export default function Layout() {
  const [cr, setCr] = useState<Creditos | null>(null)
  useEffect(() => { loadJSON<Creditos>('creditos.json').then(setCr).catch(() => {}) }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-forest-dark text-white sticky top-0 z-[1000] shadow">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
          <Link to="/" className="flex items-center gap-3 group shrink-0">
            <span className="text-2xl">🌎</span>
            <div className="leading-tight">
              <div className="font-extrabold tracking-tight text-sm sm:text-base flex items-center gap-2">
                Observatorio Ambiental Peruano
                {cr?.construccion && (
                  <span className="text-[9px] uppercase font-semibold bg-amber-400 text-amber-950 px-1.5 py-0.5 rounded">
                    {cr.construccion}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-forest-light/90 hidden sm:block">
                Datos abiertos para comprender el territorio y proteger el futuro
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 text-sm overflow-x-auto -mx-1 px-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `shrink-0 px-3 py-1.5 rounded-md transition ${
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

      <Asistente />

      <footer className="bg-ink text-slate-300 text-sm">
        <div className="max-w-6xl mx-auto px-4 py-7 grid gap-5 sm:grid-cols-2">
          <div>
            <div className="font-bold text-white">Créditos</div>
            <p className="mt-1 text-slate-400">
              {cr?.atribucion ?? 'Este observatorio se encuentra en construcción.'}
            </p>
            <p className="mt-2 text-slate-400">
              {cr?.autorRol ?? 'Dirección, tecnología y sistematización de datos'}:{' '}
              <strong className="text-white">{cr?.autor ?? 'Carlos Cárdenas Fernández'}</strong>
              {cr?.autorLink && (
                <>
                  {' · '}
                  <a href={cr.autorLink} target="_blank" rel="noreferrer noopener" className="text-forest-light hover:underline">
                    ver proyectos
                  </a>
                </>
              )}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-slate-400">Código y datos: open source · Fase 1 — Observatorio</p>
            <Link to="/acerca" className="text-forest-light hover:underline">Acerca y fuentes →</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
