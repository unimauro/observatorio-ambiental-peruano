const estilos: Record<string, string> = {
  verificado: 'bg-green-100 text-green-800',
  estimado: 'bg-amber-100 text-amber-800',
  ilustrativo: 'bg-slate-200 text-slate-700',
  referencial: 'bg-slate-200 text-slate-700',
  referencia: 'bg-amber-100 text-amber-800',
}

export default function Estado({ estado }: { estado: string }) {
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
        estilos[estado] ?? 'bg-slate-200 text-slate-700'
      }`}
    >
      {estado}
    </span>
  )
}
