# Fuentes y metodología — Observatorio Ambiental Peruano

Este documento registra el origen y el estado de cada dato del observatorio.
**Estados:** `verificado` (cifra oficial citada) · `estimado` (derivado de oficiales) · `referencial` (aproximado para visualización).

## Derrames petroleros

- **474 derrames (2000–2019)** en lotes amazónicos y el Oleoducto Norperuano. Causas: 65% corrosión/fallas operativas, 28% terceros. — Datos de OEFA y OSINERGMIN sistematizados por el Subgrupo sobre Derrames Petroleros de la **Coordinadora Nacional de Derechos Humanos** (2020).
  - https://earthrights.org/media_release/470-derrames-petroleros-amazonia-peruana-2000-2019/
  - https://es.mongabay.com/2020/08/informe-derrames-petroleo-amazonia-peruana/
- **229 procedimientos administrativos sancionadores (PAS)** de OEFA.
- **+2,000 sitios impactados/contaminados** en la Amazonía Norte.
- Eventos del mapa (Cuninico 2014, Chiriaco/Imaza 2016, Morona 2016, La Pampilla/Repsol 2022): documentados públicamente; **coordenadas aproximadas/referenciales** — reemplazar con registros georeferenciados oficiales de OEFA.

## Pasivos y depósitos de relaves (OEFA)

- **Capa oficial integrada (verificado):** `relaves-oefa-puntos.geojson` — 107 depósitos de relaves fiscalizados, con administrado (empresa), unidad fiscalizable, estado y área. Estados: 74 en operación, 18 inoperativos, 8 cerrados, 4 revegetados, 2 pasivo ambiental minero. Fuente: OEFA — PIFA, servidor ArcGIS:
  - `https://pifa.oefa.gob.pe/arcgis/rest/services/RIESGOS/SERV_RIESGO_HIDROM_RELAVES_WMS/MapServer/4` (layer "Depósitos de Relaves"). Puntos = centroide de cada polígono.
- **Nota:** la capa hosted "Emergencias Ambientales - Hidrocarburos" (services5.arcgis.com) figura como pública pero el servicio está huérfano (Invalid URL). Pendiente ubicar la capa de derrames vigente en PIFA (carpeta EMER_HIDRO no expone servicios públicos).

## Deforestación

- **2022: 146,575 ha · 2023: 132,216 ha · acumulado 2001–2023: 3,053,354 ha (4.3% de la cobertura amazónica).** — **Geobosques**, Programa Nacional de Conservación de Bosques (MINAM).
  - https://geobosques.minam.gob.pe/
  - https://www.infobae.com/peru/2024/03/21/peru-entre-los-paises-con-mayor-deforestacion-en-latinoamerica-perdio-mas-de-146-mil-hectareas-de-bosques-en-2022/
  - https://www.servindi.org/actualidad-informes/12/04/2024/2022-peru-perdio-mas-de-146-mil-ha-de-bosques-amazonicos
- **Ucayali, Loreto, Madre de Dios, San Martín, Huánuco y Junín = 86%** de la pérdida. La distribución por región en `deforestacion.json` es **estimada** (reemplazar con descarga oficial por departamento).

## Áreas Naturales Protegidas

- **76 ANP del SINANPE (25,684,523 ha)** + 25 ACR (3,245,188 ha) + 141 ACP (384,918 ha). — **SERNANP** (al 2021).
- **Capa oficial integrada (verificado):** `anp-sernanp.geojson` — 103 polígonos de ANP de administración nacional (definitivas), 25,372,083 ha de superficie legal, con nombre, categoría, categoría UICN y base legal. Descargado del servidor ArcGIS REST del SERNANP (2026-06-15):
  - `https://geoservicios.sernanp.gob.pe/arcgis/rest/services/servicios_ogc/peru_sernanp_0102/MapServer/0` (geometría generalizada a ~0.005°, outSR 4326).
- **Minería ilegal en ANP (verificado):** `mineria-ilegal-anp.geojson` — 179 sitios con descripción, tipo de actividad, ubicación y estado. Servidor ArcGIS REST SERNANP `servicios_ogc/peru_sernanp_0201/MapServer/1`.
  - https://www.gob.pe/sernanp · https://geo.sernanp.gob.pe/

## Capa geográfica base

- `peru-departamentos.geojson`: 24 departamentos (campo `NOMBDEP`). Reutilizado de un proyecto previo del autor; geometría simplificada.

## Pendientes / próximas integraciones

- [ ] Puntos oficiales de derrames OEFA (georeferenciados).
- [ ] Deforestación por departamento/distrito desde Geobosques.
- [ ] Cuencas hidrográficas (ANA) y ANP (SERNANP WFS).
- [ ] Concesiones mineras y pasivos (MINEM / INGEMMET).
- [ ] Calidad de agua/aire (ECA, SINIA).
- [ ] Cartografía de comunidades y pueblos indígenas.
