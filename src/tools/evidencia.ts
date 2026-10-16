import path from "node:path"
import { ErrorNegocio } from "../lib/error.ts"
import { escribirArchivo, rutaRelativa, sha256 } from "../lib/fs.ts"
import type { Paquete } from "../rules/tipos.ts"

export type Evidencia = { ruta: string; sha256: string }

/** Contenido determinista (sin marcas de tiempo): el mismo correo siempre produce el mismo hash. */
export function textoEvidencia(a: NonNullable<Paquete["aprobacion"]>): string {
  return [`De: ${a.de}`, `Para: ${a.para}`, `Fecha: ${a.fecha}`, `Asunto: ${a.asunto}`, "", a.texto].join("\n")
}

/** Escribe out/<caso>/aprobacion.txt con el correo y el sha256 de su contenido. */
export async function generarEvidenciaTxt(directory: string, caso: string, p: Paquete): Promise<Evidencia> {
  if (!p.aprobacion) throw new ErrorNegocio("No hay correo de aprobación (aprobacion.json) para generar la evidencia")
  const contenido = textoEvidencia(p.aprobacion)
  const hash = sha256(contenido)
  const ruta = path.join(directory, "out", caso, "aprobacion.txt")
  await escribirArchivo(ruta, `${contenido}\n\n--\nsha256: ${hash}\n`)
  return { ruta: rutaRelativa(directory, ruta), sha256: hash }
}
