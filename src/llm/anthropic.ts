import Anthropic from "@anthropic-ai/sdk"
import { ErrorNegocio } from "../lib/error.ts"
import type {
  DefinicionHerramienta,
  LlmAdapter,
  Mensaje,
  OpcionesEnvio,
  RespuestaLlm,
} from "./adapter.ts"

type MensajeApi = Anthropic.MessageParam
type BloqueApi = Anthropic.ContentBlockParam

function aMensajeApi(m: Mensaje): MensajeApi {
  if (m.rol === "usuario") return { role: "user", content: m.texto }
  if (m.rol === "herramienta") {
    const bloques: BloqueApi[] = m.resultados.map((r) => ({
      type: "tool_result",
      tool_use_id: r.id,
      content: r.contenido,
      is_error: r.esError,
    }))
    return { role: "user", content: bloques }
  }
  const texto: BloqueApi[] = m.texto ? [{ type: "text", text: m.texto }] : []
  const usos: BloqueApi[] = m.llamadas.map((l) => ({ type: "tool_use", id: l.id, name: l.nombre, input: l.argumentos }))
  return { role: "assistant", content: [...texto, ...usos] }
}

function aHerramientaApi(h: DefinicionHerramienta): Anthropic.Tool {
  return { name: h.nombre, description: h.descripcion, input_schema: { ...h.esquema, type: "object" } }
}

function aRespuesta(r: Anthropic.Message): RespuestaLlm {
  const texto = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n")
  const llamadas = r.content.flatMap((b) =>
    b.type === "tool_use" ? [{ id: b.id, nombre: b.name, argumentos: argumentosDe(b.input) }] : [],
  )
  const motivo = r.stop_reason === "tool_use" ? "herramientas" : r.stop_reason === "max_tokens" ? "limite" : "fin"
  const u = r.usage
  const entrada = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  return { texto, llamadas, motivo, uso: { entrada, salida: u.output_tokens } }
}

function argumentosDe(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? { ...input } : {}
}

function textoDeEstado(e: InstanceType<typeof Anthropic.APIError>): string {
  const detalle = (e.message ?? "").toLowerCase()
  if (e.status === 401 || e.status === 403) return "la clave del modelo es inválida o no tiene permisos"
  if (e.status === 429) return "se alcanzó el límite de solicitudes del modelo, espera un momento"
  if (e.status === 402 || detalle.includes("credit balance")) return "la cuenta del modelo no tiene crédito suficiente"
  if (e.status === 408 || e.status === 504) return "el modelo tardó demasiado en responder"
  if (e.status === 529 || (e.status ?? 0) >= 500) return "el servicio del modelo no está disponible por ahora"
  return "el modelo rechazó la solicitud"
}

/** Convierte errores del SDK en mensajes legibles; nunca expone el JSON crudo. */
function traducirError(e: unknown): Error {
  if (e instanceof ErrorNegocio) return e
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ErrorNegocio("el modelo tardó demasiado en responder")
  if (e instanceof Anthropic.APIConnectionError) return new ErrorNegocio("no se pudo conectar con el servicio del modelo")
  if (e instanceof Anthropic.APIError) return new ErrorNegocio(textoDeEstado(e))
  return new ErrorNegocio("error inesperado al consultar el modelo")
}

/** Implementación para Anthropic. La clave se lee solo de `ANTHROPIC_API_KEY`. */
export class AnthropicLlm implements LlmAdapter {
  readonly proveedor = "anthropic"
  readonly modelo: string
  private readonly cliente: Anthropic | null

  constructor(modelo: string, apiKey: string | undefined) {
    this.modelo = modelo
    this.cliente = apiKey ? new Anthropic({ apiKey, maxRetries: 1 }) : null
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opts: OpcionesEnvio): Promise<RespuestaLlm> {
    if (!this.cliente) throw new ErrorNegocio("falta configurar la clave del modelo en el servidor")
    try {
      const respuesta = await this.cliente.messages.create(
        {
          model: this.modelo,
          max_tokens: opts.maxTokens,
          system: [{ type: "text", text: opts.sistema, cache_control: { type: "ephemeral" } }],
          tools: herramientas.map(aHerramientaApi),
          messages: mensajes.map(aMensajeApi),
        },
        { signal: opts.signal },
      )
      return aRespuesta(respuesta)
    } catch (e) {
      throw traducirError(e)
    }
  }
}
