#!/usr/bin/env python3
"""
ETL del Observatorio Ambiental Peruano.

Descarga capas OFICIALES desde servidores ArcGIS REST (SERNANP, OEFA, OSINERGMIN
GISEM, GEOCATMIN/INGEMMET) y WFS (CooperAcción), las guarda como GeoJSON en
public/data/ y calcula el análisis de superposición territorial. Sin dependencias
externas (solo biblioteca estándar) para correr en cualquier runner de CI.

Uso:  python etl/build_data.py
"""
import json
import os
import ssl
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE  # algunos servidores .gob.pe tienen cadenas TLS incompletas
UA = "Mozilla/5.0 (ObservatorioAmbientalPeruano ETL)"
HOY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

manifest, errores = [], []


def _http(url, data=None, referer=None, retries=3, timeout=150):
    headers = {"User-Agent": UA}
    if referer:
        headers["Referer"] = referer
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"fallo {url}: {last}")


def write_fc(out, titulo, fuente, feats, estado="verificado", extra=None):
    meta = {"titulo": titulo, "fuente": fuente, "estado": estado, "actualizado": HOY}
    if extra:
        meta.update(extra)
    fc = {"type": "FeatureCollection", "metadata": meta, "features": feats}
    with open(os.path.join(OUT_DIR, out), "w", encoding="utf-8") as fh:
        json.dump(fc, fh, ensure_ascii=False)
    manifest.append({"archivo": out, "features": len(feats), "titulo": titulo, "fuente": fuente})
    print(f"OK  {out:34s} {len(feats):>5} features")
    return fc


def centroid(geom):
    if not geom:
        return None
    t, c = geom["type"], geom["coordinates"]
    ring = c[0] if t == "Polygon" else c[0][0] if t == "MultiPolygon" else None
    if not ring:
        return None
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return [round(sum(xs) / len(xs), 5), round(sum(ys) / len(ys), 5)]


# === ESTRATEGIA 1: ArcGIS f=geojson paginado (SERNANP, OEFA) ================
SOURCES = [
    {"out": "anp-sernanp.geojson", "titulo": "Áreas Naturales Protegidas (administración nacional)",
     "fuente": "SERNANP — ArcGIS REST servicios_ogc/peru_sernanp_0102",
     "url": "https://geoservicios.sernanp.gob.pe/arcgis/rest/services/servicios_ogc/peru_sernanp_0102/MapServer/0",
     "outFields": "anp_cate,anp_codi,anp_nomb,anp_suleg,anp_uicn,anp_balec,anp_felec",
     "where": "1=1", "referer": None, "offset": 0.005, "tipo": "polygon"},
    {"out": "mineria-ilegal-anp.geojson", "titulo": "Minería ilegal en ámbito de ANP",
     "fuente": "SERNANP — ArcGIS REST servicios_ogc/peru_sernanp_0201",
     "url": "https://geoservicios.sernanp.gob.pe/arcgis/rest/services/servicios_ogc/peru_sernanp_0201/MapServer/1",
     "outFields": "descrip,idtipact,ubiref,estado", "where": "1=1", "referer": None, "offset": 0.002, "tipo": "polygon"},
    {"out": "relaves-oefa-puntos.geojson", "titulo": "Depósitos de relaves fiscalizados",
     "fuente": "OEFA — PIFA, RIESGOS/SERV_RIESGO_HIDROM_RELAVES_WMS",
     "url": "https://pifa.oefa.gob.pe/arcgis/rest/services/RIESGOS/SERV_RIESGO_HIDROM_RELAVES_WMS/MapServer/4",
     "outFields": "NOM_COMP,TIPO_COMP,ESTADO_DR,UNIDAD_FISCALIZABLE,ADMINISTRADO,SUBSECTOR,AREA_M2",
     "rename": {"ADMINISTRADO": "administrado", "UNIDAD_FISCALIZABLE": "unidad", "ESTADO_DR": "estado_dr",
                "AREA_M2": "area_m2", "SUBSECTOR": "subsector"},
     "where": "1=1", "referer": "https://pifa.oefa.gob.pe/", "offset": 0.001, "tipo": "centroid"},
    {"out": "riesgo-ambiental-oefa.geojson", "titulo": "Unidades fiscalizables con riesgo ambiental Muy alto / Alto",
     "fuente": "OEFA — PIFA, RIESGOS/SERV_RIES_AMB_UF",
     "url": "https://pifa.oefa.gob.pe/arcgis/rest/services/RIESGOS/SERV_RIES_AMB_UF/MapServer/5",
     "outFields": "ADMINISTRADO,UNIDAD_FISCALIZABLE,SUBSECTOR,RIESGO_EST,PE_EST,VU_EST,DESC_PAM,DESC_PAH,DESC_CSA",
     "rename": {"ADMINISTRADO": "administrado", "UNIDAD_FISCALIZABLE": "unidad", "SUBSECTOR": "subsector",
                "RIESGO_EST": "riesgo", "PE_EST": "peligro", "VU_EST": "vulnerabilidad",
                "DESC_PAM": "pasivo_minero", "DESC_PAH": "pasivo_hidrocarburo", "DESC_CSA": "conflicto_socioamb"},
     "where": "RIESGO_EST IN ('Muy alto','Alto')", "referer": "https://pifa.oefa.gob.pe/", "offset": 0.001, "tipo": "centroid"},
]


def build_paginated(src):
    feats, offset = [], 0
    while True:
        params = {"where": src["where"], "outFields": src["outFields"], "outSR": "4326",
                  "geometryPrecision": "5", "maxAllowableOffset": src["offset"], "returnGeometry": "true",
                  "f": "geojson", "resultOffset": offset, "resultRecordCount": 2000}
        gj = _http(src["url"] + "/query", params, src.get("referer"))
        batch = gj.get("features", [])
        feats.extend(batch)
        if len(batch) < 2000:
            break
        offset += len(batch)
    rename = src.get("rename", {})
    out = []
    for f in feats:
        geom = f.get("geometry")
        props = {rename.get(k, k): v for k, v in (f.get("properties") or {}).items()}
        if src["tipo"] == "centroid":
            ct = centroid(geom)
            if not ct:
                continue
            geom = {"type": "Point", "coordinates": ct}
        elif not geom:
            continue
        out.append({"type": "Feature", "geometry": geom, "properties": props})
    return write_fc(src["out"], src["titulo"], src["fuente"], out)


# === ESTRATEGIA 2: ArcGIS f=json por lotes de OBJECTID (GEOCATMIN, sin paginación) =
def arcgis_idlist(layer_url, out_fields, simplify=None, referer=None):
    ids = _http(layer_url + "/query", {"where": "1=1", "returnIdsOnly": "true", "f": "json"}, referer)
    oidf = ids.get("objectIdFieldName", "OBJECTID")
    oids = ids.get("objectIds") or []
    feats = []
    for i in range(0, len(oids), 400):
        chunk = oids[i:i + 400]
        p = {"where": f"{oidf} IN ({','.join(map(str, chunk))})", "outFields": out_fields,
             "returnGeometry": "true", "outSR": "4326", "geometryPrecision": "5", "f": "json"}
        if simplify:
            p["maxAllowableOffset"] = simplify
        feats += _http(layer_url + "/query", p, referer).get("features", [])
    return feats


def esri_point(g):
    return [round(g["x"], 5), round(g["y"], 5)] if g and "x" in g else None


def esri_polygon(g):
    return {"type": "Polygon", "coordinates": g["rings"]} if g and "rings" in g else None


def esri_centroid(g):
    if not g or "rings" not in g:
        return None
    ring = g["rings"][0]
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return [round(sum(xs) / len(xs), 5), round(sum(ys) / len(ys), 5)]


GEOCAT = "https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_OTRAS_FUENTES/MapServer"


def build_pueblos():
    feats = []
    for ft in arcgis_idlist(f"{GEOCAT}/15", "NOMBRE,TIPO_POB,FAM_LINGUI,ETNIA1,FEDERACION,ZONA"):
        c = esri_point(ft.get("geometry"))
        a = ft.get("attributes", {})
        if not c:
            continue
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": c}, "properties": {
            "nombre": a.get("NOMBRE"), "tipo": a.get("TIPO_POB"), "etnia": a.get("ETNIA1"),
            "familia_ling": a.get("FAM_LINGUI"), "federacion": a.get("FEDERACION"), "zona": a.get("ZONA")}})
    return write_fc("pueblos-indigenas.geojson", "Pueblos indígenas (localidades)",
                    "Ministerio de Cultura / IBC, vía GEOCATMIN (INGEMMET).", feats)


def build_comunidades():
    feats = []
    for ft in arcgis_idlist(f"{GEOCAT}/17", "NOMBRE,ETNIA1,POBLACION,FAMILIAS,RIO", simplify="0.01"):
        c = esri_centroid(ft.get("geometry"))
        a = ft.get("attributes", {})
        if not c:
            continue
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": c}, "properties": {
            "nombre": a.get("NOMBRE"), "etnia": a.get("ETNIA1"), "poblacion": a.get("POBLACION"),
            "familias": a.get("FAMILIAS"), "rio": a.get("RIO")}})
    return write_fc("comunidades-nativas.geojson", "Comunidades nativas (centroides)",
                    "IBC / SICNA, vía GEOCATMIN (INGEMMET).", feats)


def build_reservas():
    feats = []
    for ft in arcgis_idlist(f"{GEOCAT}/18", "NOMRET,CATEGO,PUEIND,ESTADO", simplify="0.003"):
        g = esri_polygon(ft.get("geometry"))
        a = ft.get("attributes", {})
        if not g:
            continue
        feats.append({"type": "Feature", "geometry": g, "properties": {
            "nombre": a.get("NOMRET"), "categoria": a.get("CATEGO"), "pueblo": a.get("PUEIND"), "estado": a.get("ESTADO")}})
    return write_fc("reservas-territoriales.geojson", "Reservas territoriales (PIACI)",
                    "Ministerio de Cultura, vía GEOCATMIN (INGEMMET).", feats)


# === ESTRATEGIA 3: GISEM (OSINERGMIN) — capas combinadas ====================
GISEM = "https://gisem.osinergmin.gob.pe/serverosih/rest/services"


def build_lotes():
    feats = []
    hl = f"{GISEM}/Hidrocarburos_Liquidos/HIDROCARBUROS_LIQUIDOS/FeatureServer"
    for lid, fase in [("11", "Explotación"), ("12", "Exploración")]:
        gj = _http(f"{hl}/{lid}/query", {"where": "1=1", "outFields": "NOMB_LOTE,CIA,UBICACION,CONTRATO,TIPO_CONTR",
                                         "outSR": "4326", "geometryPrecision": "5", "maxAllowableOffset": "0.003", "f": "geojson"},
                   referer="https://gisem.osinergmin.gob.pe/")
        for ft in gj.get("features", []):
            if not ft.get("geometry"):
                continue
            p = ft.get("properties") or {}
            feats.append({"type": "Feature", "geometry": ft["geometry"], "properties": {
                "lote": p.get("NOMB_LOTE"), "empresa": p.get("CIA"), "ubicacion": p.get("UBICACION"),
                "contrato": p.get("CONTRATO"), "tipo_contrato": p.get("TIPO_CONTR"), "fase": fase}})
    return write_fc("lotes-petroleros.geojson", "Lotes petroleros (exploración y explotación)",
                    "Perupetro, vía OSINERGMIN GISEM (ArcGIS REST).", feats)


def build_unidades():
    feats = []
    mem = f"{GISEM}/Mineria/MINERIA_MEM/MapServer"
    # capa 5 = producción, capa 2 = exploración
    for lid, fields, fase, fmap in [
        ("5", "NOMBRE,TITULAR,SUSTANCIA,SITUACIÓN", "En producción",
         lambda a: {"nombre": a.get("NOMBRE"), "titular": a.get("TITULAR"), "sustancia": a.get("SUSTANCIA"), "situacion": a.get("SITUACIÓN")}),
        ("2", "EMPRESA,PROYECTO,PRODUCTO,REGION,CATEGORIA", "En exploración",
         lambda a: {"nombre": a.get("PROYECTO"), "titular": a.get("EMPRESA"), "sustancia": a.get("PRODUCTO"), "region": a.get("REGION")}),
    ]:
        d = _http(f"{mem}/{lid}/query", {"where": "1=1", "outFields": fields, "returnGeometry": "true",
                                         "outSR": "4326", "geometryPrecision": "5", "f": "json"},
                  referer="https://gisem.osinergmin.gob.pe/")
        for ft in d.get("features", []):
            g = ft.get("geometry")
            c = esri_point(g)
            if not c:
                continue
            props = fmap(ft.get("attributes", {}))
            props["tipo"] = fase
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": c}, "properties": props})
    return write_fc("unidades-mineras.geojson", "Unidades mineras (producción y exploración)",
                    "MINEM, vía OSINERGMIN GISEM (ArcGIS REST).", feats)


# === ESTRATEGIA 4: WFS GeoServer (CooperAcción) =============================
def build_campesinas():
    url = ("http://cooperaccion-geoportal.org:8082/geoserver/ows?service=wfs&version=2.0.0&request=GetFeature"
           "&typeNames=espacio-cooperacion:comunidadescampesinas&count=6000&srsName=EPSG:4326&outputFormat=application/json")
    d = _http(url)
    feats = []
    for ft in d.get("features", []):
        ct = centroid(ft.get("geometry"))
        if not ct:
            continue
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": ct},
                      "properties": {"nombre": (ft.get("properties") or {}).get("nombre")}})
    return write_fc("comunidades-campesinas.geojson", "Comunidades campesinas (centroides)",
                    "CooperAcción — geoportal Espacio de Cooperación (GeoServer).", feats)


# === ANÁLISIS DE SUPERPOSICIÓN ==============================================
def _in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _in_geom(lng, lat, geom):
    if not geom:
        return False
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"] if geom["type"] == "MultiPolygon" else []
    for poly in polys:
        if _in_ring(lng, lat, poly[0]):
            if not any(_in_ring(lng, lat, poly[k]) for k in range(1, len(poly))):
                return True
    return False


def _load(fn):
    with open(os.path.join(OUT_DIR, fn), encoding="utf-8") as fh:
        return json.load(fh)["features"]


def build_superposicion():
    lotes = _load("lotes-petroleros.geojson")
    anp = _load("anp-sernanp.geojson")
    pueblos = _load("pueblos-indigenas.geojson")
    comun = _load("comunidades-nativas.geojson")
    unidades = _load("unidades-mineras.geojson")

    def count_in(points, polys, key=None):
        n, by = 0, {}
        for pt in points:
            c = pt.get("geometry", {}).get("coordinates")
            if not c:
                continue
            for poly in polys:
                if _in_geom(c[0], c[1], poly.get("geometry")):
                    n += 1
                    if key:
                        nm = poly["properties"].get(key)
                        by[nm] = by.get(nm, 0) + 1
                    break
        return n, by

    pue_lote, _ = count_in(pueblos, lotes)
    com_lote, com_by = count_in(comun, lotes, key="lote")
    pue_anp, _ = count_in(pueblos, anp)
    com_anp, _ = count_in(comun, anp)
    uni_anp, _ = count_in(unidades, anp)
    lotes_anp = 0
    for lt in lotes:
        ct = centroid(lt.get("geometry"))
        if ct and any(_in_geom(ct[0], ct[1], a.get("geometry")) for a in anp):
            lotes_anp += 1
    top = sorted(com_by.items(), key=lambda x: -x[1])[:6]
    out = {
        "nota": "Análisis de superposición geográfica calculado sobre las capas oficiales del observatorio (point-in-polygon). Indicativo: usa centroides de comunidades y puede subestimar solapamientos parciales.",
        "actualizado": HOY,
        "cruces": [
            {"id": "pueblos_lotes", "etiqueta": "Localidades de pueblos indígenas dentro de lotes petroleros", "valor": pue_lote, "de": len(pueblos), "fuente": "Min. Cultura/IBC × Perupetro"},
            {"id": "comunidades_lotes", "etiqueta": "Comunidades nativas dentro de lotes petroleros", "valor": com_lote, "de": len(comun), "fuente": "IBC/SICNA × Perupetro"},
            {"id": "pueblos_anp", "etiqueta": "Localidades indígenas dentro de áreas protegidas", "valor": pue_anp, "de": len(pueblos), "fuente": "Min. Cultura/IBC × SERNANP"},
            {"id": "comunidades_anp", "etiqueta": "Comunidades nativas dentro de áreas protegidas", "valor": com_anp, "de": len(comun), "fuente": "IBC/SICNA × SERNANP"},
            {"id": "unidades_anp", "etiqueta": "Unidades mineras dentro de áreas protegidas", "valor": uni_anp, "de": len(unidades), "fuente": "MINEM × SERNANP"},
            {"id": "lotes_anp", "etiqueta": "Lotes petroleros que se superponen con áreas protegidas", "valor": lotes_anp, "de": len(lotes), "fuente": "Perupetro × SERNANP"},
        ],
        "topLotes": [{"lote": k, "comunidades": v} for k, v in top],
    }
    with open(os.path.join(OUT_DIR, "superposicion.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(f"OK  superposicion.json              {pue_lote} pueblos / {com_lote} comunidades en lotes")


# === MAIN ===================================================================
# Cada fuente es una tarea independiente: si una falla (p.ej. OEFA bloquea la IP
# del runner de CI con 403), las demás se publican igual y la capa caída conserva
# su última versión buena. Las capas OEFA suelen 403 desde datacenters; se refrescan
# bien desde una IP residencial (ejecutar el ETL localmente cuando cambien).
TASKS = [(s["out"], (lambda s=s: build_paginated(s))) for s in SOURCES] + [
    ("lotes", build_lotes), ("unidades", build_unidades),
    ("pueblos", build_pueblos), ("comunidades", build_comunidades), ("reservas", build_reservas),
    ("campesinas", build_campesinas)]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, fn in TASKS:
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            errores.append({"tarea": name, "error": str(e)})
            print(f"ERR {name:34s} {e}")
    # Superposición: solo si las capas base existen
    try:
        build_superposicion()
    except Exception as e:  # noqa: BLE001
        errores.append({"tarea": "superposicion", "error": str(e)})
        print(f"ERR superposicion: {e}")
    with open(os.path.join(OUT_DIR, "_manifest.json"), "w", encoding="utf-8") as fh:
        json.dump({"generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "capas": manifest, "errores": errores}, fh, ensure_ascii=False, indent=2)
    print(f"\n{len(manifest)} capas OK, {len(errores)} con error.")


if __name__ == "__main__":
    main()
