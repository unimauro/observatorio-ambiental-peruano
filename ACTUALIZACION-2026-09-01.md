# Actualización del Observatorio — 2026-09-01

**Sitios impactados por hidrocarburos en la Amazonía**

Integré el paquete *"Bases de datos - sitios impactados por hidrocarburos"* (PUINAMUDT + datos abiertos OEFA/MINEM) al observatorio. Son las cuencas del **Pastaza, Corrientes, Tigre y Marañón** (Loreto), zona de los lotes 1AB/192 y 8.

Live: https://unimauro.github.io/observatorio-ambiental-peruano/ → **Mapa**, grupo nuevo **"Amazonía: sitios impactados"**.

---

## Lo que se agregó (4 capas nuevas en el mapa)

| Capa | Qué es | Registros | Mapeados | Fuente |
|---|---|---|---|---|
| **Monitoreo indígena (PUINAMUDT)** | Impactos registrados por monitores indígenas, 2007–2025 | 994 | **567** con coordenada | PUINAMUDT (el StoryMap que pasaste) |
| **Monitoreo OEFA sitios impactados** | Puntos con muestreo de agua, suelo, sedimento y biota (ISIM 2022–2024) | ~4,000 muestras | **86 puntos únicos** | OEFA datos abiertos |
| **Pasivos hidrocarburos Amazonía** | Inventario oficial de pasivos (2015–2019) | 22 | 22 | MINEM / DGAAH |
| **Sitios con plan de rehabilitación** | Sitios con propuesta oficial y **costo estimado** (≈ S/ 669 millones en total) | 30 | 30 | MINEM / DGAAH |

**Detalle del monitoreo indígena** (lo que se ve al hacer clic en cada punto): tipo de impacto, federación, zona, lote, empresa, año, descripción, si hubo remediación y estado de validación. Los tipos más frecuentes: derrame antiguo (285), derrame nuevo (217), botadero (214), derrame de crudo (124). Federaciones: FECONACO, FEDIQUEP, OPIKAFPE, FECONACOR.

**Cada capa se puede descargar en CSV** desde el propio panel del mapa (botón `csv` al lado de cada capa), con `lon`/`lat` y todos los atributos — justo lo que pedía Kely para tener la data en base de datos y no andar buscando.

---

## Notas importantes (para no sobre-vender la cifra)

- **Monitoreo indígena:** de los 994 impactos, 567 tienen coordenada utilizable. Los otros 427 **no traen ubicación** en la base original (o venían con coordenadas rotas: lat/lon intercambiadas, grados metidos en columnas UTM, eastings incompletos). El resto de datos de esos 427 sí está en el Excel, solo que no se pueden poner en el mapa. Esto explica lo que estabas limpiando "desde anoche".
- **OEFA:** las descargas de datos abiertos vienen topadas a 1,000 filas por componente, así que los 86 puntos son una **muestra**, no el universo completo. Cuando saquen la descarga sin tope, se vuelve a correr el ETL y se actualiza solo.
- Todas las coordenadas se convirtieron de UTM WGS84 (zona 18S; 19S para el punto de Madre de Dios) a lat/lon. Verifiqué que todo cae dentro de Loreto/Amazonía.

---

## Bajo el capó (para retomar después)

- Fuentes originales versionadas: `etl/fuentes/hidrocarburos-amazonia/` (los 8 Excel + su diccionario).
- ETL nuevo: `etl/build_hidrocarburos_amazonia.py` — lee los Excel, limpia y convierte coordenadas, y escribe los GeoJSON + CSV a `public/data/`. Para regenerar:
  ```bash
  pip install openpyxl
  python etl/build_hidrocarburos_amazonia.py
  npm run build
  ```
- Resumen agregado en `public/data/hidrocarburos-amazonia.json` (lo consume el asistente del sitio, así que el bot ya sabe responder sobre estos datos).
- Documentación de fuentes actualizada en `research/fuentes.md`.

---

## Pendientes del chat (lo que sigue en cola)

- [ ] **UNDP — Estudio técnico del Lote 8 (base SIG):** revisar si trae shapefiles/coordenadas para una capa propia. (link que pasó Kely)
- [ ] **Concesiones (geoportal CooperAcción):** mapear concesiones mineras/forestales — sigue en baja prioridad en el backlog.
- [ ] **Bibliografía de Kely (ResearchGate):** subir a la Biblioteca los docs de valoración económica y economía feminista de la zona. Pendiente definir cuáles y bajar los PDFs.
- [ ] **Mapas ArcGIS instant (2 appids que pasó Kely):** son otro tipo de visor; la data de fondo es la misma que ya integramos con este paquete. Si nos comparten sus capas/puntos exactos, se mapean directo.
- [ ] **Incendios NASA FIRMS** — seguía como la siguiente fase votada (del backlog anterior).

---

*Generado como parte de la sesión de integración del 2026-09-01. Compila OK (`npm run build`). Falta commit + push para que salga en vivo.*
