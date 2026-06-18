import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { loadJSON, fmt } from '../lib/data'
import type { Categoria } from '../lib/data'

const base = import.meta.env.BASE_URL

const iconUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png'
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png'
const shadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'

type CapaId = 'eventos' | 'departamentos' | 'anp' | 'mineria' | 'relaves' | 'riesgo'
type Geo = { type: string; features: any[] }

const capasMeta: { id: CapaId; label: string }[] = [
  { id: 'anp', label: 'Áreas protegidas (SERNANP)' },
  { id: 'mineria', label: 'Minería ilegal en ANP' },
  { id: 'relaves', label: 'Depósitos de relaves (OEFA)' },
  { id: 'riesgo', label: 'Riesgo ambiental alto (OEFA)' },
  { id: 'eventos', label: 'Eventos (derrames/minería)' },
  { id: 'departamentos', label: 'Departamentos' },
]

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

export default function Mapa() {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<Partial<Record<CapaId, L.Layer>>>({})
  const rawRef = useRef<Partial<Record<'relaves' | 'riesgo' | 'eventos', Geo>>>({})
  const deptsRef = useRef<any[]>([])
  const [cats, setCats] = useState<Record<string, Categoria>>({})
  const [regiones, setRegiones] = useState<string[]>([])
  const [region, setRegion] = useState('')
  const [capas, setCapas] = useState<Record<CapaId, boolean>>({
    anp: true, mineria: true, relaves: true, riesgo: true, eventos: true, departamentos: false,
  })

  useEffect(() => {
    loadJSON<Categoria[]>('categorias.json').then((cs) =>
      setCats(Object.fromEntries(cs.map((c) => [c.id, c]))),
    )
  }, [])

  // --- Builders de capas de puntos (con predicado de filtro) -----------------
  function buildRelaves(gj: Geo, keep: (f: any) => boolean) {
    const g = L.layerGroup()
    L.geoJSON(gj as any, {
      filter: keep,
      pointToLayer: (_f, ll) => L.circleMarker(ll, { radius: 6, color: '#fff', weight: 1.5, fillColor: '#b45309', fillOpacity: 0.9 }),
      onEachFeature: (f, l) => {
        const p = f.properties ?? {}
        l.bindPopup(`<div style="min-width:220px"><strong style="color:#b45309">Depósito de relaves</strong>
          <div style="font-size:12px;margin-top:4px"><b>Administrado:</b> ${p.administrado ?? 's/d'}</div>
          <div style="font-size:12px"><b>Unidad fiscalizable:</b> ${p.unidad ?? 's/d'}</div>
          <div style="font-size:12px"><b>Estado:</b> ${p.estado_dr ?? 's/d'}</div>
          <div style="font-size:12px"><b>Área:</b> ${p.area_m2 ? fmt(p.area_m2) + ' m²' : 's/d'}</div>
          <div style="font-size:11px;color:#b45309;margin-top:4px">Fuente: OEFA · PIFA (oficial)</div></div>`)
      },
    }).addTo(g)
    return g
  }
  function buildRiesgo(gj: Geo, keep: (f: any) => boolean) {
    const g = L.layerGroup()
    L.geoJSON(gj as any, {
      filter: keep,
      pointToLayer: (feat, ll) => {
        const muyAlto = feat.properties?.riesgo === 'Muy alto'
        return L.circleMarker(ll, { radius: muyAlto ? 8 : 6, color: '#fff', weight: 1.5, fillColor: muyAlto ? '#6d28d9' : '#a78bfa', fillOpacity: 0.9 })
      },
      onEachFeature: (f, l) => {
        const p = f.properties ?? {}
        const flag = (v?: string) => (v && v !== '0' && v !== 'Sin pasivo' && v !== 'Sin conflicto')
        const extras = [flag(p.pasivo_minero) ? 'pasivo minero' : '', flag(p.pasivo_hidrocarburo) ? 'pasivo hidrocarburo' : '', flag(p.conflicto_socioamb) ? 'conflicto socioambiental' : ''].filter(Boolean).join(' · ')
        l.bindPopup(`<div style="min-width:230px"><strong style="color:#6d28d9">Riesgo ambiental: ${p.riesgo ?? ''}</strong>
          <div style="font-size:12px;margin-top:4px"><b>Administrado:</b> ${p.administrado ?? 's/d'}</div>
          <div style="font-size:12px"><b>Unidad fiscalizable:</b> ${p.unidad ?? 's/d'}</div>
          <div style="font-size:12px"><b>Subsector:</b> ${p.subsector ?? 's/d'}</div>
          <div style="font-size:12px"><b>Peligro:</b> ${p.peligro ?? 's/d'} · <b>Vulnerabilidad:</b> ${p.vulnerabilidad ?? 's/d'}</div>
          ${extras ? `<div style="font-size:12px;color:#b91c1c;margin-top:3px">⚠ ${extras}</div>` : ''}
          <div style="font-size:11px;color:#6d28d9;margin-top:4px">Fuente: OEFA · PIFA (oficial)</div></div>`)
      },
    }).addTo(g)
    return g
  }
  function buildEventos(gj: Geo, keep: (f: any) => boolean) {
    const g = L.layerGroup()
    L.geoJSON(gj as any, {
      filter: keep,
      pointToLayer: (feat, ll) => {
        const cat = feat.properties?.categoria
        const color = cat === 'derrames' ? '#1f2937' : cat === 'mineria' ? '#b45309' : '#0e7490'
        return L.circleMarker(ll, { radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.9 })
      },
      onEachFeature: (f, l) => {
        const p = f.properties ?? {}
        l.bindPopup(`<div style="min-width:220px"><strong>${p.nombre ?? ''}</strong><br/>
          <span style="color:#64748b;font-size:12px">${p.fecha ?? ''} · ${p.ubicacion ?? ''}</span>
          <p style="margin:6px 0;font-size:13px">${p.descripcion ?? ''}</p>
          <div style="font-size:12px"><b>Magnitud:</b> ${p.magnitud ?? 's/d'}</div>
          <div style="font-size:12px"><b>Responsable:</b> ${p.responsable ?? 's/d'}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px">Fuente: ${p.fuente ?? ''} · dato ${p.estado_dato ?? ''}</div></div>`)
      },
    }).addTo(g)
    return g
  }

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })
    const map = L.map(ref.current, { scrollWheelZoom: true }).setView(PERU_CENTER, 5)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 18 }).addTo(map)

    fetch(`${base}data/anp-sernanp.geojson`).then((r) => r.json()).then((gj) => {
      const layer = L.geoJSON(gj, {
        style: { color: '#15803d', weight: 1, fillColor: '#22c55e', fillOpacity: 0.25 },
        onEachFeature: (f, l) => {
          const p = f.properties ?? {}
          l.bindPopup(`<div style="min-width:220px"><strong>${p.anp_nomb ?? ''}</strong><br/>
            <span style="color:#15803d;font-size:12px;font-weight:600">${p.anp_cate ?? ''}</span>
            <div style="font-size:12px;margin-top:4px"><b>Superficie legal:</b> ${p.anp_suleg ? fmt(Math.round(p.anp_suleg)) + ' ha' : 's/d'}</div>
            <div style="font-size:12px"><b>Categoría UICN:</b> ${p.anp_uicn ?? 's/d'}</div>
            <div style="font-size:11px;color:#16a34a;margin-top:4px">Fuente: SERNANP (oficial)</div></div>`)
        },
      })
      layersRef.current.anp = layer; if (capas.anp) layer.addTo(map)
    })

    fetch(`${base}data/mineria-ilegal-anp.geojson`).then((r) => r.json()).then((gj) => {
      const layer = L.geoJSON(gj, {
        style: { color: '#7f1d1d', weight: 1, fillColor: '#dc2626', fillOpacity: 0.55 },
        onEachFeature: (f, l) => {
          const p = f.properties ?? {}
          l.bindPopup(`<div style="min-width:220px"><strong style="color:#b91c1c">Minería ilegal — ${p.idtipact ?? ''}</strong>
            <p style="margin:6px 0;font-size:13px">${p.descrip ?? ''}</p>
            <div style="font-size:12px"><b>Ubicación:</b> ${p.ubiref ?? 's/d'}</div>
            <div style="font-size:11px;color:#b91c1c;margin-top:4px">Fuente: SERNANP (oficial)</div></div>`)
        },
      })
      layersRef.current.mineria = layer; if (capas.mineria) layer.addTo(map)
    })

    fetch(`${base}data/relaves-oefa-puntos.geojson`).then((r) => r.json()).then((gj) => {
      rawRef.current.relaves = gj
      const g = buildRelaves(gj, () => true); layersRef.current.relaves = g; if (capas.relaves) g.addTo(map)
    })
    fetch(`${base}data/riesgo-ambiental-oefa.geojson`).then((r) => r.json()).then((gj) => {
      rawRef.current.riesgo = gj
      const g = buildRiesgo(gj, () => true); layersRef.current.riesgo = g; if (capas.riesgo) g.addTo(map)
    })
    fetch(`${base}data/eventos.geojson`).then((r) => r.json()).then((gj) => {
      rawRef.current.eventos = gj
      const g = buildEventos(gj, () => true); layersRef.current.eventos = g; if (capas.eventos) g.addTo(map)
    })

    fetch(`${base}data/peru-departamentos.geojson`).then((r) => r.json()).then((gj) => {
      deptsRef.current = gj.features
      setRegiones(gj.features.map((f: any) => f.properties?.NOMBDEP).filter(Boolean).sort())
      const layer = L.geoJSON(gj, {
        style: { color: '#334155', weight: 1, fill: false },
        onEachFeature: (f, l) => { const n = f.properties?.NOMBDEP; if (n) l.bindTooltip(String(n), { sticky: true }) },
      })
      layersRef.current.departamentos = layer; if (capas.departamentos) layer.addTo(map)
    })
  }, [])

  // Toggle de capas
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ;(Object.keys(capas) as CapaId[]).forEach((id) => {
      const layer = layersRef.current[id]
      if (!layer) return
      if (capas[id]) layer.addTo(map); else map.removeLayer(layer)
    })
  }, [capas])

  // Filtro por región: reconstruye puntos y ajusta el zoom
  function aplicarRegion(nom: string) {
    setRegion(nom)
    const map = mapRef.current
    if (!map) return
    const dept = deptsRef.current.find((f: any) => f.properties?.NOMBDEP === nom)
    const keep = (f: any) => {
      if (!nom || !dept) return true
      const c = f.geometry?.coordinates
      return c ? inGeom(c[0], c[1], dept.geometry) : false
    }
    const rebuild = (id: 'relaves' | 'riesgo' | 'eventos', builder: (gj: Geo, k: (f: any) => boolean) => L.Layer) => {
      const gj = rawRef.current[id]; if (!gj) return
      const old = layersRef.current[id]; if (old) map.removeLayer(old)
      const g = builder(gj, keep); layersRef.current[id] = g; if (capas[id]) g.addTo(map)
    }
    rebuild('relaves', buildRelaves); rebuild('riesgo', buildRiesgo); rebuild('eventos', buildEventos)
    if (nom && dept) {
      try { map.fitBounds(L.geoJSON(dept).getBounds(), { padding: [20, 20] }) } catch { /* noop */ }
    } else {
      map.setView(PERU_CENTER, 5)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold">Mapa interactivo</h1>
        <p className="text-sm text-slate-500">
          Capas oficiales del SERNANP y OEFA. Filtra por región o explora todo el país.
          Coordenadas de eventos referenciales — ver <span className="font-medium">Acerca</span>.
        </p>
      </div>

      {/* Controles: región + capas */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap bg-white border border-slate-200 rounded-lg px-3 py-2">
          <span className="text-sm font-medium">Región:</span>
          <select
            value={region}
            onChange={(e) => aplicarRegion(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
          >
            <option value="">Todo el Perú</option>
            {regiones.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {region && (
            <button onClick={() => aplicarRegion('')} className="text-sm bg-forest-dark text-white rounded-lg px-3 py-1.5 hover:bg-forest">
              ✕ Ver todo
            </button>
          )}
          {region && <span className="text-xs text-slate-400">Mostrando puntos dentro de {region}</span>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2">
          {capasMeta.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={capas[c.id]} onChange={(e) => setCapas((s) => ({ ...s, [c.id]: e.target.checked }))} />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <div ref={ref} className="h-[72vh] w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm z-0" />

      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded" style={{ background: '#22c55e' }} /> Área protegida</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded" style={{ background: '#dc2626' }} /> Minería ilegal en ANP</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: '#b45309' }} /> Depósito de relaves (OEFA)</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: '#a78bfa' }} /> Riesgo ambiental alto (OEFA)</span>
        {Object.values(cats).filter((c) => ['derrames', 'mineria'].includes(c.id)).map((c) => (
          <span key={c.id} className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: c.color }} /> {c.nombre}</span>
        ))}
      </div>
    </div>
  )
}
