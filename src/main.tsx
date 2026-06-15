import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Mapa from './pages/Mapa'
import Biblioteca from './pages/Biblioteca'
import Acerca from './pages/Acerca'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="mapa" element={<Mapa />} />
          <Route path="biblioteca" element={<Biblioteca />} />
          <Route path="acerca" element={<Acerca />} />
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>,
)
