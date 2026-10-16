import path from "node:path"
import { agregarLinea } from "./fs.ts"

export type EntradaLog = { herramienta: string; caso: string; ok: boolean; resumen: string }

/** Una línea por llamada en out/log.jsonl. Un fallo al registrar nunca rompe la herramienta. */
export async function registrarLlamada(directory: string, entrada: EntradaLog): Promise<void> {
  try {
    const linea = JSON.stringify({ ts: new Date().toISOString(), ...entrada })
    await agregarLinea(path.join(directory, "out", "log.jsonl"), linea)
  } catch {
    // el log es auxiliar
  }
}

export type EntradaUso = {
  sessionId: string
  herramienta: string
  ok: boolean
  entrada: number
  salida: number
}

/** Tokens del paso del modelo que pidió cada herramienta, en out/llm.jsonl. */
export async function registrarUso(directory: string, entrada: EntradaUso): Promise<void> {
  try {
    const linea = JSON.stringify({ ts: new Date().toISOString(), ...entrada })
    await agregarLinea(path.join(directory, "out", "llm.jsonl"), linea)
  } catch {
    // el log es auxiliar
  }
}
