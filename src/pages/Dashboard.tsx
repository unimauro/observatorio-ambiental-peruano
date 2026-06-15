import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import { loadJSON, fmt } from '../lib/data'
import type { Indicadores, Categoria, Deforestacion } from '../lib/data'
import Estado from '../components/Estado'

interface AnpResumen {
  fuente: string
  totalPoligonos: number
  superficieLegalHa: number
  porCategoria: { categoria: string; n: number; ha: number }[]
}

export default function Dashboard() {
  const [ind, setInd] = useState<Indicadores | null>(null)
  const [cats, setCats] = useState<Categoria[]>([])
  const [defo, setDefo] = useState<Deforestacion | null>(null)
  const [anp, setAnp] = useState<AnpResumen | null>(null)

  useEffect(() => {
    loadJSON<Indicadores>('indicadores.json').then(setInd).catch(console.error)
    loadJSON<Categoria[]>('categorias.json').then(setCats).catch(console.error)
    loadJSON<Deforestacion>('deforestacion.json').then(setDefo).catch(console.error)
    loadJSON<AnpResumen>('anp-resumen.json').then(setAnp).catch(console.error)
  }, [])

  return (
    <div className="space-y-8">
      <section className="rounded-xl bg-gradient-to-br from-forest-dark to-water-dark text-white p-6 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-extrabold">Estado ambiental del Perú</h1>
        <p className="mt-2 max-w-2xl text-forest-light/95">
          Centralizamos, visualizamos y democratizamos el acceso a información ambiental
          del Perú con datos abiertos y mapas interactivos. Cada cifra declara su fuente.
        </p>
        <div className="mt-4 flex gap-3">
          <Link to="/mapa" className="bg-white text-forest-dark font-semibold px-4 py-2 rounded-lg hover:bg-slate-100">
            Ver el mapa →
          </Link>
          <Link to="/biblioteca" className="bg-white/15 px-4 py-2 rounded-lg hover:bg-white/25">
            Biblioteca documental
          </Link>
        </div>
      </section>

      {/* KPIs */}
      <section>
        <h2 className="text-lg font-bold mb-3">Indicadores nacionales</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {ind?.kpis.map((k) => (
            <div key={k.id} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <span className="text-3xl font-extrabold text-forest-dark">{fmt(k.valor)}</span>
                <Estado estado={k.estado} />
              </div>
              <span className="text-xs text-slate-500 mt-0.5">{k.unidad}</span>
              <span className="text-sm font-medium mt-2 leading-snug">{k.etiqueta}</span>
              <span className="text-[11px] text-slate-400 mt-2 leading-tight">{k.fuente}</span>
            </div>
          ))}
        </div>
        {ind && <p className="text-xs text-slate-400 mt-2">Actualizado: {ind.actualizado}. {ind.nota}</p>}
      </section>

      {/* Categorías */}
      <section>
        <h2 className="text-lg font-bold mb-3">Ejes temáticos</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
          {cats.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
              <span className="text-2xl" style={{ filter: 'saturate(1.1)' }}>{c.icono}</span>
              <div>
                <div className="font-semibold leading-tight">{c.nombre}</div>
                <div className="h-1 w-10 rounded mt-1" style={{ background: c.color }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Deforestación */}
      <section className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold">Pérdida anual de bosque amazónico (ha)</h2>
          <span className="text-xs text-slate-400">{defo?.fuente}</span>
        </div>
        <div className="h-72 mt-4">
          {defo && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={defo.serieAnual} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="anio" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [`${fmt(v)} ha`, 'Pérdida']} />
                <Bar dataKey="ha" radius={[4, 4, 0, 0]}>
                  {defo.serieAnual.map((d) => (
                    <Cell key={d.anio} fill={d.estado === 'verificado' ? '#15803d' : '#86efac'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Barras verde oscuro = cifra oficial verificada; verde claro = referencia Geobosques. {defo?.nota}
        </p>
      </section>

      {/* ANP por categoría (oficial SERNANP) */}
      <section className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold">Áreas Naturales Protegidas por categoría</h2>
          <span className="text-xs text-green-700 font-medium">capa oficial SERNANP · verificado</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-4">
          {anp?.porCategoria.map((c) => (
            <div key={c.categoria} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold text-sm text-forest-dark">{c.categoria}</span>
                <span className="text-xs bg-green-100 text-green-800 rounded px-1.5 py-0.5">{c.n}</span>
              </div>
              <div className="text-sm text-slate-600 mt-1">{fmt(Math.round(c.ha))} ha</div>
            </div>
          ))}
        </div>
        {anp && (
          <p className="text-xs text-slate-400 mt-3">
            {fmt(anp.totalPoligonos)} polígonos · {fmt(Math.round(anp.superficieLegalHa))} ha. {anp.fuente}
          </p>
        )}
      </section>
    </div>
  )
}
