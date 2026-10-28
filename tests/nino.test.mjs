// Pruebas de la lógica pura del módulo "El Niño, lluvias y calor".
// `npm test` compila src/lib/nino.ts a .test-build/ y corre esto con node --test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  categoriaIcen, colorCategoria, filtrarAlertas, nivelMaximo, desdeColumnar, parseCcpp, frescura, hace, diaCorto,
  colorLluvia, colorCalor, serieMensual, episodios,
} from '../.test-build/nino.js'

const AHORA = Date.parse('2026-10-28T15:00:00Z')

const alertas = [
  { id: 'a', tipo: 'huaycos', nivel: 4, origen: 'oficial', titulo: 'Quebradas', detalle: '', fuente: '', url: null },
  { id: 'b', tipo: 'enso', nivel: 4, origen: 'calculado', titulo: 'ICEN', detalle: '', fuente: '', url: null },
  { id: 'c', tipo: 'rios', nivel: 2, origen: 'modelo', titulo: 'GloFAS', detalle: '', fuente: '', url: null },
  { id: 'd', tipo: 'calor', nivel: 3, origen: 'modelo', titulo: 'Calor', detalle: '', fuente: '', url: null },
]

test('categorías del ICEN según umbrales ENFEN', () => {
  assert.equal(categoriaIcen(-1.5), 'fría fuerte')
  assert.equal(categoriaIcen(-1.0), 'neutra')
  assert.equal(categoriaIcen(0.39), 'neutra')
  assert.equal(categoriaIcen(0.4), 'cálida débil')
  assert.equal(categoriaIcen(1.0), 'cálida moderada')
  assert.equal(categoriaIcen(2.9), 'cálida fuerte')
  assert.equal(categoriaIcen(4.11), 'cálida extraordinaria')
  assert.equal(categoriaIcen(null), null)
  assert.equal(categoriaIcen(NaN), null)
})

test('color por categoría distingue cálido/frío/neutro', () => {
  assert.notEqual(colorCategoria('cálida extraordinaria'), colorCategoria('cálida fuerte'))
  assert.equal(colorCategoria('fría débil'), '#2563eb')
  assert.equal(colorCategoria('neutra'), '#16a34a')
  assert.equal(colorCategoria(null), '#64748b')
})

test('filtrarAlertas ordena por nivel y prioriza oficiales; filtra por tipo y origen', () => {
  assert.deepEqual(filtrarAlertas(alertas, 'todas', false).map((a) => a.id), ['a', 'b', 'd', 'c'])
  assert.deepEqual(filtrarAlertas(alertas, 'rios', false).map((a) => a.id), ['c'])
  assert.deepEqual(filtrarAlertas(alertas, 'todas', true).map((a) => a.id), ['a'])
  assert.equal(nivelMaximo(alertas), 4)
  assert.equal(nivelMaximo([]), 0)
})

test('desdeColumnar y parseCcpp descartan filas inválidas', () => {
  const campos = ['nombre', 'departamento', 'provincia', 'distrito', 'nivel', 'poblacion', 'viviendas', 'lat', 'lon']
  const q = { campos, filas: [
    ['A', 'PIURA', 'P', 'D', 4, 10, 3, -5.1, -80.1],
    ['B', 'PIURA', 'P', 'D', 2, 10, 3, 'x', -80.1],
    ['C', 'PIURA', 'P', 'D', 7, 10, 3, -5.1, -80.1],
    ['corta'],
  ] }
  assert.equal(parseCcpp(q).length, 1)
  assert.equal(parseCcpp(null).length, 0)
  assert.deepEqual(desdeColumnar(undefined, undefined), [])
})

test('frescura: ok, parcial (fuente en error), desactualizado (>3 h) y sin datos', () => {
  const base = { ultima_ejecucion_utc: '', duracion_ms: 0, alertas: 0, wms: '', fuentes: [] }
  assert.equal(frescura(null, AHORA), 'sin-datos')
  assert.equal(frescura({ ...base, ultima_sincronizacion_utc: null }, AHORA), 'sin-datos')
  assert.equal(frescura({ ...base, ultima_sincronizacion_utc: new Date(AHORA - 3600e3).toISOString() }, AHORA), 'ok')
  assert.equal(frescura({ ...base, ultima_sincronizacion_utc: new Date(AHORA - 3600e3).toISOString(), fuentes: [{ estado: 'error' }] }, AHORA), 'parcial')
  assert.equal(frescura({ ...base, ultima_sincronizacion_utc: new Date(AHORA - 4 * 3600e3).toISOString() }, AHORA), 'desactualizado')
})

test('hace y diaCorto', () => {
  assert.equal(hace(null, AHORA), 'nunca')
  assert.equal(hace(new Date(AHORA - 5 * 60e3).toISOString(), AHORA), 'hace 5 min')
  assert.equal(hace(new Date(AHORA - 3 * 24 * 3600e3).toISOString(), AHORA), 'hace 3 días')
  assert.match(diaCorto('2026-10-28'), /28/)
  assert.match(diaCorto('2026-10-28'), /oct/i)
})

test('escalas de color de lluvia y calor son monótonas', () => {
  const ll = [0, 5, 15, 25, 50].map(colorLluvia)
  assert.equal(new Set(ll).size, 5)
  assert.equal(colorLluvia(null), '#e2e8f0')
  const ca = [20, 28, 31, 34, 37].map(colorCalor)
  assert.equal(new Set(ca).size, 5)
})

test('serieMensual y episodios agrupan meses consecutivos sobre el umbral', () => {
  const enso = {
    mensual: [{ anio: 1981, mes: 12, n12a: 0, n34a: 0 }, { anio: 1982, mes: 1, n12a: 1, n34a: 0.5 }],
    icen_proxy: [
      { anio: 1997, mes: 4, valor: 1.0, categoria: 'cálida moderada' }, { anio: 1997, mes: 5, valor: 2.1, categoria: 'cálida fuerte' },
      { anio: 1997, mes: 6, valor: 3.5, categoria: 'cálida extraordinaria' }, { anio: 1997, mes: 7, valor: 1.2, categoria: 'cálida moderada' },
      { anio: 2017, mes: 2, valor: 1.8, categoria: 'cálida fuerte' },
    ],
  }
  assert.deepEqual(serieMensual(enso, 1982), [{ name: '1982-01', n12a: 1, n34a: 0.5 }])
  assert.deepEqual(episodios(enso, 1.7), [
    { inicio: '1997-05', fin: '1997-06', maximo: 3.5, categoria: 'cálida extraordinaria' },
    { inicio: '2017-02', fin: '2017-02', maximo: 1.8, categoria: 'cálida fuerte' },
  ])
  assert.deepEqual(episodios(null), [])
})
