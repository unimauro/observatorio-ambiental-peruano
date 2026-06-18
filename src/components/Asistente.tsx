import { useEffect, useRef, useState } from 'react'
import { loadJSON } from '../lib/data'
import type { Indicadores, Eje } from '../lib/data'

interface Msg {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const KEY_LS = 'oap_openrouter_key'
const MODEL_LS = 'oap_openrouter_model'
const DEFAULT_MODEL = 'openrouter/auto'

// Gateway central de IA (ai.tunky.net): permite que cualquier visitante use el bot
// SIN poner su propia key. El token de cliente NO es secreto (scope/revocable por proyecto).
const GATEWAY_URL = 'https://ai.tunky.net/v1/chat'
const GATEWAY_PROJECT = 'observatorio'
const GATEWAY_CLIENT_TOKEN = 'obs_5356ba138c2761b3c84faf38bd82e4e4'

// Render ligero: enlaces markdown [t](u), rutas hash #/x, URLs y **negrita** → HTML seguro.
function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function renderRich(text: string): string {
  let h = esc(text)
  h = h.replace(/\[([^\]]+)\]\((#\/[^\s)]+|https?:\/\/[^\s)]+)\)/g,
    (_m, t, u) => `<a href="${u}"${u.startsWith('http') ? ' target="_blank" rel="noreferrer noopener"' : ''} class="underline font-medium">${t}</a>`)
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/(^|[\s(])(#\/[a-z/-]*)/g, (_m, pre, r) => `${pre}<a href="${r}" class="underline font-medium">${r}</a>`)
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s)]+)/g, (_m, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noreferrer noopener" class="underline font-medium">${u}</a>`)
  return h
}

const SUGERENCIAS = [
  '¿Qué es un pasivo ambiental minero?',
  '¿Por qué hay tantos derrames en la Amazonía?',
  '¿Qué empresas tienen unidades de alto riesgo?',
  '¿Cómo se mide la deforestación en el Perú?',
]

interface FaqCtx { grupos: { tema: string; items: { q: string; a: string }[] }[] }

async function buildContext(): Promise<string> {
  try {
    const [ind, ejes, faq] = await Promise.all([
      loadJSON<Indicadores>('indicadores.json'),
      loadJSON<Eje[]>('ejes.json'),
      loadJSON<FaqCtx>('faq.json').catch(() => ({ grupos: [] }) as FaqCtx),
    ])
    const kpis = ind.kpis
      .map((k) => `- ${k.etiqueta}: ${k.valor.toLocaleString('es-PE')} ${k.unidad} (${k.estado}; ${k.fuente})`)
      .join('\n')
    const temas = ejes
      .map((e) => `- ${e.nombre}: ${e.queEs} ${e.explicacion} [Fuentes: ${e.fuentes.join(', ')}]`)
      .join('\n')
    const faqs = faq.grupos
      .flatMap((g) => g.items.map((it) => `- P: ${it.q}\n  R: ${it.a}`))
      .join('\n')
    return `INDICADORES NACIONALES ACTUALES:\n${kpis}\n\nEJES TEMÁTICOS:\n${temas}\n\nPREGUNTAS FRECUENTES:\n${faqs}`
  } catch {
    return '(No se pudo cargar el contexto de datos.)'
  }
}

function systemPrompt(ctx: string): string {
  return [
    'Eres el asistente del Observatorio Ambiental Peruano (datos abiertos del ambiente en el Perú).',
    '',
    'TONO: cálido, fraterno y cercano, tratando de "tú", como alguien que acompaña con respeto. Un saludo breve solo en el primer mensaje.',
    'ESTILO: respuestas CORTAS, máximo 3 frases. Claras y directas, sin análisis largos ni rodeos.',
    'Cuando aplique, REMITE a la sección del dashboard con un ENLACE en formato markdown, p.ej. [Temas](#/temas). Secciones:',
    '- Dashboard general: [Dashboard](#/)',
    '- Mapa interactivo: [Mapa](#/mapa)',
    '- Temas por eje (gráficos): [Temas](#/temas)',
    '- Biblioteca documental: [Biblioteca](#/biblioteca)',
    '- Preguntas frecuentes: [FAQ](#/faq)',
    'Ej.: "…Mira el detalle en [Temas](#/temas)."',
    '',
    'REGLAS: responde solo sobre el ambiente del Perú y los datos de este observatorio. Si preguntan otra cosa, redirige amablemente.',
    'Usa los datos del contexto y cita la fuente brevemente. NO inventes cifras: si no está, dilo y nombra la fuente oficial (OEFA, MINAM, SERNANP, ANA). Sin alarmismos.',
    '',
    'CONTEXTO DE DATOS:',
    ctx,
  ].join('\n')
}

export default function Asistente() {
  const [open, setOpen] = useState(false)
  const [showCfg, setShowCfg] = useState(false)
  const [key, setKey] = useState('')
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [ctx, setCtx] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setKey(localStorage.getItem(KEY_LS) ?? '')
    setModel(localStorage.getItem(MODEL_LS) ?? DEFAULT_MODEL)
  }, [])

  useEffect(() => {
    if (open && !ctx) buildContext().then(setCtx)
  }, [open, ctx])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, loading])

  function saveCfg() {
    localStorage.setItem(KEY_LS, key.trim())
    localStorage.setItem(MODEL_LS, model.trim() || DEFAULT_MODEL)
    setShowCfg(false)
    setError('')
  }

  async function send(text: string) {
    const q = text.trim()
    if (!q || loading) return
    setError('')
    const next: Msg[] = [...msgs, { role: 'user', content: q }]
    const payloadMsgs = [
      { role: 'system' as const, content: systemPrompt(ctx) },
      ...next.map((m) => ({ role: m.role, content: m.content })),
    ]
    setMsgs(next)
    setInput('')
    setLoading(true)
    try {
      let reply: string | null = null
      // 1) Gateway central (sin key del usuario).
      try {
        const r = await fetch(GATEWAY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Token': GATEWAY_CLIENT_TOKEN },
          body: JSON.stringify({ project: GATEWAY_PROJECT, messages: payloadMsgs }),
        })
        if (r.ok) reply = (await r.json()).reply ?? null
      } catch { /* gateway no disponible → intentamos respaldo */ }

      // 2) Respaldo: API key propia del usuario (si la configuró).
      if (reply == null && key.trim()) {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key.trim()}`,
            'HTTP-Referer': location.origin,
            'X-Title': 'Observatorio Ambiental Peruano',
          },
          body: JSON.stringify({ model: model.trim() || DEFAULT_MODEL, messages: payloadMsgs }),
        })
        if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 140)}`)
        reply = (await r.json()).choices?.[0]?.message?.content ?? null
      }

      if (reply == null) {
        throw new Error('El asistente no está disponible por ahora. Puedes usar tu propia API key en ⚙️.')
      }
      setMsgs((m) => [...m, { role: 'assistant', content: reply! }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al consultar el modelo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-[1100] bg-forest-dark hover:bg-forest text-white rounded-full shadow-lg w-14 h-14 flex items-center justify-center text-2xl transition"
        aria-label="Asistente del Observatorio"
        title="Pregúntale al Observatorio"
      >
        {open ? '✕' : '💬'}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-[1100] w-[min(94vw,400px)] h-[min(70vh,560px)] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          <div className="bg-forest-dark text-white px-4 py-3 flex items-center justify-between">
            <div>
              <div className="font-bold text-sm">Asistente ambiental</div>
              <div className="text-[11px] text-forest-light/90">Explica los datos del observatorio</div>
            </div>
            <button onClick={() => setShowCfg((s) => !s)} className="text-white/90 hover:text-white text-lg" title="Ajustes" aria-label="Ajustes">⚙️</button>
          </div>

          {showCfg && (
            <div className="p-3 bg-slate-50 border-b border-slate-200 text-sm space-y-2">
              <p className="text-xs text-slate-600">
                El asistente ya funciona sin configurar nada (usa el servicio del observatorio).
                Opcional: usa tu propia API key de OpenRouter como respaldo — se guarda solo en este
                navegador. Consíguela en{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer noopener" className="text-water underline">openrouter.ai/keys</a>.
              </p>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="API key de OpenRouter (sk-or-...)"
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              />
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Modelo (ej. openrouter/auto)"
                className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              />
              <button onClick={saveCfg} className="bg-forest-dark text-white text-sm rounded-lg px-3 py-1.5 w-full">Guardar</button>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {msgs.length === 0 && !showCfg && (
              <div className="text-sm text-slate-500 space-y-2">
                <p>Hola 👋 Pregúntame qué significan los datos ambientales del Perú.</p>
                <div className="flex flex-col gap-1.5">
                  {SUGERENCIAS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="text-left text-xs bg-slate-100 hover:bg-slate-200 rounded-lg px-2.5 py-1.5 transition">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                {m.role === 'assistant' ? (
                  <span
                    className="inline-block text-sm rounded-2xl px-3 py-2 max-w-[90%] whitespace-pre-wrap text-left bg-slate-100 text-ink [&_a]:text-forest-dark"
                    dangerouslySetInnerHTML={{ __html: renderRich(m.content) }}
                  />
                ) : (
                  <span className="inline-block text-sm rounded-2xl px-3 py-2 max-w-[90%] whitespace-pre-wrap text-left bg-forest-dark text-white">
                    {m.content}
                  </span>
                )}
              </div>
            ))}
            {loading && <div className="text-sm text-slate-400">Pensando…</div>}
            {error && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1.5">{error}</div>}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(input) }}
            className="p-2 border-t border-slate-200 flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu pregunta…"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-forest"
            />
            <button type="submit" disabled={loading} className="bg-forest-dark text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50">
              ➤
            </button>
          </form>
        </div>
      )}
    </>
  )
}
