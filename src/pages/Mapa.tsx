import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { fmt } from '../lib/data'

const base = import.meta.env.BASE_URL

const iconUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png'
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png'
const shadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'

type CapaId =
  | 'anp' | 'lotes' | 'pueblos' | 'reservas' | 'comunidades' | 'campesinas'
  | 'unidades' | 'mineria' | 'relaves' | 'riesgo' | 'eventos' | 'departamentos'
type Geo = { type: string; features: any[] }

const PERU_CENTER: L.LatLngTuple = [-9.6, -74.5]

// --- Punto dentro de polígono (filtro por región, sin dependencias) ---------
function inRing(x: number, y: number, ring: number[][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}
function inGeom(lng: number, lat: number, geom: any): boolean {
  if (!geom) return false
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []
  for (const poly of polys) {
    if (inRing(lng, lat, poly[0])) {
      let hole = false
      for (let k = 1; k < poly.length; k++) if (inRing(lng, lat, poly[k])) { hole = true; break }
      if (!hole) return true
    }
  }
  return false
}

// --- Definición declarativa de capas ----------------------------------------
type PointDef = {
  kind: 'point'; file: string; cluster: boolean
  style: (f: any) => L.CircleMarkerOptions
  popup: (p: any) => string
}
type PolyDef = {
  kind: 'poly'; file: string
  style: L.PathOptions | ((f: any) => L.PathOptions)
  popup: (p: any) => string
}
type LayerDef = (PointDef | PolyDef) & { label: string; group: string }

const POPUP = {
  pueblos: (p: any) => `<div style="min-width:210px"><strong style="color:#7c3aed">${p.nombre ?? 'Localidad indígena'}</strong>
    <div style="font-size:12px;margin-top:4px"><b>Pueblo / etnia:</b> ${p.etnia ?? 's/d'}</div>
    <div style="font-size:12px"><b>Familia lingüística:</b> ${p.familia_ling ?? 's/d'}</div>
    <div style="font-size:12px"><b>Tipo:</b> ${p.tipo ?? 's/d'}</div>
    ${p.federacion ? `<div style="font-size:12px"><b>Federación:</b> ${p.federacion}</div>` : ''}
    <div style="font-size:11px;color:#7c3aed;margin-top:4px">Fuente: Min. Cultura/IBC · GEOCATMIN</div></div>`,
  comunidades: (p: any) => `<div style="min-width:210px"><strong style="color:#7c3aed">Comunidad nativa ${p.nombre ?? ''}</strong>
    <div style="font-size:12px;margin-top:4px"><b>Etnia:</b> ${p.etnia ?? 's/d'}</div>
    <div style="font-size:12px"><b>Población:</b> ${p.poblacion ?? 's/d'} · <b>Familias:</b> ${p.familias ?? 's/d'}</div>
    <div style="font-size:12px"><b>Río:</b> ${p.rio ?? 's/d'}</div>
    <div style="font-size:11px;color:#7c3aed;margin-top:4px">Fuente: IBC/SICNA · GEOCATMIN</div></div>`,
  campesinas: (p: any) => `<div style="min-width:190px"><strong style="color:#0f766e">Comunidad campesina ${p.nombre ?? ''}</strong>
    <div style="font-size:11px;color:#0f766e;margin-top:4px">Fuente: CooperAcción (geoportal)</div></div>`,
  unidades: (p: any) => `<div style="min-width:215px"><strong style="color:#92400e">Minería · ${p.tipo ?? ''}</strong>
    <div style="font-size:12px;margin-top:4px"><b>Unidad:</b> ${p.nombre ?? 's/d'}</div>
    <div style="font-size:12px"><b>Titular:</b> ${p.titular ?? 's/d'}</div>
    <div style="font-size:12px"><b>Sustancia:</b> ${p.sustancia ?? 's/d'}</div>
    ${p.region ? `<div style="font-size:12px"><b>Región:</b> ${p.region}</div>` : ''}
    <div style="font-size:11px;color:#92400e;margin-top:4px">Fuente: MINEM · OSINERGMIN GISEM</div></div>`,
  relaves: (p: any) => `<div style="min-width:220px"><strong style="color:#b45309">Depósito de relaves</strong>
    <div style="font-size:12px;margin-top:4px"><b>Administrado:</b> ${p.administrado ?? 's/d'}</div>
    <div style="font-size:12px"><b>Unidad fiscalizable:</b> ${p.unidad ?? 's/d'}</div>
    <div style="font-size:12px"><b>Estado:</b> ${p.estado_dr ?? 's/d'}</div>
    <div style="font-size:12px"><b>Área:</b> ${p.area_m2 ? fmt(p.area_m2) + ' m²' : 's/d'}</div>
    <div style="font-size:11px;color:#b45309;margin-top:4px">Fuente: OEFA · PIFA (oficial)</div></div>`,
  riesgo: (p: any) => {
    const flag = (v?: string) => (v && v !== '0' && v !== 'Sin pasivo' && v !== 'Sin conflicto')
    const extras = [flag(p.pasivo_minero) ? 'pasivo minero' : '', flag(p.pasivo_hidrocarburo) ? 'pasivo hidrocarburo' : '', flag(p.conflicto_socioamb) ? 'conflicto socioambiental' : ''].filter(Boolean).join(' · ')
    return `<div style="min-width:230px"><strong style="color:#6d28d9">Riesgo ambiental: ${p.riesgo ?? ''}</strong>
      <div style="font-size:12px;margin-top:4px"><b>Administrado:</b> ${p.administrado ?? 's/d'}</div>
      <div style="font-size:12px"><b>Unidad fiscalizable:</b> ${p.unidad ?? 's/d'}</div>
      <div style="font-size:12px"><b>Subsector:</b> ${p.subsector ?? 's/d'}</div>
      <div style="font-size:12px"><b>Peligro:</b> ${p.peligro ?? 's/d'} · <b>Vulnerabilidad:</b> ${p.vulnerabilidad ?? 's/d'}</div>
      ${extras ? `<div style="font-size:12px;color:#b91c1c;margin-top:3px">⚠ ${extras}</div>` : ''}
      <div style="font-size:11px;color:#6d28d9;margin-top:4px">Fuente: OEFA · PIFA (oficial)</div></div>`
  },
  eventos: (p: any) => `<div style="min-width:220px"><strong>${p.nombre ?? ''}</strong><br/>
    <span style="color:#64748b;font-size:12px">${p.fecha ?? ''} · ${p.ubicacion ?? ''}</span>
    <p style="margin:6px 0;font-size:13px">${p.descripcion ?? ''}</p>
    <div style="font-size:12px"><b>Magnitud:</b> ${p.magnitud ?? 's/d'}</div>
    <div style="font-size:12px"><b>Responsable:</b> ${p.responsable ?? 's/d'}</div>
    <div style="font-size:11px;color:#94a3b8;margin-top:4px">Fuente: ${p.fuente ?? ''} · dato ${p.estado_dato ?? ''}</div></div>`,
  lotes: (p: any) => `<div style="min-width:220px"><strong style="color:#9a3412">Lote ${p.lote ?? ''}</strong>
    <div style="font-size:12px;margin-top:4px"><b>Fase:</b> ${p.fase ?? 's/d'}</div>
    <div style="font-size:12px"><b>Empresa:</b> ${p.empresa ?? 's/d'}</div>
    <div style="font-size:12px"><b>Ubicación:</b> ${p.ubicacion ?? 's/d'}</div>
    <div style="font-size:12px"><b>Contrato:</b> ${p.tipo_contrato ?? ''} ${p.contrato ?? ''}</div>
    <div style="font-size:11px;color:#9a3412;margin-top:4px">Fuente: Perupetro · OSINERGMIN GISEM</div></div>`,
  anp: (p: any) => `<div style="min-width:220px"><strong>${p.anp_nomb ?? ''}</strong><br/>
    <span style="color:#15803d;font-size:12px;font-weight:600">${p.anp_cate ?? ''}</span>
    <div style="font-size:12px;margin-top:4px"><b>Superficie legal:</b> ${p.anp_suleg ? fmt(Math.round(p.anp_suleg)) + ' ha' : 's/d'}</div>
    <div style="font-size:12px"><b>Categoría UICN:</b> ${p.anp_uicn ?? 's/d'}</div>
    <div style="font-size:11px;color:#16a34a;margin-top:4px">Fuente: SERNANP (oficial)</div></div>`,
  mineria: (p: any) => `<div style="min-width:220px"><strong style="color:#b91c1c">Minería ilegal — ${p.idtipact ?? ''}</strong>
    <p style="margin:6px 0;font-size:13px">${p.descrip ?? ''}</p>
    <div style="font-size:12px"><b>Ubicación:</b> ${p.ubiref ?? 's/d'}</div>
    <div style="font-size:11px;color:#b91c1c;margin-top:4px">Fuente: SERNANP (oficial)</div></div>`,
  reservas: (p: any) => `<div style="min-width:220px"><strong style="color:#5b21b6">Reserva territorial — ${p.nombre ?? ''}</strong>
    <div style="font-size:12px;margin-top:4px"><b>Categoría:</b> ${p.categoria ?? 's/d'}</div>
    <div style="font-size:12px"><b>Pueblo:</b> ${p.pueblo ?? 's/d'}</div>
    <div style="font-size:12px"><b>Estado:</b> ${p.estado ?? 's/d'}</div>
    <div style="font-size:11px;color:#5b21b6;margin-top:4px">Fuente: Min. Cultura · GEOCATMIN</div></div>`,
}

const LAYERS: Record<CapaId, LayerDef> = {
  anp: { kind: 'poly', label: 'Áreas protegidas (SERNANP)', group: 'Áreas y base', file: 'anp-sernanp.geojson',
    style: { color: '#15803d', weight: 1, fillColor: '#22c55e', fillOpacity: 0.25 }, popup: POPUP.anp },
  lotes: { kind: 'poly', label: 'Lotes petroleros (Perupetro)', group: 'Hidrocarburos y minería', file: 'lotes-petroleros.geojson',
    style: (f) => ({ color: '#7c2d12', weight: 1, fillColor: f?.properties?.fase === 'Explotación' ? '#9a3412' : '#f59e0b', fillOpacity: 0.30 }), popup: POPUP.lotes },
  reservas: { kind: 'poly', label: 'Reservas territoriales (PIACI)', group: 'Territorios y pueblos', file: 'reservas-territoriales.geojson',
    style: { color: '#5b21b6', weight: 1.5, fillColor: '#8b5cf6', fillOpacity: 0.30, dashArray: '4 3' }, popup: POPUP.reservas },
  mineria: { kind: 'poly', label: 'Minería ilegal en ANP', group: 'Hidrocarburos y minería', file: 'mineria-ilegal-anp.geojson',
    style: { color: '#7f1d1d', weight: 1, fillColor: '#dc2626', fillOpacity: 0.55 }, popup: POPUP.mineria },
  pueblos: { kind: 'point', label: 'Pueblos indígenas (Cultura/IBC)', group: 'Territorios y pueblos', file: 'pueblos-indigenas.geojson', cluster: true,
    style: () => ({ radius: 4, color: '#581c87', weight: 0.6, fillColor: '#7c3aed', fillOpacity: 0.9 }), popup: POPUP.pueblos },
  comunidades: { kind: 'point', label: 'Comunidades nativas', group: 'Territorios y pueblos', file: 'comunidades-nativas.geojson', cluster: true,
    style: () => ({ radius: 4, color: '#fff', weight: 0.8, fillColor: '#9333ea', fillOpacity: 0.85 }), popup: POPUP.comunidades },
  campesinas: { kind: 'point', label: 'Comunidades campesinas', group: 'Territorios y pueblos', file: 'comunidades-campesinas.geojson', cluster: true,
    style: () => ({ radius: 4, color: '#fff', weight: 0.5, fillColor: '#0d9488', fillOpacity: 0.85 }), popup: POPUP.campesinas },
  unidades: { kind: 'point', label: 'Unidades mineras (MINEM)', group: 'Hidrocarburos y minería', file: 'unidades-mineras.geojson', cluster: true,
    style: (f) => ({ radius: 6, color: '#fff', weight: 1.2, fillColor: f?.properties?.tipo === 'En producción' ? '#92400e' : '#fbbf24', fillOpacity: 0.9 }), popup: POPUP.unidades },
  relaves: { kind: 'point', label: 'Depósitos de relaves (OEFA)', group: 'Hidrocarburos y minería', file: 'relaves-oefa-puntos.geojson', cluster: false,
    style: () => ({ radius: 6, color: '#fff', weight: 1.5, fillColor: '#b45309', fillOpacity: 0.9 }), popup: POPUP.relaves },
  riesgo: { kind: 'point', label: 'Riesgo ambiental alto (OEFA)', group: 'Hidrocarburos y minería', file: 'riesgo-ambiental-oefa.geojson', cluster: false,
    style: (f) => ({ radius: f?.properties?.riesgo === 'Muy alto' ? 8 : 6, color: '#fff', weight: 1.5, fillColor: f?.properties?.riesgo === 'Muy alto' ? '#6d28d9' : '#a78bfa', fillOpacity: 0.9 }), popup: POPUP.riesgo },
  eventos: { kind: 'point', label: 'Eventos (derrames/minería)', group: 'Áreas y base', file: 'eventos.geojson', cluster: false,
    style: (f) => ({ radius: 9, color: '#fff', weight: 2, fillColor: f?.properties?.categoria === 'derrames' ? '#1f2937' : f?.properties?.categoria === 'mineria' ? '#b45309' : '#0e7490', fillOpacity: 0.9 }), popup: POPUP.eventos },
  departamentos: { kind: 'poly', label: 'Departamentos', group: 'Áreas y base', file: 'peru-departamentos.geojson',
    style: { color: '#334155', weight: 1, fill: false }, popup: () => '' },
}

const DEFAULT_ON: CapaId[] = ['anp', 'lotes', 'pueblos', 'reservas', 'unidades', 'mineria', 'relaves', 'riesgo', 'eventos']

const GROUPS = ['Territorios y pueblos', 'Hidrocarburos y minería', 'Áreas y base']

const LEYENDA: { c: string; t: string; sq?: boolean }[] = [
  { c: '#22c55e', t: 'Área protegida', sq: true },
  { c: '#9a3412', t: 'Lote (explotación)', sq: true },
  { c: '#f59e0b', t: 'Lote (exploración)', sq: true },
  { c: '#8b5cf6', t: 'Reserva territorial (PIACI)', sq: true },
  { c: '#7c3aed', t: 'Pueblo indígena' },
  { c: '#9333ea', t: 'Comunidad nativa' },
  { c: '#0d9488', t: 'Comunidad campesina' },
  { c: '#92400e', t: 'Mina en producción' },
  { c: '#fbbf24', t: 'Proyecto en exploración' },
  { c: '#dc2626', t: 'Minería ilegal', sq: true },
  { c: '#b45309', t: 'Depósito de relaves' },
  { c: '#a78bfa', t: 'Riesgo ambiental alto' },
]

export default function Mapa() {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<Partial<Record<CapaId, L.Layer>>>({})
  const rawRef = useRef<Partial<Record<CapaId, Geo>>>({})
  const deptsRef = useRef<any[]>([])
  const regionRef = useRef('')
  const [regiones, setRegiones] = useState<string[]>([])
  const [region, setRegion] = useState('')
  const [panelOpen, setPanelOpen] = useState(true)
  const [capas, setCapas] = useState<Record<CapaId, boolean>>(
    Object.fromEntries((Object.keys(LAYERS) as CapaId[]).map((id) => [id, DEFAULT_ON.includes(id)])) as Record<CapaId, boolean>,
  )

  // Predicado de filtro por región (para puntos)
  function keepFn() {
    const nom = regionRef.current
    const dept = nom ? deptsRef.current.find((f: any) => f.properties?.NOMBDEP === nom) : null
    return (f: any) => {
      if (!nom || !dept) return true
      const c = f.geometry?.coordinates
      return c ? inGeom(c[0], c[1], dept.geometry) : false
    }
  }

  function buildLayer(id: CapaId, gj: Geo): L.Layer {
    const def = LAYERS[id]
    if (def.kind === 'poly') {
      return L.geoJSON(gj as any, {
        style: def.style as any,
        onEachFeature: (f, l) => { const html = def.popup(f.properties ?? {}); if (html) l.bindPopup(html) },
      })
    }
    // puntos: cluster o layerGroup, con filtro por región
    const keep = keepFn()
    const grp: any = def.cluster
      ? (L as any).markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50, disableClusteringAtZoom: 11, spiderfyOnMaxZoom: true })
      : L.layerGroup()
    for (const f of gj.features ?? []) {
      if (!keep(f)) continue
      const c = f.geometry?.coordinates
      if (!c) continue
      const m = L.circleMarker([c[1], c[0]], def.style(f))
      const html = def.popup(f.properties ?? {})
      if (html) m.bindPopup(html)
      grp.addLayer(m)
    }
    return grp
  }

  // Carga perezosa: trae el geojson solo cuando se necesita
  async function ensureLayer(id: CapaId) {
    const map = mapRef.current
    if (!map) return
    if (!layersRef.current[id]) {
      let gj = rawRef.current[id]
      if (!gj) {
        const r = await fetch(`${base}data/${LAYERS[id].file}`)
        gj = await r.json()
        rawRef.current[id] = gj
      }
      layersRef.current[id] = buildLayer(id, gj!)
    }
    if (capas[id]) layersRef.current[id]!.addTo(map)
  }

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })
    const map = L.map(ref.current, { scrollWheelZoom: true, preferCanvas: true }).setView(PERU_CENTER, 5)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 18 }).addTo(map)

    // Departamentos: se carga siempre (para la lista de regiones), se muestra solo si está activo
    fetch(`${base}data/peru-departamentos.geojson`).then((r) => r.json()).then((gj) => {
      deptsRef.current = gj.features
      setRegiones(gj.features.map((f: any) => f.properties?.NOMBDEP).filter(Boolean).sort())
      rawRef.current.departamentos = gj
      const layer = buildLayer('departamentos', gj)
      ;(layer as L.GeoJSON).eachLayer((l: any) => { const n = l.feature?.properties?.NOMBDEP; if (n) l.bindTooltip(String(n), { sticky: true }) })
      layersRef.current.departamentos = layer
      if (capas.departamentos) layer.addTo(map)
    })

    // Carga inicial solo de las capas activas por defecto
    DEFAULT_ON.forEach((id) => { void ensureLayer(id) })
  }, [])

  // Toggle de capas (carga perezosa al activar)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ;(Object.keys(capas) as CapaId[]).forEach((id) => {
      if (capas[id]) {
        if (layersRef.current[id]) layersRef.current[id]!.addTo(map)
        else void ensureLayer(id)
      } else {
        const layer = layersRef.current[id]
        if (layer) map.removeLayer(layer)
      }
    })
  }, [capas])

  // Filtro por región: reconstruye SOLO las capas de puntos cargadas, ajusta zoom
  function aplicarRegion(nom: string) {
    setRegion(nom)
    regionRef.current = nom
    const map = mapRef.current
    if (!map) return
    ;(Object.keys(LAYERS) as CapaId[]).forEach((id) => {
      if (LAYERS[id].kind !== 'point') return
      const gj = rawRef.current[id]
      if (!gj) return
      const old = layersRef.current[id]; if (old) map.removeLayer(old)
      layersRef.current[id] = buildLayer(id, gj)
      if (capas[id]) layersRef.current[id]!.addTo(map)
    })
    const dept = nom ? deptsRef.current.find((f: any) => f.properties?.NOMBDEP === nom) : null
    if (nom && dept) {
      try { map.fitBounds(L.geoJSON(dept).getBounds(), { padding: [20, 20] }) } catch { /* noop */ }
    } else {
      map.setView(PERU_CENTER, 5)
    }
  }

  const activas = (Object.keys(capas) as CapaId[]).filter((id) => capas[id]).length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold">Mapa interactivo</h1>
        <p className="text-sm text-slate-500">
          Capas oficiales del SERNANP, OEFA, MINEM y Cultura. Filtra por región o explora todo el país.
          Coordenadas de eventos referenciales — ver <span className="font-medium">Acerca</span>.
        </p>
      </div>

      {/* Región */}
      <div className="flex items-center gap-2 flex-wrap bg-white border border-slate-200 rounded-lg px-3 py-2">
        <span className="text-sm font-medium">Región:</span>
        <select value={region} onChange={(e) => aplicarRegion(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="">Todo el Perú</option>
          {regiones.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {region && (
          <button onClick={() => aplicarRegion('')} className="text-sm bg-forest-dark text-white rounded-lg px-3 py-1.5 hover:bg-forest">✕ Ver todo</button>
        )}
        {region && <span className="text-xs text-slate-400">Puntos dentro de {region}</span>}
      </div>

      {/* Panel de capas (agrupado y plegable) */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <button onClick={() => setPanelOpen((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium">
          <span>Capas <span className="text-slate-400 font-normal">({activas} activas)</span></span>
          <span className={`text-slate-400 transition-transform ${panelOpen ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {panelOpen && (
          <div className="px-3 pb-3 grid sm:grid-cols-3 gap-x-4 gap-y-3 border-t border-slate-100 pt-3">
            {GROUPS.map((g) => (
              <div key={g}>
                <div className="text-[11px] uppercase font-semibold text-slate-400 mb-1">{g}</div>
                <div className="flex flex-col gap-1">
                  {(Object.keys(LAYERS) as CapaId[]).filter((id) => LAYERS[id].group === g).map((id) => (
                    <label key={id} className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input type="checkbox" checked={capas[id]} onChange={(e) => setCapas((s) => ({ ...s, [id]: e.target.checked }))} />
                      {LAYERS[id].label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div ref={ref} className="h-[72vh] w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm z-0" />

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600">
        {LEYENDA.map((l) => (
          <span key={l.t} className="flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 ${l.sq ? 'rounded' : 'rounded-full'}`} style={{ background: l.c }} /> {l.t}
          </span>
        ))}
      </div>
    </div>
  )
}
