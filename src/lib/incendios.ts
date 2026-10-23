// Lógica pura del módulo de incendios (sin React ni Leaflet) para poder probarla.
// Los datos los genera etl/build_incendios.py en public/data/incendios/.

export interface Foco {
  id: string
  fuente_id: string
  satelite: string | null
  instrumento: 'VIIRS' | 'MODIS'
  lat: number
  lon: number
  adq_utc: string
  confianza: 'baja' | 'nominal' | 'alta' | null
  confianza_raw: string | null
  frp: number | null
  brillo: number | null
  brillo2: number | null
  scan: number | null
  track: number | null
  dia_noche: string | null
  version: string | null
  recibido_utc: string
  departamento: string | null
  anp: string | null
  /** adq_utc en milisegundos (calculado al cargar) */
  t: number
}

export interface FocosArchivo {
  generado_utc: string
  alcance: string
  dias: number
  campos: string[]
  filas: unknown[][]
}

export interface FuenteEstado {
  id: string
  nombre: string
  tipo: 'satelital' | 'administrativo'
  modo: string
  estado: 'ok' | 'sin-cambios' | 'error'
  error: string | null
  registros: number | null
  ultimo_exito: string | null
  ultimo_registro?: string | null
  duracion_ms: number
}

export interface EstadoIngesta {
  ultima_ejecucion_utc: string
  ultima_sincronizacion_utc: string | null
  duracion_ms: number
  alcance: string
  dias: number
  total_focos: number
  fuentes: FuenteEstado[]
}

export interface Filtros {
  horas: number
  satelites: string[] | null // null = todos; [] = ninguno
  confianzas: string[] | null // null = todas; [] = ninguna
  departamento: string // '' = todo el Perú
}

export const VENTANAS = [
  { horas: 6, etiqueta: '6 h' },
  { horas: 12, etiqueta: '12 h' },
  { horas: 24, etiqueta: '24 h' },
  { horas: 72, etiqueta: '72 h' },
  { horas: 168, etiqueta: '7 días' },
]

export const FILTROS_INICIALES: Filtros = { horas: 24, satelites: null, confianzas: null, departamento: '' }

/** Marca/desmarca `v`. Si al final están todas marcadas vuelve a `null` (= todas, incluso las que aparezcan luego). */
export function alternarSeleccion(actual: string[] | null, v: string, todos: string[]): string[] | null {
  const base = actual ?? todos
  const sig = base.includes(v) ? base.filter((x) => x !== v) : [...base, v]
  return todos.every((t) => sig.includes(t)) ? null : sig
}

export const seleccionado = (sel: string[] | null, v: string) => sel === null || sel.includes(v)

/** Antigüedad de la detección → color de la leyenda. */
export const EDADES = [
  { max: 6, color: '#dc2626', etiqueta: '< 6 h' },
  { max: 12, color: '#f97316', etiqueta: '6–12 h' },
  { max: 24, color: '#f59e0b', etiqueta: '12–24 h' },
  { max: 72, color: '#a16207', etiqueta: '1–3 días' },
  { max: Infinity, color: '#78716c', etiqueta: '3–7 días' },
]

const H = 3_600_000

export function parseFocos(d: FocosArchivo): Foco[] {
  if (!d || !Array.isArray(d.campos) || !Array.isArray(d.filas)) return []
  return d.filas.filter(Array.isArray).map((fila) => {
    const o: Record<string, unknown> = {}
    d.campos.forEach((c, i) => { o[c] = fila[i] })
    o.t = Date.parse(o.adq_utc as string)
    return o as unknown as Foco
  }).filter((f) => Number.isFinite(f.t) && Number.isFinite(f.lat) && Number.isFinite(f.lon) &&
    Math.abs(f.lat) <= 90 && Math.abs(f.lon) <= 180)
}

export function filtrarFocos(focos: Foco[], f: Filtros, ahora: number): Foco[] {
  const desde = ahora - f.horas * H
  return focos.filter((x) =>
    x.t >= desde && x.t <= ahora + H &&
    seleccionado(f.satelites, x.satelite ?? '') &&
    seleccionado(f.confianzas, x.confianza ?? 'sin dato') &&
    (!f.departamento || x.departamento === f.departamento))
}

export function edad(t: number, ahora: number) {
  const horas = Math.max(0, (ahora - t) / H)
  return EDADES.find((e) => horas < e.max) ?? EDADES[EDADES.length - 1]
}

const fmtFecha = (tz: string) => new Intl.DateTimeFormat('es-PE', {
  timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})
const FMT_LIMA = fmtFecha('America/Lima')
const FMT_UTC = fmtFecha('UTC')

export const horaLima = (iso: string | number) => FMT_LIMA.format(new Date(iso)) + ' (Lima)'
export const horaUTC = (iso: string | number) => FMT_UTC.format(new Date(iso)) + ' UTC'

export function hace(iso: string | null, ahora: number): string {
  if (!iso) return 'nunca'
  const min = Math.round((ahora - Date.parse(iso)) / 60000)
  if (min < 1) return 'hace instantes'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}

export type Frescura = 'ok' | 'parcial' | 'desactualizado' | 'sin-datos'

/** La ingesta corre cada ~1 h (cron de GitHub, puede retrasarse); >2 h sin sincronizar = desactualizado. */
export function frescura(e: EstadoIngesta | null, ahora: number, limiteHoras = 2): Frescura {
  if (!e || !e.ultima_sincronizacion_utc) return 'sin-datos'
  if (ahora - Date.parse(e.ultima_sincronizacion_utc) > limiteHoras * H) return 'desactualizado'
  if (e.fuentes.some((f) => f.tipo === 'satelital' && f.estado === 'error')) return 'parcial'
  return 'ok'
}

export function contarPor<T>(xs: T[], clave: (x: T) => string | null | undefined) {
  const m = new Map<string, number>()
  for (const x of xs) {
    const k = clave(x) || 'sin dato'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
}

/** Histograma por bloques de horas (hora de Lima) para la ventana activa. */
export function serieHoraria(focos: Foco[], horas: number, ahora: number) {
  const paso = horas <= 24 ? 1 : horas <= 72 ? 3 : 6
  const n = Math.ceil(horas / paso)
  const fin = Math.ceil(ahora / (paso * H)) * paso * H
  const cubos = Array.from({ length: n }, (_, i) => {
    const t0 = fin - (n - i) * paso * H
    return { t0, name: FMT_LIMA.format(new Date(t0)).replace(/ \d{4},?/, ''), value: 0 }
  })
  for (const f of focos) {
    const i = Math.floor((f.t - (fin - n * paso * H)) / (paso * H))
    if (i >= 0 && i < n) cubos[i].value++
  }
  return { paso, cubos }
}

export function indicadores(focos: Foco[], ahora: number) {
  return {
    total: focos.length,
    ult24: focos.filter((f) => f.t >= ahora - 24 * H).length,
    departamentos: new Set(focos.map((f) => f.departamento).filter(Boolean)).size,
    enAnp: focos.filter((f) => f.anp).length,
    altaConfianza: focos.filter((f) => f.confianza === 'alta').length,
  }
}

/** Enlace al visor oficial de FIRMS centrado en la detección. */
export function enlaceFirms(f: Pick<Foco, 'lat' | 'lon' | 'adq_utc'>): string {
  // la fecha viene de un archivo publicado: solo se acepta YYYY-MM-DD
  const dia = /^\d{4}-\d{2}-\d{2}/.exec(String(f.adq_utc))?.[0] ?? ''
  return `https://firms.modaps.eosdis.nasa.gov/map/#d:${dia};@${f.lon.toFixed(4)},${f.lat.toFixed(4)},12.00z`
}
