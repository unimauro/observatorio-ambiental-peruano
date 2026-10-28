# Módulo "El Niño, lluvias y calor" (`#/nino`)

Reúne en una sola página el estado del Fenómeno El Niño y los avisos oficiales de lluvias,
activación de quebradas (huaycos), crecidas de ríos y calor en el Perú, con pronóstico a 7 días
y la perspectiva estacional del SENAMHI. Construido el 28-oct-2026 al inicio de la temporada de
lluvias 2026–27, con El Niño costero en condición extraordinaria.

## 1. Qué hay en la página

| Bloque | Contenido | Fuente | Clase |
|---|---|---|---|
| Semáforo | Proxy del ICEN y categoría ENFEN; anomalía semanal Niño 1+2 y 3.4; número de alertas | NOAA CPC · cálculo propio | calculado / verificado |
| Comunicado ENFEN | Título, fecha y PDF del último comunicado oficial | enfen.imarpe.gob.pe | oficial (solo enlace) |
| Alertas | Lista ordenable por nivel 1–4 y tipo (El Niño, lluvias, huaycos, ríos, calor); cada una marca su **origen**: `oficial`, `modelo`, `calculado` | varias | ver §4 |
| Mapa | Capas WMS del SENAMHI (quebradas, SILVIA, SONICS, aviso meteorológico, lluvia 24 h, pronóstico verano) + puntos propios (centros poblados nivel 3–4, avisos hidrológicos, estaciones sobre umbral, crecidas SONICS, ciudades) | SENAMHI IDESEP · Open-Meteo | oficial / modelo |
| Pronóstico 7 días | Tabla 30 ciudades × 7 días, lluvia o Tmáx, con color | Open-Meteo | modelo |
| Huaycos | KPIs de centros poblados, población y viviendas en zonas con aviso; distritos nivel 4; infraestructura expuesta; SILVIA 3 días | SENAMHI | oficial |
| Ríos | SONICS 7 días; avisos hidrológicos; caudal GloFAS en 18 ríos con ratio pico/media 30 d | SENAMHI · Open-Meteo | oficial / modelo |
| Temperatura del mar | Anomalía semanal 104 semanas; proxy del ICEN desde 1982 con umbrales; episodios ≥ 1,7 °C; mensual 1982– | NOAA | verificado / calculado |
| Estacional | Probabilidades inferior/normal/superior por sector climático: verano, trimestre, mes (lluvia, Tmáx) | SENAMHI | oficial |

## 2. Fuentes y endpoints (verificados 28-oct-2026)

| id | Endpoint | Notas |
|---|---|---|
| `NOAA_MENSUAL` | `https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices` | Mensual desde 1982, OISST v2.1, base 1991–2020 |
| `NOAA_SEMANAL` | `https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for` | Semanal desde 1990; números negativos vienen pegados (`24.6-0.4`) |
| `ENFEN` | `https://enfen.imarpe.gob.pe/comunicados/` | Scraping del bloque "ULTIMO COMUNICADO". gob.pe/enfen da 404 |
| `SENAMHI_*` | `https://idesep.senamhi.gob.pe/geoserver/wfs` (WFS 2.0, `outputFormat=application/json`) | **Lento** (20–100 s por capa pesada); usar `propertyName=` para omitir geometría. Capas: `g_aviso:view_aviso`(+`_aux`), `g_prono_pp_24h:view_aviso24h`, `g_dbphisis:aviso_hidro_pub`, `g_umbrales:umbrales_precipitacion`, `g_acti_quebrada:ccpp_filter` / `view_av_activ_qdra` / `eess_filter` / `iiee_filter` / `vial_*_filter`, `silvia:cuencas_nivel_12_prono{1,2,3}_silvia`, `dhi-seh-sonics:SONICS-CCPP-PRONOSTICO-01..07`, `spc:prono_verano_poligono`, `spc:prono_trim_poligono_pp1`, `spc:prono_mensual_poligono_{pp,tmax,tmin}1` |
| WMS | `https://idesep.senamhi.gob.pe/geoserver/wms` | El mapa pide las imágenes directamente al SENAMHI (sin pasar por el ETL) |
| `OPEN_METEO` | `https://api.open-meteo.com/v1/forecast` | Sin clave; 30 ciudades en una sola llamada; CC BY 4.0 |
| `OPEN_METEO_CAUDAL` | `https://flood-api.open-meteo.com/v1/flood` | GloFAS v4 (~5 km), 30 días previos + 7 de pronóstico |

Descartados: INDECI/SINPAD (403 a scripts), datosabiertos.gob.pe (redirección/HTML), `met.igp.gob.pe/datos/icen.txt` (404).

### ⚠️ GOTCHA: el SENAMHI bloquea IPs de datacenter

Verificado el 28-oct-2026: `idesep.senamhi.gob.pe` y `www.senamhi.gob.pe` **no responden** (timeout)
desde el runner de GitHub Actions ni desde el VPS Hostinger (217.15.168.100); `enfen.imarpe.gob.pe`
tampoco resuelve DNS desde el runner. Desde una IP residencial todo funciona (mismo caso que el
OEFA, ver `build_data.py`). Consecuencias y diseño:

- En CI las fuentes `SENAMHI_*` y `ENFEN` quedan en estado **`previo`** (no `error`): se publica su
  última versión válida con su `generado_utc` real y la UI muestra "datos de hace X". NOAA y
  Open-Meteo sí se refrescan cada hora en CI.
- Los datos del SENAMHI se refrescan con **`etl/sync_nino_local.sh`** desde una IP residencial: corre
  el ETL completo, commitea solo `public/data/nino/*` + CSV y hace push (el push despliega).
  Programable cada hora con `docs/launchd/pe.tunky.oap-nino.plist` (macOS launchd; corre al
  despertar si la Mac estaba dormida). Log en `/tmp/oap-nino-sync.log`.
- El paso "Recuperar" de `deploy.yml` compara `generado_utc` y conserva la copia **más nueva**
  entre repo y Pages, para que un commit residencial fresco no sea pisado por la copia de Pages.
- Alternativas si se quiere independencia de la Mac: proxy residencial, una Raspberry en casa,
  o pedir al SENAMHI acceso para la IP del VPS.

## 3. Ejecución automática

`.github/workflows/deploy.yml` corre `python etl/build_nino.py` después del ETL de incendios, en cada
push y cada hora (`cron: '23 * * * *'`). Antes recupera la versión publicada de `data/nino/*.json`
para conservar la última versión válida de cada fuente. No commitea nada: los datos viajan en el
artefacto de Pages. Las 13 fuentes se consultan en paralelo (4 hilos); una corrida completa toma
~100 s, dominada por el GeoServer del SENAMHI.

Salidas en `public/data/nino/`: `estado.json`, `alertas.json`, `enso.json`, `enfen.json`,
`avisos.json`, `quebradas.json` (~600 kB, columnar), `silvia.json`, `sonics.json`, `estacional.json`,
`pronostico.json`, `caudales.json`. CSV en `public/data/csv/nino-*.csv`.

Variables: `NINO_TIMEOUT` (seg, def. 90), `NINO_SIN_SENAMHI=1`, `NINO_SIN_OPEN_METEO=1`.
Códigos de salida: 0 ok · 3 todas las fuentes caídas (se publica lo previo) · otro = error del ETL.

## 4. Reglas de las alertas (`construir_alertas`)

Cada alerta tiene `nivel` 1–4 y `origen`:

- **oficial** — aviso emitido por SENAMHI/ENFEN. El nivel es el del aviso (meteorológico, hidrológico)
  o se deriva del máximo nivel presente (quebradas: 4 si hay centros poblados en nivel 4; SILVIA: 4 si
  ≥ 50 cuencas en nivel 4; SONICS: 3 si ≥ 50 centros poblados en nivel 3). Umbrales: nivel 3 si ≥ 5
  estaciones superan su umbral. El comunicado ENFEN entra como nivel 3 si la página dice "Alerta".
- **modelo** — Open-Meteo: lluvia diaria ≥ 20 mm (nivel 3 si ≥ 40 mm) o Tmáx ≥ 33 °C (nivel 3 si
  ≥ 36 °C) en alguna de las 30 ciudades; GloFAS: pico de caudal ≥ 2× la media de 30 días (nivel 3 si ≥ 4×).
- **calculado** — proxy del ICEN: 4 extraordinaria · 3 fuerte · 2 moderada · 1 débil/neutra.

La página deja elegir "solo avisos oficiales". Los textos siempre dicen de dónde sale cada número.

## 5. Límites y anti-overclaiming

- El **proxy del ICEN** es el promedio móvil de 3 meses de la anomalía Niño 1+2 de NOAA OISST
  (base 1991–2020). El ICEN oficial del ENFEN usa ERSSTv5 y puede diferir en décimas. Por eso se
  llama "proxy" y "cálculo propio" en toda la interfaz. Categorías ENFEN: < −1,4 fría fuerte;
  −1,4/−1,2 moderada; −1,2/−1,0 débil; −1,0/0,4 neutra; 0,4/1,0 cálida débil; 1,0/1,7 moderada;
  1,7/3,0 fuerte; > 3,0 extraordinaria.
- El comunicado del ENFEN solo se enlaza (título/fecha/PDF). No se interpreta su contenido ni se
  extrae texto del PDF.
- Open-Meteo y GloFAS son modelos globales (9–25 km / 5 km): fallan en la costa norte y en valles
  andinos. Son referenciales y nunca reemplazan al SENAMHI; cada tarjeta lo dice.
- "Población en zonas con aviso" suma `pob_total` del padrón de centros poblados del SENAMHI; es
  exposición potencial, no afectados.
- Los avisos hidrológicos publicados en la capa pueden tener semanas (SENAMHI no los retira de
  inmediato); se muestra la fecha.
- No hay datos de daños reales (INDECI/SINPAD no es accesible por script). Pendiente.

## 6. Pruebas

`npm test` → `etl/tests/test_nino.py` (16: parsers NOAA/ENFEN, normalizadores, inyección CSV,
flujo completo con fuentes simuladas, fuente caída conserva previos, todas caen, previos corruptos,
WFS inválido, Open-Meteo con menos series, variables de entorno, escritura atómica) y
`tests/nino.test.mjs` (8: categorías ICEN, filtros, columnar, frescura, colores, episodios).

## 7. Pendientes

- Daños reales por lluvias (INDECI/COEN): buscar fuente accesible (boletines PDF del COEN, SINPAD vía IP residencial).
- Pronóstico por distrito (SENAMHI `view_av_activ_qdra` por distrito ya está; falta choropleth propio).
- Avisos meteorológicos: la capa `g_aviso:view_aviso` estaba vacía al construir; validar campos
  (`nro_aviso`, `nivel`, `fech_ini/fin`, `cod_even`) con un aviso real.
- Notificaciones (WhatsApp/email) cuando aparezca una alerta nivel 4 nueva.
- Versión en el Mapa general (capa "El Niño").
