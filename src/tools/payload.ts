import { ErrorNegocio } from "../lib/error.ts"
import { buscarProveedor } from "../rules/rc.ts"
import type { Derivados, Evaluacion } from "../rules/rc.ts"
import type { Maestros, Paquete, Proveedor } from "../rules/tipos.ts"
import type { OrdenCompra } from "../sap/adapter.ts"

export type Traza = { campo: string; valor: unknown; fuente: string; nota?: string }

type Registrar = <T>(campo: string, valor: T, fuente: string, nota?: string) => T
type Posicion = OrdenCompra["posiciones"][number]

const MAX_DESCRIPCION = 40

/** Unidad SAP: solo las horas se distinguen en los fixtures; el resto se trata como unidad. */
const unidadDe = (descripcion: string): Posicion["unidad"] => (/\bhoras?\b/i.test(descripcion) ? "H" : "UN")

function referencia(p: Paquete, reg: Registrar): OrdenCompra["referencia"] {
  if (!p.correo) throw new ErrorNegocio("Falta correo.json: no se puede referenciar el correo de la solicitud")
  return {
    solicitud_id: reg("referencia.solicitud_id", p.solicitud.solicitud_id, "solicitud"),
    correo_id: reg("referencia.correo_id", p.correo.id, "correo"),
    cotizacion_ref: reg("referencia.cotizacion_ref", p.cotizacion?.ref ?? null, "cotizacion"),
  }
}

function proveedorOrden(prov: Proveedor, reg: Registrar): OrdenCompra["proveedor"] {
  const fuente = "maestro.proveedores"
  return {
    codigo_sap: reg("proveedor.codigo_sap", prov.codigo_sap, fuente),
    nit: reg("proveedor.nit", prov.nit, fuente),
    nombre: reg("proveedor.nombre", prov.nombre, fuente),
  }
}

function aprobadorOrden(p: Paquete, evidenciaSha: string, reg: Registrar): OrdenCompra["aprobador"] {
  if (!p.aprobacion) throw new ErrorNegocio("Falta el correo de aprobación")
  return {
    email: reg("aprobador.email", p.aprobacion.de, "aprobacion"),
    fecha_aprobacion: reg("aprobador.fecha_aprobacion", p.aprobacion.fecha, "aprobacion"),
    evidencia_sha256: reg("aprobador.evidencia_sha256", evidenciaSha, "derivado", "sha256 de out/<caso>/aprobacion.txt"),
  }
}

function posicionOrden(p: Paquete, derivados: Derivados, reg: Registrar): Posicion {
  const s = p.solicitud
  const descripcion = s.descripcion.slice(0, MAX_DESCRIPCION).trimEnd()
  const iva = s.indicador_iva ?? derivados.indicador_iva
  if (!iva) throw new ErrorNegocio("No hay indicador de IVA ni se pudo derivar del proveedor")
  return {
    numero: reg("posiciones[0].numero", 10, "derivado", "primera posición"),
    descripcion: reg("posiciones[0].descripcion", descripcion, "solicitud", `truncada a ${MAX_DESCRIPCION} caracteres`),
    cantidad: reg("posiciones[0].cantidad", s.cantidad, "solicitud"),
    unidad: reg("posiciones[0].unidad", unidadDe(s.descripcion), "derivado", "H si la descripción habla de horas; UN en otro caso"),
    precio_unitario: reg("posiciones[0].precio_unitario", s.valor_unitario, "solicitud", "IVA incluido"),
    centro_costo: reg("posiciones[0].centro_costo", s.centro_costo, "solicitud"),
    subarea: reg("posiciones[0].subarea", s.subarea, "solicitud"),
    indicador_iva: reg("posiciones[0].indicador_iva", iva, s.indicador_iva ? "solicitud" : "derivado"),
  }
}

/** Construye la OC y la fuente de cada valor. Lanza `ErrorNegocio` si el paquete no alcanza para armarla. */
export function construirOrden(
  p: Paquete,
  m: Maestros,
  ev: Evaluacion,
  evidenciaSha: string,
): { orden: OrdenCompra; trazas: Traza[] } {
  const trazas: Traza[] = []
  const reg: Registrar = (campo, valor, fuente, nota) => {
    trazas.push({ campo, valor, fuente, ...(nota ? { nota } : {}) })
    return valor
  }
  const prov = buscarProveedor(p.solicitud, m.proveedores)
  if (!prov) throw new ErrorNegocio("No se puede construir la OC: el proveedor no existe en el maestro")
  const pago = p.solicitud.condiciones_pago ?? ev.derivados.condiciones_pago ?? prov.condiciones_pago_default
  const orden: OrdenCompra = {
    referencia: referencia(p, reg),
    sociedad: reg("sociedad", "1000", "derivado", "constante del reto"),
    organizacion_compras: reg("organizacion_compras", "1000", "derivado", "constante del reto"),
    proveedor: proveedorOrden(prov, reg),
    moneda: reg("moneda", p.solicitud.moneda, "solicitud"),
    condiciones_pago: reg("condiciones_pago", pago, p.solicitud.condiciones_pago ? "solicitud" : "derivado"),
    aprobador: aprobadorOrden(p, evidenciaSha, reg),
    posiciones: [posicionOrden(p, ev.derivados, reg)],
    excepciones: ev.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  }
  return { orden, trazas }
}
