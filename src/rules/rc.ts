import type { Centro, CodigoRC, Hallazgo, Maestros, Paquete, Proveedor, Solicitud } from "./tipos.ts"

export type Regla = (p: Paquete, m: Maestros) => Hallazgo[]
export type Derivado = { campo: "indicador_iva" | "condiciones_pago"; valor: string; fuente: string }
export type Derivados = Partial<Record<Derivado["campo"], string>>

export type Evaluacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
}

const TOLERANCIA_RC5 = 0.02

const bloqueo = (codigo: CodigoRC, detalle: string, valor?: unknown): Hallazgo => ({ tipo: "bloqueo", codigo, detalle, valor })
const confirmacion = (codigo: CodigoRC, detalle: string, valor?: unknown): Hallazgo => ({ tipo: "confirmacion", codigo, detalle, valor })
const derivado = (codigo: CodigoRC, detalle: string, valor: Derivado): Hallazgo => ({ tipo: "derivado", codigo, detalle, valor })

const soloFecha = (iso: string): string => iso.slice(0, 10)
const moneda = (n: number): string => `COP ${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`

/** Quita puntos y dígito de verificación: `900.555.111-2` → `900555111`. */
export function normalizarNit(nit: string): string {
  return (nit.replaceAll(".", "").split("-")[0] ?? "").trim()
}

export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Por NIT; si la solicitud no trae NIT, por nombre normalizado. */
export function buscarProveedor(s: Solicitud, proveedores: Proveedor[]): Proveedor | null {
  if (s.proveedor_nit) {
    const nit = normalizarNit(s.proveedor_nit)
    return proveedores.find((x) => x.nit === nit) ?? null
  }
  const nombre = normalizarNombre(s.proveedor_nombre)
  return proveedores.find((x) => normalizarNombre(x.nombre) === nombre) ?? null
}

const centroDe = (p: Paquete, m: Maestros): Centro | null =>
  m.centros.find((c) => c.centro_costo === p.solicitud.centro_costo) ?? null

const aprobadorDe = (centro: Centro, email: string) =>
  centro.aprobadores.find((a) => a.email.toLowerCase() === email.toLowerCase())

export const rc1: Regla = (p, m) => {
  const s = p.solicitud
  const ref = s.proveedor_nit ? `NIT ${s.proveedor_nit}` : `nombre "${s.proveedor_nombre}"`
  const prov = buscarProveedor(s, m.proveedores)
  if (!prov) return [bloqueo("RC1", `El proveedor (${ref}) no existe en el maestro de proveedores`, { ref })]
  if (!prov.activo) return [bloqueo("RC1", `El proveedor ${prov.nombre} (${prov.codigo_sap}) está inactivo`, { ref })]
  return []
}

export const rc2: Regla = (p, m) => {
  const a = p.aprobacion
  if (!a) return [bloqueo("RC2", "No hay correo de aprobación")]
  if (!a.aprobado) return [bloqueo("RC2", "El correo de aprobación no contiene \"Aprobado\"", { aprobador: a.de })]
  const centro = centroDe(p, m)
  if (!centro || aprobadorDe(centro, a.de)) return [] // centro inexistente lo reporta RC4
  return [bloqueo("RC2", `${a.de} no es aprobador del centro ${centro.centro_costo}`, { aprobador: a.de })]
}

export const rc3: Regla = (p, m) => {
  const centro = centroDe(p, m)
  if (!centro) return []
  const total = p.solicitud.valor_total
  const aprobador = p.aprobacion ? aprobadorDe(centro, p.aprobacion.de) : undefined
  const tope = aprobador ? aprobador.tope : Math.max(0, ...centro.aprobadores.map((a) => a.tope))
  if (total <= tope) return []
  const quien = aprobador ? `El tope de ${aprobador.email}` : `El mayor tope del centro ${centro.centro_costo}`
  return [bloqueo("RC3", `${quien} (${moneda(tope)}) no cubre el valor de la solicitud (${moneda(total)})`, { valor_total: total, tope })]
}

export const rc4: Regla = (p, m) => {
  const centro = centroDe(p, m)
  const { centro_costo, subarea } = p.solicitud
  if (!centro) return [bloqueo("RC4", `El centro de costo ${centro_costo} no existe en el maestro`)]
  if (centro.subareas.includes(subarea)) return []
  return [bloqueo("RC4", `La subárea "${subarea}" no pertenece al centro ${centro_costo}`, { subareas: centro.subareas })]
}

export const rc5: Regla = (p) => {
  const total = p.solicitud.valor_total
  if (!p.cotizacion) return [confirmacion("RC5", "No hay cotización del proveedor; confirmar si se crea la OC sin ella")]
  const cot = p.cotizacion.total
  const diferencia = Math.abs(cot - total) / total
  if (diferencia <= TOLERANCIA_RC5) return []
  const pct = (diferencia * 100).toFixed(1)
  const detalle = `La cotización (${moneda(cot)}) difiere ${pct} % de la solicitud (${moneda(total)})`
  return [confirmacion("RC5", detalle, { solicitud: total, cotizacion: cot })]
}

function derivarDelProveedor(
  p: Paquete,
  m: Maestros,
  campo: Derivado["campo"],
  valorProveedor: (prov: Proveedor) => string,
): Derivado | null {
  if (p.solicitud[campo]) return null
  const prov = buscarProveedor(p.solicitud, m.proveedores)
  return prov ? { campo, valor: valorProveedor(prov), fuente: "maestro.proveedores" } : null
}

export const rc6: Regla = (p, m) => {
  const d = derivarDelProveedor(p, m, "indicador_iva", (prov) => prov.indicador_iva_default)
  if (!d) return []
  const detalle = `indicador_iva no informado; se deriva ${d.valor} del proveedor`
  return [derivado("RC6", detalle, d), confirmacion("RC6", `Confirmar el indicador de IVA ${d.valor} derivado del maestro`, d)]
}

export const rc7: Regla = (p, m) => {
  const d = derivarDelProveedor(p, m, "condiciones_pago", (prov) => prov.condiciones_pago_default)
  return d ? [derivado("RC7", `condiciones_pago no informadas; se derivan ${d.valor} del proveedor`, d)] : []
}

export const rc8: Regla = (p) => {
  const f = p.factura
  if (!f || soloFecha(f.fecha) >= soloFecha(p.solicitud.fecha_solicitud)) return []
  const detalle = `La factura ${f.numero} (${soloFecha(f.fecha)}) es anterior a la solicitud (${p.solicitud.fecha_solicitud}): OC retroactiva`
  return [confirmacion("RC8", detalle, { retroactiva: true, factura: f.numero })]
}

export const rc9: Regla = (p) => {
  const a = p.aprobacion
  if (!a || soloFecha(a.fecha) >= soloFecha(p.solicitud.fecha_solicitud)) return []
  const detalle = `La aprobación (${soloFecha(a.fecha)}) es anterior a la solicitud (${p.solicitud.fecha_solicitud})`
  return [confirmacion("RC9", detalle)]
}

export const rc10: Regla = (p) => {
  const { cantidad, valor_unitario, valor_total } = p.solicitud
  const calculado = cantidad * valor_unitario
  if (Math.abs(calculado - valor_total) <= 1) return []
  const detalle = `cantidad × valor unitario (${moneda(calculado)}) no coincide con el valor total (${moneda(valor_total)})`
  return [bloqueo("RC10", detalle, { calculado, valor_total })]
}

export const REGLAS: Regla[] = [rc1, rc2, rc3, rc4, rc5, rc6, rc7, rc8, rc9, rc10]

function esDerivado(v: unknown): v is Derivado {
  return typeof v === "object" && v !== null && "campo" in v && "valor" in v
}

export function derivadosDe(hallazgos: Hallazgo[]): Derivados {
  const derivados: Derivados = {}
  for (const h of hallazgos) {
    if (h.tipo === "derivado" && esDerivado(h.valor)) derivados[h.valor.campo] = h.valor.valor
  }
  return derivados
}

export function evaluarPaquete(p: Paquete, m: Maestros): Evaluacion {
  const hallazgos = REGLAS.flatMap((regla) => regla(p, m))
  const bloqueos = hallazgos.filter((h) => h.tipo === "bloqueo")
  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones: hallazgos.filter((h) => h.tipo === "confirmacion"),
    derivados: derivadosDe(hallazgos),
    retroactiva: hallazgos.some((h) => h.codigo === "RC8"),
  }
}
