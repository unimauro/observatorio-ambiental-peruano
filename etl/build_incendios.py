#!/usr/bin/env python3
"""
ETL de incendios forestales y focos de calor — Observatorio Ambiental Peruano.

Fuentes:
  1. NASA FIRMS (primaria, casi en tiempo real): detecciones VIIRS (Suomi NPP,
     NOAA-20, NOAA-21) y MODIS (Terra/Aqua).
       - Con FIRMS_MAP_KEY → API oficial de área (/api/area/csv/...).
       - Sin clave       → archivos públicos "active_fire" de Sudamérica (24h/7d),
                           los mismos que publica FIRMS sin registro.
  2. MINAM GeoServidor (secundaria, administrativa): ServicioCFOI/MapServer
       capa 0 = Registro de incendios 2026 (puntos, INDECI/MINAM)
       capa 1 = Registro histórico 2000-2025 (solo se agregan conteos)
     Un registro administrativo NO implica un incendio activo hoy.

Salidas (public/data/incendios/):
  focos.json          detecciones normalizadas, formato columnar compacto
  focos-24h.geojson   últimas 24 h en GeoJSON (interoperabilidad)
  minam-2026.geojson  registro administrativo 2026
  minam-resumen.json  conteos históricos por año y departamento
  serie-diaria.json   conteo diario acumulado (crece más allá de la ventana)
  estado.json         última sincronización, estado por fuente, errores, tiempos
  ../csv/incendios-focos.csv, ../csv/incendios-minam-2026.csv

Garantías: solo biblioteca estándar; si una fuente falla se conserva la última
versión válida de esa fuente; la MAP_KEY nunca se escribe en disco ni en logs.

Uso:  python etl/build_incendios.py
Variables: FIRMS_MAP_KEY, INCENDIOS_DIAS (1-10, def. 7),
           INCENDIOS_ALCANCE (peru|sudamerica, def. peru), INCENDIOS_SIN_MINAM=1
"""
import csv
import io
import json
import os
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data")
OUT_DIR = os.path.join(ROOT, "incendios")
CSV_DIR = os.path.join(ROOT, "csv")
UA = "Mozilla/5.0 (ObservatorioAmbientalPeruano ETL incendios)"
CTX = ssl.create_default_context()
CTX_GOB = ssl.create_default_context()
CTX_GOB.check_hostname = False
CTX_GOB.verify_mode = ssl.CERT_NONE  # cadenas TLS incompletas en .gob.pe

LIMA = timezone(timedelta(hours=-5))  # Perú no usa horario de verano
BBOX = {"peru": (-81.4, -18.4, -68.6, 0.1), "sudamerica": (-92.0, -56.0, -32.0, 13.5)}

FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov"
# fuente_id → (ruta del archivo público sin sufijo, instrumento)
FIRMS_FUENTES = {
    "VIIRS_SNPP_NRT": ("suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_America", "VIIRS"),
    "VIIRS_NOAA20_NRT": ("noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America", "VIIRS"),
    "VIIRS_NOAA21_NRT": ("noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_America", "VIIRS"),
    "MODIS_NRT": ("modis-c6.1/csv/MODIS_C6_1_South_America", "MODIS"),
}
SATELITES = {"N": "Suomi NPP", "1": "NOAA-20", "N20": "NOAA-20", "2": "NOAA-21", "N21": "NOAA-21",
             "T": "Terra", "A": "Aqua", "Terra": "Terra", "Aqua": "Aqua"}
SAT_POR_FUENTE = {"VIIRS_SNPP_NRT": "Suomi NPP", "VIIRS_NOAA20_NRT": "NOAA-20", "VIIRS_NOAA21_NRT": "NOAA-21"}

MINAM_BASE = "https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioCFOI/MapServer"
MINAM_VISOR = "https://geoservidorperu.minam.gob.pe/geoservidor/"

# Columnas de focos.json (orden fijo; el frontend lo lee por nombre de campo)
CAMPOS = ["id", "fuente_id", "satelite", "instrumento", "lat", "lon", "adq_utc", "confianza",
          "confianza_raw", "frp", "brillo", "brillo2", "scan", "track", "dia_noche", "version",
          "recibido_utc", "departamento", "anp"]


def log(evento, **kw):
    print(json.dumps({"ts": ahora_iso(), "evento": evento, **kw}, ensure_ascii=False), flush=True)


def ahora():
    return datetime.now(timezone.utc)


def ahora_iso(dt=None):
    return (dt or ahora()).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def ocultar(texto, clave):
    """Quita la MAP_KEY de cualquier texto antes de loguearlo o guardarlo."""
    texto = str(texto)
    return texto.replace(clave, "***") if clave else texto


# --------------------------------------------------------------------------- HTTP
class NoModificado(Exception):
    pass


def http_get(url, *, timeout=60, reintentos=3, ctx=CTX, cabeceras=None, condicional=None):
    """GET con reintentos limitados y backoff. `condicional` = {'etag','last_modified'}.
    Devuelve (texto, metadatos). Lanza NoModificado ante un 304."""
    h = {"User-Agent": UA, **(cabeceras or {})}
    if condicional:
        if condicional.get("etag"):
            h["If-None-Match"] = condicional["etag"]
        if condicional.get("last_modified"):
            h["If-Modified-Since"] = condicional["last_modified"]
    if condicional and (condicional.get("etag") or condicional.get("last_modified")):
        # FIRMS ignora If-None-Match (responde 200 siempre): un HEAD barato decide.
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA}, method="HEAD")
            with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
                etag, lm = r.headers.get("ETag"), r.headers.get("Last-Modified")
            if (etag and etag == condicional.get("etag")) or (not etag and lm and lm == condicional.get("last_modified")):
                raise NoModificado()
        except NoModificado:
            raise
        except Exception:  # noqa: BLE001 — si el HEAD falla, se intenta el GET normal
            pass
    ultimo = None
    for i in range(reintentos):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                meta = {"etag": r.headers.get("ETag"), "last_modified": r.headers.get("Last-Modified")}
                return r.read().decode("utf-8", errors="replace"), meta
        except urllib.error.HTTPError as e:
            if e.code == 304:
                raise NoModificado() from None
            ultimo = f"HTTP {e.code}"
            if e.code in (400, 401, 403, 404):  # no se arregla reintentando
                break
            if e.code == 429:
                time.sleep(10 * (i + 1))
                continue
        except Exception as e:  # noqa: BLE001 — red, timeout, TLS
            ultimo = f"{type(e).__name__}: {e}"
        time.sleep(2 * (i + 1))
    raise RuntimeError(ultimo or "error desconocido")


# ------------------------------------------------------------------- geometría
def _in_ring(x, y, ring):
    dentro = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            dentro = not dentro
        j = i
    return dentro


def _polys(geom):
    if not geom:
        return []
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


class IndicePoligonos:
    """Point-in-polygon con prefiltro por bbox (sin dependencias)."""

    def __init__(self, features, campo):
        self.items = []
        for f in features:
            polys = _polys(f.get("geometry"))
            if not polys:
                continue
            xs = [p[0] for poly in polys for p in poly[0]]
            ys = [p[1] for poly in polys for p in poly[0]]
            self.items.append(((min(xs), min(ys), max(xs), max(ys)), polys, (f.get("properties") or {}).get(campo)))

    def buscar(self, lon, lat):
        for (x0, y0, x1, y1), polys, nombre in self.items:
            if not (x0 <= lon <= x1 and y0 <= lat <= y1):
                continue
            for poly in polys:
                if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, h) for h in poly[1:]):
                    return nombre
        return None


def cargar_indice(archivo, campo):
    try:
        with open(os.path.join(ROOT, archivo), encoding="utf-8") as fh:
            return IndicePoligonos(json.load(fh)["features"], campo)
    except Exception as e:  # noqa: BLE001
        log("aviso_indice", archivo=archivo, error=str(e))
        return IndicePoligonos([], campo)


# -------------------------------------------------------------- normalización
def _num(v):
    try:
        x = float(v)
        return None if x != x else x  # NaN → None
    except (TypeError, ValueError):
        return None


def confianza_normalizada(raw, instrumento):
    """VIIRS: l/n/h (o low/nominal/high). MODIS: 0-100 → <30 baja, 30-79 nominal, ≥80 alta."""
    s = str(raw or "").strip().lower()
    if instrumento == "MODIS":
        n = _num(s)
        if n is None:
            return None
        return "baja" if n < 30 else ("alta" if n >= 80 else "nominal")
    return {"l": "baja", "low": "baja", "n": "nominal", "nominal": "nominal",
            "h": "alta", "high": "alta"}.get(s)


def parse_adq(fecha, hora):
    """acq_date 'YYYY-MM-DD' + acq_time 'HMM'/'HHMM' (UTC) → datetime aware o None."""
    try:
        hhmm = str(hora).strip().zfill(4)
        return datetime.strptime(f"{fecha.strip()} {hhmm}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        return None


def coord_valida(lat, lon):
    return lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180 \
        and not (lat == 0 and lon == 0)


def normalizar_firms(fila, fuente_id, instrumento):
    """Fila CSV FIRMS → dict común, o None si es inválida."""
    lat, lon = _num(fila.get("latitude")), _num(fila.get("longitude"))
    if not coord_valida(lat, lon):
        return None
    adq = parse_adq(fila.get("acq_date", ""), fila.get("acq_time", ""))
    if adq is None:
        return None
    sat_raw = str(fila.get("satellite", "")).strip()
    satelite = SAT_POR_FUENTE.get(fuente_id) or SATELITES.get(sat_raw, sat_raw or None)
    conf_raw = str(fila.get("confidence", "")).strip()
    lat, lon = round(lat, 5), round(lon, 5)
    return {
        "id": f"{fuente_id}:{adq.strftime('%Y%m%dT%H%M')}:{lat:.4f},{lon:.4f}",
        "fuente_id": fuente_id,
        "satelite": satelite,
        "instrumento": instrumento,
        "lat": lat,
        "lon": lon,
        "adq_utc": ahora_iso(adq),
        "confianza": confianza_normalizada(conf_raw, instrumento),
        "confianza_raw": conf_raw or None,
        "frp": _num(fila.get("frp")),
        "brillo": _num(fila.get("bright_ti4") or fila.get("brightness")),
        "brillo2": _num(fila.get("bright_ti5") or fila.get("bright_t31")),
        "scan": _num(fila.get("scan")),
        "track": _num(fila.get("track")),
        "dia_noche": (fila.get("daynight") or "").strip() or None,
        "version": (fila.get("version") or "").strip() or None,
        "recibido_utc": None,
        "departamento": None,
        "anp": None,
    }


def parse_firms_csv(texto, fuente_id, instrumento):
    """Parsea un CSV de FIRMS. Detecta respuestas de error en texto plano."""
    texto = (texto or "").strip()
    if not texto:
        return [], 0
    primera = texto.splitlines()[0].lower()
    if "latitude" not in primera or "longitude" not in primera:
        raise RuntimeError(f"respuesta no es CSV de FIRMS: {texto[:120]!r}")
    validos, invalidos = [], 0
    for fila in csv.DictReader(io.StringIO(texto)):
        r = normalizar_firms(fila, fuente_id, instrumento)
        if r is None:
            invalidos += 1
        else:
            validos.append(r)
    return validos, invalidos


def en_ventana(registro, desde, hasta):
    t = datetime.strptime(registro["adq_utc"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return desde <= t <= hasta


def deduplicar(registros):
    """Una detección = (fuente, instante, píxel a 1e-4°). Detecciones distintas de un
    mismo incendio (otro píxel, otro paso u otro satélite) se conservan."""
    vistos = {}
    for r in registros:
        previo = vistos.get(r["id"])
        # ante duplicado exacto se queda el que tenga más campos informados
        if previo is None or sum(v is not None for v in r.values()) > sum(v is not None for v in previo.values()):
            vistos[r["id"]] = r
    return list(vistos.values())


# ------------------------------------------------------------------ previos
def leer_json(nombre, defecto=None):
    try:
        with open(os.path.join(OUT_DIR, nombre), encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:  # noqa: BLE001
        return defecto


def focos_previos():
    d = leer_json("focos.json")
    if not d or "filas" not in d:
        return []
    campos = d["campos"]
    return [dict(zip(campos, fila)) for fila in d["filas"]]


def escribir(nombre, obj, carpeta=None):
    carpeta = carpeta or OUT_DIR
    os.makedirs(carpeta, exist_ok=True)
    ruta = os.path.join(carpeta, nombre)
    fd, tmp = tempfile.mkstemp(dir=carpeta, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    os.chmod(tmp, 0o644)  # mkstemp crea 0600; Pages y el VPS deben poder leerlo
    os.replace(tmp, ruta)  # escritura atómica: nunca se publica un archivo a medias


def escribir_csv(nombre, campos, filas):
    os.makedirs(CSV_DIR, exist_ok=True)
    ruta = os.path.join(CSV_DIR, nombre)
    fd, tmp = tempfile.mkstemp(dir=CSV_DIR, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as fh:  # BOM para Excel
        w = csv.writer(fh)
        w.writerow(campos)
        w.writerows(filas)
    os.chmod(tmp, 0o644)
    os.replace(tmp, ruta)


# ---------------------------------------------------------------- FIRMS
def urls_firms(fuente_id, dias, clave, bbox):
    if clave:
        # La API de área acepta hasta 5 días por consulta → se trocea con fecha de inicio.
        area = ",".join(str(v) for v in bbox)
        urls, inicio, restante = [], ahora().date() - timedelta(days=dias - 1), dias
        while restante > 0:
            n = min(5, restante)
            urls.append(f"{FIRMS_BASE}/api/area/csv/{clave}/{fuente_id}/{area}/{n}/{inicio.isoformat()}")
            inicio += timedelta(days=n)
            restante -= n
        return urls
    ruta, _ = FIRMS_FUENTES[fuente_id]
    return [f"{FIRMS_BASE}/data/active_fire/{ruta}_{'24h' if dias <= 1 else '7d'}.csv"]


def descargar_firms(fuente_id, dias, clave, bbox, cond_previa, fetch=http_get):
    """Devuelve (registros|None si 304, invalidos, metadatos de caché)."""
    _, instrumento = FIRMS_FUENTES[fuente_id]
    registros, invalidos, meta = [], 0, {}
    urls = urls_firms(fuente_id, dias, clave, bbox)
    for url in urls:
        cond = cond_previa if (not clave and len(urls) == 1) else None  # 304 solo en archivo público
        texto, meta = fetch(url, condicional=cond)
        r, inv = parse_firms_csv(texto, fuente_id, instrumento)
        registros += r
        invalidos += inv
    return registros, invalidos, meta


# ---------------------------------------------------------------- MINAM
def _minam_query(capa, params, fetch=http_get):
    q = urllib.parse.urlencode({"f": "json", **params})
    texto, _ = fetch(f"{MINAM_BASE}/{capa}/query?{q}", ctx=CTX_GOB, timeout=90)
    d = json.loads(texto)
    if "error" in d:
        raise RuntimeError(f"ArcGIS: {d['error'].get('message')}")
    return d


def _fecha_ddmmyyyy(s):
    try:
        return datetime.strptime(str(s).strip(), "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def _txt(v):
    s = str(v).strip() if v is not None else ""
    return s or None


def descargar_minam_2026(fetch=http_get):
    campos = ("OBJECTID_12,INCENDIO,FEC_EMERGE,FEC_TERMIN,NOMBDEP,NOMBPROV,NOMBDIST,LOCALIDAD,"
              "DES_FUENTE,FTE_INF,ORIGEN,REGION_NAT,anp_nomb,anp_cate,COB_AFECTA,CULTI_AFEC,"
              "DES_DANO,OBSERVACIO,ACTIVIDAD")
    feats, offset = [], 0
    while True:
        d = _minam_query(0, {"where": "1=1", "outFields": campos, "outSR": 4326, "returnGeometry": "true",
                             "orderByFields": "OBJECTID_12", "resultOffset": offset, "resultRecordCount": 1000},
                         fetch)
        lote = d.get("features", [])
        for f in lote:
            a, g = f.get("attributes", {}), f.get("geometry") or {}
            lat, lon = _num(g.get("y")), _num(g.get("x"))
            if not coord_valida(lat, lon):
                continue
            feats.append({"type": "Feature",
                          "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                          "properties": {
                              "id": f"MINAM-2026:{a.get('OBJECTID_12')}",
                              "fecha_emergencia": _fecha_ddmmyyyy(a.get("FEC_EMERGE")),
                              "fecha_termino": _fecha_ddmmyyyy(a.get("FEC_TERMIN")),
                              "departamento": _txt(a.get("NOMBDEP")),
                              "provincia": _txt(a.get("NOMBPROV")),
                              "distrito": _txt(a.get("NOMBDIST")),
                              "localidad": _txt(a.get("LOCALIDAD")),
                              "reportado_por": _txt(a.get("DES_FUENTE")),
                              "origen": _txt(a.get("ORIGEN")),
                              "region_natural": _txt(a.get("REGION_NAT")),
                              "anp": _txt(a.get("anp_nomb")),
                              "cobertura_afectada": _num(a.get("COB_AFECTA")),
                              "cultivo_afectado": _num(a.get("CULTI_AFEC")),
                              "danos": _txt(a.get("DES_DANO")),
                              "observacion": _txt(a.get("OBSERVACIO")),
                          }})
        if len(lote) < 1000 and not d.get("exceededTransferLimit"):
            break
        offset += len(lote)
    return feats


def descargar_minam_resumen(fetch=http_get):
    stat = json.dumps([{"statisticType": "count", "onStatisticField": "OBJECTID_1", "outStatisticFieldName": "n"}])
    por_anio = _minam_query(1, {"where": "1=1", "outStatistics": stat, "groupByFieldsForStatistics": "AñO"}, fetch)
    por_dep = _minam_query(1, {"where": "1=1", "outStatistics": stat, "groupByFieldsForStatistics": "NOMBDEP"}, fetch)
    anios = sorted(({"anio": int(f["attributes"]["AñO"]), "registros": int(f["attributes"]["n"])}
                    for f in por_anio.get("features", []) if f["attributes"].get("AñO")), key=lambda x: x["anio"])
    deps = sorted(({"departamento": _txt(f["attributes"]["NOMBDEP"]) or "s/d", "registros": int(f["attributes"]["n"])}
                   for f in por_dep.get("features", [])), key=lambda x: -x["registros"])
    return {"porAnio": anios, "porDepartamento": deps, "total": sum(a["registros"] for a in anios)}


# ------------------------------------------------------------- serie diaria
def actualizar_serie(serie_previa, focos, desde, hasta):
    """Conteo diario (fecha en hora de Lima). Solo se recalculan los días que la
    ventana cubre completos; los anteriores se conservan para el histórico."""
    por_dia = {}
    for f in focos:
        t = datetime.strptime(f["adq_utc"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).astimezone(LIMA)
        d = por_dia.setdefault(t.date().isoformat(), {"total": 0, "VIIRS": 0, "MODIS": 0})
        d["total"] += 1
        d[f["instrumento"]] = d.get(f["instrumento"], 0) + 1
    primer_dia_completo = (desde.astimezone(LIMA) + timedelta(days=1)).date().isoformat()
    hoy_lima = hasta.astimezone(LIMA).date().isoformat()
    serie = {s["fecha"]: s for s in (serie_previa or [])}
    for fecha, d in por_dia.items():
        if fecha >= primer_dia_completo:
            serie[fecha] = {"fecha": fecha, **d, "parcial": fecha == hoy_lima}
    for fecha, s in serie.items():
        if fecha < hoy_lima:
            s["parcial"] = False
    return sorted(serie.values(), key=lambda s: s["fecha"])[-400:]


# ---------------------------------------------------------------------- main
def ejecutar(fetch=http_get, now=None):
    t0 = time.time()
    clave = os.environ.get("FIRMS_MAP_KEY", "").strip()
    dias = max(1, min(10, int(os.environ.get("INCENDIOS_DIAS", "7") or 7)))
    alcance = os.environ.get("INCENDIOS_ALCANCE", "peru").strip().lower()
    alcance = alcance if alcance in BBOX else "peru"
    bbox = BBOX[alcance]
    hasta = now or ahora()
    desde = hasta - timedelta(days=dias)

    estado_previo = leer_json("estado.json", {}) or {}
    fuentes_previas = {f["id"]: f for f in estado_previo.get("fuentes", [])}
    previos = focos_previos()
    recibido = {p["id"]: p.get("recibido_utc") for p in previos}

    deptos = cargar_indice("peru-departamentos.geojson", "NOMBDEP")
    anps = cargar_indice("anp-sernanp.geojson", "anp_nomb")

    fuentes_estado, todos = [], []
    for fuente_id in FIRMS_FUENTES:
        ti = time.time()
        prev = fuentes_previas.get(fuente_id, {})
        st = {"id": fuente_id, "nombre": f"NASA FIRMS · {fuente_id}", "tipo": "satelital",
              "modo": "api-map-key" if clave else "archivo-publico", "ultimo_exito": prev.get("ultimo_exito"),
              "cache": prev.get("cache") if not clave else None}
        try:
            regs, invalidos, meta = descargar_firms(fuente_id, dias, clave, bbox, prev.get("cache"), fetch)
            st.update(estado="ok", invalidos=invalidos, ultimo_exito=ahora_iso(hasta), error=None,
                      cache=meta if not clave else None)
        except NoModificado:
            regs = [p for p in previos if p["fuente_id"] == fuente_id]
            st.update(estado="sin-cambios", invalidos=0, ultimo_exito=ahora_iso(hasta), error=None)
        except Exception as e:  # noqa: BLE001
            regs = [p for p in previos if p["fuente_id"] == fuente_id]  # última versión válida
            st.update(estado="error", error=ocultar(e, clave), invalidos=0)
        # recorte espacial + temporal, enriquecimiento
        utiles = []
        for r in regs:
            if not (bbox[0] <= r["lon"] <= bbox[2] and bbox[1] <= r["lat"] <= bbox[3]):
                continue
            if not en_ventana(r, desde, hasta + timedelta(hours=1)):
                continue
            if r.get("departamento") is None:
                r["departamento"] = deptos.buscar(r["lon"], r["lat"])
            if alcance == "peru" and r["departamento"] is None:
                continue  # fuera del territorio peruano
            if r.get("anp") is None and r["departamento"]:
                r["anp"] = anps.buscar(r["lon"], r["lat"])
            r["recibido_utc"] = recibido.get(r["id"]) or r.get("recibido_utc") or ahora_iso(hasta)
            utiles.append(r)
        st.update(registros=len(utiles), duracion_ms=int((time.time() - ti) * 1000))
        fuentes_estado.append(st)
        todos += utiles
        log("fuente", **{k: v for k, v in st.items() if k != "cache"})

    focos = sorted(deduplicar(todos), key=lambda r: r["adq_utc"], reverse=True)
    # Si todas las fuentes fallan, `focos` ya son los previos vigentes (última versión válida).
    escribir("focos.json", {"generado_utc": ahora_iso(hasta), "alcance": alcance, "dias": dias,
                            "campos": CAMPOS, "filas": [[r.get(c) for c in CAMPOS] for r in focos]})
    hace24 = hasta - timedelta(hours=24)
    escribir("focos-24h.geojson", {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
         "properties": {c: r.get(c) for c in CAMPOS if c not in ("lat", "lon")}}
        for r in focos if en_ventana(r, hace24, hasta + timedelta(hours=1))]})
    escribir_csv("incendios-focos.csv", ["lon", "lat"] + [c for c in CAMPOS if c not in ("lat", "lon")],
                 [[r["lon"], r["lat"]] + [r.get(c) for c in CAMPOS if c not in ("lat", "lon")] for r in focos])
    escribir("serie-diaria.json", actualizar_serie(leer_json("serie-diaria.json", []), focos, desde, hasta))

    # MINAM (administrativo): no debe tumbar la ingesta satelital
    if os.environ.get("INCENDIOS_SIN_MINAM") != "1":
        for fid, nombre, tarea in (
            ("MINAM_REGISTRO_2026", "MINAM · Registro de incendios 2026", "registro"),
            ("MINAM_HISTORICO", "MINAM · Registro histórico 2000-2025", "historico"),
        ):
            ti, prev = time.time(), fuentes_previas.get(fid, {})
            st = {"id": fid, "nombre": nombre, "tipo": "administrativo", "modo": "arcgis-rest",
                  "ultimo_exito": prev.get("ultimo_exito"), "registros": prev.get("registros"),
                  "ultimo_registro": prev.get("ultimo_registro")}
            try:
                if tarea == "registro":
                    feats = descargar_minam_2026(fetch)
                    if not feats:
                        raise RuntimeError("respuesta vacía")
                    escribir("minam-2026.geojson", {"type": "FeatureCollection", "features": feats})
                    cols = list(feats[0]["properties"].keys())
                    escribir_csv("incendios-minam-2026.csv", ["lon", "lat"] + cols,
                                 [f["geometry"]["coordinates"] + [f["properties"][c] for c in cols] for f in feats])
                    fechas = [f["properties"]["fecha_emergencia"] for f in feats if f["properties"]["fecha_emergencia"]]
                    st.update(registros=len(feats), ultimo_registro=max(fechas) if fechas else None)
                else:
                    res = descargar_minam_resumen(fetch)
                    if not res["porAnio"]:
                        raise RuntimeError("respuesta vacía")
                    escribir("minam-resumen.json", {"generado_utc": ahora_iso(hasta), **res})
                    st.update(registros=res["total"])
                st.update(estado="ok", error=None, ultimo_exito=ahora_iso(hasta))
            except Exception as e:  # noqa: BLE001
                st.update(estado="error", error=str(e)[:300])  # se conserva el archivo previo
            st["duracion_ms"] = int((time.time() - ti) * 1000)
            fuentes_estado.append(st)
            log("fuente", **st)
    else:
        fuentes_estado += [f for k, f in fuentes_previas.items() if k.startswith("MINAM")]

    estado = {
        "ultima_ejecucion_utc": ahora_iso(hasta),
        "ultima_sincronizacion_utc": ahora_iso(hasta) if any(
            f["estado"] in ("ok", "sin-cambios") for f in fuentes_estado if f["tipo"] == "satelital")
        else estado_previo.get("ultima_sincronizacion_utc"),
        "duracion_ms": int((time.time() - t0) * 1000),
        "alcance": alcance,
        "dias": dias,
        "total_focos": len(focos),
        "fuentes": fuentes_estado,
    }
    escribir("estado.json", estado)
    log("fin", total_focos=len(focos), duracion_ms=estado["duracion_ms"],
        errores=[f["id"] for f in fuentes_estado if f["estado"] == "error"])
    return estado


def main():
    lock_path = os.path.join(tempfile.gettempdir(), "oap-incendios.lock")
    try:
        import fcntl
        lock = open(lock_path, "w")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)  # evita ejecuciones simultáneas
    except BlockingIOError:
        log("omitido", motivo="otra ejecución en curso")
        return 0
    except ImportError:
        lock = None  # Windows: sin bloqueo
    estado = ejecutar()
    # código ≠ 0 solo si TODAS las fuentes satelitales fallaron (alerta en CI)
    sat = [f for f in estado["fuentes"] if f["tipo"] == "satelital"]
    return 1 if sat and all(f["estado"] == "error" for f in sat) else 0


if __name__ == "__main__":
    sys.exit(main())
