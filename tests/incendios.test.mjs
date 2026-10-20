// Pruebas de la lógica de filtros del módulo de incendios.
// `npm test` compila src/lib/incendios.ts a .test-build/ y corre esto con node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFocos, filtrarFocos, edad, frescura, indicadores, serieHoraria, contarPor, enlaceFirms, horaLima,
  FILTROS_INICIALES,
} from '../.test-build/incendios.js'

const AHORA = Date.parse('2026-10-19T18:00:00Z')
const CAMPOS = ['id', 'fuente_id', 'satelite', 'instrumento', 'lat', 'lon', 'adq_utc', 'confianza', 'departamento', 'anp']
const fila = (id, sat, horasAtras, conf, dep, anp = null, lat = -9.5, lon = -73.5) =>
  [id, 'X', sat, sat === 'Terra' ? 'MODIS' : 'VIIRS', lat, lon, new Date(AHORA - horasAtras * 3600e3).toISOString(), conf, dep, anp]

const focos = parseFocos({
  generado_utc: '', alcance: 'peru', dias: 7, campos: CAMPOS, filas: [
    fila('a', 'Suomi NPP', 1, 'alta', 'UCAYALI', 'ANP X'),
    fila('b', 'NOAA-20', 8, 'nominal', 'UCAYALI'),
    fila('c', 'NOAA-21', 20, 'baja', 'LORETO'),
    fila('d', 'Terra', 50, null, 'CUSCO'),
    fila('e', 'Suomi NPP', 150, 'alta', 'CUSCO'),
    fila('f', 'Suomi NPP', 1, 'alta', 'CUSCO', null, 'x', -73.5), // lat inválida → descartada
  ],
})

test('parseFocos descarta coordenadas no numéricas', () => {
  assert.equal(focos.length, 5)
})

test('ventanas temporales 6/12/24/72 h y 7 días', () => {
  const n = (horas) => filtrarFocos(focos, { ...FILTROS_INICIALES, horas }, AHORA).length
  assert.deepEqual([6, 12, 24, 72, 168].map(n), [1, 2, 3, 4, 5])
})

test('filtros por satélite, confianza y departamento se combinan', () => {
  const base = { ...FILTROS_INICIALES, horas: 168 }
  assert.equal(filtrarFocos(focos, { ...base, satelites: ['Suomi NPP'] }, AHORA).length, 2)
  assert.equal(filtrarFocos(focos, { ...base, confianzas: ['alta'] }, AHORA).length, 2)
  assert.equal(filtrarFocos(focos, { ...base, confianzas: ['sin dato'] }, AHORA).length, 1)
  assert.equal(filtrarFocos(focos, { ...base, departamento: 'CUSCO', satelites: ['Suomi NPP'] }, AHORA).length, 1)
})

test('leyenda por antigüedad', () => {
  assert.equal(edad(AHORA - 2 * 3600e3, AHORA).etiqueta, '< 6 h')
  assert.equal(edad(AHORA - 30 * 3600e3, AHORA).etiqueta, '1–3 días')
  assert.equal(edad(AHORA - 100 * 3600e3, AHORA).etiqueta, '3–7 días')
})

test('frescura: sin datos, desactualizado, parcial y ok', () => {
  const e = (min, err = false) => ({
    ultima_sincronizacion_utc: new Date(AHORA - min * 60e3).toISOString(),
    fuentes: [{ tipo: 'satelital', estado: err ? 'error' : 'ok' }],
  })
  assert.equal(frescura(null, AHORA), 'sin-datos')
  assert.equal(frescura({ ultima_sincronizacion_utc: null, fuentes: [] }, AHORA), 'sin-datos')
  assert.equal(frescura(e(180), AHORA), 'desactualizado')
  assert.equal(frescura(e(10, true), AHORA), 'parcial')
  assert.equal(frescura(e(10), AHORA), 'ok')
})

test('indicadores sobre el conjunto filtrado', () => {
  assert.deepEqual(indicadores(focos, AHORA), { total: 5, ult24: 3, departamentos: 3, enAnp: 1, altaConfianza: 2 })
  assert.deepEqual(contarPor(focos, (f) => f.departamento)[0], { name: 'CUSCO', value: 2 })
})

test('serie horaria suma todos los focos de la ventana', () => {
  const sel = filtrarFocos(focos, { ...FILTROS_INICIALES, horas: 72 }, AHORA)
  const { paso, cubos } = serieHoraria(sel, 72, AHORA)
  assert.equal(paso, 3)
  assert.equal(cubos.reduce((s, c) => s + c.value, 0), sel.length)
})

test('hora local de Lima es UTC-5 y enlace a FIRMS', () => {
  assert.match(horaLima('2026-10-19T07:05:00Z'), /02:05/)
  assert.equal(enlaceFirms({ lat: -9.5, lon: -73.5, adq_utc: '2026-10-19T07:05:00Z' }),
    'https://firms.modaps.eosdis.nasa.gov/map/#d:2026-10-19;@-73.5000,-9.5000,12.00z')
})
