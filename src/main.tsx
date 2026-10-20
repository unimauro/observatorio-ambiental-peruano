import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Temas from './pages/Temas'
import Biblioteca from './pages/Biblioteca'
import Faq from './pages/Faq'
import Acerca from './pages/Acerca'

// Las páginas con Leaflet se cargan bajo demanda: la portada no descarga el mapa
const Mapa = lazy(() => import('./pages/Mapa'))
const Incendios = lazy(() => import('./pages/Incendios'))
const cargandoPagina = <div className="py-16 text-center text-sm text-slate-500">Cargando…</div>

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="mapa" element={<Suspense fallback={cargandoPagina}><Mapa /></Suspense>} />
          <Route path="incendios" element={<Suspense fallback={cargandoPagina}><Incendios /></Suspense>} />
          <Route path="temas" element={<Temas />} />
          <Route path="biblioteca" element={<Biblioteca />} />
          <Route path="faq" element={<Faq />} />
          <Route path="acerca" element={<Acerca />} />
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>,
)
