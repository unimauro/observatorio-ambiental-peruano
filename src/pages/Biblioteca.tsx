import { useEffect, useMemo, useState } from 'react'
import { loadJSON } from '../lib/data'
import type { Documento, Categoria } from '../lib/data'

export default function Biblioteca() {
  const [docs, setDocs] = useState<Documento[]>([])
  const [cats, setCats] = useState<Categoria[]>([])
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<string>('todas')

  useEffect(() => {
    loadJSON<{ documentos: Documento[] }>('documentos.json').then((d) => setDocs(d.documentos))
    loadJSON<Categoria[]>('categorias.json').then(setCats)
  }, [])

  const filtrados = useMemo(() => {
    return docs.filter((d) => {
      const okCat = filtro === 'todas' || d.categoria === filtro
      const okQ =
        !q ||
        `${d.titulo} ${d.fuente} ${d.resumen} ${d.tipo}`.toLowerCase().includes(q.toLowerCase())
      return okCat && okQ
    })
  }, [docs, q, filtro])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Biblioteca documental</h1>
        <p className="text-sm text-slate-500">
          Estudios, informes y plataformas oficiales. Estructura preparada para búsqueda
          inteligente con IA (RAG) en la Fase 3.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por título, fuente o tema…"
          className="flex-1 min-w-[220px] border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-forest outline-none"
        />
        <select
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="todas">Todas las categorías</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.icono} {c.nombre}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-3">
        {filtrados.map((d) => (
          <a
            key={d.id}
            href={d.url}
            target="_blank"
            rel="noreferrer noopener"
            className="block bg-white border border-slate-200 rounded-xl p-4 hover:border-forest hover:shadow-sm transition"
          >
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="bg-slate-100 px-2 py-0.5 rounded">{d.tipo}</span>
              <span>{d.anio}</span>
              <span>·</span>
              <span>{d.fuente}</span>
            </div>
            <h3 className="font-semibold mt-1 text-forest-dark">{d.titulo}</h3>
            <p className="text-sm text-slate-600 mt-1">{d.resumen}</p>
          </a>
        ))}
        {filtrados.length === 0 && (
          <p className="text-sm text-slate-400 py-8 text-center">Sin resultados.</p>
        )}
      </div>
    </div>
  )
}
