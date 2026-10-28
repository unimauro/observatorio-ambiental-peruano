import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from 'recharts'
import { fmt } from '../lib/data'
import {
  TIPOS, NIVELES, ORIGENES, filtrarAlertas, nivelMaximo, parseCcpp, desdeColumnar, frescura, hace, horaLima, diaCorto,
  colorLluvia, colorCalor, colorCategoria, serieMensual, episodios,
} from '../lib/nino'
import type {
  Alerta, AlertasArchivo, Enso, Enfen, Avisos, Quebradas, Silvia, Sonics, Estacional, Pronostico, Caudales, EstadoNino, TipoAlerta,
} from '../lib/nino'

const base = import.meta.env.BASE_URL
const PERU_BOUNDS: L.LatLngBoundsExpression = [[-18.4, -81.4], [-0.03, -68.6]]
const REFRESCO_MS = 10 * 60_000
const WMS = 'https://idesep.senamhi.gob.pe/geoserver/wms'

// Capas WMS que se piden directamente al GeoServer del SENAMHI (solo imágenes; sin datos personales)
const CAPAS_WMS = [
  { id: 'quebradas', etiqueta: 'Activación de quebradas (distritos)', capa: 'g_acti_quebrada:view_av_activ_qdra', defecto: true },
  { id: 'silvia', etiqueta: 'SILVIA · movimientos en masa, día 1', capa: 'silvia:cuencas_nivel_12_prono1_silvia', defecto: false },
  { id: 'sonics', etiqueta: 'SONICS · crecidas fluviales, día 1', capa: 'dhi-seh-sonics:SONICS-PRONOSTICO-01', defecto: false },
  { id: 'aviso', etiqueta: 'Aviso meteorológico vigente', capa: 'g_aviso:view_aviso', defecto: false },
  { id: 'pp24', etiqueta: 'Pronóstico de lluvia 24 h', capa: 'g_prono_pp_24h:view_aviso24h', defecto: false },
  { id: 'verano', etiqueta: 'Pronóstico verano 2027 (sectores)', capa: 'spc:prono_verano_poligono', defecto: false },
]
const CAPAS_PUNTOS = [
  { id: 'ccpp', etiqueta: 'Centros poblados · quebradas nivel 3–4', defecto: true },
  { id: 'hidro', etiqueta: 'Avisos hidrológicos (ríos)', defecto: true },
  { id: 'umbral', etiqueta: 'Estaciones que superan umbral de lluvia', defecto: true },
  { id: 'sonicsccpp', etiqueta: 'Centros poblados · crecida fluvial nivel 2–3', defecto: false },
  { id: 'ciudades', etiqueta: 'Ciudades · pronóstico 7 días', defecto: true },
]

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const fila = (k: string, v: unknown) => (v === null || v === undefined || v === '' ? '' : `<div style="font-size:12px"><b>${esc(k)}:</b> ${esc(v)}</div>`)

async function cargar<T>(archivo: string): Promise<T> {
  const r = await fetch(`${base}data/nino/${archivo}?v=${Math.floor(Date.now() / 300_000)}`, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`${archivo}: HTTP ${r.status}`)
  return r.json() as Promise<T>
}

function Chip({ activo, onClick, children, color = 'sky' }: { activo: boolean; onClick: () => void; children: React.ReactNode; color?: 'sky' | 'slate' }) {
  const on = color === 'sky' ? 'bg-sky-700 border-sky-700 text-white shadow-sm' : 'bg-slate-800 border-slate-800 text-white'
  return (
    <button type="button" aria-pressed={activo} onClick={onClick}
      className={`min-h-[36px] px-3 py-1.5 rounded-full border text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${activo ? on : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
      {children}
    </button>
  )
}

function Tarjeta({ titulo, children, nota, className = '' }: { titulo: string; children: React.ReactNode; nota?: string; className?: string }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-4 ${className}`}>
      <h3 className="font-semibold text-sm">{titulo}</h3>
      {nota && <p className="text-xs text-slate-500 mt-0.5">{nota}</p>}
      <div className="mt-3">{children}</div>
    </div>
  )
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return <span className="inline-block text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded text-white" style={{ background: color }}>{children}</span>
}

function TarjetaAlerta({ a }: { a: Alerta }) {
  const n = NIVELES[a.nivel]
  const t = TIPOS.find((x) => x.id === a.tipo)
  return (
    <article className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 border-l-4" style={{ borderLeftColor: n.color }}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <Badge color={n.color}>{n.etiqueta}</Badge>
        <span className={`px-1.5 py-0.5 rounded border ${a.origen === 'oficial' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : a.origen === 'modelo' ? 'bg-slate-50 border-slate-300 text-slate-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`} title={ORIGENES[a.origen].nota}>
          {ORIGENES[a.origen].etiqueta}
        </span>
        <span className="text-slate-500">{t?.icono} {t?.etiqueta}</span>
      </div>
      <h3 className="font-semibold text-sm mt-1.5 leading-snug">{a.titulo}</h3>
      {a.detalle && <p className="text-xs text-slate-600 mt-1">{a.detalle}</p>}
      <p className="text-[11px] text-slate-400 mt-1.5">
        {a.fuente}{a.url && <> · <a className="underline hover:text-sky-700" href={a.url} target="_blank" rel="noreferrer noopener">ver fuente ↗</a></>}
      </p>
    </article>
  )
}

export default function Nino() {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const capasRef = useRef<Record<string, L.Layer>>({})

  const [estado, setEstado] = useState<EstadoNino | null>(null)
  const [alertas, setAlertas] = useState<AlertasArchivo | null>(null)
  const [enso, setEnso] = useState<Enso | null>(null)
  const [enfen, setEnfen] = useState<Enfen | null>(null)
  const [avisos, setAvisos] = useState<Avisos | null>(null)
  const [quebradas, setQuebradas] = useState<Quebradas | null>(null)
  const [silvia, setSilvia] = useState<Silvia | null>(null)
  const [sonics, setSonics] = useState<Sonics | null>(null)
  const [estacional, setEstacional] = useState<Estacional | null>(null)
  const [pron, setPron] = useState<Pronostico | null>(null)
  const [caud, setCaud] = useState<Caudales | null>(null)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [reloj, setReloj] = useState(Date.now())

  const [tipo, setTipo] = useState<TipoAlerta | 'todas'>('todas')
  const [soloOficiales, setSoloOficiales] = useState(false)
  const [modo, setModo] = useState<'lluvia' | 'calor'>('lluvia')
  const [wmsOn, setWmsOn] = useState<Record<string, boolean>>(Object.fromEntries(CAPAS_WMS.map((c) => [c.id, c.defecto])))
  const [ptsOn, setPtsOn] = useState<Record<string, boolean>>(Object.fromEntries(CAPAS_PUNTOS.map((c) => [c.id, c.defecto])))
  const [depSel, setDepSel] = useState('')

  useEffect(() => {
    let vivo = true
    async function leer() {
      const r = await Promise.allSettled([
        cargar<EstadoNino>('estado.json'), cargar<AlertasArchivo>('alertas.json'), cargar<Enso>('enso.json'), cargar<Enfen>('enfen.json'),
        cargar<Avisos>('avisos.json'), cargar<Quebradas>('quebradas.json'), cargar<Silvia>('silvia.json'), cargar<Sonics>('sonics.json'),
        cargar<Estacional>('estacional.json'), cargar<Pronostico>('pronostico.json'), cargar<Caudales>('caudales.json'),
      ])
      if (!vivo) return
      const set = [setEstado, setAlertas, setEnso, setEnfen, setAvisos, setQuebradas, setSilvia, setSonics, setEstacional, setPron, setCaud] as ((v: any) => void)[]
      r.forEach((x, i) => { if (x.status === 'fulfilled') set[i](x.value) })
      setErrorCarga(r[1].status === 'rejected' && r[0].status === 'rejected' ? 'No se pudieron cargar los datos. Reintentando automáticamente.' : null)
      setReloj(Date.now())
      setCargando(false)
    }
    void leer()
    const id = setInterval(leer, REFRESCO_MS)
    const tic = setInterval(() => setReloj(Date.now()), 60_000)
    return () => { vivo = false; clearInterval(id); clearInterval(tic) }
  }, [])

  const fresc = frescura(estado, reloj)
  const lista = useMemo(() => filtrarAlertas(alertas?.alertas ?? [], tipo, soloOficiales), [alertas, tipo, soloOficiales])
  const maxNivel = nivelMaximo(alertas?.alertas ?? [])
  const ccpp = useMemo(() => parseCcpp(quebradas), [quebradas])
  const sonicsPts = useMemo(() => desdeColumnar<{ nombre: string; departamento: string; provincia: string; distrito: string; nivel: number; lat: number; lon: number }>(sonics?.campos_dia1, sonics?.dia1), [sonics])
  const a = enso?.actual
  const deps = useMemo(() => (quebradas?.resumen.departamentos ?? []).map((d) => d.departamento).sort(), [quebradas])

  // Mapa base
  useEffect(() => {
    if (!ref.current || mapRef.current) return
    const map = L.map(ref.current, { scrollWheelZoom: true, preferCanvas: true }).fitBounds(PERU_BOUNDS)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap · Avisos: SENAMHI IDESEP · Pronóstico: Open-Meteo', maxZoom: 18 }).addTo(map)
    fetch(`${base}data/peru-departamentos.geojson`).then((r) => r.json()).then((gj) => {
      L.geoJSON(gj, { style: { color: '#475569', weight: 0.8, fillOpacity: 0 }, interactive: false }).addTo(map)
    }).catch(() => {})
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Capas WMS del SENAMHI
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const c of CAPAS_WMS) {
      const k = `wms:${c.id}`
      const existe = capasRef.current[k]
      if (wmsOn[c.id] && !existe) {
        capasRef.current[k] = L.tileLayer.wms(WMS, { layers: c.capa, format: 'image/png', transparent: true, opacity: 0.6, attribution: 'SENAMHI' }).addTo(map)
      } else if (!wmsOn[c.id] && existe) {
        map.removeLayer(existe); delete capasRef.current[k]
      }
    }
  }, [wmsOn])

  // Capas de puntos (datos propios)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const poner = (k: string, on: boolean, crear: () => L.Layer | null) => {
      const existe = capasRef.current[k]
      if (existe) { map.removeLayer(existe); delete capasRef.current[k] }
      if (!on) return
      const l = crear()
      if (l) { l.addTo(map); capasRef.current[k] = l }
    }
    const filtroDep = <T extends { departamento: string | null }>(xs: T[]) => (depSel ? xs.filter((x) => x.departamento === depSel) : xs)

    poner('ccpp', ptsOn.ccpp, () => {
      const grp: any = (L as any).markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 40, disableClusteringAtZoom: 11 })
      for (const c of filtroDep(ccpp.filter((x) => x.nivel >= 3))) {
        const n = NIVELES[c.nivel]
        L.circleMarker([c.lat, c.lon], { radius: c.nivel === 4 ? 6 : 4.5, color: '#fff', weight: 0.8, fillColor: n.color, fillOpacity: 0.9 })
          .bindPopup(`<div style="min-width:220px"><strong style="color:${n.color}">⛰️ Activación de quebradas · ${esc(n.etiqueta)}</strong>
            ${fila('Centro poblado', c.nombre)}${fila('Ubicación', `${c.distrito}, ${c.provincia}, ${c.departamento}`)}
            ${fila('Población', fmt(c.poblacion))}${fila('Viviendas', fmt(c.viviendas))}
            <div style="font-size:11px;color:#64748b;margin-top:4px">${esc(quebradas?.niveles?.[String(c.nivel)]?.descripcion ?? '')}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px">SENAMHI · aviso ${esc(quebradas?.fecha_aviso ?? '')}</div></div>`)
          .addTo(grp)
      }
      return grp
    })
    poner('hidro', ptsOn.hidro, () => {
      const grp = L.layerGroup()
      for (const h of filtroDep(avisos?.hidrologicos ?? [])) {
        if (h.lat === null || h.lon === null) continue
        const n = NIVELES[h.nivel ?? 1]
        L.marker([h.lat, h.lon], { icon: L.divIcon({ className: '', html: `<div style="background:${n.color};color:#fff;border:2px solid #fff;border-radius:6px;padding:2px 5px;font-size:11px;font-weight:700;box-shadow:0 1px 3px #0006;white-space:nowrap">🏞️ ${esc(h.estacion ?? 'río')}</div>`, iconAnchor: [10, 10] }) })
          .bindPopup(`<div style="min-width:240px"><strong style="color:${n.color}">${esc(h.titulo ?? 'Aviso hidrológico')}</strong>
            ${fila('Nivel', `${h.nivel} (${h.color ?? ''})`)}${fila('Fecha', h.fecha)}${fila('Cuenca', h.cuenca)}${fila('Ubicación', `${h.distrito ?? ''}, ${h.provincia ?? ''}, ${h.departamento ?? ''}`)}
            ${fila('Situación', h.peligro)}${fila('Recomendación', h.recomendacion)}<div style="font-size:11px;color:#94a3b8;margin-top:3px">SENAMHI · aviso hidrológico N° ${esc(h.numero ?? '')}</div></div>`)
          .addTo(grp)
      }
      return grp
    })
    poner('umbral', ptsOn.umbral, () => {
      const grp = L.layerGroup()
      for (const u of filtroDep((avisos?.umbrales ?? []).filter((x) => x.supera || x.supera_acum))) {
        if (u.lat === null || u.lon === null) continue
        L.circleMarker([u.lat, u.lon], { radius: 7, color: '#1e3a8a', weight: 2, fillColor: '#60a5fa', fillOpacity: 0.9 })
          .bindPopup(`<div style="min-width:220px"><strong style="color:#1e3a8a">🌧️ Lluvia por encima del umbral</strong>
            ${fila('Estación', u.estacion)}${fila('Ubicación', `${u.distrito ?? ''}, ${u.provincia ?? ''}, ${u.departamento ?? ''}`)}${fila('Cuenca', u.cuenca)}
            ${fila('Lluvia del día', `${u.pp_mm} mm (umbral ${u.umbral_mm} mm)`)}${fila('Acumulado', `${u.pp_acum_mm} mm (umbral ${u.umbral_acum_mm} mm)`)}${fila('Fecha', `${u.fecha ?? ''} ${u.hora ?? ''}`)}
            <div style="font-size:11px;color:#94a3b8;margin-top:3px">SENAMHI · umbrales de precipitación</div></div>`)
          .addTo(grp)
      }
      return grp
    })
    poner('sonicsccpp', ptsOn.sonicsccpp, () => {
      const grp: any = (L as any).markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 40, disableClusteringAtZoom: 11 })
      for (const c of filtroDep(sonicsPts.filter((x) => x.nivel >= 2))) {
        const n = NIVELES[c.nivel]
        L.circleMarker([c.lat, c.lon], { radius: 5, color: '#0c4a6e', weight: 1, fillColor: n.color, fillOpacity: 0.85 })
          .bindPopup(`<div style="min-width:220px"><strong style="color:${n.color}">🏞️ Crecida fluvial prevista · ${esc(n.etiqueta)}</strong>
            ${fila('Centro poblado', c.nombre)}${fila('Ubicación', `${c.distrito}, ${c.provincia}, ${c.departamento}`)}
            <div style="font-size:11px;color:#94a3b8;margin-top:3px">SENAMHI · SONICS, pronóstico día 1</div></div>`)
          .addTo(grp)
      }
      return grp
    })
    poner('ciudades', ptsOn.ciudades, () => {
      const grp = L.layerGroup()
      for (const c of filtroDep(pron?.ciudades ?? [])) {
        const v = modo === 'lluvia' ? c.pp_max_dia : c.tmax_max
        const col = modo === 'lluvia' ? colorLluvia(v) : colorCalor(v)
        const txt = v === null ? 's/d' : modo === 'lluvia' ? `${v.toFixed(0)} mm` : `${v.toFixed(0)}°`
        L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', html: `<div style="background:${col};color:${modo === 'lluvia' && (v ?? 0) < 10 ? '#1e293b' : '#fff'};border:1.5px solid #fff;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:700;box-shadow:0 1px 3px #0005;white-space:nowrap">${esc(c.ciudad)} ${txt}</div>`, iconAnchor: [30, 10] }) })
          .bindPopup(`<div style="min-width:250px"><strong>${esc(c.ciudad)} (${esc(c.departamento)})</strong>
            <div style="font-size:11px;color:#64748b;margin-bottom:4px">Pronóstico de modelo global (Open-Meteo), referencial</div>
            <table style="font-size:11px;border-collapse:collapse">${c.dias.map((d) => `<tr><td style="padding:1px 6px 1px 0">${esc(diaCorto(d.fecha))}</td><td style="padding:1px 6px;background:${colorLluvia(d.pp)};color:${(d.pp ?? 0) >= 20 ? '#fff' : '#1e293b'}">${d.pp?.toFixed(1) ?? '–'} mm</td><td style="padding:1px 6px">${d.prob ?? '–'} %</td><td style="padding:1px 6px;background:${colorCalor(d.tmax)};color:${(d.tmax ?? 0) >= 30 ? '#fff' : '#1e293b'}">${d.tmax?.toFixed(0) ?? '–'}° / ${d.tmin?.toFixed(0) ?? '–'}°</td></tr>`).join('')}</table>
            <div style="font-size:10px;color:#94a3b8;margin-top:3px">lluvia · prob. de lluvia · Tmáx/Tmín</div></div>`)
          .addTo(grp)
      }
      return grp
    })
  }, [ptsOn, ccpp, avisos, sonicsPts, pron, modo, depSel, quebradas])

  function restablecer() {
    setWmsOn(Object.fromEntries(CAPAS_WMS.map((c) => [c.id, c.defecto])))
    setPtsOn(Object.fromEntries(CAPAS_PUNTOS.map((c) => [c.id, c.defecto])))
    setDepSel(''); setModo('lluvia'); mapRef.current?.fitBounds(PERU_BOUNDS)
  }

  const ciudadesOrden = useMemo(() => [...(pron?.ciudades ?? [])].sort((x, y) => (modo === 'lluvia' ? (y.pp_7d ?? 0) - (x.pp_7d ?? 0) : (y.tmax_max ?? 0) - (x.tmax_max ?? 0))), [pron, modo])
  const diasPron = pron?.ciudades[0]?.dias.map((d) => d.fecha) ?? []
  const semanal = useMemo(() => (enso?.semanal ?? []).slice(-104).map((s) => ({ name: s.semana.slice(2, 7), 'Niño 1+2': s.n12a, 'Niño 3.4': s.n34a })), [enso])
  const mensual = useMemo(() => serieMensual(enso, 1982), [enso])
  const icenSerie = useMemo(() => (enso?.icen_proxy ?? []).map((p) => ({ name: `${p.anio}-${String(p.mes).padStart(2, '0')}`, valor: p.valor })), [enso])
  const eventos = useMemo(() => episodios(enso, 1.7).reverse(), [enso])
  const depQuebradas = useMemo(() => (quebradas?.resumen.departamentos ?? []).slice(0, 14).map((d) => ({ name: d.departamento, 'Nivel 4': d.n4, 'Nivel 3': d.n3, 'Nivel 2': d.n2 })), [quebradas])
  const sonicsDias = useMemo(() => (sonics?.dias ?? []).map((d) => ({ name: `Día ${d.dia}`, 'Nivel 3': d.por_nivel['3'] ?? 0, 'Nivel 2': d.por_nivel['2'] ?? 0, 'Nivel 1': d.por_nivel['1'] ?? 0 })), [sonics])
  const silviaDias = useMemo(() => (silvia?.dias ?? []).map((d) => ({ name: `Día ${d.dia}`, 'Nivel 4': d.por_nivel['4'] ?? 0, 'Nivel 3': d.por_nivel['3'] ?? 0, 'Nivel 2': d.por_nivel['2'] ?? 0 })), [silvia])
  const rios = useMemo(() => [...(caud?.rios ?? [])].sort((x, y) => (y.ratio ?? 0) - (x.ratio ?? 0)), [caud])

  const avisosFresc: Record<string, { cls: string; txt: string }> = {
    'sin-datos': { cls: 'bg-slate-100 border-slate-300 text-slate-700', txt: 'Aún no hay una sincronización exitosa. La página puede estar vacía.' },
    desactualizado: { cls: 'bg-amber-50 border-amber-300 text-amber-900', txt: `Datos desactualizados: la última sincronización fue ${hace(estado?.ultima_sincronizacion_utc ?? null, reloj)}.` },
    parcial: { cls: 'bg-amber-50 border-amber-300 text-amber-900', txt: 'Una o más fuentes fallaron en la última consulta; se muestran sus últimos datos válidos (ver detalle de fuentes).' },
  }

  return (
    <div className="space-y-5">
      <header className="rounded-2xl bg-gradient-to-br from-sky-900 via-sky-700 to-cyan-500 text-white px-5 py-5 sm:px-7 sm:py-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">🌊 El Niño, lluvias y calor</h1>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-3 py-1 text-xs font-medium" role="status">
            <span className="relative flex h-2.5 w-2.5">
              {fresc === 'ok' && <span className="absolute inline-flex h-full w-full rounded-full bg-green-300 opacity-75 animate-ping motion-reduce:animate-none" />}
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${fresc === 'ok' ? 'bg-green-300' : fresc === 'sin-datos' ? 'bg-slate-300' : 'bg-amber-300'}`} />
            </span>
            {fresc === 'ok' ? 'Actualizado' : fresc === 'parcial' ? 'Parcial' : fresc === 'desactualizado' ? 'Desactualizado' : cargando ? 'Cargando…' : 'Sin datos'}
            {estado?.ultima_sincronizacion_utc && <span className="opacity-80">· {hace(estado.ultima_sincronizacion_utc, reloj)}</span>}
          </span>
        </div>
        <p className="text-sm text-white/90 mt-2 max-w-3xl">
          Estado del Fenómeno El Niño y avisos oficiales de lluvias, activación de quebradas (huaycos), crecidas de ríos y
          calor en el Perú, con pronósticos a 7 días y la perspectiva estacional del SENAMHI. Se actualiza cada hora.
        </p>
      </header>

      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
        <b>Cómo leer esta página.</b> Las alertas marcadas como <b>aviso oficial</b> provienen del SENAMHI o del ENFEN y son
        las que deben guiar cualquier decisión. Las de <b>modelo global</b> (Open-Meteo, GloFAS) son referenciales y pueden
        fallar en la costa norte y los Andes. El <b>proxy del ICEN</b> es un cálculo de este observatorio sobre datos de la NOAA
        y no reemplaza el diagnóstico oficial del ENFEN. Ante una emergencia: INDECI 115, Bomberos 116.
      </div>

      {/* Estado de la sincronización */}
      <details className="group bg-white border border-slate-200 rounded-lg px-4 py-3 text-sm">
        <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 cursor-pointer list-none">
          <span><b>Última sincronización:</b> {estado?.ultima_sincronizacion_utc ? horaLima(estado.ultima_sincronizacion_utc) : cargando ? 'cargando…' : 'sin datos'}</span>
          {estado && (
            <span className="text-xs text-slate-500">
              {estado.fuentes.filter((f) => f.estado !== 'error').length}/{estado.fuentes.length} fuentes ok
              <span className="ml-1 text-slate-400 group-open:hidden">· ver detalle ▾</span>
              <span className="ml-1 text-slate-400 hidden group-open:inline">· ocultar ▴</span>
            </span>
          )}
        </summary>
        {estado && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {estado.fuentes.map((f) => (
              <span key={f.id} title={f.error ?? `Último éxito: ${f.ultimo_exito ?? 'nunca'}`}
                className={`text-[11px] px-2 py-0.5 rounded-full border ${f.estado === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                {f.estado === 'error' ? '⚠ ' : '✓ '}{f.nombre}{f.registros !== null && f.registros !== undefined && ` · ${fmt(f.registros)}`}{f.estado === 'error' && ' · error, se conservan datos previos'}
              </span>
            ))}
          </div>
        )}
      </details>
      {(avisosFresc[fresc] || errorCarga) && (
        <div role="alert" className={`rounded-lg border px-4 py-2.5 text-sm ${errorCarga ? 'bg-red-50 border-red-300 text-red-900' : avisosFresc[fresc].cls}`}>⚠ {errorCarga ?? avisosFresc[fresc].txt}</div>
      )}

      {/* Semáforo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 border-l-4 rounded-xl p-3 sm:p-4" style={{ borderLeftColor: colorCategoria(a?.icen_categoria ?? null) }}>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums">{a?.icen_proxy !== null && a?.icen_proxy !== undefined ? `${a.icen_proxy > 0 ? '+' : ''}${a.icen_proxy.toFixed(2)} °C` : '—'}</div>
          <div className="text-sm font-medium mt-0.5">Proxy del ICEN · <span style={{ color: colorCategoria(a?.icen_categoria ?? null) }}>{a?.icen_categoria ?? 's/d'}</span></div>
          <div className="text-xs text-slate-400">promedio 3 meses Niño 1+2, centrado en {a?.icen_proxy_mes ?? '—'} · cálculo propio</div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-sky-600 rounded-xl p-3 sm:p-4">
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums">{a?.n12_anomalia_semanal !== null && a?.n12_anomalia_semanal !== undefined ? `${a.n12_anomalia_semanal > 0 ? '+' : ''}${a.n12_anomalia_semanal.toFixed(1)} °C` : '—'}</div>
          <div className="text-sm font-medium mt-0.5">Anomalía semanal Niño 1+2</div>
          <div className="text-xs text-slate-400">mar frente a Perú/Ecuador · semana del {a?.semana ?? '—'} · NOAA</div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-cyan-500 rounded-xl p-3 sm:p-4">
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums">{a?.n34_anomalia_semanal !== null && a?.n34_anomalia_semanal !== undefined ? `${a.n34_anomalia_semanal > 0 ? '+' : ''}${a.n34_anomalia_semanal.toFixed(1)} °C` : '—'}</div>
          <div className="text-sm font-medium mt-0.5">Anomalía semanal Niño 3.4</div>
          <div className="text-xs text-slate-400">Pacífico central (El Niño global) · NOAA</div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 rounded-xl p-3 sm:p-4" style={{ borderLeftColor: maxNivel ? NIVELES[maxNivel].color : '#94a3b8' }}>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums">{cargando ? '—' : fmt(alertas?.resumen.total ?? 0)}</div>
          <div className="text-sm font-medium mt-0.5">Alertas activas</div>
          <div className="text-xs text-slate-400">{maxNivel ? `máximo: ${NIVELES[maxNivel].etiqueta}` : 'sin alertas'} · {alertas?.alertas.filter((x) => x.origen === 'oficial').length ?? 0} oficiales</div>
        </div>
      </div>

      {enfen && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">📄 {enfen.titulo}</span>
          <span className="text-emerald-800">{enfen.fecha ?? ''}{enfen.estado_alerta ? ` · ${enfen.estado_alerta}` : ''}</span>
          <a className="underline font-medium" href={enfen.url ?? enfen.pagina} target="_blank" rel="noreferrer noopener">leer el comunicado (PDF) ↗</a>
          <span className="text-xs text-emerald-700 w-full">Diagnóstico oficial quincenal de la Comisión Multisectorial ENFEN (IMARPE, SENAMHI, IGP, ANA, INDECI, DHN). El observatorio solo enlaza el documento; no interpreta su contenido.</span>
        </div>
      )}

      {/* Alertas */}
      <h2 className="text-xl font-bold pt-1">Alertas</h2>
      <section aria-label="Filtros de alertas" className="bg-white border border-slate-200 rounded-xl px-3 py-3 sm:px-4 text-sm flex flex-wrap items-center gap-1.5">
        {TIPOS.map((t) => (
          <Chip key={t.id} activo={tipo === t.id} onClick={() => setTipo(t.id)}>{t.icono} {t.etiqueta}{t.id !== 'todas' && alertas ? ` (${alertas.resumen.por_tipo[t.id] ?? 0})` : ''}</Chip>
        ))}
        <label className="flex items-center gap-2 cursor-pointer min-h-[36px] sm:ml-auto">
          <input type="checkbox" className="h-4 w-4 accent-sky-700" checked={soloOficiales} onChange={(e) => setSoloOficiales(e.target.checked)} />
          Solo avisos oficiales
        </label>
      </section>
      {lista.length ? (
        <div className="grid gap-3 lg:grid-cols-2">{lista.map((x) => <TarjetaAlerta key={x.id} a={x} />)}</div>
      ) : (
        <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl px-4 py-6 text-center">{cargando ? 'Cargando alertas…' : 'Sin alertas con estos filtros.'}</p>
      )}

      {/* Mapa */}
      <h2 className="text-xl font-bold pt-1">Mapa de avisos y pronóstico</h2>
      <section aria-label="Capas del mapa" className="bg-white border border-slate-200 rounded-xl px-3 py-3 sm:px-4 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="font-medium">Capas SENAMHI (imagen)</span>
          {CAPAS_WMS.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 cursor-pointer min-h-[32px]">
              <input type="checkbox" className="h-4 w-4 accent-sky-700" checked={!!wmsOn[c.id]} onChange={(e) => setWmsOn((s) => ({ ...s, [c.id]: e.target.checked }))} />{c.etiqueta}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="font-medium">Puntos</span>
          {CAPAS_PUNTOS.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 cursor-pointer min-h-[32px]">
              <input type="checkbox" className="h-4 w-4 accent-sky-700" checked={!!ptsOn[c.id]} onChange={(e) => setPtsOn((s) => ({ ...s, [c.id]: e.target.checked }))} />{c.etiqueta}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Ciudades por</span>
          <Chip activo={modo === 'lluvia'} onClick={() => setModo('lluvia')}>🌧️ lluvia máx. diaria</Chip>
          <Chip activo={modo === 'calor'} onClick={() => setModo('calor')}>🌡️ temperatura máx.</Chip>
          <label htmlFor="nino-dep" className="font-medium sm:ml-3">Departamento</label>
          <select id="nino-dep" value={depSel} onChange={(e) => setDepSel(e.target.value)} className="min-h-[36px] border border-slate-300 rounded-lg px-2 py-1.5 bg-white max-w-full">
            <option value="">Todo el Perú</option>
            {deps.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button type="button" onClick={restablecer} className="min-h-[36px] px-3 py-1.5 rounded-lg bg-forest-dark text-white hover:bg-forest sm:ml-auto">↺ Restablecer</button>
        </div>
      </section>
      <div ref={ref} role="region" aria-label="Mapa de avisos de lluvias, huaycos y ríos en el Perú" className="h-[60vh] min-h-[360px] sm:h-[70vh] w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm z-0" />
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600 items-center bg-white border border-slate-200 rounded-lg px-3 py-2">
        <span className="font-medium">Nivel de aviso:</span>
        {[1, 2, 3, 4].map((n) => <span key={n} className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full ring-1 ring-white" style={{ background: NIVELES[n].color }} /> {NIVELES[n].etiqueta}</span>)}
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full border-2" style={{ background: '#60a5fa', borderColor: '#1e3a8a' }} /> estación sobre umbral</span>
        <span className="text-slate-400">Las capas "imagen" se dibujan desde el GeoServer del SENAMHI y pueden tardar.</span>
      </div>

      {/* Pronóstico 7 días */}
      <h2 className="text-xl font-bold pt-1">Pronóstico a 7 días por ciudad</h2>
      <Tarjeta titulo={modo === 'lluvia' ? 'Lluvia diaria prevista (mm) · ordenado por acumulado de 7 días' : 'Temperatura máxima prevista (°C) · ordenado por la máxima'} nota={`${pron?.atribucion ?? 'Open-Meteo'} · modelo global, referencial: no sustituye el pronóstico del SENAMHI. Pulsa un encabezado de modo arriba para cambiar.`}>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="text-xs min-w-[640px] w-full">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-2 font-medium">Ciudad</th>
                {diasPron.map((d) => <th key={d} className="py-1 px-1 font-medium text-center">{diaCorto(d)}</th>)}
                <th className="py-1 pl-2 font-medium text-right">{modo === 'lluvia' ? '7 días' : 'Tmáx'}</th>
              </tr>
            </thead>
            <tbody>
              {ciudadesOrden.map((c) => (
                <tr key={c.ciudad} className="border-t border-slate-100">
                  <td className="py-1 pr-2 whitespace-nowrap"><b>{c.ciudad}</b> <span className="text-slate-400">{c.departamento}</span></td>
                  {c.dias.map((d) => {
                    const v = modo === 'lluvia' ? d.pp : d.tmax
                    const bg = modo === 'lluvia' ? colorLluvia(v) : colorCalor(v)
                    const oscuro = modo === 'lluvia' ? (v ?? 0) >= 20 : (v ?? 0) >= 30
                    return <td key={d.fecha} className="py-1 px-1 text-center tabular-nums rounded" style={{ background: bg, color: oscuro ? '#fff' : '#1e293b' }} title={`${d.fecha}: ${d.pp ?? '–'} mm (${d.prob ?? '–'} %), ${d.tmin ?? '–'}–${d.tmax ?? '–'} °C`}>{v === null ? '–' : modo === 'lluvia' ? v.toFixed(0) : v.toFixed(0)}</td>
                  })}
                  <td className="py-1 pl-2 text-right tabular-nums font-semibold">{modo === 'lluvia' ? (c.pp_7d !== null ? `${c.pp_7d.toFixed(0)} mm` : '–') : (c.tmax_max !== null ? `${c.tmax_max.toFixed(0)} °C` : '–')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {/* Huaycos */}
      <h2 className="text-xl font-bold pt-1">Huaycos y activación de quebradas</h2>
      {quebradas ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { v: quebradas.resumen.ccpp, t: 'Centros poblados con aviso', n: `niveles 2–4 · ${quebradas.fecha_aviso ?? ''}`, c: NIVELES[2].color },
              { v: quebradas.resumen.poblacion, t: 'Habitantes en zonas con aviso', n: 'según el padrón de centros poblados del SENAMHI', c: NIVELES[3].color },
              { v: quebradas.resumen.ccpp_por_nivel['4'] ?? 0, t: 'Centros poblados en nivel 4', n: `y ${fmt(quebradas.resumen.ccpp_por_nivel['3'] ?? 0)} en nivel 3`, c: NIVELES[4].color },
              { v: quebradas.resumen.distritos, t: 'Distritos con aviso', n: `${fmt(quebradas.resumen.distritos_por_nivel['4'] ?? 0)} en nivel 4`, c: '#0369a1' },
            ].map((k) => (
              <div key={k.t} className="bg-white border border-slate-200 border-l-4 rounded-xl p-3 sm:p-4" style={{ borderLeftColor: k.c }}>
                <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums">{fmt(k.v)}</div>
                <div className="text-sm font-medium mt-0.5">{k.t}</div>
                <div className="text-xs text-slate-400">{k.n}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta titulo="Centros poblados con aviso por departamento y nivel" nota="Aviso de activación de quebradas del SENAMHI (top 14). La 'activación' es el flujo súbito de agua, lodo y piedras: el huayco.">
              <div style={{ height: Math.max(220, depQuebradas.length * 26) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={depQuebradas} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" fontSize={11} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={110} fontSize={11} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Nivel 4" stackId="a" fill={NIVELES[4].color} isAnimationActive={false} />
                    <Bar dataKey="Nivel 3" stackId="a" fill={NIVELES[3].color} isAnimationActive={false} />
                    <Bar dataKey="Nivel 2" stackId="a" fill={NIVELES[2].color} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Tarjeta>
            <Tarjeta titulo="Qué más está en zonas con aviso" nota="Conteos del SENAMHI de infraestructura dentro de las áreas con aviso de activación de quebradas">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  ['Establecimientos de salud', quebradas.resumen.expuestos?.eess], ['Instituciones educativas', quebradas.resumen.expuestos?.iiee],
                  ['Tramos de vía nacional', quebradas.resumen.expuestos?.vial_nacional], ['Tramos de vía departamental', quebradas.resumen.expuestos?.vial_departamental],
                  ['Tramos de vía vecinal', quebradas.resumen.expuestos?.vial_vecinal], ['Viviendas', quebradas.resumen.viviendas],
                ].map(([t, v]) => (
                  <div key={String(t)} className="bg-slate-50 rounded-lg p-3"><div className="text-xl font-bold tabular-nums">{v === null || v === undefined ? '—' : fmt(Number(v))}</div><div className="text-xs text-slate-500">{t}</div></div>
                ))}
              </div>
              {quebradas.resumen.distritos_nivel4.length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer font-medium text-slate-700">Distritos en nivel 4 ({quebradas.resumen.distritos_nivel4.length}) ▾</summary>
                  <p className="mt-1 text-slate-600 leading-relaxed">{quebradas.resumen.distritos_nivel4.map((d) => `${d.distrito} (${d.provincia}, ${d.departamento})`).join(' · ')}</p>
                </details>
              )}
              {quebradas.niveles['4'] && <p className="text-xs text-slate-500 mt-3"><b>Nivel 4 según SENAMHI:</b> {quebradas.niveles['4'].descripcion} {quebradas.niveles['4'].recomendacion}</p>}
            </Tarjeta>
            {silviaDias.length > 0 && (
              <Tarjeta titulo="SILVIA · subcuencas con pronóstico de movimientos en masa por lluvias" nota={`Sistema de monitoreo de movimientos en masa potenciales (deslizamientos, huaycos) a 3 días · emitido ${silvia?.dias[0]?.fecha_emision ?? ''}`}>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={silviaDias} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} width={40} allowDecimals={false} />
                      <Tooltip formatter={(v: number) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Nivel 4" stackId="a" fill={NIVELES[4].color} isAnimationActive={false} />
                      <Bar dataKey="Nivel 3" stackId="a" fill={NIVELES[3].color} isAnimationActive={false} />
                      <Bar dataKey="Nivel 2" stackId="a" fill={NIVELES[2].color} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Tarjeta>
            )}
          </div>
        </>
      ) : <p className="text-sm text-slate-500">Sin datos de activación de quebradas.</p>}

      {/* Ríos */}
      <h2 className="text-xl font-bold pt-1">Ríos: crecidas e inundaciones</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="SONICS · centros poblados con pronóstico de crecida fluvial" nota="Pronóstico hidrológico del SENAMHI por tramo de río, 7 días. Nivel 3 = alto.">
          {sonicsDias.length ? (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sonicsDias} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} width={44} allowDecimals={false} />
                  <Tooltip formatter={(v: number) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Nivel 3" stackId="a" fill={NIVELES[3].color} isAnimationActive={false} />
                  <Bar dataKey="Nivel 2" stackId="a" fill={NIVELES[2].color} isAnimationActive={false} />
                  <Bar dataKey="Nivel 1" stackId="a" fill={NIVELES[1].color} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-sm text-slate-400">Sin datos SONICS.</p>}
          {sonics?.dias[0] && <p className="text-xs text-slate-500 mt-2">Mañana, por departamento: {sonics.dias[0].por_departamento.slice(0, 8).map((d) => `${d.departamento} (${d.ccpp})`).join(', ')}.</p>}
        </Tarjeta>
        <Tarjeta titulo="Avisos hidrológicos vigentes (SENAMHI)" nota="Situación del nivel de ríos en estaciones de monitoreo">
          {avisos?.hidrologicos.length ? (
            <ul className="space-y-2 text-sm">
              {avisos.hidrologicos.map((h) => (
                <li key={h.id ?? h.titulo} className="border-l-4 pl-3" style={{ borderLeftColor: NIVELES[h.nivel ?? 1].color }}>
                  <div className="font-medium leading-snug">{h.titulo}</div>
                  <div className="text-xs text-slate-500">{h.fecha} · {h.departamento} · {h.cuenca} · nivel {h.nivel} ({h.color?.toLowerCase()})</div>
                  <div className="text-xs text-slate-600 mt-0.5">{h.peligro}</div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">Sin avisos hidrológicos vigentes.</p>}
        </Tarjeta>
        <Tarjeta titulo="Caudal previsto en ríos clave (GloFAS, 7 días)" nota={`${caud?.atribucion ?? ''} · modelo global de ~5 km, referencial. Ratio = pico previsto ÷ media de los últimos 30 días.`} className="lg:col-span-2">
          {rios.length ? (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="text-xs min-w-[560px] w-full">
                <thead><tr className="text-left text-slate-500"><th className="py-1 pr-2 font-medium">Río</th><th className="py-1 px-2 font-medium text-right">Media 30 d (m³/s)</th><th className="py-1 px-2 font-medium text-right">Pico 7 d (m³/s)</th><th className="py-1 px-2 font-medium text-right">Ratio</th><th className="py-1 pl-2 font-medium">Próximos 7 días</th></tr></thead>
                <tbody>
                  {rios.map((r) => {
                    const fut = r.serie.filter((s) => s.fecha >= (caud?.generado_utc.slice(0, 10) ?? ''))
                    const mx = Math.max(1e-6, ...fut.map((s) => s.qmax ?? s.q ?? 0))
                    return (
                      <tr key={r.rio} className="border-t border-slate-100">
                        <td className="py-1 pr-2 whitespace-nowrap"><b>{r.rio}</b> <span className="text-slate-400">{r.departamento}</span></td>
                        <td className="py-1 px-2 text-right tabular-nums">{r.media_30d ?? '–'}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{r.pico_7d ?? '–'}</td>
                        <td className="py-1 px-2 text-right tabular-nums font-semibold" style={{ color: (r.ratio ?? 0) >= 2 ? NIVELES[3].color : '#1e293b' }}>{r.ratio !== null ? `×${r.ratio.toFixed(1)}` : '–'}</td>
                        <td className="py-1 pl-2"><div className="flex items-end gap-0.5 h-5">{fut.map((s) => <span key={s.fecha} title={`${s.fecha}: ${s.qmax ?? s.q ?? '–'} m³/s`} className="inline-block w-2 rounded-sm" style={{ height: `${Math.max(8, ((s.qmax ?? s.q ?? 0) / mx) * 100)}%`, background: (r.ratio ?? 0) >= 2 ? '#2563eb' : '#94a3b8' }} />)}</div></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-slate-400">Sin datos de caudal.</p>}
        </Tarjeta>
      </div>

      {/* ENSO */}
      <h2 className="text-xl font-bold pt-1">El Niño: temperatura del mar</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Anomalía semanal de la temperatura del mar (°C)" nota="Niño 1+2 = frente a Perú y Ecuador (El Niño costero). Niño 3.4 = Pacífico central (El Niño global). NOAA OISST, últimas 104 semanas, base 1991–2020.">
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={semanal} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={10} interval="preserveStartEnd" minTickGap={28} /><YAxis fontSize={11} width={36} />
                <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Line type="monotone" dataKey="Niño 1+2" stroke="#dc2626" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line type="monotone" dataKey="Niño 3.4" stroke="#0369a1" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Proxy del ICEN desde 1982 (°C)" nota="Promedio móvil de 3 meses de la anomalía Niño 1+2 (cálculo propio). Líneas: 0,4 débil · 1,0 moderado · 1,7 fuerte · 3,0 extraordinario (categorías ENFEN). Se ven 1982–83, 1997–98, 2017 y 2023.">
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={icenSerie} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={10} interval={59} tickFormatter={(v: string) => v.slice(0, 4)} /><YAxis fontSize={11} width={36} domain={[-3, 6]} />
                <Tooltip />
                {[0.4, 1.0, 1.7, 3.0].map((y) => <ReferenceLine key={y} y={y} stroke="#f59e0b" strokeDasharray="4 4" />)}
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Line type="monotone" dataKey="valor" name="proxy ICEN" stroke="#b91c1c" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Episodios cálidos fuertes o extraordinarios (proxy ≥ 1,7 °C)" nota="Agrupados por meses consecutivos; el máximo indica la categoría alcanzada. Cálculo propio sobre NOAA.">
          {eventos.length ? (
            <table className="text-xs w-full"><thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Inicio</th><th className="py-1 font-medium">Fin</th><th className="py-1 font-medium text-right">Máximo</th><th className="py-1 pl-2 font-medium">Categoría</th></tr></thead>
              <tbody>{eventos.map((e) => <tr key={e.inicio} className="border-t border-slate-100"><td className="py-1">{e.inicio}</td><td className="py-1">{e.fin}</td><td className="py-1 text-right tabular-nums">+{e.maximo.toFixed(2)} °C</td><td className="py-1 pl-2" style={{ color: colorCategoria(e.categoria) }}>{e.categoria}</td></tr>)}</tbody></table>
          ) : <p className="text-sm text-slate-400">Sin datos.</p>}
        </Tarjeta>
        <Tarjeta titulo="Anomalía mensual Niño 1+2 y 3.4 desde 1982 (°C)" nota="Serie mensual NOAA. Un El Niño costero (1+2) puede darse sin El Niño global (3.4), como en 2017.">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mensual} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={10} interval={59} tickFormatter={(v: string) => v.slice(0, 4)} /><YAxis fontSize={11} width={36} />
                <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Line type="monotone" dataKey="n12a" name="Niño 1+2" stroke="#dc2626" dot={false} strokeWidth={1.2} isAnimationActive={false} />
                <Line type="monotone" dataKey="n34a" name="Niño 3.4" stroke="#0369a1" dot={false} strokeWidth={1.2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Tarjeta>
      </div>

      {/* Estacional */}
      <h2 className="text-xl font-bold pt-1">Perspectiva estacional del SENAMHI</h2>
      {estacional ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta titulo={`Lluvias · ${estacional.verano[0]?.periodo?.replace('_', '–') ?? 'verano'}`} nota={`Probabilidad (%) de que la lluvia del periodo sea inferior / normal / superior a lo habitual, por sector climático · emitido ${estacional.verano[0]?.emision ?? ''}`}>
            <TablaEstacional filas={estacional.verano} />
          </Tarjeta>
          <Tarjeta titulo={`Lluvias · ${estacional.trimestre_pp[0]?.periodo?.replace('_', '–') ?? 'próximo trimestre'}`} nota={`Mismo formato · emitido ${estacional.trimestre_pp[0]?.emision ?? ''}`}>
            <TablaEstacional filas={estacional.trimestre_pp} />
          </Tarjeta>
          {estacional.mes_tmax.length > 0 && (
            <Tarjeta titulo={`Temperatura máxima · ${estacional.mes_tmax[0]?.periodo ?? 'próximo mes'}`} nota="Probabilidad de temperatura máxima inferior / normal / superior a lo habitual (el calor de la costa y la selva)">
              <TablaEstacional filas={estacional.mes_tmax} />
            </Tarjeta>
          )}
          {estacional.mes_pp.length > 0 && (
            <Tarjeta titulo={`Lluvias · ${estacional.mes_pp[0]?.periodo ?? 'próximo mes'}`} nota={`Emitido ${estacional.mes_pp[0]?.emision ?? ''}`}>
              <TablaEstacional filas={estacional.mes_pp} />
            </Tarjeta>
          )}
        </div>
      ) : <p className="text-sm text-slate-500">Sin pronóstico estacional disponible.</p>}

      {/* Fuentes y descargas */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-600 space-y-1.5">
        <p>
          <b>Fuentes.</b> Temperatura del mar:{' '}
          <a className="underline" href="https://www.cpc.ncep.noaa.gov/data/indices/" target="_blank" rel="noreferrer noopener">NOAA CPC (OISST v2.1, índices Niño)</a>.
          Diagnóstico oficial: <a className="underline" href="https://enfen.imarpe.gob.pe/comunicados/" target="_blank" rel="noreferrer noopener">Comunicados ENFEN</a>.
          Avisos meteorológicos, hidrológicos, activación de quebradas, SILVIA, SONICS, umbrales y pronóstico estacional:{' '}
          <a className="underline" href="https://idesep.senamhi.gob.pe/" target="_blank" rel="noreferrer noopener">SENAMHI IDESEP (GeoServer WFS/WMS)</a>{' '}
          y <a className="underline" href="https://www.senamhi.gob.pe/" target="_blank" rel="noreferrer noopener">senamhi.gob.pe</a>.
          Pronóstico por ciudad y caudales: <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer noopener">Open-Meteo</a> (CC BY 4.0; caudal de GloFAS/Copernicus).
          Límites: departamentos INEI. Metodología y límites en <code>docs/NINO.md</code>.
        </p>
        <p>
          <b>Descargar datos:</b>{' '}
          <a className="underline hover:text-sky-700" download href={`${base}data/csv/nino-quebradas-ccpp.csv`}>centros poblados con aviso de quebradas (CSV)</a>{' · '}
          <a className="underline hover:text-sky-700" download href={`${base}data/csv/nino-pronostico-ciudades.csv`}>pronóstico 7 días por ciudad (CSV)</a>{' · '}
          <a className="underline hover:text-sky-700" download href={`${base}data/csv/nino-avisos-hidro.csv`}>avisos hidrológicos (CSV)</a>{' · '}
          <a className="underline hover:text-sky-700" href={`${base}data/nino/enso.json`} target="_blank" rel="noreferrer noopener">series Niño 1+2 / 3.4 (JSON)</a>{' · '}
          <a className="underline hover:text-sky-700" href={`${base}data/nino/alertas.json`} target="_blank" rel="noreferrer noopener">alertas (JSON)</a>{' · '}
          <a className="underline hover:text-sky-700" href={`${base}data/nino/estado.json`} target="_blank" rel="noreferrer noopener">estado de la ingesta (JSON)</a>
        </p>
      </div>
    </div>
  )
}

function TablaEstacional({ filas }: { filas: { sector: string | null; escenario: string | null; inferior: number | null; normal: number | null; superior: number | null }[] }) {
  const col = (e: string | null) => (e ?? '').includes('Superior') && !(e ?? '').includes('Normal') ? '#1d4ed8' : (e ?? '').includes('Superior') ? '#3b82f6' : (e ?? '').includes('Inferior') && !(e ?? '').includes('Normal') ? '#b45309' : (e ?? '').includes('Inferior') ? '#d97706' : '#16a34a'
  if (!filas.length) return <p className="text-sm text-slate-400">Sin datos.</p>
  return (
    <table className="text-xs w-full">
      <thead><tr className="text-left text-slate-500"><th className="py-1 font-medium">Sector</th><th className="py-1 px-1 font-medium text-right">Inf.</th><th className="py-1 px-1 font-medium text-right">Normal</th><th className="py-1 px-1 font-medium text-right">Sup.</th><th className="py-1 pl-2 font-medium">Escenario</th></tr></thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.sector ?? ''} className="border-t border-slate-100">
            <td className="py-1 capitalize">{(f.sector ?? '').toLowerCase()}</td>
            <td className="py-1 px-1 text-right tabular-nums">{f.inferior ?? '–'}</td>
            <td className="py-1 px-1 text-right tabular-nums">{f.normal ?? '–'}</td>
            <td className="py-1 px-1 text-right tabular-nums">{f.superior ?? '–'}</td>
            <td className="py-1 pl-2 font-semibold" style={{ color: col(f.escenario) }}>{f.escenario}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
