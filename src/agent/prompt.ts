import { readdir } from "node:fs/promises"
import path from "node:path"
import { leerTexto } from "../lib/fs.ts"

/** System prompt = agent/prompt.md + cada src/knowledge/*.md, leídos de archivo. */
export async function cargarPrompt(directory: string): Promise<string> {
  const carpeta = path.join(directory, "src", "knowledge")
  const archivos = (await readdir(carpeta)).filter((f) => f.endsWith(".md")).sort()
  const partes = [await leerTexto(path.join(directory, "agent", "prompt.md"))]
  for (const archivo of archivos) partes.push(await leerTexto(path.join(carpeta, archivo)))
  return partes.join("\n\n")
}
