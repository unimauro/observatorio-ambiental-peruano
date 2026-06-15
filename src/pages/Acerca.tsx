const fuentes = [
  ['OEFA', 'Organismo de Evaluación y Fiscalización Ambiental', 'https://www.oefa.gob.pe/'],
  ['MINAM', 'Ministerio del Ambiente', 'https://www.minam.gob.pe/'],
  ['Geobosques', 'Monitoreo de bosques (MINAM)', 'https://geobosques.minam.gob.pe/'],
  ['SINIA', 'Sistema Nacional de Información Ambiental', 'https://sinia.minam.gob.pe/'],
  ['ANA', 'Autoridad Nacional del Agua', 'https://www.gob.pe/ana'],
  ['SERNANP', 'Servicio Nacional de Áreas Naturales Protegidas', 'https://www.gob.pe/sernanp'],
  ['INEI', 'Instituto Nacional de Estadística e Informática', 'https://www.inei.gob.pe/'],
  ['Datos Abiertos', 'Plataforma Nacional de Datos Abiertos', 'https://www.datosabiertos.gob.pe/'],
  ['OSINERGMIN', 'Organismo Supervisor de la Inversión en Energía y Minería', 'https://www.osinergmin.gob.pe/'],
]

export default function Acerca() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold">Acerca del Observatorio</h1>
        <p className="mt-2 text-slate-600">
          El <strong>Observatorio Ambiental Peruano</strong> centraliza, visualiza y
          democratiza el acceso a información ambiental del Perú mediante datos abiertos,
          mapas interactivos e inteligencia artificial.
        </p>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-bold mb-2">Hoja de ruta</h2>
        <ol className="space-y-2 text-sm text-slate-700">
          <li><strong>Fase 1 — Observatorio (actual):</strong> mapa nacional, derrames, deforestación, áreas protegidas, indicadores y dashboard.</li>
          <li><strong>Fase 2 — Investigación:</strong> biblioteca documental ampliada, línea de tiempo histórica (1970–hoy), estadísticas regionales.</li>
          <li><strong>Fase 3 — IA Ambiental:</strong> chat con documentos, generación de reportes, detección de patrones y alertas (RAG).</li>
        </ol>
      </section>

      <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <h2 className="font-bold mb-2 text-amber-900">Sobre la calidad del dato</h2>
        <p className="text-sm text-amber-900/90">
          Cada cifra y punto del mapa declara su <strong>estado</strong>:
          <span className="font-semibold"> verificado</span> (cifra oficial citada),
          <span className="font-semibold"> estimado</span> (derivado/distribuido a partir de oficiales) y
          <span className="font-semibold"> referencial</span> (ubicación o valor aproximado para visualización).
          Evitamos el sobre-afirmar: las coordenadas de eventos son aproximadas y se
          reemplazarán con los registros georeferenciados oficiales de OEFA.
        </p>
      </section>

      <section>
        <h2 className="font-bold mb-3">Fuentes oficiales</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          {fuentes.map(([sigla, nombre, url]) => (
            <a key={sigla} href={url} target="_blank" rel="noreferrer noopener"
              className="bg-white border border-slate-200 rounded-lg px-3 py-2 hover:border-forest transition">
              <div className="font-semibold text-forest-dark text-sm">{sigla}</div>
              <div className="text-xs text-slate-500">{nombre}</div>
            </a>
          ))}
        </div>
      </section>

      <p className="text-xs text-slate-400">
        Proyecto abierto y sin fines de lucro. Las contribuciones de datos y validación
        científica son bienvenidas vía el repositorio.
      </p>
    </div>
  )
}
