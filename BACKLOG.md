# Backlog — Observatorio Ambiental Peruano

Punto de retomada rápido. Estado al **2026-09-01**. Live: https://unimauro.github.io/observatorio-ambiental-peruano/

## ✅ Hecho (sesión Amazonía — sitios impactados, 2026-09-01)

- 4 capas nuevas desde el paquete de aliados "Bases de datos - sitios impactados por hidrocarburos" (grupo **"Amazonía: sitios impactados"** en el mapa, ver detalle en [`ACTUALIZACION-2026-09-01.md`](ACTUALIZACION-2026-09-01.md)):
  - **`monitoreo-indigena`** (PUINAMUDT) — 994 impactos, 567 mapeados. **Es la data del StoryMap que pedía Kely.** Activa por defecto.
  - **`oefa-isim-amazonia`** — 86 puntos únicos de monitoreo OEFA (agua/suelo/sedimento/biota).
  - **`pash-amazonia`** — 22 pasivos hidrocarburos Amazonía (MINEM).
  - **`planes-rehabilitacion-amazonia`** — 30 sitios con costo de rehabilitación (MINEM, ≈ S/ 669 M).
- ETL nuevo `etl/build_hidrocarburos_amazonia.py` (parte de Excel locales, convierte UTM→lat/lon, limpia coords sucias, fusiona `_manifest.json`). Requiere `openpyxl`.
- Fuentes originales versionadas en `etl/fuentes/hidrocarburos-amazonia/`. Doc en `research/fuentes.md`. Contexto del asistente actualizado. `npm run build` OK.

## ✅ Hecho (sesión derrames + refresco)

- Capa **pasivos de hidrocarburos** (OEFA, nacional) — 3,266 puntos.
- Capa **suelos empetrolados del Lote X / Talara** (OEFA) — 3,233 locaciones.
- Capa **traza del Oleoducto Norperuano** (Petroperú vía GISEM) — desde 803 progresivas.
- `derrames.json` — KPIs agregados que consumen Dashboard, Temas y el bot.
- Grupo de capas **"Derrames y pasivos"** en el mapa (panel a 4 columnas).
- Sección **"La huella de los derrames"** en el Dashboard + 6 gráficos nuevos en Temas.
- **Exportación CSV** de las 16 capas + `derrames-resumen.csv`, con enlaces de descarga en la UI.
- **Catálogo de endpoints** oficiales en `research/endpoints.json` (los que sirven y los caídos).
- **Refresco 2026-08-05:** ETL corrido local (salta el 403 de OEFA). Relaves 107 → 206.

## 🔜 Pendiente / próximo

- [ ] **Incendios NASA FIRMS** — siguiente fase votada. Puntos de calor (VIIRS/MODIS) por región y fecha; capa + KPI + eje "incendios" (hoy está `en-integracion`).
- [ ] **Eventos de derrame con fecha/volumen/responsable** — NO hay capa pública (ver `research/endpoints.json`). Camino: sistematizar informes/PAS del OEFA o la base CNDDHH 2000–2019.
- [ ] **Deforestación por departamento/distrito** desde Geobosques (hoy solo total nacional, `porRegion2023` es estimado).
- [ ] **Capas candidatas del OEFA** ya identificadas en `endpoints.json`: REINFO (minería ilegal área), áreas degradadas por residuos sólidos, conflictos socioambientales, monitoreo mensual de playas post-Pampilla.
- [ ] **Analytics GA4 por sección** (SPA con hash routing solo cuenta la primera carga) — propuesto, sin hacer.
- [ ] Concesiones forestales (2,922) / energía GISEM — opcional, baja prioridad.
- [ ] `apoyo.json` — Carlos debe dar Yape/Plin/PayPal reales y poner `activo:true`.

## ⚠️ Recordatorios de operación

- **El cron semanal NO refresca las 4 capas OEFA** (PIFA da 403 a IPs de datacenter). Hay que correr `python etl/build_data.py` **local** (IP residencial) cada cierto tiempo para actualizar relaves, riesgo, pasivos y suelos.
- Al pushear: el bot ETL puede haber commiteado antes → `git pull --rebase` primero.
- No levantar servidores en local para probar; el deploy y la verificación van por GitHub Actions / en vivo.

## Cómo retomar

```bash
cd ~/Documents/Repos/observatorio-ambiental-peruano
git pull --rebase origin main
python etl/build_data.py        # refresca datos (correr local por el 403 de OEFA)
npm run build                   # verifica que compila
git add -A && git commit && git push   # deploy automático a Pages
```
