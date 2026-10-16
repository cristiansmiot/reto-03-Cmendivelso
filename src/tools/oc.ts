import path from "node:path"
import { z } from "zod"
import { registrarControl } from "../lib/control.ts"
import type { ResultadoControl } from "../lib/control.ts"
import { ErrorConfirmacion, ErrorNegocio } from "../lib/error.ts"
import { escribirArchivo, jsonCanonico, rutaRelativa, sha256 } from "../lib/fs.ts"
import { ejecutarSeguro } from "../lib/result.ts"
import type { Contexto } from "../lib/result.ts"
import { evaluarPaquete } from "../rules/rc.ts"
import type { Evaluacion } from "../rules/rc.ts"
import { OrdenCompraSchema } from "../sap/adapter.ts"
import type { OrdenCompra } from "../sap/adapter.ts"
import { SapMock } from "../sap/mock.ts"
import { generarEvidenciaTxt } from "./evidencia.ts"
import { cargarMaestros, cargarPaquete } from "./paquete.ts"
import { construirOrden } from "./payload.ts"

type Salida = { data: unknown; resumen: string }

const casoArg = z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, p. ej. sol-001")

async function evaluar(directory: string, caso: string) {
  const { paquete, faltantes } = await cargarPaquete(directory, caso)
  const maestros = await cargarMaestros(directory)
  return { paquete, faltantes, maestros, ev: evaluarPaquete(paquete, maestros) }
}

const pideConfirmacion = (ev: Evaluacion): boolean => ev.apta && ev.confirmaciones.length > 0

/** La OC tal como quedaría en SAP, sin las confirmaciones (que aún no se han dado). */
async function reconstruirOrden(directory: string, caso: string) {
  const { paquete, maestros, ev } = await evaluar(directory, caso)
  if (!ev.apta) {
    const motivos = ev.bloqueos.map((b) => `${b.codigo}: ${b.detalle}`).join("; ")
    throw new ErrorNegocio(`La solicitud no es apta, no se construye el payload. ${motivos}`)
  }
  const evidencia = await generarEvidenciaTxt(directory, caso, paquete)
  return { paquete, ev, ...construirOrden(paquete, maestros, ev, evidencia.sha256) }
}

export const leer_paquete = {
  description: "Lee y normaliza el paquete de un caso (correo, solicitud, cotización, aprobación y factura si existe).",
  args: { caso: casoArg },
  async execute(args: { caso: string }, ctx: Contexto): Promise<string> {
    return ejecutarSeguro("oc_leer_paquete", args.caso, ctx.directory, async () => {
      const { paquete, faltantes } = await cargarPaquete(ctx.directory, args.caso)
      const resumen = faltantes.length ? `paquete leído; faltan: ${faltantes.join(", ")}` : "paquete completo"
      return { data: { ...paquete, faltantes }, resumen }
    })
  },
}

export const validar = {
  description: "Aplica las reglas de control RC1-RC10 a un caso y devuelve si es apta, los bloqueos, las confirmaciones y los valores derivados.",
  args: {
    caso: casoArg,
    paquete: z.unknown().optional().describe("Opcional e ignorado: el servidor relee el caso desde los archivos"),
  },
  async execute(args: { caso: string; paquete?: unknown }, ctx: Contexto): Promise<string> {
    return ejecutarSeguro("oc_validar", args.caso, ctx.directory, async () => {
      const { ev } = await evaluar(ctx.directory, args.caso)
      const resumen = `apta=${ev.apta}; bloqueos=${ev.bloqueos.length}; confirmaciones=${ev.confirmaciones.length}`
      return { data: ev, resumen, requiereConfirmacion: pideConfirmacion(ev) }
    })
  },
}

export const construir_payload = {
  description: "Construye la orden de compra tal como quedaría en SAP, valida su esquema y guarda la trazabilidad de cada valor.",
  args: {
    caso: casoArg,
    paquete: z.unknown().optional().describe("Opcional e ignorado: el servidor relee el caso desde los archivos"),
    derivados: z.unknown().optional().describe("Opcional e ignorado: los derivados se recalculan en el servidor"),
  },
  async execute(args: { caso: string; paquete?: unknown; derivados?: unknown }, ctx: Contexto): Promise<string> {
    return ejecutarSeguro("oc_construir_payload", args.caso, ctx.directory, async () => {
      const { orden, trazas, ev } = await reconstruirOrden(ctx.directory, args.caso)
      const ruta = path.join(ctx.directory, "out", args.caso, "trazabilidad.json")
      await escribirArchivo(ruta, JSON.stringify(trazas, null, 2))
      const data = { orden: OrdenCompraSchema.parse(orden), trazabilidad: rutaRelativa(ctx.directory, ruta) }
      const resumen = `payload de ${orden.referencia.solicitud_id} con ${trazas.length} valores trazados`
      return { data, resumen, requiereConfirmacion: pideConfirmacion(ev) }
    })
  },
}

export const generar_evidencia = {
  description: "Genera la evidencia de aprobación (out/<caso>/aprobacion.txt) y devuelve su ruta y sha256.",
  args: { caso: casoArg },
  async execute(args: { caso: string }, ctx: Contexto): Promise<string> {
    return ejecutarSeguro("oc_generar_evidencia", args.caso, ctx.directory, async () => {
      const { paquete } = await cargarPaquete(ctx.directory, args.caso)
      const evidencia = await generarEvidenciaTxt(ctx.directory, args.caso, paquete)
      return { data: evidencia, resumen: `${evidencia.ruta} sha256=${evidencia.sha256.slice(0, 12)}…` }
    })
  },
}

type Compuerta = { resultado: ResultadoControl; mensaje: string }

function compuerta(ev: Evaluacion, confirmado: boolean): Compuerta | null {
  if (!ev.apta) {
    const motivos = ev.bloqueos.map((b) => `${b.codigo}: ${b.detalle}`).join("; ")
    return { resultado: "bloqueada", mensaje: `OC bloqueada, no se crea. ${motivos}` }
  }
  if (ev.confirmaciones.length > 0 && !confirmado) {
    const pendientes = ev.confirmaciones.map((c) => `${c.codigo}: ${c.detalle}`).join("; ")
    return { resultado: "pendiente_confirmacion", mensaje: `Falta la confirmación del usuario para crear la OC. ${pendientes}` }
  }
  return null
}

/** Hash del payload sin los confirmantes: lo único que cambia entre construir y crear. */
function huella(orden: OrdenCompra): string {
  const excepciones = orden.excepciones.map((e) => ({ ...e, confirmado_por: null, confirmado_ts: null }))
  return sha256(jsonCanonico({ ...orden, excepciones }))
}

async function enviarASap(orden: OrdenCompra, sessionId: string, directory: string) {
  const sap = new SapMock(directory)
  const previa = await sap.buscarOrdenPorReferencia(orden.referencia.solicitud_id)
  if (previa) return { numero_oc: previa.numero_oc, fecha: null, idempotente: true }
  const ts = new Date().toISOString()
  const excepciones = orden.excepciones.map((e) => ({ ...e, confirmado_por: `analista (sesión ${sessionId})`, confirmado_ts: ts }))
  const creada = await sap.crearOrden({ ...orden, excepciones })
  return { ...creada, idempotente: false }
}

type ArgsCrear = { caso: string; payload?: OrdenCompra; confirmado?: boolean }

/** Devuelve la función que anota cada intento de creación en out/control.csv. */
function registradorDeIntentos(directory: string, solicitud_id: string, ev: Evaluacion) {
  return (resultado: ResultadoControl, numero_oc = "") =>
    registrarControl(directory, {
      solicitud_id,
      resultado,
      numero_oc,
      retroactiva: ev.retroactiva,
      bloqueos: ev.bloqueos.map((h) => h.codigo),
      confirmaciones: ev.confirmaciones.map((h) => h.codigo),
    })
}

async function crearOrden(args: ArgsCrear, ctx: Contexto): Promise<Salida> {
  const { paquete, maestros, ev } = await evaluar(ctx.directory, args.caso)
  const intento = registradorDeIntentos(ctx.directory, paquete.solicitud.solicitud_id, ev)
  const cerrada = compuerta(ev, args.confirmado === true)
  if (cerrada) {
    await intento(cerrada.resultado)
    throw cerrada.resultado === "pendiente_confirmacion" ? new ErrorConfirmacion(cerrada.mensaje) : new ErrorNegocio(cerrada.mensaje)
  }
  const evidencia = await generarEvidenciaTxt(ctx.directory, args.caso, paquete)
  const { orden } = construirOrden(paquete, maestros, ev, evidencia.sha256)
  if (!args.payload || huella(args.payload) !== huella(orden)) {
    await intento("rechazada")
    throw new ErrorNegocio("El payload recibido no coincide con la OC reconstruida desde el caso. Llama oc_construir_payload y envía su resultado sin modificarlo")
  }
  const resultado = await enviarASap(orden, ctx.sessionId, ctx.directory)
  await intento(resultado.idempotente ? "idempotente" : "creada", resultado.numero_oc)
  return { data: resultado, resumen: `OC ${resultado.numero_oc}${resultado.idempotente ? " (idempotente)" : ""}` }
}

export const crear = {
  description: "Crea la OC en SAP si el caso es apta y está confirmada; reconstruye el payload desde el caso y rechaza si difiere del recibido.",
  args: {
    caso: casoArg,
    payload: OrdenCompraSchema.optional().describe("Payload devuelto por oc_construir_payload, sin modificar"),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente en el turno inmediatamente anterior"),
  },
  async execute(args: ArgsCrear, ctx: Contexto): Promise<string> {
    return ejecutarSeguro("oc_crear", args.caso, ctx.directory, () => crearOrden(args, ctx))
  },
}
