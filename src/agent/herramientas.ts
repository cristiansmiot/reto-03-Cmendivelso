import { z } from "zod"
import type { DefinicionHerramienta } from "../llm/adapter.ts"
import type { Contexto } from "../lib/result.ts"

/** Contrato de herramienta (CLAUDE.md): descripción, esquema zod por campo y `execute` que nunca lanza. */
export type Herramienta = {
  description: string
  args: Record<string, z.ZodType>
  execute: (args: never, ctx: Contexto) => Promise<string>
}

export type Registro = Map<string, Herramienta>

/** Cada export `x` del archivo `oc` se llama `oc_x` para el modelo. */
export function registrar(archivo: string, herramientas: Record<string, Herramienta>): Registro {
  return new Map(Object.entries(herramientas).map(([nombre, h]) => [`${archivo}_${nombre}`, h]))
}

export function definiciones(registro: Registro): DefinicionHerramienta[] {
  return [...registro].map(([nombre, h]) => {
    const { $schema, ...esquema } = z.toJSONSchema(z.object(h.args), { io: "input" })
    return { nombre, descripcion: h.description, esquema }
  })
}
