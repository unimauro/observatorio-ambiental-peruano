import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
  PieChart, Pie, Legend, LineChart, Line, LabelList,
} from 'recharts'
import { loadJSON, aggregateGeo, fmt } from '../lib/data'
import type { Indicadores, Eje, Deforestacion } from '../lib/data'

interface AnpResumen { porCategoria: { categoria: string; n: number; ha: number }[] }
interface Clima { glaciares: { fuente: string; serie: { anio: number; km2: number }[] } }
interface Agua {
  embalses: { fuente: string; datos: { nombre: string; capacidad_mmc: number; llenado_pct: number }[] }
}
type Serie = { name: string; value: number }[]

const PALETA = ['#15803d', '#b45309', '#0e7490', '#7c3aed', '#dc2626', '#059669', '#0369a1', '#92400e', '#a16207']

function Bloque({ children, titulo, fuente }: { children: React.ReactNode; titulo: string; fuente?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-1 mb-2">
        <h4 className="text-sm font-semibold text-slate-700">{titulo}</h4>
        {fuente && <span className="text-[10px] text-slate-400">{fuente}</span>}
      </div>
      <div className="h-72 sm:h-80">{children}</div>
    </div>
  )
}

function BarMini({ data, color = '#15803d', money }: { data: Serie; color?: string; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 12, right: 40, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" fontSize={12} tickFormatter={(v) => (money ? `${(v / 1000).toFixed(0)}k` : String(v))} />
        <YAxis type="category" dataKey="name" width={140} fontSize={12} />
        <Tooltip formatter={(v: number) => fmt(v)} cursor={{ fill: '#0000000a' }} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={26} isAnimationActive={false}>
          {data.map((_, i) => <Cell key={i} fill={color} />)}
          <LabelList dataKey="value" position="right" fontSize={11} formatter={(v: number) => fmt(v)} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function PieMini({ data }: { data: Serie }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={92} label={(e) => String(e.value)} isAnimationActive={false}>
          {data.map((_, i) => <Cell key={i} fill={PALETA[i % PALETA.length]} />)}
        </Pie>
        <Tooltip /><Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}

function LineMini({ data, color, yLabel }: { data: { x: string; y: number }[]; color: string; yLabel?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: 4, right: 18, top: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="x" fontSize={12} />
        <YAxis fontSize={12} width={48} />
        <Tooltip formatter={(v: number) => `${fmt(v)}${yLabel ? ' ' + yLabel : ''}`} />
        <Line dataKey="y" stroke={color} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export default function Temas() {
  const [ejes, setEjes] = useState<Eje[]>([])
  const [ind, setInd] = useState<Indicadores | null>(null)
  const [defo, setDefo] = useState<Deforestacion | null>(null)
  const [anp, setAnp] = useState<AnpResumen | null>(null)
  const [clima, setClima] = useState<Clima | null>(null)
  const [agua, setAgua] = useState<Agua | null>(null)
  const [riesgoSub, setRiesgoSub] = useState<Serie>([])
  const [relavesEstado, setRelavesEstado] = useState<Serie>([])
  const [mineriaTipo, setMineriaTipo] = useState<Serie>([])

  useEffect(() => {
    loadJSON<Eje[]>('ejes.json').then(setEjes).catch(console.error)
    loadJSON<Indicadores>('indicadores.json').then(setInd).catch(console.error)
    loadJSON<Deforestacion>('deforestacion.json').then(setDefo).catch(console.error)
    loadJSON<AnpResumen>('anp-resumen.json').then(setAnp).catch(console.error)
    loadJSON<Clima>('clima.json').then(setClima).catch(console.error)
    loadJSON<Agua>('agua.json').then(setAgua).catch(console.error)
    aggregateGeo('riesgo-ambiental-oefa.geojson', 'subsector').then(setRiesgoSub).catch(() => {})
    aggregateGeo('relaves-oefa-puntos.geojson', 'estado_dr').then(setRelavesEstado).catch(() => {})
    aggregateGeo('mineria-ilegal-anp.geojson', 'idtipact').then((d) => setMineriaTipo(d.slice(0, 8))).catch(() => {})
  }, [])

  const causasDerrame: Serie = [
    { name: 'Corrosión / falla operativa', value: 65 },
    { name: 'Terceros', value: 28 },
    { name: 'Otros', value: 7 },
  ]

  function goTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function graficos(id: string) {
    switch (id) {
      case 'deforestacion':
        return (
          <>
            <Bloque titulo="Pérdida anual de bosque (ha)" fuente="Geobosques/MINAM">
              <BarMini money color="#15803d" data={(defo?.serieAnual ?? []).map((s) => ({ name: String(s.anio), value: s.ha }))} />
            </Bloque>
            <Bloque titulo="Pérdida 2023 por región (ha, estimado)" fuente="Geobosques/MINAM">
              <BarMini money color="#16a34a" data={(defo?.porRegion2023 ?? []).map((s) => ({ name: s.region, value: s.ha }))} />
            </Bloque>
          </>
        )
      case 'derrames':
        return (
          <Bloque titulo="Causas de los derrames (% 2000–2019)" fuente="CNDDHH / OEFA">
            <BarMini color="#1f2937" data={causasDerrame} />
          </Bloque>
        )
      case 'mineria':
        return (
          <>
            <Bloque titulo="Riesgo ambiental alto por subsector" fuente="OEFA — PIFA">
              <BarMini color="#b45309" data={riesgoSub} />
            </Bloque>
            <Bloque titulo="Depósitos de relaves por estado" fuente="OEFA — PIFA">
              <PieMini data={relavesEstado} />
            </Bloque>
            <Bloque titulo="Minería ilegal en ANP por tipo" fuente="SERNANP">
              <BarMini color="#dc2626" data={mineriaTipo} />
            </Bloque>
          </>
        )
      case 'pasivos':
        return (
          <Bloque titulo="Depósitos de relaves por estado" fuente="OEFA — PIFA">
            <PieMini data={relavesEstado} />
          </Bloque>
        )
      case 'agua':
        return (
          <Bloque titulo="Principales embalses — capacidad (MMC)" fuente="ANA (referencia)">
            <BarMini color="#0e7490" data={(agua?.embalses.datos ?? []).map((e) => ({ name: e.nombre, value: e.capacidad_mmc }))} />
          </Bloque>
        )
      case 'clima':
        return (
          <Bloque titulo="Retroceso de la cobertura glaciar (km²)" fuente="INAIGEM (referencia)">
            <LineMini color="#0369a1" yLabel="km²" data={(clima?.glaciares.serie ?? []).map((s) => ({ x: String(s.anio), y: s.km2 }))} />
          </Bloque>
        )
      case 'anp':
        return (
          <>
            <Bloque titulo="ANP por categoría (n.° de áreas)" fuente="SERNANP">
              <BarMini color="#059669" data={(anp?.porCategoria ?? []).map((c) => ({ name: c.categoria, value: c.n }))} />
            </Bloque>
            <Bloque titulo="Superficie protegida por categoría (ha)" fuente="SERNANP">
              <BarMini money color="#047857" data={(anp?.porCategoria ?? []).map((c) => ({ name: c.categoria, value: Math.round(c.ha) }))} />
            </Bloque>
          </>
        )
      default:
        return null
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Ejes temáticos</h1>
        <p className="text-sm text-slate-500">
          Cada eje con su explicación y gráficos generados a partir de los datos reales del
          observatorio. Los marcados “en integración” se completarán con sus fuentes oficiales.
        </p>
      </div>

      {/* Menú de navegación interno */}
      <nav className="sticky top-[60px] z-[500] bg-slate-50/95 backdrop-blur -mx-4 px-4 py-2 border-y border-slate-200">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {ejes.map((e) => (
            <button
              key={e.id}
              onClick={() => goTo(e.id)}
              className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-full bg-white border border-slate-200 hover:border-forest hover:text-forest-dark transition flex items-center gap-1"
            >
              <span>{e.icono}</span>{e.nombre}
            </button>
          ))}
        </div>
      </nav>

      {ejes.map((e) => {
        const kpis = ind?.kpis.filter((k) => k.categoria === e.id) ?? []
        const conDatos = e.estado === 'con-datos'
        return (
          <section key={e.id} className="scroll-mt-[120px]" id={e.id}>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-4 sm:p-5 flex items-start gap-3" style={{ background: `${e.color}10` }}>
                <span className="text-3xl sm:text-4xl">{e.icono}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg sm:text-xl font-bold" style={{ color: e.color }}>{e.nombre}</h2>
                    <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${conDatos ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}`}>
                      {conDatos ? 'con datos' : 'en integración'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 mt-1"><strong>Qué es:</strong> {e.queEs}</p>
                  <p className="text-sm text-slate-600 mt-1">{e.explicacion}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {e.fuentes.map((f) => (
                      <span key={f} className="text-[11px] bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-500">{f}</span>
                    ))}
                  </div>
                </div>
              </div>

              {kpis.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-100">
                  {kpis.map((k) => (
                    <div key={k.id} className="bg-white p-3">
                      <div className="text-xl font-extrabold" style={{ color: e.color }}>{fmt(k.valor)}</div>
                      <div className="text-[11px] text-slate-500 leading-tight">{k.etiqueta}</div>
                    </div>
                  ))}
                </div>
              )}

              {conDatos ? (
                <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">{graficos(e.id)}</div>
              ) : (
                <div className="p-4">
                  <div className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4 text-sm text-slate-500">
                    📡 Datos en integración. Se incorporarán desde: {e.fuentes.join(', ')}.
                  </div>
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
