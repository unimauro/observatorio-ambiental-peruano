import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { loadJSON } from '../lib/data'
import type { Categoria } from '../lib/data'

const base = import.meta.env.BASE_URL

// Arregla los iconos por defecto de Leaflet bajo un base path de Pages.
const iconUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png'
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png'
const shadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'

interface Capas {
  eventos: boolean
  departamentos: boolean
}

export default function Mapa() {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<{ eventos?: L.LayerGroup; departamentos?: L.GeoJSON }>({})
  const [cats, setCats] = useState<Record<string, Categoria>>({})
  const [capas, setCapas] = useState<Capas>({ eventos: true, departamentos: true })

  useEffect(() => {
    loadJSON<Categoria[]>('categorias.json').then((cs) =>
      setCats(Object.fromEntries(cs.map((c) => [c.id, c]))),
    )
  }, [])

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    const map = L.map(ref.current, { scrollWheelZoom: true }).setView([-9.2, -75.0], 5)
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 18,
    }).addTo(map)

    // Capa departamentos
    fetch(`${base}data/peru-departamentos.geojson`)
      .then((r) => r.json())
      .then((gj) => {
        const layer = L.geoJSON(gj, {
          style: { color: '#15803d', weight: 1, fillColor: '#22c55e', fillOpacity: 0.06 },
          onEachFeature: (f, l) => {
            const nom = f.properties?.NOMBDEP
            if (nom) l.bindTooltip(String(nom), { sticky: true })
          },
        })
        layersRef.current.departamentos = layer
        layer.addTo(map)
      })

    // Capa eventos
    fetch(`${base}data/eventos.geojson`)
      .then((r) => r.json())
      .then((gj) => {
        const group = L.layerGroup()
        L.geoJSON(gj, {
          pointToLayer: (feat, latlng) => {
            const cat = feat.properties?.categoria
            const color =
              cat === 'derrames' ? '#1f2937' : cat === 'mineria' ? '#b45309' : '#0e7490'
            return L.circleMarker(latlng, {
              radius: 9,
              color: '#fff',
              weight: 2,
              fillColor: color,
              fillOpacity: 0.9,
            })
          },
          onEachFeature: (f, l) => {
            const p = f.properties ?? {}
            l.bindPopup(`
              <div style="min-width:220px">
                <strong>${p.nombre ?? ''}</strong><br/>
                <span style="color:#64748b;font-size:12px">${p.fecha ?? ''} · ${p.ubicacion ?? ''}</span>
                <p style="margin:6px 0;font-size:13px">${p.descripcion ?? ''}</p>
                <div style="font-size:12px"><b>Magnitud:</b> ${p.magnitud ?? 's/d'}</div>
                <div style="font-size:12px"><b>Responsable:</b> ${p.responsable ?? 's/d'}</div>
                <div style="font-size:11px;color:#94a3b8;margin-top:4px">Fuente: ${p.fuente ?? ''} · dato ${p.estado_dato ?? ''}</div>
              </div>`)
          },
        }).addTo(group)
        layersRef.current.eventos = group
        group.addTo(map)
      })

    L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })
  }, [])

  // Toggle de capas
  useEffect(() => {
    const map = mapRef.current
    const { eventos, departamentos } = layersRef.current
    if (!map) return
    if (eventos) capas.eventos ? eventos.addTo(map) : map.removeLayer(eventos)
    if (departamentos) capas.departamentos ? departamentos.addTo(map) : map.removeLayer(departamentos)
  }, [capas])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Mapa interactivo</h1>
          <p className="text-sm text-slate-500">
            Eventos ambientales georeferenciados. Coordenadas referenciales — ver{' '}
            <span className="font-medium">Acerca</span> para la metodología.
          </p>
        </div>
        <div className="flex gap-3 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={capas.eventos}
              onChange={(e) => setCapas((c) => ({ ...c, eventos: e.target.checked }))}
            />
            Eventos
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={capas.departamentos}
              onChange={(e) => setCapas((c) => ({ ...c, departamentos: e.target.checked }))}
            />
            Departamentos
          </label>
        </div>
      </div>

      <div
        ref={ref}
        className="h-[70vh] w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm z-0"
      />

      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        {Object.values(cats).map((c) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: c.color }} />
            {c.nombre}
          </span>
        ))}
      </div>
    </div>
  )
}
