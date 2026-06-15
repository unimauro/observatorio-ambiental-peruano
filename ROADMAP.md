# 🗺️ Roadmap — Observatorio Ambiental Peruano

> Visión: **centralizar, visualizar y democratizar** el acceso a información ambiental
> del Perú mediante datos abiertos, mapas interactivos e inteligencia artificial.

**Estado actual:** ✅ Fase 1 desplegada — https://unimauro.github.io/observatorio-ambiental-peruano/

**Principio rector (anti-sobre-afirmación):** todo dato declara su `estado`
(`verificado` / `estimado` / `referencial`). No publicamos cifras sin fuente ni
coordenadas inventadas como si fueran oficiales.

**Leyenda:** ✅ hecho · 🔜 siguiente · 🧭 planificado · 💡 idea

---

## ✅ Fase 1 — Observatorio (MVP) — *desplegado*

Base navegable con datos oficiales sembrados y procedencia marcada.

- ✅ Scaffold Vite + React 19 + TS + Tailwind + Leaflet + Recharts
- ✅ Dashboard de indicadores nacionales (KPIs con fuente y estado)
- ✅ Mapa interactivo (capas activables: eventos / departamentos)
- ✅ Serie de deforestación (Geobosques/MINAM)
- ✅ Biblioteca documental con búsqueda + filtro
- ✅ Página "Acerca" con hoja de ruta y fuentes oficiales
- ✅ Capa base GeoJSON (24 departamentos)
- ✅ Despliegue automático a GitHub Pages (GitHub Actions)
- ✅ `research/fuentes.md` con metodología y estado por dato

---

## 🔜 Fase 1.5 — Consolidación de datos reales

> Objetivo: reemplazar lo `estimado`/`referencial` por capas oficiales georeferenciadas.
> Es el paso de mayor valor inmediato: convierte el demo en una fuente confiable.

### Capas geográficas oficiales
- 🔜 **Derrames OEFA georeferenciados** — puntos oficiales con fecha, lote, operador, volumen, estado del PAS.
- 🔜 **Deforestación por departamento/distrito** — descarga Geobosques (no solo el total nacional).
- 🧭 **ANP desde SERNANP** — polígonos vía WFS `geo.sernanp.gob.pe` (ANP nacionales, ACR, ACP + zonas de amortiguamiento).
- 🧭 **Cuencas hidrográficas (ANA)** — capa hídrica + estaciones de calidad de agua.
- 🧭 **Concesiones mineras y pasivos** — MINEM / INGEMMET (catastro minero).
- 🧭 **Calidad de agua y aire (ECA)** — SINIA / estaciones de monitoreo.
- 💡 **Cartografía de pueblos indígenas / comunidades** — BDPI (Ministerio de Cultura).

### Monitoreo continuo de fuentes (objetivo: rastrear "todo")
> Centralizar toda la información ambiental relevante del Perú y del mundo. Catálogo completo en la app (Acerca → "Fuentes que monitoreamos") y en `public/data/fuentes-monitoreo.json`.
- 🔜 **Fiscalización y regulación (Perú):** OEFA (derrames, PAS, SINADA), OSINERGMIN, ANA, SERNANP, SERFOR, SENACE, INGEMMET, SENAMHI.
- 🧭 **Ministerios y Estado:** MINAM (SINIA, Geobosques, Geoservidor), MINEM, MIDAGRI, MINCUL-BDPI, Defensoría del Pueblo, INEI, Datos Abiertos.
- 🧭 **Organizaciones ambientales y sociedad civil:** SPDA, DAR, CooperAcción, IBC, EarthRights, CNDDHH, MAAP, Mongabay.
- 🧭 **Organismos internacionales y datasets globales:** Global Forest Watch, RAISG, NASA FIRMS, PNUMA/UNEP, FAO, Banco Mundial, UICN, WWF.
- 💡 Rastreo automatizado (scrapers/APIs + cron) con marca de fecha y estado por fuente.

### Calidad y confianza
- 🔜 Mejorar geometría de la capa base (límites distritales: ya existe `distritos.geojson`, 1,834 distritos).
- 🧭 Validación cruzada de cada cifra con su fuente primaria (no solo prensa).
- 🧭 Página de "changelog de datos" (qué se actualizó y cuándo).

**Hecho cuando:** ≥ 3 capas provienen de descargas oficiales directas y los badges
`referencial` del mapa de derrames pasan a `verificado`.

---

## 🧭 Fase 2 — Investigación

> Profundidad histórica y analítica. Convierte el observatorio en herramienta de consulta.

### ETL reproducible
- ✅ Pipeline Python (`etl/build_data.py`, solo stdlib) que descarga capas oficiales de SERNANP y OEFA → `public/data/*.geojson` + `_manifest.json` con fecha y conteo.
- ✅ GitHub Action programada (cron semanal, `update-data.yml`) que refresca los datos y commitea cambios automáticamente.
- 🧭 Sumar al ETL: ecorregiones (SERNANP), conflictos socioambientales y derrames (OEFA), deforestación por depto (Geobosques), catastro minero (MINEM/INGEMMET).

### Análisis y narrativa
- 🧭 **Línea de tiempo histórica 1970 → hoy** (navegable, filtrable por eje).
- 🧭 **Fichas por región/departamento** con indicadores comparables.
- 🧭 **Estadísticas cruzadas:** deforestación × minería × pobreza × pueblos indígenas.
- 🧭 Biblioteca documental ampliada (informes OEFA, Defensoría, tesis, sentencias, papers).
- 💡 Indicadores socioeconómicos asociados (INEI: pobreza, IDH, pesca, agricultura).

### Producto
- 🧭 Descarga de datos (CSV/GeoJSON) por capa — "datos abiertos de verdad".
- 🧭 Compartir vistas con permalink (estado de capas + zoom en la URL).
- 💡 Modo comparación temporal (slider de años en el mapa).

**Hecho cuando:** el ETL corre solo por cron, hay línea de tiempo histórica y
cualquiera puede descargar los datasets.

---

## 🧭 Fase 3 — IA Ambiental

> El diferenciador. Convierte documentos y datos en respuestas y alertas.

- 🧭 **Chat con documentos (RAG)** sobre la biblioteca: *"¿Cuántos derrames afectaron pueblos kukama?"*, *"¿Qué empresa tiene más incidentes?"*, *"¿Cuánto costaría remediar Loreto?"*
- 🧭 **Generación de reportes** ejecutivos por región/eje a demanda.
- 🧭 **Detección de patrones** (clústeres de derrames, correlación deforestación–minería).
- 💡 **Alertas automáticas** de nuevos eventos (scraping OEFA / boletines).
- 💡 **Resúmenes ejecutivos** automáticos de informes largos (PDF → síntesis citada).

**Consideraciones:** la IA siempre cita la fuente y nunca afirma sin respaldo; las
respuestas marcan cuando un dato es estimado o incompleto.

**Hecho cuando:** un usuario sube/consulta un PDF y obtiene respuestas con citas verificables.

---

## 🔧 Transversal (técnico)

- 🔜 Bump de GitHub Actions a **Node 24** (Node 20 se deprecó el 16-jun-2026).
- 🧭 Imagen Open Graph propia (compartir en redes con tarjeta).
- 🧭 Tests básicos + CI de lint/build en PRs.
- 🧭 i18n (ES/EN) para cooperación internacional.
- 🧭 Accesibilidad (contraste, navegación por teclado, lectores de pantalla).
- 💡 Dominio propio (p. ej. `ambiental.pe` o subdominio).
- 💡 Analítica de uso (privacy-friendly).

---

## 🤝 Modelo de colaboración

- **Tecnología:** Carlos (arquitectura, datos, IA, despliegue).
- **Investigación / validación científica:** colega que valida fuentes y metodología.
- **Comunidad:** contribuciones de datos vía PR (cada dato declara `fuente` + `estado`).

---

## 📌 Próximos 3 pasos sugeridos

1. **Bajar el GeoJSON oficial de ANP (SERNANP WFS)** → primera capa 100% oficial en el mapa.
2. **Armar el ETL Python** para deforestación por departamento (Geobosques).
3. **Bump Actions a Node 24** (mantenimiento rápido, evita roturas futuras).
