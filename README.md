# 🌎 Observatorio Ambiental Peruano

> **Datos abiertos para comprender el territorio y proteger el futuro.**

Plataforma abierta que **centraliza, visualiza y democratiza** el acceso a información
ambiental del Perú mediante datos abiertos, mapas interactivos e inteligencia artificial.

🔗 **Demo:** https://unimauro.github.io/observatorio-ambiental-peruano/

---

## Ejes temáticos

🌳 Bosques y deforestación · 🛢️ Derrames petroleros · ⛏️ Minería y pasivos ·
💧 Agua y cuencas · 🌎 Cambio climático · 🔥 Incendios forestales ·
🏞️ Áreas naturales protegidas · 👥 Pueblos indígenas · 📊 Indicadores socioeconómicos

## Hoja de ruta

| Fase | Alcance |
|------|---------|
| **1 — Observatorio** *(desplegado)* | Mapa nacional, derrames, deforestación, ANP, dashboard de indicadores |
| **1.5 — Consolidación de datos** | Reemplazar capas estimadas/referenciales por descargas oficiales georeferenciadas |
| **2 — Investigación** | ETL reproducible, biblioteca ampliada, línea de tiempo 1970–hoy, estadísticas regionales |
| **3 — IA Ambiental** | Chat con documentos (RAG), reportes automáticos, detección de patrones y alertas |

Detalle completo en [`ROADMAP.md`](ROADMAP.md).

## Stack

- **Vite + React 19 + TypeScript**
- **TailwindCSS** (UI institucional)
- **Leaflet + OpenStreetMap** (mapas)
- **Recharts** (visualizaciones)
- **GitHub Pages + GitHub Actions** (despliegue automático)

100% estático: los datos se sirven como JSON / GeoJSON desde `public/data/`.

## Estructura

```
public/data/        Datasets (JSON / GeoJSON) servidos estáticamente
  indicadores.json    KPIs nacionales con fuente y estado
  categorias.json     Ejes temáticos
  deforestacion.json  Serie anual + por región (Geobosques)
  eventos.geojson     Eventos georeferenciados (derrames, minería)
  documentos.json     Biblioteca documental
  peru-departamentos.geojson  Capa base (24 departamentos)
src/
  pages/            Dashboard · Mapa · Biblioteca · Acerca
  components/       Layout, Estado (badge de calidad de dato)
  lib/data.ts       Carga de datasets + tipos
research/fuentes.md  Origen y metodología de cada dato
```

## Calidad del dato (anti-sobre-afirmación)

Cada cifra y punto declara su **estado**:
`verificado` (oficial citado) · `estimado` (derivado de oficiales) · `referencial` (aproximado para visualización).
Las coordenadas de eventos son aproximadas y se reemplazarán con los registros
georeferenciados oficiales de OEFA. Ver [`research/fuentes.md`](research/fuentes.md).

## Fuentes oficiales

OEFA · MINAM · Geobosques · SINIA · ANA · SERNANP · INEI · OSINERGMIN · Plataforma Nacional de Datos Abiertos.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/
npm run preview
```

El despliegue a GitHub Pages es automático en cada push a `main`
(`.github/workflows/deploy.yml`).

## Cómo contribuir datos

1. Agrega o corrige entradas en `public/data/*.json` declarando `fuente` y `estado`.
2. Para nuevas capas geográficas, usa GeoJSON en WGS84 (EPSG:4326).
3. Documenta el origen en `research/fuentes.md`.

## Licencia

Datos: fuentes oficiales citadas. Código: MIT.
