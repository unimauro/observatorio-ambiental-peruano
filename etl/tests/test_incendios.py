"""Pruebas del ETL de incendios (unitarias + integración con fuentes simuladas).

Uso:  python -m unittest discover -s etl/tests
Datos de prueba: SOLO fixtures sintéticas de este archivo; nunca se escriben en
public/data (cada prueba usa un directorio temporal).
"""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import build_incendios as bi  # noqa: E402

AHORA = datetime(2026, 10, 19, 18, 0, tzinfo=timezone.utc)
CLAVE = "abc123SECRETkey"

VIIRS_HDR = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight"
MODIS_HDR = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight"

# Cuadrado "Perú de prueba" para el point-in-polygon
DEPTOS = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"NOMBDEP": "UCAYALI"},
     "geometry": {"type": "Polygon", "coordinates": [[[-76, -12], [-72, -12], [-72, -8], [-76, -8], [-76, -12]]]}},
]}
ANP = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"anp_nomb": "ANP de prueba"},
     "geometry": {"type": "Polygon", "coordinates": [[[-74, -10], [-73, -10], [-73, -9], [-74, -9], [-74, -10]]]}},
]}


def viirs(*filas):
    return "\n".join([VIIRS_HDR, *filas]) + "\n"


class Unitarias(unittest.TestCase):
    def test_normaliza_viirs(self):
        regs, inv = bi.parse_firms_csv(
            viirs("-9.5,-73.5,330.1,0.4,0.5,2026-10-19,0705,N,h,2.0NRT,290.2,12.3,N"), "VIIRS_SNPP_NRT", "VIIRS")
        self.assertEqual(inv, 0)
        r = regs[0]
        self.assertEqual(r["adq_utc"], "2026-10-19T07:05:00Z")
        self.assertEqual(r["satelite"], "Suomi NPP")
        self.assertEqual(r["confianza"], "alta")
        self.assertEqual(r["frp"], 12.3)
        self.assertEqual(r["brillo"], 330.1)
        self.assertEqual(r["id"], "VIIRS_SNPP_NRT:20261019T0705:-9.5000,-73.5000")

    def test_hora_de_3_digitos(self):
        self.assertEqual(bi.parse_adq("2026-10-19", "705"), datetime(2026, 10, 19, 7, 5, tzinfo=timezone.utc))
        self.assertIsNone(bi.parse_adq("2026-13-40", "0705"))
        self.assertIsNone(bi.parse_adq("", "0705"))

    def test_confianza_modis_numerica(self):
        self.assertEqual(bi.confianza_normalizada("15", "MODIS"), "baja")
        self.assertEqual(bi.confianza_normalizada("55", "MODIS"), "nominal")
        self.assertEqual(bi.confianza_normalizada("80", "MODIS"), "alta")
        self.assertIsNone(bi.confianza_normalizada("x", "MODIS"))
        self.assertEqual(bi.confianza_normalizada("nominal", "VIIRS"), "nominal")
        self.assertEqual(bi.confianza_normalizada("l", "VIIRS"), "baja")

    def test_satelite_modis(self):
        csv = MODIS_HDR + "\n-9.5,-73.5,320,1,1,2026-10-19,1500,A,90,6.1NRT,300,40,D\n"
        r = bi.parse_firms_csv(csv, "MODIS_NRT", "MODIS")[0][0]
        self.assertEqual((r["satelite"], r["instrumento"], r["confianza"]), ("Aqua", "MODIS", "alta"))

    def test_coordenadas_y_fechas_invalidas(self):
        regs, inv = bi.parse_firms_csv(viirs(
            "-95,-73.5,330,0.4,0.5,2026-10-19,0705,N,n,2.0NRT,290,1,N",     # lat fuera de rango
            "-9.5,-200,330,0.4,0.5,2026-10-19,0705,N,n,2.0NRT,290,1,N",     # lon fuera de rango
            "abc,-73.5,330,0.4,0.5,2026-10-19,0705,N,n,2.0NRT,290,1,N",     # no numérico
            "0,0,330,0.4,0.5,2026-10-19,0705,N,n,2.0NRT,290,1,N",           # isla nula
            "-9.5,-73.5,330,0.4,0.5,19/10/2026,0705,N,n,2.0NRT,290,1,N",    # fecha mal formada
            "-9.5,-73.5,330,0.4,0.5,2026-10-19,0705,N,n,2.0NRT,290,1,N",    # válida
        ), "VIIRS_SNPP_NRT", "VIIRS")
        self.assertEqual((len(regs), inv), (1, 5))

    def test_respuesta_no_csv(self):
        with self.assertRaises(RuntimeError):
            bi.parse_firms_csv("Invalid MAP_KEY.", "VIIRS_SNPP_NRT", "VIIRS")
        self.assertEqual(bi.parse_firms_csv("", "VIIRS_SNPP_NRT", "VIIRS"), ([], 0))
        self.assertEqual(bi.parse_firms_csv(VIIRS_HDR + "\n", "VIIRS_SNPP_NRT", "VIIRS"), ([], 0))

    def test_ventana_temporal(self):
        r = {"adq_utc": "2026-10-19T11:30:00Z"}
        for horas, esperado in ((6, False), (12, True), (24, True)):
            self.assertEqual(bi.en_ventana(r, AHORA - timedelta(hours=horas), AHORA), esperado, horas)
        self.assertFalse(bi.en_ventana({"adq_utc": "2026-10-20T12:00:00Z"}, AHORA - timedelta(days=7), AHORA))

    def test_deduplicacion_conserva_detecciones_distintas(self):
        base = viirs("-9.5,-73.5,330,0.4,0.5,2026-10-19,0705,N,n,2.0NRT,290,1,N")
        a = bi.parse_firms_csv(base, "VIIRS_SNPP_NRT", "VIIRS")[0]
        duplicado = bi.parse_firms_csv(base, "VIIRS_SNPP_NRT", "VIIRS")[0]
        otro_sat = bi.parse_firms_csv(base, "VIIRS_NOAA20_NRT", "VIIRS")[0]
        otro_pixel = bi.parse_firms_csv(viirs("-9.5038,-73.5,330,0.4,0.5,2026-10-19,0705,N,n,2.0NRT,290,1,N"),
                                        "VIIRS_SNPP_NRT", "VIIRS")[0]
        otro_paso = bi.parse_firms_csv(viirs("-9.5,-73.5,330,0.4,0.5,2026-10-19,1810,N,n,2.0NRT,290,1,N"),
                                       "VIIRS_SNPP_NRT", "VIIRS")[0]
        self.assertEqual(len(bi.deduplicar(a + duplicado + otro_sat + otro_pixel + otro_paso)), 4)

    def test_urls_api_trocea_en_bloques_de_5_dias(self):
        urls = bi.urls_firms("VIIRS_SNPP_NRT", 7, CLAVE, bi.BBOX["peru"])
        self.assertEqual(len(urls), 2)
        self.assertTrue(urls[0].split("/")[-2] == "5" and urls[1].split("/")[-2] == "2")
        d0 = datetime.fromisoformat(urls[0].split("/")[-1]).date()
        d1 = datetime.fromisoformat(urls[1].split("/")[-1]).date()
        self.assertEqual((d1 - d0).days, 5)
        self.assertIn("_24h.csv", bi.urls_firms("MODIS_NRT", 1, "", bi.BBOX["peru"])[0])
        self.assertIn("_7d.csv", bi.urls_firms("MODIS_NRT", 3, "", bi.BBOX["peru"])[0])

    def test_oculta_la_clave(self):
        self.assertNotIn(CLAVE, bi.ocultar(f"fallo https://x/api/area/csv/{CLAVE}/VIIRS", CLAVE))

    def test_serie_conserva_dias_viejos_y_marca_parcial(self):
        previa = [{"fecha": "2026-10-01", "total": 99, "VIIRS": 99, "MODIS": 0, "parcial": False}]
        focos = [{"adq_utc": "2026-10-19T12:00:00Z", "instrumento": "VIIRS"},
                 {"adq_utc": "2026-10-15T12:00:00Z", "instrumento": "MODIS"},
                 {"adq_utc": "2026-10-12T19:00:00Z", "instrumento": "VIIRS"}]  # día incompleto
        s = {x["fecha"]: x for x in bi.actualizar_serie(previa, focos, AHORA - timedelta(days=7), AHORA)}
        self.assertEqual(s["2026-10-01"]["total"], 99)
        self.assertTrue(s["2026-10-19"]["parcial"])
        self.assertEqual(s["2026-10-15"]["MODIS"], 1)
        self.assertNotIn("2026-10-12", s)


class Integracion(unittest.TestCase):
    """ejecutar() completo con fuentes simuladas y directorio temporal."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        for nombre, obj in (("peru-departamentos.geojson", DEPTOS), ("anp-sernanp.geojson", ANP)):
            with open(os.path.join(root, nombre), "w") as fh:
                json.dump(obj, fh)
        self._orig = (bi.ROOT, bi.OUT_DIR, bi.CSV_DIR)
        bi.ROOT, bi.OUT_DIR, bi.CSV_DIR = root, os.path.join(root, "incendios"), os.path.join(root, "csv")
        self._env = dict(os.environ)
        os.environ.pop("FIRMS_MAP_KEY", None)
        os.environ["INCENDIOS_SIN_MINAM"] = "1"

    def tearDown(self):
        bi.ROOT, bi.OUT_DIR, bi.CSV_DIR = self._orig
        os.environ.clear()
        os.environ.update(self._env)
        self.tmp.cleanup()

    def correr(self, fetch):
        buf = io.StringIO()
        with redirect_stdout(buf):
            estado = bi.ejecutar(fetch=fetch, now=AHORA)
        return estado, buf.getvalue()

    def focos(self):
        with open(os.path.join(bi.OUT_DIR, "focos.json")) as fh:
            d = json.load(fh)
        return [dict(zip(d["campos"], f)) for f in d["filas"]]

    @staticmethod
    def fetch_ok(url, **_):
        if "MODIS" in url:
            return MODIS_HDR + "\n-9.5,-73.5,320,1,1,2026-10-19,1500,T,85,6.1NRT,300,40,D\n", {"etag": '"m"'}
        return viirs(
            "-9.5,-73.5,330,0.4,0.5,2026-10-19,0705,N,n,2.0NRT,290,5,N",   # Ucayali, dentro de ANP
            "-11.5,-75.5,330,0.4,0.5,2026-10-19,1200,N,h,2.0NRT,290,9,D",  # Ucayali, fuera de ANP
            "-30.0,-60.0,330,0.4,0.5,2026-10-19,1200,N,h,2.0NRT,290,9,D",  # Argentina → fuera de bbox
            "-9.5,-70.0,330,0.4,0.5,2026-10-19,1200,N,h,2.0NRT,290,9,D",   # bbox Perú pero fuera del polígono
            "-9.5,-73.5,330,0.4,0.5,2026-10-01,1200,N,h,2.0NRT,290,9,D",   # fuera de la ventana de 7 días
        ), {"etag": '"v"'}

    def test_flujo_completo(self):
        estado, _ = self.correr(self.fetch_ok)
        focos = self.focos()
        # 2 VIIRS válidos × 3 satélites + 1 MODIS
        self.assertEqual(len(focos), 7)
        self.assertTrue(all(f["departamento"] == "UCAYALI" for f in focos))
        self.assertEqual(sum(1 for f in focos if f["anp"] == "ANP de prueba"), 4)
        self.assertTrue(all(f["recibido_utc"] == "2026-10-19T18:00:00Z" for f in focos))
        self.assertEqual(estado["total_focos"], 7)
        self.assertTrue(all(f["estado"] == "ok" for f in estado["fuentes"]))
        for nombre in ("estado.json", "focos-24h.geojson", "serie-diaria.json"):
            self.assertTrue(os.path.exists(os.path.join(bi.OUT_DIR, nombre)))
        with open(os.path.join(bi.CSV_DIR, "incendios-focos.csv"), encoding="utf-8-sig") as fh:
            self.assertEqual(len(fh.read().strip().splitlines()), 8)

    def test_fuente_caida_conserva_ultima_version_valida(self):
        self.correr(self.fetch_ok)
        primera = {f["id"]: f["recibido_utc"] for f in self.focos()}

        def fetch_noaa20_cae(url, **kw):
            if "J1_VIIRS" in url:
                raise RuntimeError("HTTP 503")
            return self.fetch_ok(url, **kw)

        estado, _ = self.correr(fetch_noaa20_cae)
        st = {f["id"]: f for f in estado["fuentes"]}
        self.assertEqual(st["VIIRS_NOAA20_NRT"]["estado"], "error")
        self.assertEqual(st["VIIRS_NOAA20_NRT"]["registros"], 2)  # conservados
        self.assertEqual(len(self.focos()), 7)
        # la fecha de recepción original se preserva entre corridas
        self.assertEqual({f["id"]: f["recibido_utc"] for f in self.focos()}, primera)

    def test_respuesta_vacia_e_invalida(self):
        def fetch(url, **_):
            if "SUOMI" in url:
                return "", {}
            if "J2_VIIRS" in url:
                return "<html>Service Unavailable</html>", {}
            return self.fetch_ok(url)

        estado, _ = self.correr(fetch)
        st = {f["id"]: f for f in estado["fuentes"]}
        self.assertEqual((st["VIIRS_SNPP_NRT"]["estado"], st["VIIRS_SNPP_NRT"]["registros"]), ("ok", 0))
        self.assertEqual(st["VIIRS_NOAA21_NRT"]["estado"], "error")
        self.assertEqual(estado["total_focos"], 3)  # NOAA-20 (2) + MODIS (1)

    def test_todas_caen_sin_previos(self):
        def fetch(url, **_):
            raise RuntimeError("timeout")

        estado, _ = self.correr(fetch)
        self.assertEqual(estado["total_focos"], 0)
        self.assertIsNone(estado["ultima_sincronizacion_utc"])
        self.assertTrue(all(f["estado"] == "error" for f in estado["fuentes"]))

    def test_clave_no_aparece_en_logs_ni_archivos(self):
        os.environ["FIRMS_MAP_KEY"] = CLAVE

        def fetch(url, **_):
            raise RuntimeError(f"HTTP 403 en {url}")  # el error incluye la URL con la clave

        _, logs = self.correr(fetch)
        self.assertNotIn(CLAVE, logs)
        for carpeta in (bi.OUT_DIR, bi.CSV_DIR):
            for nombre in os.listdir(carpeta):
                with open(os.path.join(carpeta, nombre), encoding="utf-8-sig") as fh:
                    self.assertNotIn(CLAVE, fh.read(), nombre)

    def test_sin_cambios_reutiliza_previos(self):
        self.correr(self.fetch_ok)

        def fetch(url, **_):
            raise bi.NoModificado()

        estado, _ = self.correr(fetch)
        self.assertTrue(all(f["estado"] == "sin-cambios" for f in estado["fuentes"]))
        self.assertEqual(estado["total_focos"], 7)

    def test_minam_caido_no_tumba_la_ingesta(self):
        os.environ.pop("INCENDIOS_SIN_MINAM")

        def fetch(url, **kw):
            if "minam.gob.pe" in url:
                raise RuntimeError("HTTP 500")
            return self.fetch_ok(url, **kw)

        estado, _ = self.correr(fetch)
        st = {f["id"]: f for f in estado["fuentes"]}
        self.assertEqual(st["MINAM_REGISTRO_2026"]["estado"], "error")
        self.assertEqual(st["MINAM_HISTORICO"]["estado"], "error")
        self.assertEqual(estado["total_focos"], 7)

    def test_minam_normaliza_registro(self):
        os.environ.pop("INCENDIOS_SIN_MINAM")

        def fetch(url, **kw):
            if "/0/query" in url:
                return json.dumps({"features": [
                    {"attributes": {"OBJECTID_12": 5, "FEC_EMERGE": "22/07/2026", "FEC_TERMIN": " ",
                                    "NOMBDEP": "AYACUCHO", "ORIGEN": "INDECI", "COB_AFECTA": 0},
                     "geometry": {"x": -73.99, "y": -12.75}},
                    {"attributes": {"OBJECTID_12": 6}, "geometry": {"x": None, "y": None}},  # sin coordenadas
                ]}), {}
            if "/1/query" in url:
                campo = "AñO" if "A%C3%B1O" in url else "NOMBDEP"
                return json.dumps({"features": [{"attributes": {campo: 2024 if campo == "AñO" else "CUSCO", "n": 10}}]}), {}
            return self.fetch_ok(url, **kw)

        estado, _ = self.correr(fetch)
        with open(os.path.join(bi.OUT_DIR, "minam-2026.geojson")) as fh:
            feats = json.load(fh)["features"]
        self.assertEqual(len(feats), 1)
        p = feats[0]["properties"]
        self.assertEqual((p["fecha_emergencia"], p["fecha_termino"], p["departamento"]), ("2026-07-22", None, "AYACUCHO"))
        st = {f["id"]: f for f in estado["fuentes"]}
        self.assertEqual(st["MINAM_REGISTRO_2026"]["ultimo_registro"], "2026-07-22")
        self.assertEqual(st["MINAM_HISTORICO"]["registros"], 10)


if __name__ == "__main__":
    unittest.main()
