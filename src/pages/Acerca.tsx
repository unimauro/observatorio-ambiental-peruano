import { useEffect, useState } from 'react'
import { loadJSON } from '../lib/data'

interface Fuente {
  sigla: string
  nombre: string
  url: string
  estado: 'integrado' | 'planificado'
}
interface Grupo {
  categoria: string
  fuentes: Fuente[]
}
interface Monitoreo {
  nota: string
  grupos: Grupo[]
}
interface Fase {
  id: string
  nombre: string
  estado: 'completada' | 'en progreso' | 'planificada'
  pct: number
  desc: string
  items: { t: string; ok: boolean }[]
}
interface Fases { actualizado: string; fases: Fase[] }

const ESTADO_FASE: Record<string, string> = {
  completada: 'bg-green-100 text-green-800',
  'en progreso': 'bg-amber-100 text-amber-800',
  planificada: 'bg-slate-200 text-slate-600',
}

function EstadoFuente({ estado }: { estado: string }) {
  const ok = estado === 'integrado'
  return (
    <span
      className={`shrink-0 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
        ok ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'
      }`}
    >
      {estado}
    </span>
  )
}

export default function Acerca() {
  const [mon, setMon] = useState<Monitoreo | null>(null)
  const [fases, setFases] = useState<Fases | null>(null)

  useEffect(() => {
    loadJSON<Monitoreo>('fuentes-monitoreo.json').then(setMon).catch(console.error)
    loadJSON<Fases>('fases.json').then(setFases).catch(console.error)
  }, [])

  const overall = fases ? Math.round(fases.fases.reduce((a, f) => a + f.pct, 0) / fases.fases.length) : 0

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-extrabold">Acerca del Observatorio</h1>
        <p className="mt-2 text-slate-600">
          El <strong>Observatorio Ambiental Peruano</strong> centraliza, visualiza y
          democratiza el acceso a información ambiental del Perú mediante datos abiertos,
          mapas interactivos e inteligencia artificial.
        </p>
      </div>


      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h2 className="font-bold">Hoja de ruta</h2>
          <span className="text-xs text-slate-400">Avance global: <strong className="text-forest-dark">{overall}%</strong></span>
        </div>
        {/* Barra de avance global */}
        <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden mb-4">
          <div className="h-full bg-forest rounded-full transition-all" style={{ width: `${overall}%` }} />
        </div>

        <div className="space-y-4">
          {fases?.fases.map((f) => (
            <div key={f.id} className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-semibold text-sm">{f.nombre}</h3>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${ESTADO_FASE[f.estado]}`}>{f.estado}</span>
                  <span className="text-xs font-bold text-slate-600">{f.pct}%</span>
                </div>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden my-2">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${f.pct}%`, background: f.estado === 'completada' ? '#15803d' : '#d97706' }}
                />
              </div>
              <p className="text-xs text-slate-500">{f.desc}</p>
              <ul className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1">
                {f.items.map((it, i) => (
                  <li key={i} className={`text-xs flex items-start gap-1.5 ${it.ok ? 'text-slate-700' : 'text-slate-400'}`}>
                    <span>{it.ok ? '✅' : '⏳'}</span>
                    <span>{it.t}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {fases && <p className="text-[11px] text-slate-400 mt-3">Actualizado: {fases.actualizado} · ✅ hecho · ⏳ en curso/planificado</p>}
      </section>

      <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <h2 className="font-bold mb-2 text-amber-900">Sobre la calidad del dato</h2>
        <p className="text-sm text-amber-900/90">
          Cada cifra y punto del mapa declara su <strong>estado</strong>:
          <span className="font-semibold"> verificado</span> (cifra oficial citada),
          <span className="font-semibold"> estimado</span> (derivado/distribuido a partir de oficiales) y
          <span className="font-semibold"> referencial</span> (ubicación o valor aproximado para visualización).
          Evitamos el sobre-afirmar: las coordenadas de eventos son aproximadas y se
          reemplazarán con los registros georeferenciados oficiales de OEFA.
        </p>
      </section>

      {/* Fuentes que monitoreamos */}
      <section>
        <h2 className="font-bold mb-1">Fuentes que monitoreamos</h2>
        <p className="text-sm text-slate-500 mb-3">
          El Observatorio rastrea —o integrará progresivamente— información de
          organismos de fiscalización, ministerios, organizaciones ambientales y
          organismos internacionales. <span className="font-medium text-green-700">integrado</span> = ya en uso;
          {' '}<span className="font-medium text-slate-600">planificado</span> = en hoja de ruta.
        </p>
        <div className="space-y-5">
          {mon?.grupos.map((g) => (
            <div key={g.categoria}>
              <h3 className="text-sm font-semibold text-forest-dark mb-2">{g.categoria}</h3>
              <div className="grid sm:grid-cols-2 gap-2">
                {g.fuentes.map((f) => (
                  <a
                    key={f.sigla}
                    href={f.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="bg-white border border-slate-200 rounded-lg px-3 py-2 hover:border-forest transition flex items-start gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-forest-dark text-sm">{f.sigla}</div>
                      <div className="text-xs text-slate-500 leading-snug">{f.nombre}</div>
                    </div>
                    <EstadoFuente estado={f.estado} />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-bold mb-1">Créditos</h2>
        <p className="text-sm text-slate-700">
          Dirección, tecnología y datos: <strong>Carlos Cárdenas Fernández</strong>.
        </p>
      </section>
    </div>
  )
}
