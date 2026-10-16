/** Tipos neutros: el ciclo del agente solo conoce estos, nunca los del proveedor. */

export type LlamadaHerramienta = { id: string; nombre: string; argumentos: Record<string, unknown> }

export type ResultadoHerramienta = { id: string; nombre: string; contenido: string; esError: boolean }

export type Mensaje =
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "herramienta"; resultados: ResultadoHerramienta[] }

export type DefinicionHerramienta = {
  nombre: string
  descripcion: string
  /** JSON Schema (objeto) de los argumentos. */
  esquema: Record<string, unknown>
}

export type Uso = { entrada: number; salida: number }

export type RespuestaLlm = {
  texto: string
  llamadas: LlamadaHerramienta[]
  /** `herramientas`: el modelo pidió ejecutar herramientas. `limite`: se cortó por tokens. */
  motivo: "fin" | "herramientas" | "limite"
  uso: Uso
}

export type OpcionesEnvio = {
  sistema: string
  maxTokens: number
  signal?: AbortSignal
}

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opts: OpcionesEnvio): Promise<RespuestaLlm>
}
