// Lógica pura del módulo "El Niño, lluvias y calor" (sin React ni Leaflet) para poder probarla.
// Los datos los genera etl/build_nino.py en public/data/nino/.

export type Origen = 'oficial' | 'modelo' | 'calculado'
export type TipoAlerta = 'enso' | 'lluvias' | 'huaycos' | 'rios' | 'calor'

export interface Alerta {
  id: string
  tipo: TipoAlerta
  nivel: 1 | 2 | 3 | 4
  origen: Origen
  titulo: string
  detalle: string
  fuente: string
  url: string | null
}

export interface AlertasArchivo {
  generado_utc: string
  alertas: Alerta[]
  resumen: { total: number; por_nivel: Record<string, number>; por_tipo: Record<string, number> }
}

export interface EnsoActual {
  mes: string | null
  n12_anomalia_mensual: number | null
  n34_anomalia_mensual: number | null
  semana: string | null
  n12_anomalia_semanal: number | null
  n12_sst_semanal: number | null
  n34_anomalia_semanal: number | null
  icen_proxy: number | null
  icen_proxy_mes: string | null
  icen_categoria: string | null
}

export interface Enso {
  generado_utc: string
  clim_base: string
  mensual: { anio: number; mes: number; n12: number; n12a: number; n34: number; n34a: number }[]
  semanal: { semana: string; n12: number; n12a: number; n3a: number; n34: number; n34a: number; n4a: number }[]
  icen_proxy: { anio: number; mes: number; valor: number; categoria: string | null }[]
  actual: EnsoActual
  nota: string
}

export interface Enfen { numero: string; fecha: string | null; titulo: string; url: string | null; pagina: string; estado_alerta: string | null }

export interface AvisoMet { numero: string | null; nivel: number | null; emision: string | null; inicio: string | null; fin: string | null; fenomeno: string | null; evento: string | null; departamentos: string[] }
export interface AvisoHidro {
  id: string | null; numero: string | null; nivel: number | null; color: string | null; fecha: string | null; titulo: string | null
  estacion: string | null; cuenca: string | null; region_hidrografica: string | null; departamento: string | null; provincia: string | null; distrito: string | null
  peligro: string | null; recomendacion: string | null; lat: number | null; lon: number | null
}
export interface Umbral {
  estacion: string | null; departamento: string | null; provincia: string | null; distrito: string | null; cuenca: string | null; fecha: string | null; hora: string | null
  pp_mm: number | null; umbral_mm: number | null; pp_acum_mm: number | null; umbral_acum_mm: number | null; supera: boolean; supera_acum: boolean; lat: number | null; lon: number | null
}
export interface Avisos {
  generado_utc: string
  meteorologicos: AvisoMet[]
  lluvia_24h: { nivel: number | null; fecha: string | null; descripcion: string | null; recomendacion: string | null }[]
  hidrologicos: AvisoHidro[]
  umbrales: Umbral[]
  umbrales_fecha: string | null
}

export interface Ccpp { nombre: string; departamento: string; provincia: string; distrito: string; nivel: number; poblacion: number; viviendas: number; lat: number; lon: number }
export interface DepQuebrada { departamento: string; ccpp: number; poblacion: number; viviendas: number; n2: number; n3: number; n4: number }
export interface Quebradas {
  generado_utc: string
  fecha_aviso: string | null
  campos: string[]
  filas: unknown[][]
  niveles: Record<string, { descripcion: string | null; recomendacion: string | null }>
  resumen: {
    ccpp: number; poblacion: number; viviendas: number
    ccpp_por_nivel: Record<string, number>; poblacion_por_nivel: Record<string, number>
    distritos: number; distritos_por_nivel: Record<string, number>
    departamentos: DepQuebrada[]
    distritos_nivel4: { departamento: string; provincia: string; distrito: string; nivel: number }[]
    expuestos: Record<string, number | null>
  }
}

export interface Silvia { generado_utc: string; dias: { dia: number; fecha_emision: string | null; cuencas: number; por_nivel: Record<string, number> }[] }
export interface Sonics {
  generado_utc: string
  dias: { dia: number; ccpp: number; por_nivel: Record<string, number>; por_departamento: { departamento: string; ccpp: number }[] }[]
  campos_dia1: string[]
  dia1: unknown[][]
}
export interface SectorEstacional { sector: string | null; escenario: string | null; emision: string | null; inferior: number | null; normal: number | null; superior: number | null; periodo: string | null; variable: string | null }
export interface Estacional { generado_utc: string; verano: SectorEstacional[]; trimestre_pp: SectorEstacional[]; mes_pp: SectorEstacional[]; mes_tmax: SectorEstacional[]; mes_tmin: SectorEstacional[] }

export interface DiaPron { fecha: string; pp: number | null; prob: number | null; tmax: number | null; tmin: number | null; tapp: number | null; codigo: number | null }
export interface Ciudad { ciudad: string; departamento: string; lat: number; lon: number; dias: DiaPron[]; pp_7d: number | null; pp_max_dia: number | null; tmax_max: number | null; modelo: string }
export interface Pronostico { generado_utc: string; atribucion: string; ciudades: Ciudad[] }
export interface Rio { rio: string; departamento: string; lat: number; lon: number; serie: { fecha: string; q: number | null; qmax: number | null }[]; media_30d: number | null; pico_7d: number | null; ratio: number | null }
export interface Caudales { generado_utc: string; atribucion: string; rios: Rio[] }

export interface FuenteEstado { id: string; nombre: string; tipo: string; estado: 'ok' | 'error'; error: string | null; registros: number | null; ultimo_exito: string | null; duracion_ms: number }
export interface EstadoNino { ultima_ejecucion_utc: string; ultima_sincronizacion_utc: string | null; duracion_ms: number; fuentes: FuenteEstado[]; alertas: number; wms: string }

export const TIPOS: { id: TipoAlerta | 'todas'; etiqueta: string; icono: string }[] = [
  { id: 'todas', etiqueta: 'Todas', icono: '' },
  { id: 'enso', etiqueta: 'El Niño', icono: '🌊' },
  { id: 'lluvias', etiqueta: 'Lluvias', icono: '🌧️' },
  { id: 'huaycos', etiqueta: 'Huaycos', icono: '⛰️' },
  { id: 'rios', etiqueta: 'Ríos', icono: '🏞️' },
  { id: 'calor', etiqueta: 'Calor', icono: '🌡️' },
]

/** Colores de nivel (1 bajo … 4 muy alto), alineados con la escala amarillo/naranja/rojo del SENAMHI. */
export const NIVELES: Record<number, { color: string; fondo: string; etiqueta: string }> = {
  1: { color: '#ca8a04', fondo: '#fef9c3', etiqueta: 'Nivel 1 · bajo' },
  2: { color: '#ea580c', fondo: '#ffedd5', etiqueta: 'Nivel 2 · moderado' },
  3: { color: '#dc2626', fondo: '#fee2e2', etiqueta: 'Nivel 3 · alto' },
  4: { color: '#7f1d1d', fondo: '#fecaca', etiqueta: 'Nivel 4 · muy alto' },
}

export const ORIGENES: Record<Origen, { etiqueta: string; nota: string }> = {
  oficial: { etiqueta: 'Aviso oficial', nota: 'Emitido por SENAMHI o ENFEN' },
  modelo: { etiqueta: 'Modelo global', nota: 'Salida de modelo (Open-Meteo / GloFAS), referencial' },
  calculado: { etiqueta: 'Cálculo propio', nota: 'Calculado por el observatorio con datos NOAA' },
}

/** Categorías del ICEN según el ENFEN (promedio móvil de 3 meses de la anomalía Niño 1+2). */
export const ICEN_CATEGORIAS: [number, number, string][] = [
  [-Infinity, -1.4, 'fría fuerte'], [-1.4, -1.2, 'fría moderada'], [-1.2, -1.0, 'fría débil'],
  [-1.0, 0.4, 'neutra'], [0.4, 1.0, 'cálida débil'], [1.0, 1.7, 'cálida moderada'],
  [1.7, 3.0, 'cálida fuerte'], [3.0, Infinity, 'cálida extraordinaria'],
]

export function categoriaIcen(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null
  const c = ICEN_CATEGORIAS.find(([lo, hi]) => v >= lo && v < hi)
  return c ? c[2] : null
}

export function colorCategoria(cat: string | null): string {
  if (!cat) return '#64748b'
  if (cat.includes('extraordinaria')) return '#7f1d1d'
  if (cat.includes('fuerte') && cat.startsWith('cálida')) return '#dc2626'
  if (cat.includes('moderada') && cat.startsWith('cálida')) return '#ea580c'
  if (cat.startsWith('cálida')) return '#f59e0b'
  if (cat.startsWith('fría')) return '#2563eb'
  return '#16a34a'
}

export function filtrarAlertas(alertas: Alerta[], tipo: TipoAlerta | 'todas', soloOficiales: boolean): Alerta[] {
  return alertas
    .filter((a) => (tipo === 'todas' || a.tipo === tipo) && (!soloOficiales || a.origen === 'oficial'))
    .sort((a, b) => b.nivel - a.nivel || (a.origen === 'oficial' ? -1 : 1) - (b.origen === 'oficial' ? -1 : 1) || a.titulo.localeCompare(b.titulo))
}

export function nivelMaximo(alertas: Alerta[]): number {
  return alertas.reduce((m, a) => Math.max(m, a.nivel), 0)
}

/** Convierte un archivo columnar {campos, filas} en objetos; descarta filas inválidas. */
export function desdeColumnar<T>(campos: string[] | undefined, filas: unknown[][] | undefined): T[] {
  if (!Array.isArray(campos) || !Array.isArray(filas)) return []
  return filas.filter((f) => Array.isArray(f) && f.length >= campos.length).map((f) => {
    const o: Record<string, unknown> = {}
    campos.forEach((c, i) => { o[c] = f[i] })
    return o as unknown as T
  })
}

export function parseCcpp(q: Quebradas | null): Ccpp[] {
  return desdeColumnar<Ccpp>(q?.campos, q?.filas).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.nivel >= 1 && c.nivel <= 4)
}

const H = 3_600_000

export type Frescura = 'ok' | 'parcial' | 'desactualizado' | 'sin-datos'

/** La ingesta corre cada ~1 h; >3 h sin sincronizar = desactualizado (SENAMHI/NOAA actualizan a diario). */
export function frescura(e: EstadoNino | null, ahora: number, limiteHoras = 3): Frescura {
  if (!e || !e.ultima_sincronizacion_utc) return 'sin-datos'
  if (ahora - Date.parse(e.ultima_sincronizacion_utc) > limiteHoras * H) return 'desactualizado'
  if (e.fuentes.some((f) => f.estado === 'error')) return 'parcial'
  return 'ok'
}

export function hace(iso: string | null, ahora: number): string {
  if (!iso) return 'nunca'
  const min = Math.round((ahora - Date.parse(iso)) / 60000)
  if (min < 1) return 'hace instantes'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}

const FMT = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
export const horaLima = (iso: string | number) => FMT.format(new Date(iso)) + ' (Lima)'
const FMT_DIA = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' })
/** 'YYYY-MM-DD' → 'mié 28 oct' (sin desfase de zona horaria). */
export const diaCorto = (fecha: string) => FMT_DIA.format(new Date(fecha + 'T12:00:00Z'))

/** Color de lluvia diaria prevista (mm) para la tabla y el mapa. */
export function colorLluvia(mm: number | null): string {
  if (mm === null || !Number.isFinite(mm)) return '#e2e8f0'
  if (mm >= 40) return '#1e3a8a'
  if (mm >= 20) return '#2563eb'
  if (mm >= 10) return '#60a5fa'
  if (mm >= 2) return '#bfdbfe'
  return '#f1f5f9'
}

export function colorCalor(tmax: number | null): string {
  if (tmax === null || !Number.isFinite(tmax)) return '#e2e8f0'
  if (tmax >= 36) return '#7f1d1d'
  if (tmax >= 33) return '#dc2626'
  if (tmax >= 30) return '#f97316'
  if (tmax >= 27) return '#fbbf24'
  return '#f1f5f9'
}

/** Serie mensual Niño 1+2 reducida a un punto por mes desde `desdeAnio` para el gráfico largo. */
export function serieMensual(enso: Enso | null, desdeAnio = 1982) {
  return (enso?.mensual ?? []).filter((m) => m.anio >= desdeAnio).map((m) => ({ name: `${m.anio}-${String(m.mes).padStart(2, '0')}`, n12a: m.n12a, n34a: m.n34a }))
}

/** Los episodios en que el proxy del ICEN superó un umbral (p. ej. 1.7 = fuerte), agrupados en eventos. */
export function episodios(enso: Enso | null, umbral = 1.7) {
  const out: { inicio: string; fin: string; maximo: number; categoria: string | null }[] = []
  let actual: typeof out[number] | null = null
  for (const p of enso?.icen_proxy ?? []) {
    const k = `${p.anio}-${String(p.mes).padStart(2, '0')}`
    if (p.valor >= umbral) {
      if (!actual) actual = { inicio: k, fin: k, maximo: p.valor, categoria: p.categoria }
      else { actual.fin = k; if (p.valor > actual.maximo) { actual.maximo = p.valor; actual.categoria = p.categoria } }
    } else if (actual) { out.push(actual); actual = null }
  }
  if (actual) out.push(actual)
  return out
}
