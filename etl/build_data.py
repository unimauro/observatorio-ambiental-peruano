#!/usr/bin/env python3
"""
ETL del Observatorio Ambiental Peruano.

Descarga capas OFICIALES desde los servidores ArcGIS REST de SERNANP y OEFA
y las guarda como GeoJSON en public/data/. Sin dependencias externas (solo
biblioteca estándar) para correr en cualquier runner de CI.

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

# --- Catálogo de fuentes oficiales -------------------------------------------
# tipo: "polygon" (conserva geometría simplificada) | "centroid" (convierte a punto)
SOURCES = [
    {
        "out": "anp-sernanp.geojson",
        "titulo": "Áreas Naturales Protegidas (administración nacional)",
        "fuente": "SERNANP — ArcGIS REST servicios_ogc/peru_sernanp_0102",
        "url": "https://geoservicios.sernanp.gob.pe/arcgis/rest/services/servicios_ogc/peru_sernanp_0102/MapServer/0",
        "outFields": "anp_cate,anp_codi,anp_nomb,anp_suleg,anp_uicn,anp_balec,anp_felec",
        "where": "1=1", "referer": None, "offset": 0.005, "tipo": "polygon",
    },
    {
        "out": "mineria-ilegal-anp.geojson",
        "titulo": "Minería ilegal en ámbito de ANP",
        "fuente": "SERNANP — ArcGIS REST servicios_ogc/peru_sernanp_0201",
        "url": "https://geoservicios.sernanp.gob.pe/arcgis/rest/services/servicios_ogc/peru_sernanp_0201/MapServer/1",
        "outFields": "descrip,idtipact,ubiref,estado",
        "where": "1=1", "referer": None, "offset": 0.002, "tipo": "polygon",
    },
    {
        "out": "relaves-oefa-puntos.geojson",
        "titulo": "Depósitos de relaves fiscalizados",
        "fuente": "OEFA — PIFA, RIESGOS/SERV_RIESGO_HIDROM_RELAVES_WMS",
        "url": "https://pifa.oefa.gob.pe/arcgis/rest/services/RIESGOS/SERV_RIESGO_HIDROM_RELAVES_WMS/MapServer/4",
        "outFields": "NOM_COMP,TIPO_COMP,ESTADO_DR,UNIDAD_FISCALIZABLE,ADMINISTRADO,SUBSECTOR,AREA_M2",
        "rename": {"ADMINISTRADO": "administrado", "UNIDAD_FISCALIZABLE": "unidad",
                   "ESTADO_DR": "estado_dr", "AREA_M2": "area_m2", "SUBSECTOR": "subsector"},
        "where": "1=1", "referer": "https://pifa.oefa.gob.pe/", "offset": 0.001, "tipo": "centroid",
    },
    {
        "out": "riesgo-ambiental-oefa.geojson",
        "titulo": "Unidades fiscalizables con riesgo ambiental Muy alto / Alto",
        "fuente": "OEFA — PIFA, RIESGOS/SERV_RIES_AMB_UF",
        "url": "https://pifa.oefa.gob.pe/arcgis/rest/services/RIESGOS/SERV_RIES_AMB_UF/MapServer/5",
        "outFields": "ADMINISTRADO,UNIDAD_FISCALIZABLE,SUBSECTOR,RIESGO_EST,PE_EST,VU_EST,DESC_PAM,DESC_PAH,DESC_CSA",
        "rename": {"ADMINISTRADO": "administrado", "UNIDAD_FISCALIZABLE": "unidad",
                   "SUBSECTOR": "subsector", "RIESGO_EST": "riesgo", "PE_EST": "peligro",
                   "VU_EST": "vulnerabilidad", "DESC_PAM": "pasivo_minero",
                   "DESC_PAH": "pasivo_hidrocarburo", "DESC_CSA": "conflicto_socioamb"},
        "where": "RIESGO_EST IN ('Muy alto','Alto')",
        "referer": "https://pifa.oefa.gob.pe/", "offset": 0.001, "tipo": "centroid",
    },
]


def fetch(url, params, referer=None, retries=3):
    data = urllib.parse.urlencode(params).encode()
    headers = {"User-Agent": "Mozilla/5.0 (ObservatorioAmbientalPeruano ETL)"}
    if referer:
        headers["Referer"] = referer
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url + "/query", data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=120, context=CTX) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"fallo al consultar {url}: {last}")


def fetch_all(src):
    """Descarga todas las features paginando si el servidor limita la transferencia."""
    feats, offset = [], 0
    while True:
        params = {
            "where": src["where"], "outFields": src["outFields"], "outSR": "4326",
            "geometryPrecision": "5", "maxAllowableOffset": src["offset"],
            "returnGeometry": "true", "f": "geojson",
            "resultOffset": offset, "resultRecordCount": 2000,
        }
        gj = fetch(src["url"], params, src.get("referer"))
        batch = gj.get("features", [])
        feats.extend(batch)
        if len(batch) < 2000:
            break
        offset += len(batch)
    return feats


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


def build(src):
    feats = fetch_all(src)
    rename = src.get("rename", {})
    out_feats = []
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
        out_feats.append({"type": "Feature", "geometry": geom, "properties": props})
    fc = {
        "type": "FeatureCollection",
        "metadata": {
            "titulo": src["titulo"], "fuente": src["fuente"],
            "estado": "verificado",
            "actualizado": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        },
        "features": out_feats,
    }
    path = os.path.join(OUT_DIR, src["out"])
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, ensure_ascii=False)
    return {"archivo": src["out"], "features": len(out_feats),
            "titulo": src["titulo"], "fuente": src["fuente"], "url": src["url"]}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest, errores = [], []
    for src in SOURCES:
        try:
            info = build(src)
            manifest.append(info)
            print(f"OK  {info['archivo']:32s} {info['features']:>5} features")
        except Exception as e:  # noqa: BLE001
            errores.append({"archivo": src["out"], "error": str(e)})
            print(f"ERR {src['out']:32s} {e}")
    with open(os.path.join(OUT_DIR, "_manifest.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "capas": manifest, "errores": errores,
        }, fh, ensure_ascii=False, indent=2)
    print(f"\n{len(manifest)} capas OK, {len(errores)} con error.")
    # No abortamos el CI por una fuente caída: el resto se publica igual.


if __name__ == "__main__":
    main()
