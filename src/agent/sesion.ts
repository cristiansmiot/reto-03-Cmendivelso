import type { Mensaje, Uso } from "../llm/adapter.ts"

export type LlamadaRegistrada = {
  name: string
  args: Record<string, unknown>
  ok: boolean
  summary: string
  /** Tokens del paso del modelo que pidió esta llamada. */
  uso: Uso
}

export type Sesion = {
  id: string
  mensajes: Mensaje[]
  llamadas: LlamadaRegistrada[]
  tokens: Uso
  /** Casos con confirmación humana pendiente. Solo el siguiente turno puede resolverla. */
  pendiente: { casos: string[] } | null
  ocupada: boolean
}

export function nuevaSesion(id: string): Sesion {
  return { id, mensajes: [], llamadas: [], tokens: { entrada: 0, salida: 0 }, pendiente: null, ocupada: false }
}
