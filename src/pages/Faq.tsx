import { useEffect, useState } from 'react'
import { loadJSON } from '../lib/data'

interface Item { q: string; a: string }
interface Grupo { tema: string; items: Item[] }
interface Faq { grupos: Grupo[] }

export default function FaqPage() {
  const [faq, setFaq] = useState<Faq | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    loadJSON<Faq>('faq.json').then(setFaq).catch(console.error)
  }, [])

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold">Preguntas frecuentes</h1>
        <p className="text-sm text-slate-500">
          Cómo funciona el observatorio, de dónde salen los datos y cómo usar el asistente.
        </p>
      </div>

      {faq?.grupos.map((g) => (
        <section key={g.tema}>
          <h2 className="font-bold text-forest-dark mb-2">{g.tema}</h2>
          <div className="space-y-2">
            {g.items.map((it) => {
              const id = `${g.tema}-${it.q}`
              const isOpen = open === id
              return (
                <div key={id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setOpen(isOpen ? null : id)}
                    className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition"
                  >
                    <span className="font-medium text-sm">{it.q}</span>
                    <span className={`text-slate-400 transition-transform ${isOpen ? 'rotate-45' : ''}`}>＋</span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 text-sm text-slate-600 leading-relaxed">{it.a}</div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <p className="text-xs text-slate-400">
        ¿Tienes otra pregunta? Usa el asistente 💬 (abajo a la derecha) o abre un issue en el repositorio.
      </p>
    </div>
  )
}
