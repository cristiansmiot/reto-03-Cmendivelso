import { createHash } from "node:crypto"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { ErrorNegocio } from "./error.ts"

function noExiste(e: unknown): boolean {
  return e instanceof Error && "code" in e && e.code === "ENOENT"
}

export async function leerTextoOpcional(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf-8")
  } catch (e) {
    if (noExiste(e)) return null
    throw e
  }
}

export async function leerTexto(ruta: string): Promise<string> {
  const texto = await leerTextoOpcional(ruta)
  if (texto === null) throw new ErrorNegocio(`No se encontró el archivo ${path.basename(ruta)}`)
  return texto
}

export function parsearJson(texto: string, nombre: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    throw new ErrorNegocio(`El archivo ${nombre} no es un JSON válido`)
  }
}

export async function leerJson(ruta: string): Promise<unknown> {
  return parsearJson(await leerTexto(ruta), path.basename(ruta))
}

export async function leerJsonOpcional(ruta: string): Promise<unknown | null> {
  const texto = await leerTextoOpcional(ruta)
  return texto === null ? null : parsearJson(texto, path.basename(ruta))
}

export async function escribirArchivo(ruta: string, contenido: string): Promise<void> {
  await mkdir(path.dirname(ruta), { recursive: true })
  await writeFile(ruta, contenido, "utf-8")
}

export async function agregarLinea(ruta: string, linea: string): Promise<void> {
  await mkdir(path.dirname(ruta), { recursive: true })
  await appendFile(ruta, linea + "\n", "utf-8")
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf-8").digest("hex")
}

function ordenarClaves(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarClaves)
  if (valor === null || typeof valor !== "object") return valor
  const entradas = Object.entries(valor).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries(entradas.map(([k, v]) => [k, ordenarClaves(v)]))
}

/** JSON con claves ordenadas: mismo contenido, mismo texto, mismo hash. */
export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(ordenarClaves(valor))
}

export function rutaRelativa(directory: string, ruta: string): string {
  return path.relative(directory, ruta).split(path.sep).join("/")
}
