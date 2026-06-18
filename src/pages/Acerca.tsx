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
interface Metodo { tipo: string; valor: string; icono: string; color: string; activo: boolean }
interface Apoyo { autor: string; rol: string; texto: string; metodos: Metodo[] }

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
  const [apoyo, setApoyo] = useState<Apoyo | null>(null)

  useEffect(() => {
    loadJSON<Monitoreo>('fuentes-monitoreo.json').then(setMon).catch(console.error)
    loadJSON<Apoyo>('apoyo.json').then(setApoyo).catch(console.error)
  }, [])

  const metodos = apoyo?.metodos.filter((m) => m.activo) ?? []

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

      {/* Autoría y apoyo */}
      <section className="bg-gradient-to-br from-forest-dark to-water-dark text-white rounded-xl p-5">
        <h2 className="font-bold text-lg">Autoría y apoyo</h2>
        {apoyo && (
          <p className="text-sm text-forest-light/95 mt-1">
            {apoyo.rol}: <strong className="text-white">{apoyo.autor}</strong>. {apoyo.texto}
          </p>
        )}
        {metodos.length > 0 ? (
          <div className="flex flex-wrap gap-2 mt-3">
            {metodos.map((m) => {
              const isLink = m.valor.startsWith('http')
              return isLink ? (
                <a key={m.tipo} href={m.valor} target="_blank" rel="noreferrer noopener"
                  className="bg-white/95 text-ink font-semibold rounded-lg px-3 py-2 text-sm hover:bg-white flex items-center gap-1.5">
                  <span>{m.icono}</span> {m.tipo}
                </a>
              ) : (
                <span key={m.tipo} className="bg-white/95 text-ink font-semibold rounded-lg px-3 py-2 text-sm flex items-center gap-1.5">
                  <span>{m.icono}</span> {m.tipo}: {m.valor}
                </span>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-forest-light/80 mt-3">💛 Donaciones (Yape · Plin · PayPal · Coffee): próximamente.</p>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-bold mb-2">Hoja de ruta</h2>
        <ol className="space-y-2 text-sm text-slate-700">
          <li><strong>Fase 1 — Observatorio (actual):</strong> mapa nacional, derrames, deforestación, áreas protegidas, indicadores y dashboard.</li>
          <li><strong>Fase 2 — Investigación:</strong> biblioteca documental ampliada, línea de tiempo histórica (1970–hoy), estadísticas regionales.</li>
          <li><strong>Fase 3 — IA Ambiental:</strong> chat con documentos, generación de reportes, detección de patrones y alertas (RAG).</li>
        </ol>
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
