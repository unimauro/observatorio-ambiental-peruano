"""Pruebas del ETL "El Niño, lluvias y calor" (unitarias + integración con fuentes simuladas).

Uso:  python -m unittest discover -s etl/tests
Datos: SOLO fixtures sintéticas de este archivo; nunca se escriben en public/data
(cada prueba usa un directorio temporal).
"""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import build_nino as bn  # noqa: E402

AHORA = datetime(2026, 10, 28, 15, 0, tzinfo=timezone.utc)

NOAA_MENSUAL = """ YR MON  NINO1+2   ANOM   NINO3    ANOM   NINO4    ANOM NINO3.4    ANOM
2026   5   25.10    2.10   27.50    1.50   29.40    0.70   28.60    1.20
2026   6   25.30    3.00   27.90    2.00   29.60    0.90   29.00    1.70
2026   7   25.40    3.56   28.21    2.33   29.84    1.06   29.33    2.03
2026   8   24.93    4.08   28.35    3.13   29.63    0.93   29.42    2.52
2026   9   25.27    4.69   28.65    3.64   29.62    0.95   29.60    2.84
"""
NOAA_SEMANAL = """ Weekly SST data starts week centered on 3Jan1990

                Nino1+2      Nino3        Nino34        Nino4
 Week          SST SSTA     SST SSTA     SST SSTA     SST SSTA
 14OCT2026     26.2 5.2     29.2 4.2     30.0 3.3     29.7 1.1
 21OCT2026     26.3 5.2     29.4 4.3     30.1 3.4     29.8 1.1
 basura sin numeros
 27JAN2021     24.6-0.4     25.7-0.2     25.9-0.7     27.1-1.1
"""
ENFEN_HTML = """<html><body><div>ULTIMO COMUNICADO <h3>Comunicado Oficial Enfen N° 18-2026</h3>
<span>16 Octubre, 2026</span> <a href="https://enfen.imarpe.gob.pe/download/comunicado-oficial-enfen-n-18-2026/?wpdmdl=2165&amp;refresh=abc">Ver Comunicado</a>
<p>Se mantiene el estado de Alerta de El Niño Costero.</p></div></body></html>"""


def fc(feats):
    return json.dumps({"type": "FeatureCollection", "features": feats, "numberMatched": len(feats)})


def pt(props, lon=-79.8, lat=-6.7):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props}


def pr(props):
    return {"type": "Feature", "geometry": None, "properties": props}


def _n_puntos(url):
    """Cuántas coordenadas pide una URL de Open-Meteo (latitude=a,b,c)."""
    import urllib.parse
    return urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["latitude"][0].count(",") + 1


AVISOS_HTML = """<table><tr><th>Aviso</th></tr>
<tr><td class="vigente"><a href="./?p=aviso-meteorologico-vigente&a=2026&b=29348&c=00&d=SENA">PRECIPITACIONES EN LA COSTA NORTE Y SIERRA</td>
<td class="vigente"><a href="./?p=aviso-meteorologico-vigente&a=2026&b=29348&c=00&d=SENA">451 (vigente) </td>
<td class="vigente">2026-11-02</td><td class="vigente">2026-11-04</td><td class="vigente">2026-11-06</td><td class="vigente">59 Hrs. </td>
<td class="vigente"><span class="cuatro">ROJO</span></td></tr>
<tr><td class="emitido"><a href="./?p=aviso-meteorologico-vigente&a=2026&b=29350&c=00&d=SENA">INCREMENTO DE TEMPERATURA DIURNA EN LA COSTA</td>
<td class="emitido"><a href="./?p=aviso-meteorologico-vigente&a=2026&b=29350&c=00&d=SENA">453 (emitido) </td>
<td class="emitido">2026-11-03</td><td class="emitido">2026-11-05</td><td class="emitido">2026-11-05</td><td class="emitido">19 Hrs. </td>
<td class="emitido"><span class="tres">NARANJA</span></td></tr>
<tr><td class="caducado"><a href="./?p=aviso-meteorologico-detalle&a=2026&b=29300&c=00&d=SENA">VIEJO</td><td class="caducado"><a href="#">440 (caducado) </td>
<td class="caducado">2026-10-20</td><td class="caducado">2026-10-21</td><td class="caducado">2026-10-22</td><td class="caducado">40 Hrs. </td><td class="caducado"><span class="dos">AMARILLO</span></td></tr>
<tr><td class="vigente"><a href="./?p=x&a=2026&b=1">SIN NIVEL</td><td class="vigente">9 (vigente)</td><td class="vigente">x</td><td class="vigente">x</td><td class="vigente">x</td><td class="vigente">x</td><td class="vigente">?</td></tr>
</table>"""
DETALLE_HTML = """<div class="tab-pane fade show active" id="v-pills-tab-1-293482026" role="tabpanel">
<p align="justify">El mi&eacute;rcoles 4 se esperan <b>lluvias</b> de 5 a 55 mm/día.</p><br><!--<p align="justify"></p>-->
<iframe src="mapas/mapa-avisos-meteorologicos/index.php?av=451&nl=4&mp=1&fc=2026"></iframe></div>
<div class="tab-pane fade" id="v-pills-tab-2-293482026"><p align="justify">El jueves 5 continúan.</p>
<iframe src="mapas/mapa-avisos-meteorologicos/index.php?av=451&nl=4&mp=2&fc=2026"></iframe></div>"""
INDECI_RSS = """<?xml version="1.0"?><rss><channel><item>
<title><![CDATA[REPORTE COMPLEMENTARIO N.º 15463 &#8211; 4/11/2026 / COEN &#8211; INDECI / 06:00 HORAS  (Reporte N.º 14)  LLUVIAS INTENSAS EN EL DEPARTAMENTO DE PIURA]]></title>
<link>https://portal.indeci.gob.pe/emergencias/reporte-15463/</link><pubDate>Wed, 04 Nov 2026 12:17:13 +0000</pubDate>
<content:encoded><![CDATA[<p>HECHOS:</p><table><tr><td>25/10/2026 17:00 horas</td><td>Se registraron lluvias intensas que causaron daños materiales (viviendas) en Ayabaca.</td></tr>
<tr><td>20/10/2026 15:06 horas</td><td>Se registraron lluvias intensas en Sicchez.</td></tr></table><p>The post REPORTE ... appeared first on INDECI.</p>]]></content:encoded></item>
<item><title><![CDATA[REPORTE COMPLEMENTARIO N.º 15457 – 3NOV2026 – DESLIZAMIENTO EN EL DISTRITO DE SAN NICOLAS – ÁNCASH (3)]]></title>
<link>https://portal.indeci.gob.pe/emergencias/reporte-15457/</link><pubDate>Wed, 04 Nov 2026 12:04:07 +0000</pubDate>
<description><![CDATA[HECHOS: 2/11/2026 08:00 horas Se produjo un deslizamiento.]]></description></item>
<item><title><![CDATA[BOLETÍN INFORMATIVO DE AVISO DE CORTO PLAZO ANTE LLUVIAS INTENSAS N307-2026 DEL 04-11-2026]]></title>
<link>https://portal.indeci.gob.pe/emergencias/boletin-307/</link><pubDate>Wed, 04 Nov 2026 18:22:51 +0000</pubDate><description><![CDATA[BOLETÍN]]></description></item>
<item><title><![CDATA[INFORME DE EMERGENCIA N.° 2545 – 1/09/2026 / COEN – INDECI / 06:00 HORAS (Informe N.° 1) INCENDIO FORESTAL EN EL DISTRITO DE MARCAVELICA – PIURA]]></title>
<link>https://portal.indeci.gob.pe/emergencias/informe-2545/</link><pubDate>Tue, 01 Sep 2026 11:00:00 +0000</pubDate><description><![CDATA[x]]></description></item>
<item><title><![CDATA[MALICIOSO]]></title><link>https://evil.example/x</link><pubDate>Wed, 04 Nov 2026 12:00:00 +0000</pubDate></item>
</channel></rss>"""


def fetch_falso(url, **kw):
    """Simula todas las fuentes. Las capas se reconocen por el typeName de la URL."""
    if url == bn.AVISOS_MET_URL:
        return AVISOS_HTML
    if url.startswith("https://www.senamhi.gob.pe/?p=aviso-meteorologico-vigente"):
        return DETALLE_HTML
    if url == bn.INDECI_FEED:
        return INDECI_RSS
    if url.startswith(bn.NOAA_MENSUAL):
        return NOAA_MENSUAL
    if url.startswith(bn.NOAA_SEMANAL):
        return NOAA_SEMANAL
    if url.startswith(bn.ENFEN_URL):
        return ENFEN_HTML
    if url.startswith(bn.OPEN_METEO_FLOOD):
        n = _n_puntos(url)
        return json.dumps([{"daily": {"time": ["2026-10-01", "2026-10-27", "2026-10-28", "2026-10-29"], "river_discharge": [10, 10, 12, 30], "river_discharge_max": [10, 11, 13, 45]}}] * n)
    if url.startswith(bn.OPEN_METEO):
        n = _n_puntos(url)
        return json.dumps([{"daily": {"time": ["2026-10-28", "2026-10-29"], "precipitation_sum": [0.4, 25.0], "precipitation_probability_max": [5, 80],
                                      "temperature_2m_max": [31.0, 34.5], "temperature_2m_min": [20, 21], "apparent_temperature_max": [33, 37], "weather_code": [1, 61]}}] * n)
    if "resultType=hits" in url:
        return '<wfs:FeatureCollection numberMatched="42" numberReturned="0"/>'
    if "view_aviso_aux" in url:
        # la vista parametrizada devuelve filas solo con viewparams=qry:<nro>_<día>_<año>
        if "viewparams=qry%3A451_" not in url and "viewparams=qry%3A453_" not in url:
            return fc([])
        return fc([pr({"nombdep": "PIURA", "nombprov": "SULLANA"}), pr({"nombdep": "TUMBES", "nombprov": "TUMBES"})]) if "451_1_" in url or "453_" in url \
            else fc([pr({"nombdep": "PIURA", "nombprov": "PIURA"}), pr({"nombdep": "LAMBAYEQUE", "nombprov": "CHICLAYO"})])
    if "g_aviso%3Aview_aviso" in url:
        if "viewparams=" not in url:
            return fc([])
        return fc([pr({"gid": 1, "nro_aviso": 451, "nivel": "Nivel 2", "cod_fen": "1", "cod_even": "01", "fech_ini": "2026-11-04T17:00:00Z", "fech_fin": "2026-11-05T04:59:59Z"}),
                   pr({"gid": 2, "nro_aviso": 451, "nivel": "Nivel 4", "cod_fen": "1", "cod_even": "01", "fech_ini": "2026-11-04T17:00:00Z", "fech_fin": "2026-11-05T04:59:59Z"})])
    if "view_aviso24h" in url:
        return fc([pr({"gid": 1, "nivel": "Nivel 2", "fecha": "2026-10-27Z", "descripcio": "<b>Lluvias</b> moderadas", "recomendac": "Atentos", "respons": "HCAST"})])
    if "aviso_hidro_pub" in url:
        return fc([pt({"id_aviso": 1, "num_aviso": 9, "nivel": "2", "color_text": "NARANJA", "fecha_hora": "2026-10-26T11:00:00Z", "titulo": "RÍO X",
                       "nom_estacion": "EST", "nom_cuenca": "Cuenca X", "nom_und_hidro": "RH", "nom_departamento": "LORETO", "nom_provincia": "P", "nom_distrito": "D",
                       "peligro_nivel": "sube", "recomendacion_nivel": "cuidado", "latitud": "-3.5", "longitud": "-73.1"})])
    if "umbrales_precipitacion" in url:
        return fc([pt({"nombre": "A", "pp": "12", "umbral": "10", "pp_acum": "20", "umb_acum": "30", "hora": "09:00:00", "fecha": "28/10/2026", "departamento": "PIURA", "provincia": "P", "distrito": "D", "cuenca": "C"}),
                   pt({"nombre": "B", "pp": "0", "umbral": "10", "pp_acum": "0", "umb_acum": "30", "hora": "09:00:00", "fecha": "28/10/2026", "departamento": "CUSCO", "provincia": "P", "distrito": "D", "cuenca": "C"})])
    if "ccpp_filter" in url:
        return fc([pr({"arnombre": "CP1", "nomb_dep": "PIURA", "nomb_pro": "P", "nomb_dist": "D", "nivel": 4, "fecha": "2026-10-27Z", "viv_total": 10, "pob_total": 40, "longitud": -80.1, "latitud": -5.1, "descripcion": "muy probable", "recomendacion": "evacuar"}),
                   pr({"arnombre": "CP2", "nomb_dep": "PIURA", "nomb_pro": "P", "nomb_dist": "D", "nivel": 2, "fecha": "2026-10-27Z", "viv_total": 5, "pob_total": 12, "longitud": -80.2, "latitud": -5.2, "descripcion": "probable", "recomendacion": "atentos"}),
                   pr({"arnombre": "MALO", "nomb_dep": "PIURA", "nomb_pro": "P", "nomb_dist": "D", "nivel": 3, "fecha": "2026-10-27Z", "viv_total": 1, "pob_total": 1, "longitud": 500, "latitud": -5.2}),
                   pr({"arnombre": "=HOJA()", "nomb_dep": "CUSCO", "nomb_pro": "P", "nomb_dist": "D", "nivel": 3, "fecha": "2026-10-27Z", "viv_total": 2, "pob_total": 7, "longitud": -72.0, "latitud": -13.5})])
    if "view_av_activ_qdra" in url:
        return fc([pr({"nivel": "Nivel 4", "fecha": "2026-10-27Z", "nombdep": "PIURA", "nombprov": "P", "nombdist": "D"}), pr({"nivel": "Nivel 2", "fecha": "2026-10-27Z", "nombdep": "CUSCO", "nombprov": "P", "nombdist": "E"})])
    if "silvia" in url:
        return fc([pr({"clase": "forecast_1d", "silvia": "4", "fecha": "2026-10-27Z"}), pr({"clase": "forecast_1d", "silvia": "1", "fecha": "2026-10-27Z"})])
    if "SONICS-CCPP" in url:
        return fc([pt({"arnombre": "CP", "nomb_dep": "LORETO", "nomb_pro": "P", "nomb_dist": "D", "nivel": "Nivel 3"}, -73.2, -3.7), pr({"nomb_dep": "LORETO", "nivel": "Nivel 1"})])
    if "spc%3Aprono" in url:
        return fc([pr({"sectores": "COSTA NORTE", "inferior": 15, "normal": 26, "superior": 59, "escenario": "Superior", "variable": "precipitación", "trimestre": "ENERO_MARZO 2027", "emision": "2026-10-16Z", "bajo": 9, "mes": 11})])
    raise RuntimeError(f"URL no simulada: {url[:120]}")


class Unitarias(unittest.TestCase):
    def test_noaa_mensual(self):
        f = bn.parse_noaa_mensual(NOAA_MENSUAL)
        self.assertEqual(len(f), 5)
        self.assertEqual(f[-1], {"anio": 2026, "mes": 9, "n12": 25.27, "n12a": 4.69, "n3a": 3.64, "n4a": 0.95, "n34": 29.6, "n34a": 2.84})

    def test_noaa_semanal_incluye_negativos_pegados(self):
        f = bn.parse_noaa_semanal(NOAA_SEMANAL)
        self.assertEqual([x["semana"] for x in f], ["2021-01-27", "2026-10-14", "2026-10-21"])  # ordenada por fecha
        self.assertEqual(f[0]["n12a"], -0.4)
        self.assertEqual(f[0]["n34a"], -0.7)

    def test_noaa_vacio_falla(self):
        with self.assertRaises(RuntimeError):
            bn.parse_noaa_mensual("nada")

    def test_proxy_icen_y_categorias(self):
        ic = bn.proxy_icen(bn.parse_noaa_mensual(NOAA_MENSUAL))
        self.assertEqual([(p["anio"], p["mes"]) for p in ic], [(2026, 6), (2026, 7), (2026, 8)])
        self.assertEqual(ic[-1]["valor"], round((3.56 + 4.08 + 4.69) / 3, 2))
        self.assertEqual(ic[-1]["categoria"], "cálida extraordinaria")
        self.assertEqual(bn.categoria_icen(0.0), "neutra")
        self.assertEqual(bn.categoria_icen(0.4), "cálida débil")
        self.assertEqual(bn.categoria_icen(1.7), "cálida fuerte")
        self.assertEqual(bn.categoria_icen(-1.3), "fría moderada")
        self.assertIsNone(bn.categoria_icen(None))

    def test_enfen(self):
        e = bn.parse_enfen(ENFEN_HTML)
        self.assertEqual(e["numero"], "18-2026")
        self.assertEqual(e["fecha"], "2026-10-16")
        self.assertEqual(e["url"], "https://enfen.imarpe.gob.pe/download/comunicado-oficial-enfen-n-18-2026/")
        self.assertEqual(e["estado_alerta"], "Alerta de El Niño Costero")
        with self.assertRaises(RuntimeError):
            bn.parse_enfen("<html>sin nada</html>")

    def test_normalizadores(self):
        self.assertEqual(bn._nivel("Nivel 3"), 3)
        self.assertEqual(bn._nivel(2), 2)
        self.assertIsNone(bn._nivel("Nivel 9"))
        self.assertIsNone(bn._nivel(None))
        self.assertEqual(bn._fecha("2026-10-27Z"), "2026-10-27")
        self.assertEqual(bn._fecha("2026-10-07T11:00:00Z"), "2026-10-07T11:00:00Z")
        self.assertEqual(bn._fecha("28/10/2026"), "2026-10-28")
        self.assertIsNone(bn._fecha("31/02/2026"))
        self.assertIsNone(bn._fecha("hoy"))
        self.assertEqual(bn._txt("<b>Hola</b>&nbsp; mundo  "), "Hola mundo")
        self.assertEqual(len(bn._txt("x" * 1000)), bn.MAX_TEXTO)
        self.assertTrue(bn.coord_valida(-12, -77))
        self.assertFalse(bn.coord_valida(-12, 77))

    def test_celda_csv_no_permite_formulas(self):
        self.assertEqual(bn.celda_csv("=HOJA()"), "'=HOJA()")
        self.assertEqual(bn.celda_csv("-12.5"), "-12.5")
        self.assertEqual(bn.celda_csv(None), "")

    def test_alertas_sin_datos(self):
        self.assertEqual(bn.construir_alertas(None, None, None, None, None, None, None, None), [])


    def test_avisos_lista_solo_vigentes_y_emitidos(self):
        lista = bn.parse_avisos_lista(AVISOS_HTML)
        self.assertEqual([(a["numero"], a["estado"], a["color"], a["nivel"]) for a in lista], [("451", "vigente", "ROJO", 4), ("453", "emitido", "NARANJA", 3)])
        a = lista[0]
        self.assertEqual((a["anio"], a["id_web"], a["emision"], a["inicio"], a["fin"], a["duracion_h"]), (2026, "29348", "2026-11-02", "2026-11-04", "2026-11-06", 59))
        self.assertEqual(bn._dias_aviso(a), 3)
        self.assertEqual(bn._dias_aviso({"inicio": "2026-11-01", "fin": "2026-11-30"}), bn.MAX_DIAS_AVISO)
        self.assertEqual(bn._dias_aviso({"inicio": None, "fin": None}), 1)
        self.assertEqual(bn.parse_avisos_lista("<html>sin tabla</html>"), [])

    def test_clasificar_aviso(self):
        self.assertEqual(bn.clasificar_aviso("PRECIPITACIONES EN LA SIERRA"), "lluvias")
        self.assertEqual(bn.clasificar_aviso("INCREMENTO DE TEMPERATURA DIURNA EN LA SELVA"), "calor")
        self.assertEqual(bn.clasificar_aviso("DESCENSO DE TEMPERATURA NOCTURNA EN LA SIERRA"), "frio")
        self.assertEqual(bn.clasificar_aviso("INCREMENTO DE VIENTO EN LA COSTA"), "otros")

    def test_avisos_detalle_textos_por_dia(self):
        d = bn.parse_avisos_detalle(DETALLE_HTML)
        self.assertEqual(d[("451", 1)], "El miércoles 4 se esperan lluvias de 5 a 55 mm/día.")
        self.assertEqual(d[("451", 2)], "El jueves 5 continúan.")

    def test_indeci_feed(self):
        items = bn.parse_indeci_feed(INDECI_RSS)
        self.assertEqual(len(items), 4)  # el dominio ajeno se descarta
        piura = items[0]
        self.assertEqual((piura["clase"], piura["tipo"], piura["evento"], piura["departamento"], piura["numero"], piura["reporte_n"]), ("complementario", "lluvias", "LLUVIAS INTENSAS", "PIURA", "15463", 14))
        self.assertEqual(piura["publicado_utc"], "2026-11-04T12:17:13Z")
        self.assertEqual([h["fecha"] for h in piura["hechos"]], ["2026-10-25", "2026-10-20"])
        self.assertEqual(piura["hechos"][0]["descripcion"], "Se registraron lluvias intensas que causaron daños materiales (viviendas) en Ayabaca.")
        anc = items[1]
        self.assertEqual((anc["tipo"], anc["evento"], anc["departamento"], anc["distrito"]), ("deslizamiento", "DESLIZAMIENTO", "ÁNCASH", "SAN NICOLAS"))
        self.assertEqual(items[2]["clase"], "boletin")
        self.assertEqual((items[3]["clase"], items[3]["tipo"], items[3]["reporte_n"]), ("informe", "incendio", 1))
        with self.assertRaises(RuntimeError):
            bn.parse_indeci_feed("<rss></rss>")

    def test_emergencias_fusiona_historial(self):
        ahora = datetime(2026, 11, 4, 19, tzinfo=timezone.utc)
        nuevos = bn.parse_indeci_feed(INDECI_RSS)
        prev = {"items": [{"url": "https://portal.indeci.gob.pe/emergencias/viejo/", "publicado_utc": "2026-10-01T00:00:00Z", "tipo": "lluvias", "clase": "preliminar"},
                          {"url": "https://portal.indeci.gob.pe/emergencias/reporte-15463/", "publicado_utc": "2026-11-03T00:00:00Z", "tipo": "lluvias", "clase": "preliminar", "titulo": "VERSIÓN VIEJA"},
                          {"url": "https://portal.indeci.gob.pe/emergencias/antiguo/", "publicado_utc": "2026-09-01T00:00:00Z", "tipo": "lluvias", "clase": "preliminar"}]}
        r = bn.construir_emergencias(nuevos, prev, ahora)
        urls = [e["url"] for e in r["items"]]
        self.assertIn("https://portal.indeci.gob.pe/emergencias/viejo/", urls)        # historial conservado (34 días)
        self.assertNotIn("https://portal.indeci.gob.pe/emergencias/antiguo/", urls)   # > 45 días
        self.assertNotIn("https://portal.indeci.gob.pe/emergencias/informe-2545/", urls)
        self.assertEqual(next(e for e in r["items"] if e["url"].endswith("reporte-15463/"))["clase"], "complementario")  # la versión nueva pisa a la vieja
        self.assertEqual(r["resumen"]["lluvia_72h"], 2)
        self.assertEqual(r["resumen"]["lluvia_30d"], 2)  # "viejo" tiene 34 días: cuenta en el historial, no en 30 d

class EntornoTemporal(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._orig = (bn.OUT_DIR, bn.CSV_DIR)
        bn.OUT_DIR = os.path.join(self.tmp.name, "nino")
        bn.CSV_DIR = os.path.join(self.tmp.name, "csv")

    def tearDown(self):
        bn.OUT_DIR, bn.CSV_DIR = self._orig
        self.tmp.cleanup()

    def leer(self, nombre):
        with open(os.path.join(bn.OUT_DIR, nombre), encoding="utf-8") as fh:
            return json.load(fh)

    def correr(self, fetch=fetch_falso, now=None):
        with redirect_stdout(io.StringIO()) as out:
            estado = bn.ejecutar(fetch=fetch, now=now or AHORA)
        return estado, out.getvalue()


class Integracion(EntornoTemporal):
    def test_flujo_completo(self):
        estado, _ = self.correr()
        self.assertEqual([f["id"] for f in estado["fuentes"] if f["estado"] == "error"], [])
        self.assertEqual(estado["ultima_sincronizacion_utc"], "2026-10-28T15:00:00Z")
        enso = self.leer("enso.json")
        self.assertEqual(enso["actual"]["icen_categoria"], "cálida extraordinaria")
        self.assertEqual(enso["actual"]["n12_anomalia_semanal"], 5.2)
        q = self.leer("quebradas.json")
        self.assertEqual(q["resumen"]["ccpp"], 3)  # la coordenada inválida se descarta
        self.assertEqual(q["resumen"]["poblacion"], 59)
        self.assertEqual(q["resumen"]["ccpp_por_nivel"], {"2": 1, "3": 1, "4": 1})
        self.assertEqual(q["resumen"]["distritos_por_nivel"]["4"], 1)
        self.assertEqual(q["resumen"]["expuestos"]["eess"], 42)
        av = self.leer("avisos.json")
        met = av["meteorologicos"]
        self.assertEqual([(m["numero"], m["estado"], m["nivel"], m["tipo"]) for m in met], [("451", "vigente", 4, "lluvias"), ("453", "emitido", 3, "calor")])
        self.assertEqual(len(met[0]["dias"]), 3)  # 4, 5 y 6 de noviembre
        self.assertEqual(met[0]["departamentos"], ["LAMBAYEQUE", "PIURA", "TUMBES"])  # unión de los días
        self.assertEqual(met[0]["dias"][0]["nivel_max"], 4)
        self.assertEqual(met[0]["dias"][0]["descripcion"], "El miércoles 4 se esperan lluvias de 5 a 55 mm/día.")
        self.assertIsNone(met[0]["dias"][2]["descripcion"])
        self.assertEqual(met[0]["url"], "https://www.senamhi.gob.pe/?p=aviso-meteorologico-vigente&a=2026&b=29348&c=00&d=SENA")
        em = self.leer("emergencias.json")
        self.assertEqual([e["url"] for e in em["items"]], ["https://portal.indeci.gob.pe/emergencias/boletin-307/", "https://portal.indeci.gob.pe/emergencias/reporte-15463/",
                                                           "https://portal.indeci.gob.pe/emergencias/reporte-15457/"])  # sin el dominio ajeno ni el de hace 2 meses
        self.assertEqual(em["resumen"]["lluvia_72h"], 2)
        self.assertEqual(em["resumen"]["departamentos_lluvia_72h"], ["PIURA", "ÁNCASH"])
        alertas = self.leer("alertas.json")["alertas"]
        ids = [a["id"] for a in alertas]
        self.assertIn("aviso-met-2026-451", ids)
        self.assertIn("coen-lluvias", ids)
        self.assertEqual(next(a for a in alertas if a["id"] == "aviso-met-2026-453")["tipo"], "calor")
        self.assertTrue(next(a for a in alertas if a["id"] == "aviso-met-2026-451")["detalle"].startswith("Vigente del 2026-11-04 al 2026-11-06. 3 departamentos: LAMBAYEQUE, PIURA, TUMBES. El miércoles"))
        self.assertTrue(os.path.exists(os.path.join(bn.CSV_DIR, "nino-avisos-met.csv")))
        self.assertTrue(os.path.exists(os.path.join(bn.CSV_DIR, "nino-emergencias-coen.csv")))
        self.assertEqual(av["lluvia_24h"][0]["descripcion"], "Lluvias moderadas")
        self.assertEqual(sum(1 for u in av["umbrales"] if u["supera"]), 1)
        self.assertEqual(av["hidrologicos"][0]["lat"], -3.5)
        so = self.leer("sonics.json")
        self.assertEqual(len(so["dias"]), 7)
        self.assertEqual(so["dias"][0]["por_nivel"], {"1": 1, "3": 1})
        self.assertEqual(len(so["dia1"]), 1)
        self.assertEqual(self.leer("silvia.json")["dias"][0]["por_nivel"], {"1": 1, "4": 1})
        es = self.leer("estacional.json")
        self.assertEqual(es["verano"][0]["superior"], 59)
        pron = self.leer("pronostico.json")
        self.assertEqual(len(pron["ciudades"]), len(bn.CIUDADES))
        self.assertEqual(pron["ciudades"][0]["pp_max_dia"], 25.0)
        ca = self.leer("caudales.json")
        self.assertEqual(ca["rios"][0]["media_30d"], 10)
        self.assertEqual(ca["rios"][0]["ratio"], 4.5)
        al = self.leer("alertas.json")
        ids = {a["id"]: a for a in al["alertas"]}
        self.assertEqual(ids["quebradas"]["nivel"], 4)
        self.assertEqual(ids["enso-icen"]["nivel"], 4)
        self.assertEqual(ids["enfen"]["nivel"], 3)
        self.assertEqual(ids["aviso-met-2026-451"]["nivel"], 4)
        self.assertEqual(ids["aviso-met-2026-453"]["nivel"], 3)
        self.assertEqual(ids["glofas"]["nivel"], 3)
        self.assertEqual(ids["om-calor"]["origen"], "modelo")
        self.assertIn("estación con lluvia", ids["umbrales"]["titulo"])
        self.assertEqual([a["nivel"] for a in al["alertas"]], sorted((a["nivel"] for a in al["alertas"]), reverse=True))
        # CSV: sin inyección de fórmulas y con BOM
        with open(os.path.join(bn.CSV_DIR, "nino-quebradas-ccpp.csv"), encoding="utf-8-sig") as fh:
            texto = fh.read()
        self.assertIn("'=HOJA()", texto)
        self.assertNotIn("\n=HOJA", texto)

    def test_fuente_caida_conserva_ultima_version_valida(self):
        self.correr()
        q_antes = self.leer("quebradas.json")

        def fetch_roto(url, **kw):
            if "ccpp_filter" in url or url.startswith(bn.NOAA_SEMANAL):
                raise RuntimeError("HTTP 503")
            return fetch_falso(url, **kw)
        estado, _ = self.correr(fetch_roto)
        caidas = sorted(f["id"] for f in estado["fuentes"] if f["estado"] == "previo")  # con datos previos → "previo", no "error"
        self.assertEqual(caidas, ["NOAA_SEMANAL", "SENAMHI_QUEBRADAS"])
        self.assertFalse(estado["senamhi_bloqueado"])
        self.assertEqual(self.leer("quebradas.json")["resumen"], q_antes["resumen"])
        self.assertEqual(self.leer("enso.json")["actual"]["n12_anomalia_semanal"], 5.2)  # se conserva la semanal previa
        self.assertEqual(estado["ultima_sincronizacion_utc"], "2026-10-28T15:00:00Z")
        err = next(f for f in estado["fuentes"] if f["id"] == "SENAMHI_QUEBRADAS")
        self.assertIn("503", err["error"])
        self.assertEqual(err["ultimo_exito"], "2026-10-28T15:00:00Z")  # del éxito anterior

    def test_todas_caen_sin_previos(self):
        def todo_roto(url, **kw):
            raise RuntimeError("sin red")
        estado, _ = self.correr(todo_roto)
        self.assertTrue(all(f["estado"] == "error" for f in estado["fuentes"]))  # sin previos → "error"
        self.assertIsNone(estado["ultima_sincronizacion_utc"])
        self.assertTrue(estado["senamhi_bloqueado"])
        self.assertIsNone(estado["senamhi_ultimo_exito"])
        self.assertEqual(self.leer("alertas.json")["alertas"], [])
        self.assertFalse(os.path.exists(os.path.join(bn.OUT_DIR, "quebradas.json")))

    def test_previos_corruptos_no_tumban_la_ingesta(self):
        os.makedirs(bn.OUT_DIR, exist_ok=True)
        for n in ("estado.json", "enso.json", "quebradas.json", "avisos.json"):
            with open(os.path.join(bn.OUT_DIR, n), "w") as fh:
                fh.write("{esto no es json")
        with open(os.path.join(bn.OUT_DIR, "silvia.json"), "w") as fh:
            fh.write("[1,2,3]")
        estado, _ = self.correr()
        self.assertEqual([f["id"] for f in estado["fuentes"] if f["estado"] == "error"], [])
        self.assertEqual(self.leer("quebradas.json")["resumen"]["ccpp"], 3)

    def test_respuesta_wfs_invalida(self):
        def fetch_html(url, **kw):
            if "ccpp_filter" in url:
                return "<html>mantenimiento</html>"
            if "silvia" in url:
                return json.dumps({"type": "FeatureCollection"})  # sin features
            return fetch_falso(url, **kw)
        estado, _ = self.correr(fetch_html)
        caidas = sorted(f["id"] for f in estado["fuentes"] if f["estado"] == "error")
        self.assertEqual(caidas, ["SENAMHI_QUEBRADAS", "SENAMHI_SILVIA"])

    def test_open_meteo_con_menos_series_falla_limpio(self):
        def fetch_corto(url, **kw):
            if url.startswith(bn.OPEN_METEO) and not url.startswith(bn.OPEN_METEO_FLOOD):
                return json.dumps([{"daily": {"time": ["2026-10-28"], "precipitation_sum": [1]}}])
            return fetch_falso(url, **kw)
        estado, _ = self.correr(fetch_corto)
        err = next(f for f in estado["fuentes"] if f["id"] == "OPEN_METEO")
        self.assertEqual(err["estado"], "error")
        self.assertFalse(os.path.exists(os.path.join(bn.OUT_DIR, "pronostico.json")))

    def test_variables_de_entorno_omiten_fuentes(self):
        os.environ["NINO_SIN_SENAMHI"] = "1"
        try:
            estado, _ = self.correr()
        finally:
            del os.environ["NINO_SIN_SENAMHI"]
        ids = {f["id"] for f in estado["fuentes"]}
        self.assertNotIn("SENAMHI_QUEBRADAS", ids)
        self.assertIn("OPEN_METEO", ids)

    def test_senamhi_bloqueado_conserva_todo_y_lo_marca(self):
        """Caso GitHub Actions / VPS: SENAMHI y ENFEN no responden pero hay datos previos."""
        self.correr()
        alertas_antes = len(self.leer("alertas.json")["alertas"])

        def fetch_bloqueado(url, **kw):
            if "senamhi" in url or "imarpe" in url:
                raise RuntimeError("URLError: timed out")
            return fetch_falso(url, **kw)
        estado, _ = self.correr(fetch_bloqueado, now=AHORA.replace(hour=16))
        self.assertTrue(estado["senamhi_bloqueado"])
        self.assertEqual(self.leer("pronostico.json")["generado_utc"], "2026-10-28T16:00:00Z")  # Open-Meteo sí se refrescó
        self.assertEqual(estado["senamhi_ultimo_exito"], "2026-10-28T15:00:00Z")
        self.assertEqual({f["estado"] for f in estado["fuentes"] if f["id"].startswith("SENAMHI")}, {"previo"})
        self.assertEqual(self.leer("quebradas.json")["resumen"]["ccpp"], 3)
        self.assertEqual(self.leer("quebradas.json")["generado_utc"], "2026-10-28T15:00:00Z")  # marca de los datos reales, no de esta corrida
        self.assertEqual(len(self.leer("alertas.json")["alertas"]), alertas_antes)  # ninguna alerta se pierde por el bloqueo
        self.assertEqual(estado["ultima_sincronizacion_utc"], "2026-10-28T16:00:00Z")  # NOAA/Open-Meteo sí sincronizaron

    def test_escritura_atomica_sin_tmp_residuales(self):
        self.correr()
        self.assertEqual([f for f in os.listdir(bn.OUT_DIR) if f.endswith(".tmp")], [])


if __name__ == "__main__":
    unittest.main()
