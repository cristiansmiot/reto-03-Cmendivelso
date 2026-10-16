import { z } from "zod"
import { ErrorConfirmacion, ErrorNegocio } from "./error.ts"
import { registrarLlamada } from "./log.ts"

z.config(z.locales.es())

export type Contexto = { directory: string; sessionId: string }

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export const ok = <T>(data: T): Resultado<T> => ({ ok: true, data })
export const fallo = (error: string): Resultado<never> => ({ ok: false, error })

export function mensajeDeError(e: unknown): string {
  if (e instanceof ErrorNegocio) return e.message
  if (e instanceof z.ZodError) {
    const detalle = e.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
    return `Datos inválidos — ${detalle.join("; ")}`
  }
  return e instanceof Error ? `Error inesperado: ${e.message}` : "Error inesperado"
}

type Salida = { data: unknown; resumen: string; requiereConfirmacion?: boolean }

const MARCA_CONFIRMACION = { requiere_confirmacion: true }

/** Ejecuta una herramienta sin lanzar nunca: devuelve JSON `{ok,data}` o `{ok:false,error}` y deja rastro en log.jsonl. */
export async function ejecutarSeguro(
  herramienta: string,
  caso: string,
  directory: string,
  trabajo: () => Promise<Salida>,
): Promise<string> {
  try {
    const { data, resumen, requiereConfirmacion } = await trabajo()
    await registrarLlamada(directory, { herramienta, caso, ok: true, resumen })
    return JSON.stringify({ ...ok(data), ...(requiereConfirmacion ? MARCA_CONFIRMACION : {}) })
  } catch (e) {
    const error = mensajeDeError(e)
    await registrarLlamada(directory, { herramienta, caso, ok: false, resumen: error })
    return JSON.stringify({ ...fallo(error), ...(e instanceof ErrorConfirmacion ? MARCA_CONFIRMACION : {}) })
  }
}
