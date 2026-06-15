import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { loadJSON, fmt } from '../lib/data'
import type { Categoria } from '../lib/data'

const base = import.meta.env.BASE_URL

const iconUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png'
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png'
const shadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'

type CapaId = 'eventos' | 'departamentos' | 'anp' | 'mineria'

const capasMeta: { id: CapaId; label: string }[] = [
  { id: 'anp', label: 'Áreas protegidas (SERNANP)' },
  { id: 'mineria', label: 'Minería ilegal en ANP' },
  { id: 'eventos', label: 'Eventos (derrames/minería)' },
  { id: 'departamentos', label: 'Departamentos' },
]

export default function Mapa() {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<Partial<Record<CapaId, L.Layer>>>({})
  const [cats, setCats] = useState<Record<string, Categoria>>({})
  const [capas, setCapas] = useState<Record<CapaId, boolean>>({
    anp: true,
    mineria: true,
    eventos: true,
    departamentos: false,
  })

  useEffect(() => {
    loadJSON<Categoria[]>('categorias.json').then((cs) =>
      setCats(Object.fromEntries(cs.map((c) => [c.id, c]))),
    )
  }, [])

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })
    const map = L.map(ref.current, { scrollWheelZoom: true }).setView([-9.6, -74.5], 5)
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 18,
    }).addTo(map)

    // Áreas Naturales Protegidas (oficial SERNANP)
    fetch(`${base}data/anp-sernanp.geojson`)
      .then((r) => r.json())
      .then((gj) => {
        const layer = L.geoJSON(gj, {
          style: { color: '#15803d', weight: 1, fillColor: '#22c55e', fillOpacity: 0.25 },
          onEachFeature: (f, l) => {
            const p = f.properties ?? {}
            l.bindPopup(`
              <div style="min-width:220px">
                <strong>${p.anp_nomb ?? ''}</strong><br/>
                <span style="color:#15803d;font-size:12px;font-weight:600">${p.anp_cate ?? ''}</span>
                <div style="font-size:12px;margin-top:4px"><b>Superficie legal:</b> ${p.anp_suleg ? fmt(Math.round(p.anp_suleg)) + ' ha' : 's/d'}</div>
                <div style="font-size:12px"><b>Categoría UICN:</b> ${p.anp_uicn ?? 's/d'}</div>
                <div style="font-size:12px"><b>Base legal:</b> ${p.anp_balec ?? 's/d'}</div>
                <div style="font-size:11px;color:#16a34a;margin-top:4px">Fuente: SERNANP (oficial)</div>
              </div>`)
          },
        })
        layersRef.current.anp = layer
        layer.addTo(map)
      })

    // Minería ilegal en ANP (oficial SERNANP)
    fetch(`${base}data/mineria-ilegal-anp.geojson`)
      .then((r) => r.json())
      .then((gj) => {
        const layer = L.geoJSON(gj, {
          style: { color: '#7f1d1d', weight: 1, fillColor: '#dc2626', fillOpacity: 0.55 },
          onEachFeature: (f, l) => {
            const p = f.properties ?? {}
            l.bindPopup(`
              <div style="min-width:220px">
                <strong style="color:#b91c1c">Minería ilegal — ${p.idtipact ?? ''}</strong>
                <p style="margin:6px 0;font-size:13px">${p.descrip ?? ''}</p>
                <div style="font-size:12px"><b>Ubicación:</b> ${p.ubiref ?? 's/d'}</div>
                <div style="font-size:12px"><b>Estado:</b> ${p.estado ?? 's/d'}</div>
                <div style="font-size:11px;color:#b91c1c;margin-top:4px">Fuente: SERNANP (oficial)</div>
              </div>`)
          },
        })
        layersRef.current.mineria = layer
        layer.addTo(map)
      })

    // Departamentos (capa base)
    fetch(`${base}data/peru-departamentos.geojson`)
      .then((r) => r.json())
      .then((gj) => {
        const layer = L.geoJSON(gj, {
          style: { color: '#334155', weight: 1, fill: false },
          onEachFeature: (f, l) => {
            const nom = f.properties?.NOMBDEP
            if (nom) l.bindTooltip(String(nom), { sticky: true })
          },
        })
        layersRef.current.departamentos = layer
      })

    // Eventos puntuales (derrames, minería)
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
              radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.9,
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
  }, [])

  // Toggle de capas
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ;(Object.keys(capas) as CapaId[]).forEach((id) => {
      const layer = layersRef.current[id]
      if (!layer) return
      if (capas[id]) layer.addTo(map)
      else map.removeLayer(layer)
    })
  }, [capas])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Mapa interactivo</h1>
          <p className="text-sm text-slate-500">
            Capas oficiales del SERNANP (áreas protegidas y minería ilegal) y eventos
            documentados. Coordenadas de eventos referenciales — ver <span className="font-medium">Acerca</span>.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2">
          {capasMeta.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={capas[c.id]}
                onChange={(e) => setCapas((s) => ({ ...s, [c.id]: e.target.checked }))}
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <div
        ref={ref}
        className="h-[72vh] w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm z-0"
      />

      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded" style={{ background: '#22c55e' }} /> Área protegida</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded" style={{ background: '#dc2626' }} /> Minería ilegal en ANP</span>
        {Object.values(cats).filter((c) => ['derrames', 'mineria'].includes(c.id)).map((c) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: c.color }} /> {c.nombre}
          </span>
        ))}
      </div>
    </div>
  )
}
