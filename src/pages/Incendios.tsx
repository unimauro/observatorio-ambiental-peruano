import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { fmt } from '../lib/data'
import {
  parseFocos, filtrarFocos, edad, frescura, hace, horaLima, horaUTC, contarPor, serieHoraria,
  indicadores, enlaceFirms, alternarSeleccion, seleccionado, VENTANAS, EDADES, FILTROS_INICIALES,
} from '../lib/incendios'
import type { Foco, FocosArchivo, EstadoIngesta, Filtros } from '../lib/incendios'

const base = import.meta.env.BASE_URL
const PERU_BOUNDS: L.LatLngBoundsExpression = [[-18.4, -81.4], [-0.03, -68.6]]
const REFRESCO_MS = 10 * 60_000 // la página vuelve a leer los archivos cada 10 min
const CONFIANZAS = ['alta', 'nominal', 'baja']

interface SerieDia { fecha: string; total: number; VIIRS: number; MODIS: number; parcial: boolean }
interface MinamResumen { total: number; porAnio: { anio: number; registros: number }[]; porDepartamento: { departamento: string; registros: number }[] }
type Geo = { type: string; features: any[] }

// Los textos de fuentes externas se escapan antes de ir al HTML del popup
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

async function cargar<T>(archivo: string): Promise<T> {
  const r = await fetch(`${base}data/incendios/${archivo}?v=${Math.floor(Date.now() / 300_000)}`, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`${archivo}: HTTP ${r.status}`)
  return r.json() as Promise<T>
}

function popupFoco(f: Foco, ahora: number) {
  const e = edad(f.t, ahora)
  const fila = (k: string, v: unknown) => (v === null || v === undefined || v === '' ? '' : `<div style="font-size:12px"><b>${k}:</b> ${esc(v)}</div>`)
  return `<div style="min-width:240px">
    <strong style="color:${e.color}">🔥 Detección satelital de calor</strong>
    <div style="font-size:11px;color:#64748b;margin-bottom:4px">Antigüedad: ${e.etiqueta} · no es un incendio confirmado</div>
    ${fila('Satélite / sensor', `${f.satelite ?? 's/d'} · ${f.instrumento}`)}
    ${fila('Confianza', f.confianza ? `${f.confianza} (${f.confianza_raw})` : f.confianza_raw)}
    ${fila('FRP (potencia radiativa)', f.frp !== null ? `${f.frp} MW` : null)}
    ${fila('Temperatura de brillo', f.brillo !== null ? `${f.brillo} K` : null)}
    ${fila('Paso', f.dia_noche === 'D' ? 'diurno' : f.dia_noche === 'N' ? 'nocturno' : f.dia_noche)}
    ${fila('Adquisición', horaUTC(f.adq_utc))}
    ${fila('Hora local', horaLima(f.adq_utc))}
    ${fila('Recibido por la plataforma', horaLima(f.recibido_utc))}
    ${fila('Departamento', f.departamento)}
    ${f.anp ? `<div style="font-size:12px;color:#15803d"><b>Dentro de ANP:</b> ${esc(f.anp)}</div>` : ''}
    ${fila('Coordenadas', `${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`)}
    <div style="font-size:11px;margin-top:5px"><a href="${esc(enlaceFirms(f))}" target="_blank" rel="noreferrer noopener">Ver en NASA FIRMS ↗</a>
    <span style="color:#94a3b8"> · ${esc(f.fuente_id)} ${esc(f.version ?? '')}</span></div></div>`
}

function popupMinam(p: any) {
  const fila = (k: string, v: unknown) => (v === null || v === undefined || v === '' ? '' : `<div style="font-size:12px"><b>${k}:</b> ${esc(v)}</div>`)
  return `<div style="min-width:230px"><strong style="color:#7c2d12">Registro administrativo de incendio</strong>
    <div style="font-size:11px;color:#64748b;margin-bottom:4px">No implica que el incendio siga activo</div>
    ${fila('Fecha de emergencia', p.fecha_emergencia)}
    ${fila('Fecha de término', p.fecha_termino)}
    ${fila('Ubicación', [p.localidad, p.distrito, p.provincia, p.departamento].filter(Boolean).join(', '))}
    ${fila('Región natural', p.region_natural)}
    ${fila('ANP', p.anp)}
    ${fila('Reportado por', p.reportado_por)}
    ${fila('Daños', p.danos)}
    ${fila('Observación', p.observacion)}
    <div style="font-size:11px;color:#7c2d12;margin-top:4px">Fuente: MINAM GeoServidor · ${esc(p.origen ?? '')} · ${esc(p.id)}</div></div>`
}

function Barras({ data, alto = 288, color = '#dc2626', ancho = 120 }: { data: { name: string; value: number }[]; alto?: number; color?: string; ancho?: number }) {
  return (
    <div style={{ height: alto }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 36, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" fontSize={12} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={ancho} fontSize={11} />
          <Tooltip formatter={(v: number) => fmt(v)} cursor={{ fill: '#0000000a' }} />
          <Bar dataKey="value" name="Detecciones" fill={color} radius={[0, 6, 6, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function Chip({ activo, onClick, children, color = 'red' }: { activo: boolean; onClick: () => void; children: React.ReactNode; color?: 'red' | 'slate' }) {
  const on = color === 'red' ? 'bg-red-600 border-red-600 text-white shadow-sm' : 'bg-slate-800 border-slate-800 text-white'
  return (
    <button type="button" aria-pressed={activo} onClick={onClick}
      className={`min-h-[36px] px-3 py-1.5 rounded-full border text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${activo ? on : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
      {children}
    </button>
  )
}

function Tarjeta({ titulo, children, nota }: { titulo: string; children: React.ReactNode; nota?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h3 className="font-semibold text-sm">{titulo}</h3>
      {nota && <p className="text-xs text-slate-500 mt-0.5">{nota}</p>}
      <div className="mt-3">{children}</div>
    </div>
  )
}

export default function Incendios() {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const focosLayer = useRef<L.Layer | null>(null)
  const minamLayer = useRef<L.Layer | null>(null)
  const deptsRef = useRef<any[]>([])

  const [focos, setFocos] = useState<Foco[]>([])
  const [estado, setEstado] = useState<EstadoIngesta | null>(null)
  const [minam, setMinam] = useState<Geo | null>(null)
  const [minamRes, setMinamRes] = useState<MinamResumen | null>(null)
  const [serie, setSerie] = useState<SerieDia[]>([])
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  // `corte` = instante de la última lectura: fija la ventana de filtrado para que el mapa
  // no se reconstruya cada minuto (cerraba popups abiertos). `reloj` solo mueve los "hace X min".
  const [corte, setCorte] = useState(Date.now())
  const [reloj, setReloj] = useState(Date.now())
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES)
  const [verMinam, setVerMinam] = useState(false)

  // Carga + refresco periódico (los archivos los regenera la ingesta; aquí no se llama a ninguna API externa)
  useEffect(() => {
    let vivo = true
    async function leer() {
      const [rEst, rFocos] = await Promise.allSettled([cargar<EstadoIngesta>('estado.json'), cargar<FocosArchivo>('focos.json')])
      if (!vivo) return
      if (rEst.status === 'fulfilled') setEstado(rEst.value)
      if (rFocos.status === 'fulfilled') { setFocos(parseFocos(rFocos.value)); setErrorCarga(null) }
      else setErrorCarga('No se pudieron cargar las detecciones. Reintentando automáticamente.')
      setCorte(Date.now())
      setReloj(Date.now())
      setCargando(false)
    }
    void leer()
    cargar<SerieDia[]>('serie-diaria.json').then((s) => vivo && setSerie(s)).catch(() => {})
    cargar<MinamResumen>('minam-resumen.json').then((s) => vivo && setMinamRes(s)).catch(() => {})
    const id = setInterval(leer, REFRESCO_MS)
    const tic = setInterval(() => setReloj(Date.now()), 60_000)
    return () => { vivo = false; clearInterval(id); clearInterval(tic) }
  }, [])

  const sel = useMemo(() => filtrarFocos(focos, filtros, corte), [focos, filtros, corte])
  const kpi = useMemo(() => indicadores(sel, corte), [sel, corte])
  const satelites = useMemo(() => [...new Set(focos.map((f) => f.satelite).filter(Boolean) as string[])].sort(), [focos])
  const departamentos = useMemo(() => contarPor(focos, (f) => f.departamento).filter((d) => d.name !== 'sin dato'), [focos])
  const fresc = frescura(estado, reloj)
  const dias = estado?.dias ?? 7
  const minamEstado = estado?.fuentes.find((f) => f.id === 'MINAM_REGISTRO_2026')

  // Mapa
  useEffect(() => {
    if (!ref.current || mapRef.current) return
    const map = L.map(ref.current, { scrollWheelZoom: true, preferCanvas: true }).fitBounds(PERU_BOUNDS)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap · Focos: NASA FIRMS', maxZoom: 18 }).addTo(map)
    fetch(`${base}data/peru-departamentos.geojson`).then((r) => r.json()).then((gj) => {
      deptsRef.current = gj.features
      L.geoJSON(gj, { style: { color: '#64748b', weight: 0.8, fillOpacity: 0 }, interactive: false }).addTo(map)
    }).catch(() => {})
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (focosLayer.current) map.removeLayer(focosLayer.current)
    const grp: any = (L as any).markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45, disableClusteringAtZoom: 10, spiderfyOnMaxZoom: true })
    // los más recientes al final → quedan encima
    for (const f of [...sel].sort((a, b) => a.t - b.t)) {
      const c = edad(f.t, corte).color
      const m = L.circleMarker([f.lat, f.lon], { radius: 5, color: '#ffffff', weight: 0.8, fillColor: c, fillOpacity: 0.9 })
      m.bindPopup(() => popupFoco(f, Date.now()))
      grp.addLayer(m)
    }
    grp.addTo(map)
    focosLayer.current = grp
  }, [sel, corte])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (minamLayer.current) { map.removeLayer(minamLayer.current); minamLayer.current = null }
    if (!verMinam) return
    if (!minam) { cargar<Geo>('minam-2026.geojson').then(setMinam).catch(() => setMinam({ type: 'FeatureCollection', features: [] })); return }
    const grp = L.layerGroup()
    for (const f of minam.features) {
      const p = f.properties ?? {}
      if (filtros.departamento && p.departamento !== filtros.departamento) continue
      const [lon, lat] = f.geometry?.coordinates ?? []
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      L.circleMarker([lat, lon], { radius: 6, color: '#7c2d12', weight: 2, fillColor: '#fde68a', fillOpacity: 0.85 })
        .bindPopup(popupMinam(p)).addTo(grp)
    }
    grp.addTo(map)
    minamLayer.current = grp
  }, [verMinam, minam, filtros.departamento])

  function centrarPeru() { mapRef.current?.fitBounds(PERU_BOUNDS) }

  function elegirDepartamento(dep: string) {
    setFiltros((s) => ({ ...s, departamento: dep }))
    const d = dep ? deptsRef.current.find((f: any) => f.properties?.NOMBDEP === dep) : null
    if (d) { try { mapRef.current?.fitBounds(L.geoJSON(d).getBounds(), { padding: [20, 20] }) } catch { /* noop */ } }
    else centrarPeru()
  }

  function alternar(campo: 'satelites' | 'confianzas', v: string, todos: string[]) {
    setFiltros((s) => ({ ...s, [campo]: alternarSeleccion(s[campo], v, todos) }))
  }

  function restablecer() { setFiltros(FILTROS_INICIALES); setVerMinam(false); centrarPeru() }

  const serieVentana = useMemo(() => serieHoraria(sel, filtros.horas, corte), [sel, filtros.horas, corte])
  const filtrosActivos = filtros.satelites !== null || filtros.confianzas !== null || !!filtros.departamento
  const porDep = useMemo(() => contarPor(sel, (f) => f.departamento).slice(0, 12), [sel])
  const porSat = useMemo(() => contarPor(sel, (f) => `${f.satelite ?? 's/d'} (${f.instrumento})`), [sel])
  const porConf = useMemo(() => contarPor(sel, (f) => f.confianza), [sel])
  const porAnp = useMemo(() => contarPor(sel.filter((f) => f.anp), (f) => f.anp).slice(0, 10), [sel])
  const ventana = VENTANAS.find((v) => v.horas === filtros.horas)?.etiqueta ?? `${filtros.horas} h`

  const avisos: Record<string, { cls: string; txt: string }> = {
    'sin-datos': { cls: 'bg-slate-100 border-slate-300 text-slate-700', txt: 'Aún no hay una sincronización exitosa con NASA FIRMS. El mapa puede estar vacío.' },
    desactualizado: { cls: 'bg-amber-50 border-amber-300 text-amber-900', txt: `Datos desactualizados: la última sincronización fue ${hace(estado?.ultima_sincronizacion_utc ?? null, reloj)}. Las detecciones más recientes pueden faltar.` },
    parcial: { cls: 'bg-amber-50 border-amber-300 text-amber-900', txt: 'Una o más fuentes satelitales fallaron en la última consulta; se muestran sus últimos datos válidos.' },
  }

  return (
    <div className="space-y-5">
      <header className="rounded-2xl bg-gradient-to-br from-red-700 via-orange-600 to-amber-500 text-white px-5 py-5 sm:px-7 sm:py-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">🔥 Incendios forestales</h1>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-3 py-1 text-xs font-medium" role="status">
            <span className="relative flex h-2.5 w-2.5">
              {fresc === 'ok' && <span className="absolute inline-flex h-full w-full rounded-full bg-green-300 opacity-75 animate-ping motion-reduce:animate-none" />}
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${fresc === 'ok' ? 'bg-green-300' : fresc === 'sin-datos' ? 'bg-slate-300' : 'bg-amber-300'}`} />
            </span>
            {fresc === 'ok' ? 'En vivo' : fresc === 'parcial' ? 'Parcial' : fresc === 'desactualizado' ? 'Desactualizado' : cargando ? 'Cargando…' : 'Sin datos'}
            {estado?.ultima_sincronizacion_utc && <span className="opacity-80">· {hace(estado.ultima_sincronizacion_utc, reloj)}</span>}
          </span>
        </div>
        <p className="text-sm text-white/90 mt-2 max-w-3xl">
          Focos de calor detectados por satélite en el Perú (NASA FIRMS: VIIRS y MODIS), actualizados
          de forma automática cada hora, junto al registro administrativo de incendios del MINAM.
        </p>
      </header>

      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <b>Cómo leer este mapa.</b> Cada punto es una <b>detección satelital de una anomalía térmica</b> (un píxel
        de ~375 m en VIIRS o ~1 km en MODIS), no un incendio confirmado: puede ser una quema agrícola, un incendio
        forestal o una fuente industrial, y un mismo incendio genera varias detecciones. Por eso aquí se cuentan{' '}
        <b>detecciones</b>, no incendios, y <b>no se calcula superficie quemada</b> a partir de los puntos.
      </div>

      {/* Estado de la sincronización */}
      <details className="group bg-white border border-slate-200 rounded-lg px-4 py-3 text-sm">
        <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 cursor-pointer list-none">
          <span>
            <b>Última sincronización:</b>{' '}
            {estado?.ultima_sincronizacion_utc ? `${horaLima(estado.ultima_sincronizacion_utc)} · ${horaUTC(estado.ultima_sincronizacion_utc)}` : cargando ? 'cargando…' : 'sin datos'}
          </span>
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
                {f.estado === 'error' ? '⚠ ' : '✓ '}{f.nombre.replace('NASA FIRMS · ', '')}
                {f.registros !== null && ` · ${fmt(f.registros)}`}
                {f.estado === 'error' && ' · error, se conservan datos previos'}
              </span>
            ))}
          </div>
        )}
      </details>
      {(avisos[fresc] || errorCarga) && (
        <div role="alert" className={`rounded-lg border px-4 py-2.5 text-sm ${errorCarga ? 'bg-red-50 border-red-300 text-red-900' : avisos[fresc].cls}`}>
          ⚠ {errorCarga ?? avisos[fresc].txt}
        </div>
      )}

      {/* Filtros */}
      <section aria-label="Filtros" className="bg-white border border-slate-200 rounded-xl px-3 py-3 sm:px-4 space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium w-full sm:w-auto sm:mr-1">Periodo</span>
          {VENTANAS.map((v) => (
            <Chip key={v.horas} activo={filtros.horas === v.horas} onClick={() => setFiltros((s) => ({ ...s, horas: v.horas }))}>
              {v.etiqueta}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium w-full sm:w-auto sm:mr-1">Satélite</span>
          {satelites.map((x) => (
            <Chip key={x} color="slate" activo={seleccionado(filtros.satelites, x)} onClick={() => alternar('satelites', x, satelites)}>{x}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium w-full sm:w-auto sm:mr-1">Confianza</span>
          {CONFIANZAS.map((c) => (
            <Chip key={c} color="slate" activo={seleccionado(filtros.confianzas, c)} onClick={() => alternar('confianzas', c, CONFIANZAS)}>
              <span className="capitalize">{c}</span>
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="inc-dep" className="font-medium w-full sm:w-auto">Departamento</label>
          <select id="inc-dep" value={filtros.departamento} onChange={(e) => elegirDepartamento(e.target.value)}
            className="min-h-[36px] border border-slate-300 rounded-lg px-2 py-1.5 bg-white w-full sm:w-auto max-w-full">
            <option value="">Todo el Perú</option>
            {departamentos.map((d) => <option key={d.name} value={d.name}>{d.name} ({fmt(d.value)} en {dias} días)</option>)}
          </select>
          <label className="flex items-center gap-2 cursor-pointer min-h-[36px] sm:ml-1">
            <input type="checkbox" className="h-4 w-4 accent-red-600" checked={verMinam} onChange={(e) => setVerMinam(e.target.checked)} />
            Registro MINAM 2026 <span className="text-xs text-slate-400">(administrativo)</span>
          </label>
          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
            <button type="button" onClick={centrarPeru} className="flex-1 sm:flex-none min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">⌖ Centrar en Perú</button>
            <button type="button" onClick={restablecer} disabled={!filtrosActivos && filtros.horas === FILTROS_INICIALES.horas && !verMinam}
              className="flex-1 sm:flex-none min-h-[36px] px-3 py-1.5 rounded-lg bg-forest-dark text-white hover:bg-forest disabled:opacity-40 disabled:cursor-not-allowed">↺ Restablecer</button>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { v: kpi.total, t: `Detecciones · ${ventana}`, n: filtrosActivos ? 'con los filtros activos' : 'todo el Perú', c: 'border-l-red-600' },
          filtros.horas > 24
            ? { v: kpi.ult24, t: 'Últimas 24 h', n: 'dentro de la selección', c: 'border-l-orange-500' }
            : { v: kpi.altaConfianza, t: 'Alta confianza', n: `en ${ventana}`, c: 'border-l-orange-500' },
          { v: kpi.departamentos, t: 'Departamentos', n: `con detecciones en ${ventana}`, c: 'border-l-amber-500' },
          { v: kpi.enAnp, t: 'Dentro de ANP', n: 'áreas naturales protegidas (SERNANP)', c: 'border-l-forest' },
        ].map((k) => (
          <div key={k.t} className={`bg-white border border-slate-200 border-l-4 ${k.c} rounded-xl p-3 sm:p-4`}>
            <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums">{cargando ? '—' : fmt(k.v)}</div>
            <div className="text-sm font-medium mt-0.5">{k.t}</div>
            <div className="text-xs text-slate-400">{k.n}</div>
          </div>
        ))}
      </div>

      <div className="relative">
        <div ref={ref} role="region" aria-label="Mapa de detecciones de calor en el Perú"
          className="h-[60vh] min-h-[360px] sm:h-[70vh] w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm z-0" />
        {(cargando || (!cargando && sel.length === 0)) && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-[500] flex justify-center px-3">
            <div className="rounded-full bg-white/95 border border-slate-200 shadow px-4 py-1.5 text-sm text-slate-700">
              {cargando ? 'Cargando detecciones…' : `Sin detecciones en ${ventana} con estos filtros`}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600 items-center bg-white border border-slate-200 rounded-lg px-3 py-2">
        <span className="font-medium">Antigüedad de la detección:</span>
        {EDADES.map((e) => (
          <span key={e.etiqueta} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full ring-1 ring-white" style={{ background: e.color }} /> {e.etiqueta}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full border-2" style={{ background: '#fde68a', borderColor: '#7c2d12' }} /> Registro MINAM
        </span>
        <span className="text-slate-400">Los números en círculo agrupan detecciones cercanas.</span>
      </div>

      {/* Indicadores */}
      <h2 className="text-xl font-bold pt-2">Indicadores de la selección</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo={`Detecciones en el tiempo · ${ventana}`} nota={`Bloques de ${serieVentana.paso} h, hora de Lima`}>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serieVentana.cubos} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={10} interval="preserveStartEnd" minTickGap={24} />
                <YAxis fontSize={11} allowDecimals={false} width={40} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="value" name="Detecciones" fill="#dc2626" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Detecciones por departamento" nota="Top 12 de la selección">
          {porDep.length ? <Barras data={porDep} alto={Math.max(160, porDep.length * 24)} /> : <p className="text-sm text-slate-400">Sin detecciones con estos filtros.</p>}
        </Tarjeta>
        <Tarjeta titulo="Por satélite y sensor" nota="Cada satélite pasa a horas distintas; sus detecciones no son incendios distintos">
          <Barras data={porSat} alto={Math.max(140, porSat.length * 34)} color="#ea580c" ancho={150} />
        </Tarjeta>
        <Tarjeta titulo="Por nivel de confianza" nota="VIIRS: baja/nominal/alta · MODIS: 0–100 agrupado (<30 baja, ≥80 alta)">
          <Barras data={porConf} alto={140} color="#f59e0b" ancho={80} />
        </Tarjeta>
        <Tarjeta titulo="Detecciones dentro de áreas naturales protegidas" nota="Cruce punto-en-polígono con los límites oficiales del SERNANP">
          {porAnp.length ? <Barras data={porAnp} alto={Math.max(120, porAnp.length * 28)} color="#15803d" ancho={170} /> : <p className="text-sm text-slate-400">Ninguna detección de la selección cae dentro de un ANP.</p>}
        </Tarjeta>
        <Tarjeta titulo="Evolución diaria (acumulada por la plataforma)" nota="Conteo diario de detecciones en el Perú, hora de Lima. El día en curso es parcial; la serie crece con cada sincronización.">
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie.map((s) => ({ ...s, name: s.fecha.slice(5) + (s.parcial ? '*' : '') }))} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis fontSize={11} width={44} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="VIIRS" stackId="a" fill="#dc2626" isAnimationActive={false} />
                <Bar dataKey="MODIS" stackId="a" fill="#f59e0b" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Tarjeta>
      </div>

      {/* Registro administrativo */}
      {minamRes && (
        <>
          <h2 className="text-xl font-bold pt-2">Registro administrativo de incendios (MINAM)</h2>
          <p className="text-sm text-slate-500 max-w-3xl">
            Emergencias por incendio sistematizadas por el MINAM a partir de reportes de INDECI y otras
            entidades. Es un registro oficial pero con rezago: el último registro 2026 publicado es del{' '}
            <b>{minamEstado?.ultimo_registro ?? 's/d'}</b> ({fmt(minamEstado?.registros ?? 0)} registros en 2026).
            Que un incendio figure aquí no significa que siga activo. Actívalo en el mapa con el filtro
            “Registro MINAM 2026”.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta titulo={`Registros históricos por año · ${fmt(minamRes.total)} en total`} nota="2000–2025. El aumento desde 2019 refleja también mejoras en el registro, no solo más incendios.">
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={minamRes.porAnio.map((a) => ({ name: String(a.anio), value: a.registros }))} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={10} />
                    <YAxis fontSize={11} width={48} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="value" name="Registros" fill="#7c2d12" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Tarjeta>
            <Tarjeta titulo="Registros históricos por departamento" nota="Top 12, 2000–2025">
              <Barras data={minamRes.porDepartamento.slice(0, 12).map((d) => ({ name: d.departamento, value: d.registros }))} alto={300} color="#7c2d12" />
            </Tarjeta>
          </div>
        </>
      )}

      {/* Fuentes y descargas */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-600 space-y-1.5">
        <p>
          <b>Fuentes.</b> Focos de calor:{' '}
          <a className="underline" href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer noopener">NASA FIRMS</a>{' '}
          (VIIRS Suomi NPP, NOAA-20 y NOAA-21 a 375 m; MODIS Terra/Aqua a 1 km; productos NRT, disponibles ~3 h
          después del paso del satélite). Registro de incendios:{' '}
          <a className="underline" href="https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioCFOI/MapServer" target="_blank" rel="noreferrer noopener">MINAM GeoServidor · ServicioCFOI</a>.
          Límites: departamentos INEI, ANP SERNANP. Departamento y ANP de cada detección se asignan por cruce
          punto-en-polígono.
        </p>
        <p>
          <b>Descargar datos:</b>{' '}
          <a className="underline hover:text-forest-dark" download href={`${base}data/csv/incendios-focos.csv`}>detecciones 7 días (CSV)</a>{' · '}
          <a className="underline hover:text-forest-dark" download href={`${base}data/incendios/focos-24h.geojson`}>últimas 24 h (GeoJSON)</a>{' · '}
          <a className="underline hover:text-forest-dark" download href={`${base}data/csv/incendios-minam-2026.csv`}>registro MINAM 2026 (CSV)</a>{' · '}
          <a className="underline hover:text-forest-dark" href={`${base}data/incendios/estado.json`} target="_blank" rel="noreferrer noopener">estado de la ingesta (JSON)</a>
        </p>
      </div>
    </div>
  )
}
