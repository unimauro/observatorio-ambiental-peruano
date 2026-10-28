#!/usr/bin/env python3
"""
ETL "El Niño, lluvias y calor" — Observatorio Ambiental Peruano.

Reúne, en un solo paquete de archivos estáticos, el estado del Fenómeno El Niño
y los avisos oficiales de lluvias, activación de quebradas (huaycos), crecidas
de ríos y pronósticos de corto y mediano plazo para el Perú.

Fuentes (cada una es una tarea aislada: si falla, se conserva su última versión válida):
  NOAA_MENSUAL     NOAA CPC sstoi.indices — SST y anomalía Niño 1+2 / 3 / 3.4 / 4 mensual (1982–)
  NOAA_SEMANAL     NOAA CPC wksst9120.for — idem semanal (clim. 1991–2020)
  ENFEN            Página de comunicados oficiales del ENFEN (último comunicado: título, fecha, PDF)
  SENAMHI_AVISO    IDESEP WFS g_aviso:view_aviso(+aux): avisos meteorológicos vigentes
  SENAMHI_AVISO24H IDESEP WFS g_prono_pp_24h:view_aviso24h: zonas con pronóstico de lluvia 24 h
  SENAMHI_QUEBRADAS IDESEP WFS g_acti_quebrada:*: aviso de activación de quebradas (centros
                   poblados expuestos con población/viviendas, distritos por nivel)
  SENAMHI_HIDRO    IDESEP WFS g_dbphisis:aviso_hidro_pub: avisos hidrológicos (ríos) vigentes
  SENAMHI_SILVIA   IDESEP WFS silvia:*: pronóstico de movimientos en masa por lluvias (3 días)
  SENAMHI_SONICS   IDESEP WFS dhi-seh-sonics:SONICS-CCPP-*: centros poblados con pronóstico de
                   crecida/inundación fluvial (7 días)
  SENAMHI_UMBRALES IDESEP WFS g_umbrales:umbrales_precipitacion: lluvia observada vs umbral (hoy)
  SENAMHI_ESTACIONAL IDESEP WFS spc:*: pronóstico estacional por sectores (verano, trimestre, mes)
  OPEN_METEO       api.open-meteo.com: pronóstico 7 días (lluvia, Tmáx/Tmín) para 30 ciudades
  OPEN_METEO_CAUDAL flood-api.open-meteo.com (GloFAS): caudal previsto 7 días en 18 ríos

Salidas (public/data/nino/):
  enso.json        series Niño 1+2 / 3.4 mensual y semanal + proxy del ICEN con categoría ENFEN
  enfen.json       último comunicado oficial
  avisos.json      avisos meteorológicos, 24 h, hidrológicos, umbrales superados
  quebradas.json   centros poblados expuestos (columnar) + resúmenes por departamento/nivel
  silvia.json      conteo de cuencas por nivel y día
  sonics.json      conteo de centros poblados por nivel/día/departamento + puntos del día 1
  estacional.json  pronóstico estacional SENAMHI por sector
  pronostico.json  pronóstico Open-Meteo por ciudad (7 días)
  caudales.json    caudal GloFAS por río (30 días previos + 7 días)
  alertas.json     síntesis de alertas (nivel 1–4) con origen: oficial | modelo | calculado
  estado.json      última sincronización, estado por fuente, errores, tiempos
  ../csv/nino-quebradas-ccpp.csv, ../csv/nino-pronostico-ciudades.csv, ../csv/nino-avisos-hidro.csv

Garantías: solo biblioteca estándar; ninguna clave; nunca escribe un archivo a medias;
si una fuente falla, se publica su última versión válida y se marca en estado.json.

Uso:  python etl/build_nino.py
Variables: NINO_SIN_SENAMHI=1 (omite IDESEP), NINO_SIN_OPEN_METEO=1, NINO_TIMEOUT (seg, def. 90)
"""
import csv
import html
import json
import os
import re
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data")
OUT_DIR = os.path.join(ROOT, "nino")
CSV_DIR = os.path.join(ROOT, "csv")
UA = "Mozilla/5.0 (ObservatorioAmbientalPeruano ETL nino)"
CTX = ssl.create_default_context()
CTX_GOB = ssl.create_default_context()
CTX_GOB.check_hostname = False
CTX_GOB.verify_mode = ssl.CERT_NONE  # respaldo: cadenas TLS incompletas en .gob.pe

MAX_BYTES = 60 * 1024 * 1024
MAX_TEXTO = 400
TIMEOUT = max(20, min(300, int(os.environ.get("NINO_TIMEOUT", "90") or 90)))
SALIDA_TODAS_CAIDAS = 3
LIMA = timezone(timedelta(hours=-5))

NOAA_MENSUAL = "https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices"
NOAA_SEMANAL = "https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for"
ENFEN_URL = "https://enfen.imarpe.gob.pe/comunicados/"
WFS = "https://idesep.senamhi.gob.pe/geoserver/wfs"
WMS = "https://idesep.senamhi.gob.pe/geoserver/wms"
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_FLOOD = "https://flood-api.open-meteo.com/v1/flood"

# Categorías del ICEN según el ENFEN (promedio móvil de 3 meses de la anomalía de la TSM en Niño 1+2)
ICEN_CATEGORIAS = [
    (-9e9, -1.4, "fría fuerte"), (-1.4, -1.2, "fría moderada"), (-1.2, -1.0, "fría débil"),
    (-1.0, 0.4, "neutra"), (0.4, 1.0, "cálida débil"), (1.0, 1.7, "cálida moderada"),
    (1.7, 3.0, "cálida fuerte"), (3.0, 9e9, "cálida extraordinaria"),
]

# Ciudades para el pronóstico (capitales + ciudades costeras del norte expuestas a El Niño)
CIUDADES = [
    ("Tumbes", "TUMBES", -3.57, -80.45), ("Piura", "PIURA", -5.19, -80.63), ("Sullana", "PIURA", -4.90, -80.69),
    ("Chulucanas", "PIURA", -5.09, -80.16), ("Chiclayo", "LAMBAYEQUE", -6.77, -79.84), ("Trujillo", "LA LIBERTAD", -8.11, -79.03),
    ("Chimbote", "ANCASH", -9.07, -78.59), ("Huaraz", "ANCASH", -9.53, -77.53), ("Lima", "LIMA", -12.05, -77.04),
    ("Chosica", "LIMA", -11.94, -76.70), ("Ica", "ICA", -14.07, -75.73), ("Arequipa", "AREQUIPA", -16.40, -71.54),
    ("Moquegua", "MOQUEGUA", -17.19, -70.93), ("Tacna", "TACNA", -18.01, -70.25), ("Cajamarca", "CAJAMARCA", -7.16, -78.51),
    ("Chachapoyas", "AMAZONAS", -6.23, -77.87), ("Moyobamba", "SAN MARTIN", -6.03, -76.97), ("Tarapoto", "SAN MARTIN", -6.49, -76.37),
    ("Iquitos", "LORETO", -3.75, -73.25), ("Pucallpa", "UCAYALI", -8.38, -74.55), ("Huánuco", "HUANUCO", -9.93, -76.24),
    ("Cerro de Pasco", "PASCO", -10.68, -76.26), ("Huancayo", "JUNIN", -12.07, -75.21), ("Huancavelica", "HUANCAVELICA", -12.79, -74.97),
    ("Ayacucho", "AYACUCHO", -13.16, -74.22), ("Abancay", "APURIMAC", -13.63, -72.88), ("Cusco", "CUSCO", -13.52, -71.97),
    ("Puerto Maldonado", "MADRE DE DIOS", -12.59, -69.19), ("Puno", "PUNO", -15.84, -70.02), ("Juliaca", "PUNO", -15.50, -70.13),
]
# Ríos para el caudal GloFAS (punto de referencia aproximado; el modelo usa la celda más cercana)
RIOS = [
    ("Tumbes", "TUMBES", -3.77, -80.46), ("Chira", "PIURA", -4.88, -80.70), ("Piura", "PIURA", -5.19, -80.62),
    ("La Leche", "LAMBAYEQUE", -6.42, -79.85), ("Jequetepeque", "LA LIBERTAD", -7.27, -79.32), ("Chicama", "LA LIBERTAD", -7.65, -79.30),
    ("Moche", "LA LIBERTAD", -8.08, -78.88), ("Santa", "ANCASH", -8.98, -78.63), ("Rímac", "LIMA", -11.93, -76.69),
    ("Chillón", "LIMA", -11.85, -77.05), ("Ica", "ICA", -14.00, -75.70), ("Marañón", "LORETO", -4.47, -77.55),
    ("Huallaga", "LORETO", -5.90, -76.11), ("Ucayali", "UCAYALI", -8.38, -74.58), ("Amazonas", "LORETO", -3.72, -73.24),
    ("Mantaro", "JUNIN", -12.10, -75.20), ("Urubamba", "CUSCO", -12.86, -72.69), ("Madre de Dios", "MADRE DE DIOS", -12.60, -69.20),
]

MESES = {1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio", 7: "julio", 8: "agosto",
         9: "septiembre", 10: "octubre", 11: "noviembre", 12: "diciembre"}
CAMPOS_CCPP = ["nombre", "departamento", "provincia", "distrito", "nivel", "poblacion", "viviendas", "lat", "lon"]


def log(evento, **kw):
    print(json.dumps({"ts": ahora_iso(), "evento": evento, **kw}, ensure_ascii=False, default=str), flush=True)


def ahora():
    return datetime.now(timezone.utc)


def ahora_iso(dt=None):
    return (dt or ahora()).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- HTTP
class RespuestaDemasiadoGrande(RuntimeError):
    pass


def http_get(url, *, timeout=None, reintentos=2, ctx=CTX):
    """GET con reintentos limitados. Devuelve el texto. Las fuentes .gob.pe reintentan sin
    verificar la cadena TLS solo si la verificación falla."""
    timeout = timeout or TIMEOUT
    ultimo = None
    for i in range(reintentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                datos = r.read(MAX_BYTES + 1)
                if len(datos) > MAX_BYTES:
                    raise RespuestaDemasiadoGrande(f"respuesta mayor a {MAX_BYTES // 2**20} MB")
                return datos.decode("utf-8", errors="replace")
        except RespuestaDemasiadoGrande:
            raise
        except urllib.error.HTTPError as e:
            ultimo = f"HTTP {e.code}"
            if e.code in (400, 401, 403, 404):
                break
        except Exception as e:  # noqa: BLE001
            ultimo = f"{type(e).__name__}: {e}"
            if "CERTIFICATE_VERIFY_FAILED" in ultimo and ctx is CTX and ".gob.pe" in url:
                ctx = CTX_GOB
                continue
        time.sleep(2 * (i + 1))
    raise RuntimeError(ultimo or "error desconocido")


def wfs_json(capa, propiedades=None, extra=None, fetch=http_get):
    """GetFeature en GeoJSON. `propiedades` omite la geometría (respuesta mucho más ligera)."""
    q = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeName": capa,
         "outputFormat": "application/json"}
    if propiedades:
        q["propertyName"] = ",".join(propiedades)
    if extra:
        q.update(extra)
    texto = fetch(f"{WFS}?{urllib.parse.urlencode(q)}")
    try:
        d = json.loads(texto)
    except ValueError:
        raise RuntimeError(f"{capa}: respuesta no es JSON: {texto[:120]!r}") from None
    if not isinstance(d, dict) or not isinstance(d.get("features"), list):
        raise RuntimeError(f"{capa}: GeoJSON sin 'features'")
    return d["features"]


def wfs_hits(capa, fetch=http_get):
    q = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeName": capa, "resultType": "hits"}
    m = re.search(r'numberMatched="(\d+)"', fetch(f"{WFS}?{urllib.parse.urlencode(q)}"))
    return int(m.group(1)) if m else None


# ------------------------------------------------------------------ utilidades
def _num(v):
    try:
        x = float(v)
        return None if x != x else x
    except (TypeError, ValueError):
        return None


def _txt(v, n=MAX_TEXTO):
    if v is None:
        return None
    s = html.unescape(re.sub(r"<[^>]+>", " ", str(v))).strip()
    s = re.sub(r"\s+", " ", s)
    return s[:n] or None


def _nivel(v):
    """'Nivel 3' | '3' | 3 → 3 (1-4) o None."""
    m = re.search(r"\d", str(v or ""))
    n = int(m.group(0)) if m else None
    return n if n and 1 <= n <= 4 else None


def _fecha(v):
    """'2026-10-27Z' | '2026-10-07T11:00:00Z' | '28/10/2026' → ISO (fecha u hora) o None."""
    s = str(v or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?Z?$", s)
    if m:
        y, mo, d, hh, mm, ss = m.groups()
        try:
            dt = datetime(int(y), int(mo), int(d), int(hh or 0), int(mm or 0), int(ss or 0))
        except ValueError:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if hh else dt.strftime("%Y-%m-%d")
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", s)
    if m:
        d, mo, y = m.groups()
        try:
            return datetime(int(y), int(mo), int(d)).strftime("%Y-%m-%d")
        except ValueError:
            return None
    return None


def coord_valida(lat, lon):
    return lat is not None and lon is not None and -19 <= lat <= 1 and -82 <= lon <= -68


def _miles(x):
    """12345 → '12 345' (separador de miles con espacio, sin coma que confunda en español)."""
    try:
        return f"{int(x):,}".replace(",", " ")
    except (TypeError, ValueError):
        return str(x)


def contar(xs, clave):
    m = {}
    for x in xs:
        k = clave(x)
        if k is None:
            continue
        m[k] = m.get(k, 0) + 1
    return sorted(([k, v] for k, v in m.items()), key=lambda kv: (-kv[1], str(kv[0])))


def leer_json(nombre, defecto=None, tipo=None):
    """Archivo previo (puede venir de la versión publicada en Pages: no es confiable)."""
    try:
        with open(os.path.join(OUT_DIR, nombre), encoding="utf-8") as fh:
            d = json.load(fh)
        if tipo is not None and not isinstance(d, tipo):
            return defecto
        return d
    except Exception:  # noqa: BLE001
        return defecto


def escribir(nombre, obj, carpeta=None):
    carpeta = carpeta or OUT_DIR
    os.makedirs(carpeta, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=carpeta, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, os.path.join(carpeta, nombre))  # atómico


def celda_csv(v):
    if v is None:
        return ""
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") and not re.match(r"^-?\d+(\.\d+)?$", s) else s


def escribir_csv(nombre, campos, filas):
    os.makedirs(CSV_DIR, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=CSV_DIR, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(campos)
        for f in filas:
            w.writerow([celda_csv(v) for v in f])
    os.replace(tmp, os.path.join(CSV_DIR, nombre))


# ------------------------------------------------------------------- NOAA / ENSO
def parse_noaa_mensual(texto):
    """sstoi.indices: YR MON NINO1+2 ANOM NINO3 ANOM NINO4 ANOM NINO3.4 ANOM."""
    filas = []
    for linea in (texto or "").splitlines():
        p = linea.split()
        if len(p) < 10 or not p[0].isdigit():
            continue
        try:
            filas.append({"anio": int(p[0]), "mes": int(p[1]), "n12": float(p[2]), "n12a": float(p[3]),
                          "n3a": float(p[5]), "n4a": float(p[7]), "n34": float(p[8]), "n34a": float(p[9])})
        except ValueError:
            continue
    if not filas:
        raise RuntimeError("sstoi.indices sin filas válidas")
    return filas


def parse_noaa_semanal(texto):
    """wksst9120.for: ' 21OCT2026     26.3 5.2     29.4 4.3 ...' (8 números: Niño1+2, 3, 3.4, 4)."""
    filas = []
    for linea in (texto or "").splitlines():
        m = re.match(r"^\s*(\d{2})([A-Z]{3})(\d{4})\s+(.*)$", linea)
        if not m:
            continue
        nums = re.findall(r"-?\d+\.\d", m.group(4))
        if len(nums) < 8:
            continue
        try:
            dt = datetime.strptime(f"{m.group(1)}{m.group(2)}{m.group(3)}", "%d%b%Y")
        except ValueError:
            continue
        v = [float(x) for x in nums[:8]]
        filas.append({"semana": dt.strftime("%Y-%m-%d"), "n12": v[0], "n12a": v[1], "n3a": v[3], "n34": v[4], "n34a": v[5], "n4a": v[7]})
    if not filas:
        raise RuntimeError("wksst9120.for sin filas válidas")
    filas.sort(key=lambda r: r["semana"])
    return filas


def categoria_icen(valor):
    if valor is None:
        return None
    for lo, hi, nombre in ICEN_CATEGORIAS:
        if lo <= valor < hi:
            return nombre
    return None


def proxy_icen(mensual):
    """Promedio móvil de 3 meses (centrado en el mes del medio, como el ICEN) de la anomalía Niño 1+2.
    Es un PROXY calculado con OISST de NOAA; el ICEN oficial lo publica el ENFEN con ERSSTv5."""
    out = []
    for i in range(1, len(mensual) - 1):
        v = round((mensual[i - 1]["n12a"] + mensual[i]["n12a"] + mensual[i + 1]["n12a"]) / 3, 2)
        out.append({"anio": mensual[i]["anio"], "mes": mensual[i]["mes"], "valor": v, "categoria": categoria_icen(v)})
    return out


def construir_enso(mensual, semanal, prev):
    """Si una de las dos series falló, se reutiliza la publicada antes (última versión válida)."""
    prev = prev if isinstance(prev, dict) else {}
    mensual = mensual or [m for m in prev.get("mensual", []) if isinstance(m, dict) and "n12a" in m]
    semanal = semanal or [s for s in prev.get("semanal", []) if isinstance(s, dict) and "n12a" in s]
    ic = proxy_icen(mensual) if len(mensual) >= 3 else prev.get("icen_proxy", [])
    ultimo_m = mensual[-1] if mensual else None
    ultimo_s = semanal[-1] if semanal else None
    return {
        "generado_utc": ahora_iso(),
        "clim_base": "1991-2020",
        "mensual": [{k: r[k] for k in ("anio", "mes", "n12", "n12a", "n34", "n34a")} for r in mensual] if mensual else (prev or {}).get("mensual", []),
        "semanal": semanal[-104:] if semanal else (prev or {}).get("semanal", []),
        "icen_proxy": ic,
        "actual": {
            "mes": f"{ultimo_m['anio']}-{ultimo_m['mes']:02d}" if ultimo_m else (prev or {}).get("actual", {}).get("mes"),
            "n12_anomalia_mensual": ultimo_m["n12a"] if ultimo_m else None,
            "n34_anomalia_mensual": ultimo_m["n34a"] if ultimo_m else None,
            "semana": ultimo_s["semana"] if ultimo_s else None,
            "n12_anomalia_semanal": ultimo_s["n12a"] if ultimo_s else None,
            "n12_sst_semanal": ultimo_s["n12"] if ultimo_s else None,
            "n34_anomalia_semanal": ultimo_s["n34a"] if ultimo_s else None,
            "icen_proxy": ic[-1]["valor"] if ic else None,
            "icen_proxy_mes": f"{ic[-1]['anio']}-{ic[-1]['mes']:02d}" if ic else None,
            "icen_categoria": ic[-1]["categoria"] if ic else None,
        },
        "nota": "Anomalías de temperatura superficial del mar (°C) respecto a 1991–2020 (NOAA OISST v2.1). "
                "El 'proxy del ICEN' es el promedio móvil de 3 meses de la anomalía Niño 1+2 calculado aquí; "
                "no es el ICEN oficial del ENFEN (que usa ERSSTv5) y puede diferir en décimas.",
    }


# ------------------------------------------------------------------------ ENFEN
def parse_enfen(texto):
    """Extrae el último comunicado de la página de comunicados (bloque 'ULTIMO COMUNICADO')."""
    plano = html.unescape(re.sub(r"<[^>]+>", " ", texto or ""))
    plano = re.sub(r"\s+", " ", plano)
    m = re.search(r"Comunicado Oficial ENFEN N[°º]?\s*([0-9]{1,3})-(\d{4})\s+(\d{1,2}\s+[A-Za-záéíóú]+,?\s+\d{4})", plano, re.I)
    if not m:
        raise RuntimeError("no se encontró el último comunicado en la página")
    url = None
    mm = re.search(r'href="(https://enfen\.imarpe\.gob\.pe/download/comunicado-oficial-enfen-n-%s-%s/[^"]*)"' % (m.group(1), m.group(2)), texto, re.I)
    if mm:
        url = html.unescape(mm.group(1)).split("?")[0]  # sin el token 'refresh' que cambia en cada visita
    meses = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
             "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
    fm = re.match(r"(\d{1,2})\s+([A-Za-záéíóú]+),?\s+(\d{4})", m.group(3))
    fecha = None
    if fm and fm.group(2).lower() in meses:
        fecha = f"{fm.group(3)}-{meses[fm.group(2).lower()]:02d}-{int(fm.group(1)):02d}"
    # Estado del sistema de alerta si aparece en la página
    estado = None
    me = re.search(r"(Alerta|Vigilancia|No activo)\s+de\s+(El Niño|La Niña)\s+Coster[oa]", plano, re.I)
    if me:
        estado = f"{me.group(1)} de {me.group(2)} Costero" if me.group(2).lower() == "el niño" else f"{me.group(1)} de {me.group(2)} Costera"
    return {"numero": f"{int(m.group(1)):02d}-{m.group(2)}", "fecha": fecha, "titulo": f"Comunicado Oficial ENFEN N° {int(m.group(1)):02d}-{m.group(2)}",
            "url": url, "pagina": ENFEN_URL, "estado_alerta": estado}


# ---------------------------------------------------------------------- SENAMHI
def descargar_avisos_met(fetch=http_get):
    feats = wfs_json("g_aviso:view_aviso", ["gid", "nro_aviso", "nivel", "fecha_emi", "cod_fen", "cod_even", "fech_ini", "fech_fin", "respons"], fetch=fetch)
    aux = []
    try:
        aux = wfs_json("g_aviso:view_aviso_aux", ["nro_aviso", "nivel", "nombdep", "nombprov"], fetch=fetch)
    except Exception as e:  # noqa: BLE001
        log("aviso", fuente="SENAMHI_AVISO", detalle=f"sin desagregación por departamento: {e}")
    por_aviso = {}
    for a in aux:
        p = a.get("properties") or {}
        por_aviso.setdefault(str(p.get("nro_aviso")), set()).add(_txt(p.get("nombdep"), 60))
    avisos = []
    for f in feats:
        p = f.get("properties") or {}
        avisos.append({"numero": _txt(p.get("nro_aviso"), 20), "nivel": _nivel(p.get("nivel")), "emision": _fecha(p.get("fecha_emi")),
                       "inicio": _fecha(p.get("fech_ini")), "fin": _fecha(p.get("fech_fin")), "fenomeno": _txt(p.get("cod_fen"), 80),
                       "evento": _txt(p.get("cod_even"), 80), "responsable": _txt(p.get("respons"), 40),
                       "departamentos": sorted(d for d in por_aviso.get(str(p.get("nro_aviso")), set()) if d)})
    return avisos


def descargar_aviso_24h(fetch=http_get):
    feats = wfs_json("g_prono_pp_24h:view_aviso24h", ["gid", "nivel", "fecha", "descripcio", "recomendac", "respons"], fetch=fetch)
    return [{"nivel": _nivel(p.get("nivel")), "fecha": _fecha(p.get("fecha")), "descripcion": _txt(p.get("descripcio")),
             "recomendacion": _txt(p.get("recomendac"))} for p in (f.get("properties") or {} for f in feats)]


def descargar_hidro(fetch=http_get):
    feats = wfs_json("g_dbphisis:aviso_hidro_pub", fetch=fetch)
    out = []
    for f in feats:
        p = f.get("properties") or {}
        lat, lon = _num(p.get("latitud")), _num(p.get("longitud"))
        if not coord_valida(lat, lon):
            g = f.get("geometry") or {}
            c = g.get("coordinates") if g.get("type") == "Point" else None
            lon, lat = (_num(c[0]), _num(c[1])) if c else (None, None)
        out.append({"id": _txt(p.get("id_aviso"), 20), "numero": _txt(p.get("num_aviso"), 20), "nivel": _nivel(p.get("nivel")),
                    "color": _txt(p.get("color_text"), 20), "fecha": _fecha(p.get("fecha_hora")), "titulo": _txt(p.get("titulo"), 200),
                    "estacion": _txt(p.get("nom_estacion"), 80), "cuenca": _txt(p.get("nom_cuenca"), 80), "region_hidrografica": _txt(p.get("nom_und_hidro"), 80),
                    "departamento": _txt(p.get("nom_departamento"), 60), "provincia": _txt(p.get("nom_provincia"), 60), "distrito": _txt(p.get("nom_distrito"), 60),
                    "peligro": _txt(p.get("peligro_nivel")), "recomendacion": _txt(p.get("recomendacion_nivel")),
                    "lat": round(lat, 4) if lat is not None else None, "lon": round(lon, 4) if lon is not None else None})
    return out


def descargar_umbrales(fetch=http_get):
    feats = wfs_json("g_umbrales:umbrales_precipitacion", fetch=fetch)
    est = []
    for f in feats:
        p = f.get("properties") or {}
        g = f.get("geometry") or {}
        c = g.get("coordinates") if g.get("type") == "Point" else None
        lon, lat = (_num(c[0]), _num(c[1])) if c else (None, None)
        pp, umb, ppa, umba = _num(p.get("pp")), _num(p.get("umbral")), _num(p.get("pp_acum")), _num(p.get("umb_acum"))
        est.append({"estacion": _txt(p.get("nombre"), 80), "departamento": _txt(p.get("departamento"), 60), "provincia": _txt(p.get("provincia"), 60),
                    "distrito": _txt(p.get("distrito"), 60), "cuenca": _txt(p.get("cuenca"), 80), "fecha": _fecha(p.get("fecha")), "hora": _txt(p.get("hora"), 8),
                    "pp_mm": pp, "umbral_mm": umb, "pp_acum_mm": ppa, "umbral_acum_mm": umba,
                    "supera": bool(pp is not None and umb is not None and umb > 0 and pp >= umb),
                    "supera_acum": bool(ppa is not None and umba is not None and umba > 0 and ppa >= umba),
                    "lat": round(lat, 4) if lat is not None else None, "lon": round(lon, 4) if lon is not None else None})
    return est


def descargar_quebradas(fetch=http_get):
    ccpp = wfs_json("g_acti_quebrada:ccpp_filter",
                    ["arnombre", "nomb_dep", "nomb_pro", "nomb_dist", "nivel", "fecha", "viv_total", "pob_total", "longitud", "latitud", "descripcion", "recomendacion"],
                    fetch=fetch)
    filas, fechas, descr = [], set(), {}
    for f in ccpp:
        p = f.get("properties") or {}
        lat, lon = _num(p.get("latitud")), _num(p.get("longitud"))
        n = _nivel(p.get("nivel"))
        if not coord_valida(lat, lon) or n is None:
            continue
        filas.append([_txt(p.get("arnombre"), 80), _txt(p.get("nomb_dep"), 60), _txt(p.get("nomb_pro"), 60), _txt(p.get("nomb_dist"), 60), n,
                      int(_num(p.get("pob_total")) or 0), int(_num(p.get("viv_total")) or 0), round(lat, 4), round(lon, 4)])
        if _fecha(p.get("fecha")):
            fechas.add(_fecha(p.get("fecha")))
        descr.setdefault(n, {"descripcion": _txt(p.get("descripcion")), "recomendacion": _txt(p.get("recomendacion"))})
    if not filas:
        raise RuntimeError("respuesta sin centros poblados válidos")
    distritos = wfs_json("g_acti_quebrada:view_av_activ_qdra", ["nivel", "fecha", "nombdep", "nombprov", "nombdist"], fetch=fetch)
    dist = [{"departamento": _txt(p.get("nombdep"), 60), "provincia": _txt(p.get("nombprov"), 60), "distrito": _txt(p.get("nombdist"), 60), "nivel": _nivel(p.get("nivel"))}
            for p in (f.get("properties") or {} for f in distritos) if _nivel(p.get("nivel"))]
    por_dep = {}
    for r in filas:
        d = por_dep.setdefault(r[1], {"departamento": r[1], "ccpp": 0, "poblacion": 0, "viviendas": 0, "n2": 0, "n3": 0, "n4": 0})
        d["ccpp"] += 1
        d["poblacion"] += r[5]
        d["viviendas"] += r[6]
        d[f"n{r[4]}"] += 1
    expuestos = {}
    for k in ("eess", "iiee", "vial_nacional", "vial_departamental", "vial_vecinal"):
        try:
            expuestos[k] = wfs_hits(f"g_acti_quebrada:{k}_filter", fetch=fetch)
        except Exception:  # noqa: BLE001
            expuestos[k] = None
    return {
        "fecha_aviso": max(fechas) if fechas else None,
        "campos": CAMPOS_CCPP,
        "filas": sorted(filas, key=lambda r: (-r[4], -r[5])),
        "niveles": {str(k): v for k, v in sorted(descr.items())},
        "resumen": {
            "ccpp": len(filas), "poblacion": sum(r[5] for r in filas), "viviendas": sum(r[6] for r in filas),
            "ccpp_por_nivel": {str(n): sum(1 for r in filas if r[4] == n) for n in (2, 3, 4)},
            "poblacion_por_nivel": {str(n): sum(r[5] for r in filas if r[4] == n) for n in (2, 3, 4)},
            "distritos": len(dist), "distritos_por_nivel": {str(n): sum(1 for d in dist if d["nivel"] == n) for n in (2, 3, 4)},
            "departamentos": sorted(por_dep.values(), key=lambda d: (-(d["n4"] * 1000 + d["n3"]), -d["poblacion"])),
            "distritos_nivel4": sorted([d for d in dist if d["nivel"] == 4], key=lambda d: (d["departamento"] or "", d["provincia"] or "", d["distrito"] or "")),
            "expuestos": expuestos,
        },
    }


def descargar_silvia(fetch=http_get):
    dias = []
    for i in (1, 2, 3):
        feats = wfs_json(f"silvia:cuencas_nivel_12_prono{i}_silvia", ["clase", "silvia", "fecha"], fetch=fetch)
        fechas = {_fecha(p.get("fecha")) for p in (f.get("properties") or {} for f in feats)} - {None}
        niveles = contar(feats, lambda f: _nivel((f.get("properties") or {}).get("silvia")))
        dias.append({"dia": i, "fecha_emision": max(fechas) if fechas else None, "cuencas": len(feats),
                     "por_nivel": {str(k): v for k, v in niveles}})
    return dias


def descargar_sonics(fetch=http_get):
    dias, puntos = [], []
    for i in range(1, 8):
        capa = f"dhi-seh-sonics:SONICS-CCPP-PRONOSTICO-{i:02d}"
        if i == 1:
            feats = wfs_json(capa, fetch=fetch)  # con geometría: puntos del mapa
            for f in feats:
                p = f.get("properties") or {}
                g = f.get("geometry") or {}
                c = g.get("coordinates") if g.get("type") == "Point" else None
                lon, lat = (_num(c[0]), _num(c[1])) if c else (None, None)
                n = _nivel(p.get("nivel"))
                if coord_valida(lat, lon) and n:
                    puntos.append([_txt(p.get("arnombre"), 80), _txt(p.get("nomb_dep"), 60), _txt(p.get("nomb_pro"), 60), _txt(p.get("nomb_dist"), 60), n, round(lat, 4), round(lon, 4)])
        else:
            feats = wfs_json(capa, ["nomb_dep", "nivel"], fetch=fetch)
        props = [f.get("properties") or {} for f in feats]
        dias.append({"dia": i, "ccpp": len(props), "por_nivel": {str(k): v for k, v in contar(props, lambda p: _nivel(p.get("nivel")))},
                     "por_departamento": [{"departamento": k, "ccpp": v} for k, v in contar(props, lambda p: _txt(p.get("nomb_dep"), 60))][:15]})
    return {"dias": dias, "campos_dia1": ["nombre", "departamento", "provincia", "distrito", "nivel", "lat", "lon"], "dia1": sorted(puntos, key=lambda r: -r[4])}


def descargar_estacional(fetch=http_get):
    base = ["sectores", "escenario", "emision"]
    out = {}
    out["verano"] = [p for p in (f.get("properties") or {} for f in wfs_json("spc:prono_verano_poligono", base + ["inferior", "normal", "superior", "variable", "trimestre"], fetch=fetch))]
    out["trimestre_pp"] = [p for p in (f.get("properties") or {} for f in wfs_json("spc:prono_trim_poligono_pp1", base + ["inferior", "normal", "superior", "variable", "trimestre"], fetch=fetch))]
    for var in ("pp", "tmax", "tmin"):
        try:
            out[f"mes_{var}"] = [p for p in (f.get("properties") or {} for f in wfs_json(f"spc:prono_mensual_poligono_{var}1", base + ["bajo", "normal", "superior", "mes"], fetch=fetch))]
        except Exception as e:  # noqa: BLE001
            log("aviso", fuente="SENAMHI_ESTACIONAL", capa=var, detalle=str(e)[:200])
            out[f"mes_{var}"] = []

    def limpiar(p):
        return {"sector": _txt(p.get("sectores"), 60), "escenario": _txt(p.get("escenario"), 40), "emision": _fecha(p.get("emision")),
                "inferior": _num(p.get("inferior") if "inferior" in p else p.get("bajo")), "normal": _num(p.get("normal")), "superior": _num(p.get("superior")),
                "periodo": _txt(p.get("trimestre") or (MESES.get(int(_num(p.get("mes")) or 0), f"mes {p.get('mes')}") if p.get("mes") is not None else None), 40),
                "variable": _txt(p.get("variable"), 40)}
    return {k: [limpiar(p) for p in v] for k, v in out.items()}


# ------------------------------------------------------------------- Open-Meteo
def descargar_pronostico(fetch=http_get, ciudades=CIUDADES):
    q = {"latitude": ",".join(str(c[2]) for c in ciudades), "longitude": ",".join(str(c[3]) for c in ciudades),
         "daily": "precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,apparent_temperature_max,weather_code",
         "timezone": "America/Lima", "forecast_days": 7}
    d = json.loads(fetch(f"{OPEN_METEO}?{urllib.parse.urlencode(q)}"))
    if isinstance(d, dict):
        d = [d]
    if not isinstance(d, list) or len(d) != len(ciudades):
        raise RuntimeError(f"Open-Meteo devolvió {len(d) if isinstance(d, list) else '?'} series para {len(ciudades)} ciudades")
    out = []
    for (nombre, dep, lat, lon), r in zip(ciudades, d):
        dy = r.get("daily") or {}
        dias = []
        for i, fecha in enumerate(dy.get("time") or []):
            def v(k):
                xs = dy.get(k) or []
                return _num(xs[i]) if i < len(xs) else None
            dias.append({"fecha": fecha, "pp": v("precipitation_sum"), "prob": v("precipitation_probability_max"), "tmax": v("temperature_2m_max"),
                         "tmin": v("temperature_2m_min"), "tapp": v("apparent_temperature_max"), "codigo": v("weather_code")})
        if not dias:
            raise RuntimeError(f"Open-Meteo sin días para {nombre}")
        pps = [x["pp"] for x in dias if x["pp"] is not None]
        tmx = [x["tmax"] for x in dias if x["tmax"] is not None]
        out.append({"ciudad": nombre, "departamento": dep, "lat": lat, "lon": lon, "dias": dias,
                    "pp_7d": round(sum(pps), 1) if pps else None, "pp_max_dia": max(pps) if pps else None, "tmax_max": max(tmx) if tmx else None,
                    "modelo": r.get("model") or "open-meteo best match"})
    return out


def descargar_caudales(fetch=http_get, rios=RIOS):
    q = {"latitude": ",".join(str(c[2]) for c in rios), "longitude": ",".join(str(c[3]) for c in rios),
         "daily": "river_discharge,river_discharge_max", "past_days": 30, "forecast_days": 7}
    d = json.loads(fetch(f"{OPEN_METEO_FLOOD}?{urllib.parse.urlencode(q)}"))
    if isinstance(d, dict):
        d = [d]
    if not isinstance(d, list) or len(d) != len(rios):
        raise RuntimeError("Open-Meteo flood devolvió un número distinto de series")
    out, hoy = [], ahora().strftime("%Y-%m-%d")
    for (nombre, dep, lat, lon), r in zip(rios, d):
        dy = r.get("daily") or {}
        t, q1, q2 = dy.get("time") or [], dy.get("river_discharge") or [], dy.get("river_discharge_max") or []
        serie = [{"fecha": t[i], "q": _num(q1[i]) if i < len(q1) else None, "qmax": _num(q2[i]) if i < len(q2) else None} for i in range(len(t))]
        pasado = [s["q"] for s in serie if s["fecha"] < hoy and s["q"] is not None]
        futuro = [s["qmax"] if s["qmax"] is not None else s["q"] for s in serie if s["fecha"] >= hoy and (s["q"] is not None or s["qmax"] is not None)]
        media = round(sum(pasado) / len(pasado), 2) if pasado else None
        pico = max(futuro) if futuro else None
        ratio = round(pico / media, 2) if media and pico is not None and media > 0 else None
        out.append({"rio": nombre, "departamento": dep, "lat": lat, "lon": lon, "serie": serie, "media_30d": media, "pico_7d": pico, "ratio": ratio})
    return out


# ---------------------------------------------------------------------- alertas
def construir_alertas(enso, enfen, avisos, quebradas, silvia, sonics, pronostico, caudales):
    """Síntesis ordenable por nivel (1 bajo … 4 muy alto). 'origen' distingue aviso oficial,
    salida de modelo global o cálculo propio. Nunca inventa: cada alerta cita su dato."""
    al = []
    a = (enso or {}).get("actual") or {}
    cat = a.get("icen_categoria")
    if cat:
        nivel = 4 if "extraordinaria" in cat else 3 if "fuerte" in cat else 2 if "moderada" in cat else 1
        al.append({"id": "enso-icen", "tipo": "enso", "nivel": nivel, "origen": "calculado",
                   "titulo": f"Condición {cat} en Niño 1+2 (proxy del ICEN {a.get('icen_proxy'):+.2f} °C, {a.get('icen_proxy_mes')})",
                   "detalle": f"Anomalía semanal Niño 1+2 al {a.get('semana')}: {a.get('n12_anomalia_semanal'):+.1f} °C; Niño 3.4: {a.get('n34_anomalia_semanal'):+.1f} °C. Cálculo propio sobre datos NOAA; el diagnóstico oficial es del ENFEN."
                   if a.get("n12_anomalia_semanal") is not None else "Cálculo propio sobre NOAA OISST; el diagnóstico oficial es del ENFEN.",
                   "fuente": "NOAA CPC · cálculo del observatorio", "url": NOAA_SEMANAL})
    if enfen and enfen.get("titulo"):
        al.append({"id": "enfen", "tipo": "enso", "nivel": 3 if (enfen.get("estado_alerta") or "").lower().startswith("alerta") else 2, "origen": "oficial",
                   "titulo": f"{enfen['titulo']} ({enfen.get('fecha') or 's/f'})" + (f": {enfen['estado_alerta']}" if enfen.get("estado_alerta") else ""),
                   "detalle": "Diagnóstico y perspectiva quincenal oficial de la Comisión Multisectorial ENFEN. El PDF contiene la magnitud prevista y las recomendaciones.",
                   "fuente": "ENFEN (IMARPE, SENAMHI, IGP, ANA, INDECI, DHN)", "url": enfen.get("url") or enfen.get("pagina")})
    for av in (avisos or {}).get("meteorologicos", []):
        if av.get("nivel"):
            al.append({"id": f"aviso-met-{av.get('numero')}", "tipo": "lluvias", "nivel": av["nivel"], "origen": "oficial",
                       "titulo": f"Aviso meteorológico N° {av.get('numero')} · nivel {av['nivel']}" + (f" · {av['evento']}" if av.get("evento") else ""),
                       "detalle": f"Vigencia {av.get('inicio') or '?'} → {av.get('fin') or '?'}. " + (f"Departamentos: {', '.join(av['departamentos'][:12])}." if av.get("departamentos") else ""),
                       "fuente": "SENAMHI · aviso meteorológico", "url": "https://www.senamhi.gob.pe/?p=aviso-meteorologico"})
    for h in (avisos or {}).get("hidrologicos", []):
        if h.get("nivel"):
            al.append({"id": f"hidro-{h.get('id')}", "tipo": "rios", "nivel": h["nivel"], "origen": "oficial",
                       "titulo": f"{h.get('titulo') or 'Aviso hidrológico'} (nivel {h['nivel']}, {h.get('color') or ''})".replace(", )", ")"),
                       "detalle": f"{h.get('peligro') or ''} {h.get('departamento') or ''} · {h.get('fecha') or ''}".strip(),
                       "fuente": "SENAMHI · aviso hidrológico", "url": "https://www.senamhi.gob.pe/?p=aviso-hidrologico"})
    sup = [u for u in (avisos or {}).get("umbrales", []) if u.get("supera") or u.get("supera_acum")]
    if sup:
        al.append({"id": "umbrales", "tipo": "lluvias", "nivel": 3 if len(sup) >= 5 else 2, "origen": "oficial",
                   "titulo": f"{len(sup)} {'estación' if len(sup) == 1 else 'estaciones'} con lluvia por encima de su umbral ({(avisos or {}).get('umbrales_fecha') or 'hoy'})",
                   "detalle": "; ".join(
                       f"{u['estacion']} ({u['departamento']}): " + (f"{u['pp_mm']} mm en el día vs umbral {u['umbral_mm']} mm" if u.get("supera")
                                                                      else f"{u['pp_acum_mm']} mm acumulados vs umbral {u['umbral_acum_mm']} mm")
                       for u in sup[:8]),
                   "fuente": "SENAMHI · umbrales de precipitación", "url": "https://idesep.senamhi.gob.pe/"})
    r = (quebradas or {}).get("resumen") or {}
    if r.get("ccpp"):
        n4, n3 = r["ccpp_por_nivel"].get("4", 0), r["ccpp_por_nivel"].get("3", 0)
        nivel = 4 if n4 else 3 if n3 else 2
        deps = [d["departamento"] for d in r.get("departamentos", [])[:6]]
        al.append({"id": "quebradas", "tipo": "huaycos", "nivel": nivel, "origen": "oficial",
                   "titulo": f"Activación de quebradas: {_miles(n4)} centros poblados en nivel 4 y {_miles(n3)} en nivel 3 ({quebradas.get('fecha_aviso') or 's/f'})",
                   "detalle": f"{_miles(r['poblacion'])} habitantes y {_miles(r['viviendas'])} viviendas en zonas con aviso (niveles 2–4). Más expuestos: {', '.join(deps)}.",
                   "fuente": "SENAMHI · aviso de activación de quebradas", "url": "https://www.senamhi.gob.pe/?p=aviso-activacion-quebradas"})
    if silvia:
        d1 = silvia[0]
        n4 = d1.get("por_nivel", {}).get("4", 0)
        n3 = d1.get("por_nivel", {}).get("3", 0)
        if n4 or n3:
            al.append({"id": "silvia", "tipo": "huaycos", "nivel": 4 if n4 >= 50 else 3 if n4 or n3 >= 100 else 2, "origen": "oficial",
                       "titulo": f"Movimientos en masa por lluvias (SILVIA): {n4} cuencas en nivel 4 y {n3} en nivel 3 para mañana",
                       "detalle": f"Pronóstico a 3 días por subcuenca (nivel 12). Día 2: {silvia[1]['por_nivel'] if len(silvia) > 1 else '-'}; día 3: {silvia[2]['por_nivel'] if len(silvia) > 2 else '-'}.",
                       "fuente": "SENAMHI · SILVIA", "url": "https://www.senamhi.gob.pe/?p=silvia"})
    if sonics and sonics.get("dias"):
        d1 = sonics["dias"][0]
        n3 = d1.get("por_nivel", {}).get("3", 0)
        n2 = d1.get("por_nivel", {}).get("2", 0)
        if n3 or n2:
            al.append({"id": "sonics", "tipo": "rios", "nivel": 3 if n3 >= 50 else 2, "origen": "oficial",
                       "titulo": f"Crecida fluvial (SONICS): {n3} centros poblados en nivel 3 y {n2} en nivel 2 para mañana",
                       "detalle": "Pronóstico hidrológico a 7 días por tramo de río. Departamentos: " + ", ".join(f"{d['departamento']} ({d['ccpp']})" for d in d1.get("por_departamento", [])[:6]) + ".",
                       "fuente": "SENAMHI · SONICS", "url": "https://www.senamhi.gob.pe/?p=pronostico-hidrologico"})
    lluv = [c for c in (pronostico or []) if c.get("pp_max_dia") is not None and c["pp_max_dia"] >= 20]
    if lluv:
        lluv.sort(key=lambda c: -c["pp_max_dia"])
        al.append({"id": "om-lluvia", "tipo": "lluvias", "nivel": 3 if any(c["pp_max_dia"] >= 40 for c in lluv) else 2, "origen": "modelo",
                   "titulo": f"Modelo global: lluvia diaria ≥ 20 mm prevista en {len(lluv)} {'ciudad' if len(lluv) == 1 else 'ciudades'} (7 días)",
                   "detalle": "; ".join(f"{c['ciudad']} {c['pp_max_dia']:.0f} mm" for c in lluv[:8]) + ". Open-Meteo no sustituye el aviso oficial del SENAMHI.",
                   "fuente": "Open-Meteo (modelos globales)", "url": "https://open-meteo.com/"})
    calor = [c for c in (pronostico or []) if c.get("tmax_max") is not None and c["tmax_max"] >= 33]
    if calor:
        calor.sort(key=lambda c: -c["tmax_max"])
        al.append({"id": "om-calor", "tipo": "calor", "nivel": 3 if any(c["tmax_max"] >= 36 for c in calor) else 2, "origen": "modelo",
                   "titulo": f"Modelo global: temperatura máxima ≥ 33 °C prevista en {len(calor)} {'ciudad' if len(calor) == 1 else 'ciudades'} (7 días)",
                   "detalle": "; ".join(f"{c['ciudad']} {c['tmax_max']:.0f} °C" for c in calor[:8]) + ".",
                   "fuente": "Open-Meteo (modelos globales)", "url": "https://open-meteo.com/"})
    crec = [c for c in (caudales or []) if c.get("ratio") is not None and c["ratio"] >= 2]
    if crec:
        crec.sort(key=lambda c: -c["ratio"])
        al.append({"id": "glofas", "tipo": "rios", "nivel": 3 if any(c["ratio"] >= 4 for c in crec) else 2, "origen": "modelo",
                   "titulo": f"GloFAS: caudal previsto ≥ 2× la media de los últimos 30 días en {len(crec)} {'río' if len(crec) == 1 else 'ríos'}",
                   "detalle": "; ".join(f"{c['rio']} ×{c['ratio']:.1f}" for c in crec[:8]) + ". Modelo global de 5 km, referencial.",
                   "fuente": "Open-Meteo · GloFAS (Copernicus)", "url": "https://open-meteo.com/en/docs/flood-api"})
    al.sort(key=lambda x: (-x["nivel"], 0 if x["origen"] == "oficial" else 1, x["titulo"]))
    return al


# --------------------------------------------------------------------- ejecutar
def ejecutar(fetch=http_get, now=None):
    t0 = time.time()
    hasta = now or ahora()
    os.makedirs(OUT_DIR, exist_ok=True)
    estado_previo = leer_json("estado.json", {}, tipo=dict)
    fuentes_previas = {f.get("id"): f for f in estado_previo.get("fuentes", []) if isinstance(f, dict) and f.get("id")}
    sin_senamhi = os.environ.get("NINO_SIN_SENAMHI") == "1"
    sin_om = os.environ.get("NINO_SIN_OPEN_METEO") == "1"

    tareas = {
        "NOAA_MENSUAL": ("NOAA CPC · Niño 1+2 y 3.4 mensual", "ENSO", lambda: parse_noaa_mensual(fetch(NOAA_MENSUAL))),
        "NOAA_SEMANAL": ("NOAA CPC · Niño 1+2 y 3.4 semanal", "ENSO", lambda: parse_noaa_semanal(fetch(NOAA_SEMANAL))),
        "ENFEN": ("ENFEN · último comunicado oficial", "ENSO", lambda: parse_enfen(fetch(ENFEN_URL))),
    }
    if not sin_senamhi:
        tareas.update({
            "SENAMHI_AVISO": ("SENAMHI · avisos meteorológicos vigentes", "aviso", lambda: descargar_avisos_met(fetch)),
            "SENAMHI_AVISO24H": ("SENAMHI · pronóstico de lluvia 24 h", "aviso", lambda: descargar_aviso_24h(fetch)),
            "SENAMHI_HIDRO": ("SENAMHI · avisos hidrológicos", "aviso", lambda: descargar_hidro(fetch)),
            "SENAMHI_UMBRALES": ("SENAMHI · umbrales de precipitación", "aviso", lambda: descargar_umbrales(fetch)),
            "SENAMHI_QUEBRADAS": ("SENAMHI · activación de quebradas", "aviso", lambda: descargar_quebradas(fetch)),
            "SENAMHI_SILVIA": ("SENAMHI · SILVIA movimientos en masa", "pronostico", lambda: descargar_silvia(fetch)),
            "SENAMHI_SONICS": ("SENAMHI · SONICS crecidas fluviales", "pronostico", lambda: descargar_sonics(fetch)),
            "SENAMHI_ESTACIONAL": ("SENAMHI · pronóstico estacional", "pronostico", lambda: descargar_estacional(fetch)),
        })
    if not sin_om:
        tareas.update({
            "OPEN_METEO": ("Open-Meteo · pronóstico 7 días (30 ciudades)", "modelo", lambda: descargar_pronostico(fetch)),
            "OPEN_METEO_CAUDAL": ("Open-Meteo · GloFAS caudal (18 ríos)", "modelo", lambda: descargar_caudales(fetch)),
        })

    resultados, fuentes_estado = {}, []

    def correr(fid):
        nombre, tipo, fn = tareas[fid]
        ti, prev = time.time(), fuentes_previas.get(fid, {})
        st = {"id": fid, "nombre": nombre, "tipo": tipo, "ultimo_exito": prev.get("ultimo_exito"), "registros": prev.get("registros")}
        try:
            res = fn()
            n = len(res) if isinstance(res, (list, dict)) else 1
            st.update(estado="ok", error=None, ultimo_exito=ahora_iso(hasta), registros=n)
            return fid, st, res, int((time.time() - ti) * 1000)
        except Exception as e:  # noqa: BLE001
            st.update(estado="error", error=str(e)[:300])
            return fid, st, None, int((time.time() - ti) * 1000)

    with ThreadPoolExecutor(max_workers=4) as ex:
        for fid, st, res, ms in ex.map(correr, list(tareas)):
            st["duracion_ms"] = ms
            fuentes_estado.append(st)
            resultados[fid] = res
            log("fuente", **st)
    for fid, prev in fuentes_previas.items():
        if fid not in tareas:  # fuente omitida por variable de entorno: se conserva su estado previo
            fuentes_estado.append(prev)

    ok = lambda fid: resultados.get(fid) is not None  # noqa: E731

    # ENSO (el archivo previo cubre cualquier fuente caída)
    enso_prev = leer_json("enso.json", {}, tipo=dict)
    enso = construir_enso(resultados.get("NOAA_MENSUAL"), resultados.get("NOAA_SEMANAL"), enso_prev) if ok("NOAA_MENSUAL") or ok("NOAA_SEMANAL") else enso_prev
    if enso:
        escribir("enso.json", enso)
    enfen = resultados.get("ENFEN") or leer_json("enfen.json", None, tipo=dict)
    if enfen:
        escribir("enfen.json", {**enfen, "generado_utc": ahora_iso(hasta)})

    avisos_prev = leer_json("avisos.json", {}, tipo=dict)
    umb = resultados.get("SENAMHI_UMBRALES")
    avisos = {
        "generado_utc": ahora_iso(hasta),
        "meteorologicos": resultados["SENAMHI_AVISO"] if ok("SENAMHI_AVISO") else avisos_prev.get("meteorologicos", []),
        "lluvia_24h": resultados["SENAMHI_AVISO24H"] if ok("SENAMHI_AVISO24H") else avisos_prev.get("lluvia_24h", []),
        "hidrologicos": resultados["SENAMHI_HIDRO"] if ok("SENAMHI_HIDRO") else avisos_prev.get("hidrologicos", []),
        "umbrales": umb if umb is not None else avisos_prev.get("umbrales", []),
        "umbrales_fecha": (max((u["fecha"] for u in umb if u.get("fecha")), default=None) if umb else avisos_prev.get("umbrales_fecha")),
    }
    escribir("avisos.json", avisos)
    escribir_csv("nino-avisos-hidro.csv", ["lon", "lat", "fecha", "nivel", "color", "titulo", "estacion", "cuenca", "departamento", "provincia", "distrito", "peligro", "recomendacion"],
                 [[h["lon"], h["lat"], h["fecha"], h["nivel"], h["color"], h["titulo"], h["estacion"], h["cuenca"], h["departamento"], h["provincia"], h["distrito"], h["peligro"], h["recomendacion"]]
                  for h in avisos["hidrologicos"]])

    quebradas = resultados.get("SENAMHI_QUEBRADAS") or leer_json("quebradas.json", None, tipo=dict)
    if quebradas:
        escribir("quebradas.json", {**quebradas, "generado_utc": ahora_iso(hasta)})
        escribir_csv("nino-quebradas-ccpp.csv", ["lon", "lat"] + [c for c in CAMPOS_CCPP if c not in ("lat", "lon")],
                     [[r[8], r[7]] + r[:7] for r in quebradas.get("filas", []) if isinstance(r, list) and len(r) >= 9])
    silvia = resultados.get("SENAMHI_SILVIA") or (leer_json("silvia.json", {}, tipo=dict).get("dias"))
    if silvia:
        escribir("silvia.json", {"generado_utc": ahora_iso(hasta), "dias": silvia})
    sonics = resultados.get("SENAMHI_SONICS") or leer_json("sonics.json", None, tipo=dict)
    if sonics:
        escribir("sonics.json", {**sonics, "generado_utc": ahora_iso(hasta)})
    estacional = resultados.get("SENAMHI_ESTACIONAL") or leer_json("estacional.json", None, tipo=dict)
    if estacional:
        escribir("estacional.json", {**estacional, "generado_utc": ahora_iso(hasta)})
    pron = resultados.get("OPEN_METEO") or leer_json("pronostico.json", {}, tipo=dict).get("ciudades")
    if pron:
        escribir("pronostico.json", {"generado_utc": ahora_iso(hasta), "atribucion": "Datos meteorológicos de Open-Meteo.com (CC BY 4.0)", "ciudades": pron})
        escribir_csv("nino-pronostico-ciudades.csv", ["ciudad", "departamento", "lat", "lon", "fecha", "pp_mm", "prob_pp_pct", "tmax_c", "tmin_c", "t_aparente_max_c"],
                     [[c["ciudad"], c["departamento"], c["lat"], c["lon"], d["fecha"], d["pp"], d["prob"], d["tmax"], d["tmin"], d["tapp"]] for c in pron for d in c["dias"]])
    caud = resultados.get("OPEN_METEO_CAUDAL") or leer_json("caudales.json", {}, tipo=dict).get("rios")
    if caud:
        escribir("caudales.json", {"generado_utc": ahora_iso(hasta), "atribucion": "GloFAS v4 (Copernicus EMS) vía Open-Meteo (CC BY 4.0)", "rios": caud})

    alertas = construir_alertas(enso, enfen, avisos, quebradas, silvia, sonics, pron, caud)
    escribir("alertas.json", {"generado_utc": ahora_iso(hasta), "alertas": alertas,
                              "resumen": {"total": len(alertas), "por_nivel": {str(n): sum(1 for a in alertas if a["nivel"] == n) for n in (1, 2, 3, 4)},
                                          "por_tipo": {t: sum(1 for a in alertas if a["tipo"] == t) for t in ("enso", "lluvias", "huaycos", "rios", "calor")}}})

    hubo_exito = any(f["estado"] == "ok" for f in fuentes_estado if f["id"] in tareas)
    estado = {
        "ultima_ejecucion_utc": ahora_iso(hasta),
        "ultima_sincronizacion_utc": ahora_iso(hasta) if hubo_exito else estado_previo.get("ultima_sincronizacion_utc"),
        "duracion_ms": int((time.time() - t0) * 1000),
        "fuentes": fuentes_estado,
        "alertas": len(alertas),
        "wms": WMS,
    }
    escribir("estado.json", estado)
    log("fin", duracion_ms=estado["duracion_ms"], alertas=len(alertas), errores=[f["id"] for f in fuentes_estado if f.get("estado") == "error"])
    return estado


def main():
    lock_path = os.path.join(tempfile.gettempdir(), "oap-nino.lock")
    try:
        import fcntl
        lock = os.fdopen(os.open(lock_path, os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600), "w")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("omitido", motivo="otra ejecución en curso")
        return 0
    except ImportError:
        lock = None
    estado = ejecutar()
    vivas = [f for f in estado["fuentes"] if f.get("estado") in ("ok", "error")]
    return SALIDA_TODAS_CAIDAS if vivas and all(f["estado"] == "error" for f in vivas) else 0


if __name__ == "__main__":
    sys.exit(main())
