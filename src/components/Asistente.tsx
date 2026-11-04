import { useEffect, useRef, useState } from 'react'
import { loadJSON } from '../lib/data'
import type { Indicadores, Eje, Derrames } from '../lib/data'

interface Msg {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// Gateway central de IA (ai.tunky.net): el bot funciona automáticamente, sin que
// el visitante configure nada. El token de cliente NO es secreto (revocable por proyecto).
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

interface HidroAmz {
  actualizado: string
  fuente: string
  capas: {
    monitoreo_indigena?: { total_registros: number; mapeados: number; por_tipo: [string, number][]; por_cuenca_federacion: [string, number][] }
    oefa_isim?: { puntos_unicos: number; registros_por_componente: Record<string, number> }
    pash_amazonia?: { total: number; mapeados: number }
    planes_rehabilitacion?: { sitios: number; costo_total_soles: number }
  }
}

interface IncEstado { dias: number; total_focos: number; ultima_sincronizacion_utc: string | null }
interface NinoCtx { generado_utc: string; alertas: { tipo: string; nivel: number; origen: string; titulo: string; detalle: string; fuente: string }[] }
interface NinoEnsoCtx { actual: { icen_proxy: number | null; icen_categoria: string | null; icen_proxy_mes: string | null; n12_anomalia_semanal: number | null; n34_anomalia_semanal: number | null; semana: string | null } }
interface NinoAvisosCtx { generado_utc: string; meteorologicos: { numero: string; estado: string; color: string; tipo: string; titulo: string | null; inicio: string | null; fin: string | null; departamentos: string[]; descripcion?: string | null }[]; hidrologicos: { titulo: string | null; nivel: number | null; departamento: string | null; fecha: string | null }[] }
interface NinoEmergCtx { generado_utc: string; items: { titulo: string; tipo: string; clase: string; evento: string | null; departamento: string | null; provincia: string | null; distrito: string | null; publicado_utc: string | null; hechos: { fecha: string; hora: string; descripcion: string | null }[] }[]; resumen: { lluvia_72h: number; lluvia_30d: number; reportes_30d: number; departamentos_lluvia_72h: string[]; por_tipo_30d: Record<string, number> } }
/** Listas de fuentes/capas que escriben los ETL: lo que aparezca aquí entra solo al contexto, sin tocar este archivo. */
interface EstadoFuentes { ultima_sincronizacion_utc?: string | null; fuentes?: { id: string; nombre: string; estado: string; ultimo_exito: string | null; registros: number | null }[] }
interface Manifiesto { generado?: string; capas?: { archivo: string; titulo: string; fuente: string; features: number }[] }
interface IncResumen { total: number; porAnio: { anio: number; registros: number }[]; porDepartamento: { departamento: string; registros: number }[] }

async function buildContext(): Promise<string> {
  try {
    const [ind, ejes, faq, der, amz, incE, incR, ninoA, ninoE, ninoAv, ninoEm, ninoEst, incEst, manif] = await Promise.all([
      loadJSON<Indicadores>('indicadores.json'),
      loadJSON<Eje[]>('ejes.json'),
      loadJSON<FaqCtx>('faq.json').catch(() => ({ grupos: [] }) as FaqCtx),
      loadJSON<Derrames>('derrames.json').catch(() => null),
      loadJSON<HidroAmz>('hidrocarburos-amazonia.json').catch(() => null),
      loadJSON<IncEstado>('incendios/estado.json').catch(() => null),
      loadJSON<IncResumen>('incendios/minam-resumen.json').catch(() => null),
      loadJSON<NinoCtx>('nino/alertas.json').catch(() => null),
      loadJSON<NinoEnsoCtx>('nino/enso.json').catch(() => null),
      loadJSON<NinoAvisosCtx>('nino/avisos.json').catch(() => null),
      loadJSON<NinoEmergCtx>('nino/emergencias.json').catch(() => null),
      loadJSON<EstadoFuentes>('nino/estado.json').catch(() => null),
      loadJSON<EstadoFuentes>('incendios/estado.json').catch(() => null),
      loadJSON<Manifiesto>('_manifest.json').catch(() => null),
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
    const hidro = der
      ? '\n\nDERRAMES Y PASIVOS DE HIDROCARBUROS (OEFA, oficial):\n'
        + der.kpis.map((k) => `- ${k.etiqueta}: ${k.valor.toLocaleString('es-PE')}${k.de ? ` de ${k.de.toLocaleString('es-PE')}` : ''} (${k.fuente})`).join('\n')
        + `\n- Departamentos con más pasivos: ${der.pasivosPorDepartamento.slice(0, 5).map((d) => `${d.clave} (${d.valor})`).join(', ')}`
        + `\n- Nota metodológica: ${der.nota}`
      : ''
    const c = amz?.capas
    const amazonia = c
      ? '\n\nSITIOS IMPACTADOS POR HIDROCARBUROS EN LA AMAZONÍA (cuencas Pastaza, Corrientes, Tigre y Marañón, Loreto):\n'
        + (c.monitoreo_indigena
          ? `- Monitoreo indígena (PUINAMUDT, 2007-2025): ${c.monitoreo_indigena.total_registros.toLocaleString('es-PE')} impactos registrados por monitores indígenas, ${c.monitoreo_indigena.mapeados.toLocaleString('es-PE')} con coordenada en el mapa. Tipos más frecuentes: ${c.monitoreo_indigena.por_tipo.slice(0, 4).map((t) => `${t[0]} (${t[1]})`).join(', ')}. Federaciones: ${c.monitoreo_indigena.por_cuenca_federacion.slice(0, 4).map((t) => `${t[0]} (${t[1]})`).join(', ')}.\n`
          : '')
        + (c.oefa_isim ? `- Monitoreo OEFA de sitios impactados (ISIM, 2022-2024): ${c.oefa_isim.puntos_unicos} puntos con muestreo de ${Object.keys(c.oefa_isim.registros_por_componente).join(', ').toLowerCase()}.\n` : '')
        + (c.pash_amazonia ? `- Pasivos de hidrocarburos en la Amazonía (MINEM/DGAAH): ${c.pash_amazonia.total} registros oficiales.\n` : '')
        + (c.planes_rehabilitacion ? `- Sitios con plan de rehabilitación (MINEM): ${c.planes_rehabilitacion.sitios} sitios, con un costo estimado total de S/ ${Math.round(c.planes_rehabilitacion.costo_total_soles).toLocaleString('es-PE')}.` : '')
        + `\n- Fuente: ${amz.fuente} Se ven en [Mapa](#/mapa), grupo "Amazonía: sitios impactados".`
      : ''
    const incendios = incE || incR
      ? '\n\nINCENDIOS FORESTALES:\n'
        + (incE ? `- Focos de calor satelitales (NASA FIRMS, VIIRS/MODIS) en el Perú en los últimos ${incE.dias} días: ${incE.total_focos.toLocaleString('es-PE')} detecciones (última sincronización ${incE.ultima_sincronizacion_utc ?? 'sin datos'} UTC). Una detección NO es un incendio confirmado ni sirve para calcular hectáreas quemadas. Detalle y filtros en [Incendios](#/incendios).\n` : '')
        + (incR ? `- Registro administrativo de incendios del MINAM 2000–2025: ${incR.total.toLocaleString('es-PE')} registros. Años con más registros: ${[...incR.porAnio].sort((a, b) => b.registros - a.registros).slice(0, 3).map((a) => `${a.anio} (${a.registros})`).join(', ')}. Departamentos: ${incR.porDepartamento.slice(0, 5).map((d) => `${d.departamento} (${d.registros})`).join(', ')}.` : '')
      : ''
    const e = ninoE?.actual
    const nino = ninoA || e
      ? '\n\nEL NIÑO, LLUVIAS Y CALOR (actualizado cada hora; detalle en [El Niño](#/nino)):\n'
        + (e ? `- Temperatura del mar: proxy del ICEN ${e.icen_proxy !== null ? e.icen_proxy.toFixed(2) : 's/d'} °C (${e.icen_categoria ?? 's/d'}, ${e.icen_proxy_mes ?? ''}); anomalía semanal Niño 1+2 ${e.n12_anomalia_semanal ?? 's/d'} °C y Niño 3.4 ${e.n34_anomalia_semanal ?? 's/d'} °C (semana ${e.semana ?? 's/d'}, NOAA). El proxy es un cálculo del observatorio, NO el ICEN oficial del ENFEN.\n` : '')
        + (ninoA ? ninoA.alertas.map((a) => `- [nivel ${a.nivel}/4, ${a.origen}] ${a.titulo}. ${a.detalle} (${a.fuente})`).join('\n') : '')
        + '\n- Regla: los avisos "oficial" son del SENAMHI/ENFEN/COEN; los de "modelo" (Open-Meteo, GloFAS) son referenciales. Ante emergencias: INDECI 115.'
      : ''
    const met = ninoAv?.meteorologicos?.filter((a) => a && typeof a === 'object' && 'numero' in a) ?? []
    const avisosMet = met.length
      ? `\n\nAVISOS METEOROLÓGICOS VIGENTES DEL SENAMHI (oficiales; ${met.length} avisos; datos del ${ninoAv!.generado_utc} UTC):\n`
        + met.map((a) => `- Aviso N° ${a.numero} (${a.color.toLowerCase()}, ${a.estado === 'emitido' ? 'aún no empieza' : 'vigente'}, ${a.tipo}): ${(a.titulo ?? '').toLowerCase()}. Del ${a.inicio ?? '?'} al ${a.fin ?? '?'}. Departamentos: ${a.departamentos.length ? a.departamentos.join(', ') : 's/d'}.${a.descripcion ? ` ${a.descripcion}` : ''}`).join('\n')
        + (ninoAv!.hidrologicos?.length ? `\n- Avisos hidrológicos (ríos): ${ninoAv!.hidrologicos.map((h) => `${h.titulo ?? 'aviso'} (nivel ${h.nivel ?? '?'}, ${h.departamento ?? ''}, ${h.fecha ?? ''})`).join('; ')}` : '')
        + '\n- Cada aviso enlaza a su página oficial en senamhi.gob.pe/?p=aviso-meteorologico; el nivel rojo es el máximo (4), naranja 3, amarillo 2.'
      : ''
    const lluviaEm = (ninoEm?.items ?? []).filter((x) => ['lluvias', 'huaycos', 'inundacion', 'deslizamiento', 'granizada'].includes(x.tipo)).slice(0, 15)
    const emergencias = ninoEm
      ? `\n\nEMERGENCIAS REPORTADAS POR EL COEN-INDECI (daños YA OCURRIDOS, no pronóstico; fuente portal.indeci.gob.pe/emergencias; datos del ${ninoEm.generado_utc} UTC):\n`
        + `- Reportes por lluvias, huaycos, inundaciones, deslizamientos o granizadas: ${ninoEm.resumen.lluvia_72h} en las últimas 72 h (${ninoEm.resumen.departamentos_lluvia_72h.join(', ') || 'sin departamento'}), ${ninoEm.resumen.lluvia_30d} en 30 días. Todos los reportes en 30 días por tipo: ${Object.entries(ninoEm.resumen.por_tipo_30d).map(([k, v]) => `${k} ${v}`).join(', ')}.\n`
        + lluviaEm.map((x) => `- ${x.publicado_utc?.slice(0, 10) ?? ''} ${x.clase}: ${(x.evento ?? x.tipo).toLowerCase()} en ${x.distrito ?? x.provincia ?? x.departamento ?? 's/d'}${x.distrito || x.provincia ? ` (${x.departamento ?? ''})` : ''}.${x.hechos[0]?.descripcion ? ` ${x.hechos[0].fecha}: ${x.hechos[0].descripcion}` : ''}`).join('\n')
        + '\n- Un reporte complementario es la misma emergencia actualizada; el conteo es de reportes publicados, no de emergencias distintas. No se extraen cifras de damnificados.'
      : ''
    // Inventario automático: cada ETL publica su lista de fuentes/capas; una fuente nueva aparece aquí sin editar este archivo.
    const hace = (iso: string | null | undefined) => (iso ? `${Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000))} h` : 's/d')
    const listaFuentes = (titulo: string, e: EstadoFuentes | null) => e?.fuentes?.length
      ? `\n- ${titulo} (última sincronización hace ${hace(e.ultima_sincronizacion_utc)}): ` + e.fuentes.map((f) => `${f.nombre} [${f.estado === 'ok' || f.estado === 'sin-cambios' ? 'al día' : f.estado === 'previo' ? `datos de hace ${hace(f.ultimo_exito)}` : 'sin datos'}${f.registros ? `, ${f.registros.toLocaleString('es-PE')} registros` : ''}]`).join('; ')
      : ''
    const inventario = '\n\nFUENTES Y CAPAS CONECTADAS AL OBSERVATORIO (inventario automático; si preguntan "qué datos tienen" o "de dónde sale", responde con esto):'
      + listaFuentes('Módulo El Niño, lluvias y calor [El Niño](#/nino)', ninoEst)
      + listaFuentes('Módulo Incendios [Incendios](#/incendios)', incEst)
      + (manif?.capas?.length ? `\n- Capas del [Mapa](#/mapa) (${manif.capas.length}, generadas ${manif.generado?.slice(0, 10) ?? 's/f'}): ` + manif.capas.map((c) => `${c.titulo} (${c.features.toLocaleString('es-PE')} elementos; ${c.fuente})`).join('; ') : '')
    return `INDICADORES NACIONALES ACTUALES:\n${kpis}\n\nEJES TEMÁTICOS:\n${temas}${hidro}${amazonia}${incendios}${nino}${avisosMet}${emergencias}${inventario}\n\nPREGUNTAS FRECUENTES:\n${faqs}`
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
    '- Incendios forestales (focos de calor en vivo): [Incendios](#/incendios)',
    '- El Niño, lluvias, huaycos, ríos y calor (avisos del SENAMHI, emergencias del COEN, pronósticos): [El Niño](#/nino)',
    'Ej.: "…Mira el detalle en [Temas](#/temas)."',
    '',
    'REGLAS: responde solo sobre el ambiente del Perú y los datos de este observatorio. Si preguntan otra cosa, redirige amablemente.',
    'Usa los datos del contexto y cita la fuente brevemente. NO inventes cifras: si no está, dilo y nombra la fuente oficial (OEFA, MINAM, SERNANP, ANA, SENAMHI, INDECI). Sin alarmismos.',
    'LLUVIAS Y EL NIÑO: distingue siempre AVISO (pronóstico oficial del SENAMHI, con nivel y vigencia) de EMERGENCIA (daño ya ocurrido, reportado por el COEN-INDECI). Si preguntan por un departamento, revisa qué avisos lo incluyen y qué reportes del COEN lo mencionan. El proxy del ICEN es un cálculo del observatorio, no el ICEN oficial.',
    '',
    'CONTEXTO DE DATOS:',
    ctx,
  ].join('\n')
}

export default function Asistente() {
  const [open, setOpen] = useState(false)
  const [ctx, setCtx] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && !ctx) buildContext().then(setCtx)
  }, [open, ctx])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, loading])

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
      const r = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Token': GATEWAY_CLIENT_TOKEN },
        body: JSON.stringify({ project: GATEWAY_PROJECT, messages: payloadMsgs }),
      })
      if (!r.ok) throw new Error('no-ok')
      const reply = (await r.json()).reply
      if (!reply) throw new Error('vacío')
      setMsgs((m) => [...m, { role: 'assistant', content: reply }])
    } catch {
      setError('El asistente está ocupado por ahora 🙏. Intenta de nuevo en un momento.')
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
          <div className="bg-forest-dark text-white px-4 py-3">
            <div className="font-bold text-sm">Asistente ambiental</div>
            <div className="text-[11px] text-forest-light/90">Explica los datos del observatorio</div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {msgs.length === 0 && (
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
