// Helpers para cargar los datasets estáticos desde /public/data.
// BASE_URL respeta el base path de Vite (GitHub Pages).

const base = import.meta.env.BASE_URL

export async function loadJSON<T>(file: string): Promise<T> {
  const res = await fetch(`${base}data/${file}`)
  if (!res.ok) throw new Error(`No se pudo cargar ${file} (${res.status})`)
  return res.json() as Promise<T>
}

export interface KPI {
  id: string
  etiqueta: string
  valor: number
  unidad: string
  categoria: string
  estado: 'verificado' | 'estimado' | 'ilustrativo'
  fuente: string
  detalle?: string
}

export interface Indicadores {
  actualizado: string
  nota: string
  kpis: KPI[]
}

export interface Categoria {
  id: string
  nombre: string
  icono: string
  color: string
}

export interface Documento {
  id: string
  titulo: string
  tipo: string
  anio: number
  fuente: string
  categoria: string
  url: string
  resumen: string
}

export interface SerieAnual {
  anio: number
  ha: number
  estado: string
}

export interface Deforestacion {
  fuente: string
  nota: string
  serieAnual: SerieAnual[]
  porRegion2023: { region: string; ha: number; estado: string }[]
  notaRegional: string
}

export function fmt(n: number): string {
  return n.toLocaleString('es-PE')
}
