import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { agregarLinea } from "./fs.ts"

export type ResultadoControl =
  | "creada"
  | "idempotente"
  | "bloqueada"
  | "pendiente_confirmacion"
  | "rechazada"

export type FilaControl = {
  solicitud_id: string
  resultado: ResultadoControl
  numero_oc: string
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

const ENCABEZADO = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts"

function celda(valor: string): string {
  return /[",\n]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor
}

async function existe(ruta: string): Promise<boolean> {
  return stat(ruta).then(() => true, () => false)
}

/** Agrega un intento a out/control.csv, creando el archivo con encabezado si hace falta. */
export async function registrarControl(directory: string, fila: FilaControl): Promise<void> {
  const ruta = path.join(directory, "out", "control.csv")
  await mkdir(path.dirname(ruta), { recursive: true })
  if (!(await existe(ruta))) await agregarLinea(ruta, ENCABEZADO)
  const campos = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc,
    String(fila.retroactiva),
    fila.bloqueos.join(";"),
    fila.confirmaciones.join(";"),
    new Date().toISOString(),
  ]
  await agregarLinea(ruta, campos.map(celda).join(","))
}
