#!/usr/bin/env python3
"""
ETL de sitios impactados por hidrocarburos en la Amazonía peruana.

Convierte las bases de datos locales (Excel) del paquete
`etl/fuentes/hidrocarburos-amazonia/` en capas GeoJSON + CSV que consume el
mapa del Observatorio. A diferencia de `build_data.py` (que descarga de
servidores ArcGIS y usa solo la biblioteca estándar), este script parte de
archivos ofrecidos por aliados (PUINAMUDT, OEFA datos abiertos, MINEM) y por
eso necesita `openpyxl`:

    pip install openpyxl
    python etl/build_hidrocarburos_amazonia.py

Fuentes (ver ficha en `Diccionario de Bases de datos.xlsx`):
  - BD_Monitoreo_Ambiental_Indigena  — PUINAMUDT, monitores indígenas 2007-2025
  - BD_OEFA_{Agua,Sedimento,Suelo,Hidrobiologia}_Amazonia — OEFA ISIM 2022-2024
  - BD_PASH_Amazonia                  — MINEM/DGAAH, pasivos hidrocarburos Amazonía
  - BD_Planes_Rehabilitacion_Sitios_Impactados — MINEM/DGAAH, planes con costos

Al terminar fusiona las 4 capas nuevas en `public/data/_manifest.json` sin
tocar las capas que produce `build_data.py`, y escribe un resumen agregado en
`public/data/hidrocarburos-amazonia.json`.
"""
import csv
import json
import math
import os
import warnings
from datetime import datetime, date, timezone

import openpyxl

warnings.filterwarnings("ignore")  # openpyxl avisa de estilos/pivots que no usamos

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(os.path.dirname(__file__), "fuentes", "hidrocarburos-amazonia")
OUT = os.path.join(ROOT, "public", "data")
HOY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


# --- Utilidades --------------------------------------------------------------
def num(v):
    """Convierte a float tolerando comas decimales y basura como '.9727758.8'."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    if s in ("", ".", "-", "s/d", "S/D"):
        return None
    # deja solo el primer número con signo (descarta puntos/espacios sobrantes)
    neg = s.startswith("-")
    cleaned, dot = [], False
    for ch in s.lstrip("-"):
        if ch.isdigit():
            cleaned.append(ch)
        elif ch == "." and not dot:
            cleaned.append(ch)
            dot = True
        else:
            break
    if not any(c.isdigit() for c in cleaned):
        return None
    try:
        return -float("".join(cleaned)) if neg else float("".join(cleaned))
    except ValueError:
        return None


def txt(v):
    if v is None:
        return ""
    s = str(v).replace("\n", " ").strip()
    return "" if s in (".", "-", "—") else s


def excel_date(v):
    """Serial de Excel o datetime -> 'YYYY-MM-DD'."""
    if v is None or v == "":
        return ""
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    n = num(v)
    if n and n > 20000:  # serial de Excel (base 1899-12-30)
        try:
            return (date(1899, 12, 30) + __import__("datetime").timedelta(days=int(n))).strftime("%Y-%m-%d")
        except Exception:
            return ""
    return txt(v)


# --- UTM (WGS84) inverso, zona 18 sur, sin dependencias ----------------------
_A = 6378137.0          # semieje mayor WGS84
_F = 1 / 298.257223563  # achatamiento
_K0 = 0.9996
_E2 = _F * (2 - _F)
_EP2 = _E2 / (1 - _E2)


def utm_to_lonlat(easting, northing, zone=18, south=True):
    """UTM -> (lon, lat) en grados. Serie de Snyder (~1 m)."""
    x = easting - 500000.0
    y = northing - (10000000.0 if south else 0.0)
    m = y / _K0
    mu = m / (_A * (1 - _E2 / 4 - 3 * _E2**2 / 64 - 5 * _E2**3 / 256))
    e1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))
    phi1 = (mu
            + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
            + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
            + (151 * e1**3 / 96) * math.sin(6 * mu)
            + (1097 * e1**4 / 512) * math.sin(8 * mu))
    sin1, cos1, tan1 = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    c1 = _EP2 * cos1**2
    t1 = tan1**2
    n1 = _A / math.sqrt(1 - _E2 * sin1**2)
    r1 = _A * (1 - _E2) / (1 - _E2 * sin1**2) ** 1.5
    d = x / (n1 * _K0)
    lat = (phi1 - (n1 * tan1 / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * _EP2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * _EP2 - 3 * c1**2) * d**6 / 720))
    lon0 = math.radians(zone * 6 - 183)
    lon = lon0 + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * _EP2 + 24 * t1**2) * d**5 / 120) / cos1
    return math.degrees(lon), math.degrees(lat)


PERU_LON = (-82.0, -68.0)
PERU_LAT = (-19.0, 0.5)


def in_peru(lon, lat):
    return lon is not None and lat is not None and PERU_LON[0] < lon < PERU_LON[1] and PERU_LAT[0] < lat < PERU_LAT[1]


# La mayor parte del país está en la zona UTM 18S, pero el suroriente
# (Madre de Dios, Puno) está en la 19S. La base PASH es nacional en origen.
ZONE_BY_DEPT = {"madre de dios": 19, "puno": 19}


def zone_for_dept(dep):
    return ZONE_BY_DEPT.get(txt(dep).strip().lower(), 18)


def resolve_coord(x, y, lat, lon, zone=18):
    """Devuelve (lon, lat, metodo) o (None, None, motivo).

    Tolera las inconsistencias de la base de monitoreo indígena:
    lat/lon intercambiadas, grados metidos en las columnas UTM, eastings rotos.
    """
    X, Y, La, Lo = num(x), num(y), num(lat), num(lon)
    # 1) columnas geográficas bien puestas
    if La is not None and Lo is not None:
        if in_peru(Lo, La):
            return Lo, La, "latlon"
        if in_peru(La, Lo):  # intercambiadas
            return La, Lo, "latlon_swap"
    # 2) UTM correcto
    if X is not None and Y is not None and 150000 < X < 900000 and 8.0e6 < Y < 1.06e7:
        lo, la = utm_to_lonlat(X, Y, zone, south=True)
        if in_peru(lo, la):
            return round(lo, 6), round(la, 6), "utm"
    # 3) grados metidos en columnas UTM (p. ej. X=2.39, Y=76.30)
    if X is not None and Y is not None and 0 < abs(X) < 10 and 65 < abs(Y) < 85:
        lo, la = -abs(Y), -abs(X)
        if in_peru(lo, la):
            return round(lo, 6), round(la, 6), "utm_deg"
    return None, None, "sin_coord"


def load(path, sheet=0):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[sheet]
    rows = [r for r in ws.iter_rows(values_only=True) if any(c not in (None, "") for c in r)]
    wb.close()
    return rows[0], rows[1:]


def write_geojson_csv(name, titulo, fuente, feats, extra=None):
    meta = {"titulo": titulo, "fuente": fuente, "estado": "verificado", "actualizado": HOY}
    if extra:
        meta.update(extra)
    fc = {"type": "FeatureCollection", "metadata": meta, "features": feats}
    with open(os.path.join(OUT, name + ".geojson"), "w", encoding="utf-8") as fh:
        json.dump(fc, fh, ensure_ascii=False)
    # CSV plano (lon, lat + una columna por propiedad)
    cols, seen = [], set()
    for f in feats:
        for k in f["properties"]:
            if k not in seen:
                seen.add(k)
                cols.append(k)
    os.makedirs(os.path.join(OUT, "csv"), exist_ok=True)
    with open(os.path.join(OUT, "csv", name + ".csv"), "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["lon", "lat"] + cols)
        for f in feats:
            c = f["geometry"]["coordinates"]
            p = f["properties"]
            w.writerow([c[0], c[1]] + [p.get(k) for k in cols])
    print(f"OK  {name+'.geojson':40s} {len(feats):>4} features (+ csv/{name}.csv)")
    return {"archivo": name + ".geojson", "csv": f"csv/{name}.csv",
            "features": len(feats), "titulo": titulo, "fuente": fuente}


def pt(lon, lat, props):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props}


# --- 1. Monitoreo ambiental indígena (PUINAMUDT) -----------------------------
def build_monitoreo():
    _, rows = load(os.path.join(SRC, "BD_Monitoreo_Ambiental_Indigena.xlsx"), 0)
    feats, sin, metodos, por_tipo, por_cuenca, por_fed, por_lote = [], 0, {}, {}, {}, {}, {}
    for r in rows:
        r = list(r) + [None] * (28 - len(r))
        lon, lat, met = resolve_coord(r[17], r[18], r[19], r[20])
        tipo = txt(r[8]) or "Sin especificar"
        fed = txt(r[2])
        lote = txt(r[11])
        anio = txt(r[7])
        por_tipo[tipo] = por_tipo.get(tipo, 0) + 1
        if fed:
            por_fed[fed] = por_fed.get(fed, 0) + 1
        if lote:
            por_lote[lote] = por_lote.get(lote, 0) + 1
        if lon is None:
            sin += 1
            continue
        metodos[met] = metodos.get(met, 0) + 1
        feats.append(pt(lon, lat, {
            "codigo": txt(r[1]),
            "federacion": fed,
            "zona": txt(r[4]),
            "tipo_impacto": tipo,
            "fuente_impacto": txt(r[9]),
            "antiguedad": txt(r[10]),
            "lote": lote,
            "empresa": txt(r[12]),
            "anio": anio,
            "detecto": excel_date(r[5]),
            "descripcion": txt(r[13])[:300],
            "ubicacion": txt(r[14])[:200],
            "remediacion": txt(r[23]),
            "responsable": txt(r[25]),
            "estado_validacion": txt(r[26]),
        }))
    resumen = {
        "total_registros": len(rows), "mapeados": len(feats), "sin_coordenada": sin,
        "metodos_coord": metodos,
        "por_tipo": sorted(por_tipo.items(), key=lambda x: -x[1]),
        "por_cuenca_federacion": sorted(por_fed.items(), key=lambda x: -x[1]),
        "por_lote": sorted(por_lote.items(), key=lambda x: -x[1])[:12],
    }
    m = write_geojson_csv(
        "monitoreo-indigena",
        "Monitoreo ambiental indígena (PUINAMUDT)",
        "PUINAMUDT — monitores indígenas de las cuencas Pastaza, Corrientes, Tigre y Marañón (2007-2025).",
        feats, extra={"registros_totales": len(rows), "sin_coordenada": sin})
    return m, resumen


# --- 2. OEFA ISIM: agua + sedimento + suelo + hidrobiología ------------------
OEFA_FILES = {
    "Agua": ("BD_OEFA_Agua_Amazonia.xlsx", "Este", "Norte", "Nombre del punto", "Número de informe", "Nombre de la Evaluación"),
    "Sedimento": ("BD_OEFA_Sedimento_Amazonia.xlsx", "ESTE", "NORTE", "NOM_PUNTO", "NRO_INF", "NOM_EVAL"),
    "Suelo": ("BD_OEFA_Suelo_Amazonia.xlsx", "ESTE", "NORTE", "NOM_PUNTO", "NRO_INF", "NOM_EVAL"),
    "Biota": ("BD_OEFA_Hidrobiologia_Amazonia.xlsx", "ESTE", "NORTE", "NOM_PUNTO", "NRO_INF", "NOM_EVAL"),
}


def build_oefa():
    puntos = {}  # (punto, este, norte) -> dict
    por_comp = {}
    for comp, (fn, ce, cn, cp, ci, cev) in OEFA_FILES.items():
        hdr, rows = load(os.path.join(SRC, fn), 0)
        idx = {h: i for i, h in enumerate(hdr)}
        ie, ino, ip, iinf, iev = idx.get(ce), idx.get(cn), idx.get(cp), idx.get(ci), idx.get(cev)
        n = 0
        for r in rows:
            E, N = num(r[ie]), num(r[ino])
            if E is None or N is None or not (150000 < E < 900000 and 8.0e6 < N < 1.06e7):
                continue
            lon, lat = utm_to_lonlat(E, N, 18, south=True)
            if not in_peru(lon, lat):
                continue
            punto = txt(r[ip]) if ip is not None else ""
            key = (punto, round(E), round(N))
            d = puntos.get(key)
            if not d:
                d = puntos[key] = {"lon": round(lon, 6), "lat": round(lat, 6), "punto": punto,
                                   "componentes": set(), "informe": txt(r[iinf]) if iinf is not None else "",
                                   "evaluacion": txt(r[iev]) if iev is not None else "", "n_muestras": 0}
            d["componentes"].add(comp)
            d["n_muestras"] += 1
            n += 1
        por_comp[comp] = n
    feats = []
    for d in puntos.values():
        comps = sorted(d["componentes"])
        feats.append(pt(d["lon"], d["lat"], {
            "punto": d["punto"],
            "componentes": ", ".join(comps),
            "n_componentes": len(comps),
            "informe": d["informe"],
            "evaluacion": d["evaluacion"],
            "registros": d["n_muestras"],
        }))
    m = write_geojson_csv(
        "oefa-isim-amazonia",
        "Monitoreo OEFA de sitios impactados (agua, suelo, sedimento y biota)",
        "OEFA — Datos abiertos, Evaluación ambiental para la Identificación de Sitios Impactados (ISIM), Amazonía 2022-2024.",
        feats)
    resumen = {"puntos_unicos": len(feats), "registros_por_componente": por_comp}
    return m, resumen


# --- 3. PASH Amazonía (MINEM / DGAAH) ----------------------------------------
def build_pash():
    hdr, rows = load(os.path.join(SRC, "BD_PASH_Amazonia.xlsx"), 0)
    feats, sin = [], 0
    for r in rows:
        E, N = num(r[11]), num(r[12])
        if E is None or N is None or not (150000 < E < 900000 and 8.0e6 < N < 1.06e7):
            sin += 1
            continue
        lon, lat = utm_to_lonlat(E, N, zone_for_dept(r[8]), south=True)
        feats.append(pt(round(lon, 6), round(lat, 6), {
            "id": txt(r[0]),
            "cod_ficha": txt(r[5]),
            "descripcion": txt(r[6]),
            "lote": txt(r[7]),
            "departamento": txt(r[8]),
            "provincia": txt(r[9]),
            "distrito": txt(r[10]),
            "riesgo_salud": txt(r[13]),
            "riesgo_seguridad": txt(r[14]),
            "riesgo_ambiente": txt(r[15]),
            "oficio_oefa": txt(r[3]),
        }))
    m = write_geojson_csv(
        "pash-amazonia",
        "Pasivos ambientales del subsector hidrocarburos — Amazonía",
        "MINEM — Dirección General de Asuntos Ambientales de Hidrocarburos (DGAAH), inventario 2015-2019.",
        feats)
    return m, {"total": len(rows), "mapeados": len(feats), "sin_coordenada": sin}


# --- 4. Planes de rehabilitación de sitios impactados (MINEM / DGAAH) --------
def build_planes():
    hdr, rows = load(os.path.join(SRC, "BD_Planes_Rehabilitacion_Sitios_Impactados.xlsx"), 0)
    feats, costo_total = [], 0.0
    for r in rows:
        E, N = num(r[3]), num(r[4])
        if E is None or N is None or not (150000 < E < 900000 and 8.0e6 < N < 1.06e7):
            continue
        lon, lat = utm_to_lonlat(E, N, 18, south=True)
        costo = num(r[14]) or 0.0
        costo_total += costo
        feats.append(pt(round(lon, 6), round(lat, 6), {
            "numero": txt(r[0]),
            "sitio": txt(r[1]),
            "cuenca": txt(r[2]),
            "area_ha": num(r[6]),
            "referencia": txt(r[7]),
            "expediente": txt(r[8]),
            "codigo_oefa": txt(r[9]),
            "costo_total_soles": round(costo, 2) if costo else None,
        }))
    m = write_geojson_csv(
        "planes-rehabilitacion-amazonia",
        "Sitios impactados con plan de rehabilitación (MINEM)",
        "MINEM — DGAAH, consolidado de planes de rehabilitación (cuencas Pastaza, Corrientes, Tigre y Marañón).",
        feats)
    return m, {"sitios": len(feats), "costo_total_soles": round(costo_total, 2)}


def merge_manifest(nuevas):
    path = os.path.join(OUT, "_manifest.json")
    data = {"generado": "", "capas": [], "errores": []}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    archivos = {c["archivo"] for c in nuevas}
    data["capas"] = [c for c in data.get("capas", []) if c["archivo"] not in archivos] + nuevas
    data["generado_hidrocarburos_amazonia"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifests, resumen = [], {"actualizado": HOY,
                              "fuente": "Paquete 'Sitios impactados por hidrocarburos' (PUINAMUDT, OEFA, MINEM), integrado 2026-09.",
                              "capas": {}}
    m, resumen["capas"]["monitoreo_indigena"] = build_monitoreo(); manifests.append(m)
    m, resumen["capas"]["oefa_isim"] = build_oefa(); manifests.append(m)
    m, resumen["capas"]["pash_amazonia"] = build_pash(); manifests.append(m)
    m, resumen["capas"]["planes_rehabilitacion"] = build_planes(); manifests.append(m)
    merge_manifest(manifests)
    with open(os.path.join(OUT, "hidrocarburos-amazonia.json"), "w", encoding="utf-8") as fh:
        json.dump(resumen, fh, ensure_ascii=False, indent=1)
    print("\nResumen -> public/data/hidrocarburos-amazonia.json")
    print(json.dumps(resumen["capas"], ensure_ascii=False, indent=1)[:1500])


if __name__ == "__main__":
    main()
