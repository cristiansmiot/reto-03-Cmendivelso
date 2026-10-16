import { z } from "zod"
import { ErrorNegocio } from "../lib/error.ts"
import { registrarLlamada, registrarUso } from "../lib/log.ts"
import { mensajeDeError } from "../lib/result.ts"
import type { LlamadaHerramienta, LlmAdapter, RespuestaLlm, Uso } from "../llm/adapter.ts"
import { casosConfirmados, claveCaso, forzarConfirmacion } from "./confirmacion.ts"
import { definiciones } from "./herramientas.ts"
import type { Registro } from "./herramientas.ts"
import type { LlamadaRegistrada, Sesion } from "./sesion.ts"

export type ConfigAgente = {
  maxIter: number
  maxTokensSesion: number
  maxTokensRespuesta: number
  timeoutMs: number
}

export type Dependencias = {
  llm: LlmAdapter
  herramientas: Registro
  sistema: string
  directory: string
  config: ConfigAgente
}

export type ResultadoTurno = { reply: string; toolCalls: LlamadaVista[]; needsConfirmation: boolean }
export type LlamadaVista = Pick<LlamadaRegistrada, "name" | "args" | "ok" | "summary">

type Turno = {
  sesion: Sesion
  confirmados: string[]
  llamadas: LlamadaRegistrada[]
  /** Casos que en este turno quedaron esperando confirmación. */
  pendientes: Set<string>
}

type Ejecucion = { contenido: string; ok: boolean; requiere: boolean; summary: string; args: Record<string, unknown> }

const entero = (valor: string | undefined, defecto: number): number => {
  const n = Number.parseInt(valor ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : defecto
}

export function leerConfig(env: Record<string, string | undefined> = process.env): ConfigAgente {
  return {
    maxIter: entero(env.MAX_ITER, 25),
    maxTokensSesion: entero(env.MAX_TOKENS_SESION, 200000),
    maxTokensRespuesta: entero(env.MAX_TOKENS_RESPUESTA, 2048),
    timeoutMs: entero(env.LLM_TIMEOUT_MS, 60000),
  }
}

const ResultadoSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  requiere_confirmacion: z.boolean().optional(),
})

const recortar = (texto: string, max: number): string => (texto.length > max ? `${texto.slice(0, max)}…` : texto)
const falla = (error: string) => JSON.stringify({ ok: false, error })

function leerResultado(contenido: string): Pick<Ejecucion, "ok" | "requiere" | "summary"> {
  const r = ResultadoSchema.safeParse(safeJson(contenido))
  if (!r.success) return { ok: false, requiere: false, summary: "La herramienta devolvió una respuesta ilegible" }
  const summary = r.data.ok ? JSON.stringify(r.data.data ?? null) : (r.data.error ?? "error")
  return { ok: r.data.ok, requiere: r.data.requiere_confirmacion === true, summary: recortar(summary, 300) }
}

function safeJson(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return null
  }
}

async function ejecutarLlamada(deps: Dependencias, turno: Turno, llamada: LlamadaHerramienta): Promise<Ejecucion> {
  const herramienta = deps.herramientas.get(llamada.nombre)
  const rechazar = async (error: string): Promise<Ejecucion> => {
    const caso = typeof llamada.argumentos.caso === "string" ? llamada.argumentos.caso : "-"
    await registrarLlamada(deps.directory, { herramienta: llamada.nombre, caso, ok: false, resumen: error })
    return { contenido: falla(error), ok: false, requiere: false, summary: error, args: llamada.argumentos }
  }
  if (!herramienta) return rechazar(`La herramienta "${llamada.nombre}" no existe`)
  const valido = z.object(herramienta.args).safeParse(llamada.argumentos)
  if (!valido.success) return rechazar(`Argumentos inválidos para ${llamada.nombre}: ${mensajeDeError(valido.error)}`)
  const args = forzarConfirmacion(valido.data, "confirmado" in herramienta.args, turno.confirmados)
  const contenido = await herramienta.execute(args as never, { directory: deps.directory, sessionId: turno.sesion.id })
  return { contenido, args, ...leerResultado(contenido) }
}

async function ejecutarLlamadas(deps: Dependencias, turno: Turno, r: RespuestaLlm): Promise<void> {
  const resultados = []
  for (const llamada of r.llamadas) {
    const e = await ejecutarLlamada(deps, turno, llamada)
    registrarEjecucion(deps, turno, llamada, e, r.uso)
    resultados.push({ id: llamada.id, nombre: llamada.nombre, contenido: e.contenido, esError: !e.ok })
  }
  turno.sesion.mensajes.push({ rol: "herramienta", resultados })
}

/** Marca el caso al pedir confirmación; solo una creación confirmada con éxito lo libera (otras llamadas no lo tocan). */
function actualizarPendientes(pendientes: Set<string>, args: Record<string, unknown>, e: Ejecucion): void {
  if (typeof args.caso !== "string") return
  const clave = claveCaso(args.caso)
  if (e.requiere) pendientes.add(clave)
  else if (e.ok && args.confirmado === true) pendientes.delete(clave)
}

function registrarEjecucion(deps: Dependencias, turno: Turno, llamada: LlamadaHerramienta, e: Ejecucion, uso: Uso): void {
  const { ok, summary, args } = e
  turno.llamadas.push({ name: llamada.nombre, args, ok, summary, uso })
  turno.sesion.llamadas.push({ name: llamada.nombre, args, ok, summary, uso })
  actualizarPendientes(turno.pendientes, args, e)
  void registrarUso(deps.directory, { sessionId: turno.sesion.id, herramienta: llamada.nombre, ok, ...uso })
}

async function consultarModelo(deps: Dependencias, sesion: Sesion): Promise<RespuestaLlm> {
  const controlador = new AbortController()
  const temporizador = setTimeout(() => controlador.abort(), deps.config.timeoutMs)
  try {
    const opts = { sistema: deps.sistema, maxTokens: deps.config.maxTokensRespuesta, signal: controlador.signal }
    return await deps.llm.enviar(sesion.mensajes, definiciones(deps.herramientas), opts)
  } catch (e) {
    if (!controlador.signal.aborted) throw e
    throw new ErrorNegocio(`el modelo no respondió en ${Math.round(deps.config.timeoutMs / 1000)} s`)
  } finally {
    clearTimeout(temporizador)
  }
}

function cerrar(sesion: Sesion, texto: string): string {
  sesion.mensajes.push({ rol: "asistente", texto, llamadas: [] })
  return texto
}

async function iterar(deps: Dependencias, turno: Turno): Promise<string> {
  const { sesion } = turno
  for (let i = 0; i < deps.config.maxIter; i++) {
    if (sesion.tokens.entrada + sesion.tokens.salida >= deps.config.maxTokensSesion) {
      return cerrar(sesion, `Se alcanzó el tope de tokens de esta sesión (${deps.config.maxTokensSesion}). Inicia una sesión nueva para continuar.`)
    }
    let r: RespuestaLlm
    try {
      r = await consultarModelo(deps, sesion)
    } catch (e) {
      const motivo = e instanceof ErrorNegocio ? e.message : e instanceof Error ? e.message : "error desconocido"
      return cerrar(sesion, `No pude consultar al modelo: ${motivo}. Puedes reintentar tu mensaje.`)
    }
    sesion.tokens = { entrada: sesion.tokens.entrada + r.uso.entrada, salida: sesion.tokens.salida + r.uso.salida }
    sesion.mensajes.push({ rol: "asistente", texto: r.texto, llamadas: r.llamadas })
    if (r.llamadas.length === 0) return r.texto || "(El modelo no devolvió texto.)"
    await ejecutarLlamadas(deps, turno, r)
  }
  return cerrar(sesion, `Alcancé el tope de ${deps.config.maxIter} pasos en este turno. Dime si continúo con lo que falta.`)
}

/** Un turno: mensaje del usuario → (modelo → herramientas)* → respuesta. Nunca lanza por fallos del modelo. */
export async function ejecutarTurno(deps: Dependencias, sesion: Sesion, mensaje: string): Promise<ResultadoTurno> {
  const turno: Turno = { sesion, confirmados: casosConfirmados(sesion, mensaje), llamadas: [], pendientes: new Set(casosConfirmados(sesion, mensaje)) }
  sesion.mensajes.push({ rol: "usuario", texto: mensaje })
  const reply = await iterar(deps, turno)
  const casos = [...turno.pendientes]
  sesion.pendiente = casos.length > 0 ? { casos } : null
  const toolCalls = turno.llamadas.map(({ name, args, ok, summary }) => ({ name, args, ok, summary }))
  return { reply, toolCalls, needsConfirmation: sesion.pendiente !== null }
}
