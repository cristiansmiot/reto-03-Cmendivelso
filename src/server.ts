import path from "node:path"
import { Hono } from "hono"
import { serveStatic } from "hono/bun"
import { z } from "zod"
import { registrar } from "./agent/herramientas.ts"
import { ejecutarTurno, leerConfig } from "./agent/loop.ts"
import type { Dependencias } from "./agent/loop.ts"
import { cargarPrompt } from "./agent/prompt.ts"
import { nuevaSesion } from "./agent/sesion.ts"
import type { Sesion } from "./agent/sesion.ts"
import type { LlmAdapter } from "./llm/adapter.ts"
import { AnthropicLlm } from "./llm/anthropic.ts"
import * as oc from "./tools/oc.ts"

const MAX_SESIONES = 200

const PeticionSchema = z.object({
  sessionId: z.string().regex(/^[\w-]{1,64}$/),
  message: z.string().trim().min(1).max(4000),
})

function crearLlm(env: Record<string, string | undefined>): LlmAdapter {
  const proveedor = env.LLM_PROVIDER ?? "anthropic"
  if (proveedor !== "anthropic") throw new Error(`LLM_PROVIDER "${proveedor}" no está soportado`)
  return new AnthropicLlm(env.MODEL ?? "claude-haiku-5-5", env.ANTHROPIC_API_KEY)
}

export function crearApp(base: Omit<Dependencias, "sistema">, sesiones = new Map<string, Sesion>()): Hono {
  const app = new Hono()

  app.get("/api/health", (c) => c.json({ ok: true, provider: base.llm.proveedor, model: base.llm.modelo }))

  app.get("/api/sessions/:id", (c) => {
    const sesion = sesiones.get(c.req.param("id"))
    if (!sesion) return c.json({ error: "Sesión no encontrada" }, 404)
    const { ocupada, ...visible } = sesion
    return c.json({ ...visible, needsConfirmation: sesion.pendiente !== null })
  })

  app.post("/api/chat", async (c) => {
    const cuerpo = PeticionSchema.safeParse(await c.req.json().catch(() => null))
    if (!cuerpo.success) return c.json({ error: "Se espera { sessionId, message } con un mensaje no vacío" }, 400)
    const { sessionId, message } = cuerpo.data
    if (!sesiones.has(sessionId) && sesiones.size >= MAX_SESIONES) return c.json({ error: "Demasiadas sesiones activas" }, 429)
    const sesion = sesiones.get(sessionId) ?? nuevaSesion(sessionId)
    sesiones.set(sessionId, sesion)
    if (sesion.ocupada) return c.json({ error: "La sesión está procesando otro mensaje" }, 409)
    sesion.ocupada = true
    try {
      const sistema = await cargarPrompt(base.directory)
      return c.json(await ejecutarTurno({ ...base, sistema }, sesion, message))
    } catch {
      return c.json({ error: "Error interno al procesar el mensaje" }, 500)
    } finally {
      sesion.ocupada = false
    }
  })

  app.get("/", serveStatic({ path: "./web/index.html" }))
  app.get("/*", serveStatic({ root: "./web" }))
  return app
}

const directory = path.resolve(import.meta.dir, "..")
const registro = registrar("oc", oc)
const app = crearApp({ llm: crearLlm(process.env), herramientas: registro, directory, config: leerConfig() })

export default { port: Number(process.env.PORT ?? 3000), fetch: app.fetch }
