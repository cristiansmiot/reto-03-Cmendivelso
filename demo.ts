import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import type { Evaluacion } from "./src/rules/rc.ts"
import type { OrdenCompra } from "./src/sap/adapter.ts"
import * as oc from "./src/tools/oc.ts"

const directory = import.meta.dir
const ctx = { directory, sessionId: "demo" }

type Respuesta = { ok: true; data: unknown } | { ok: false; error: string }
type Fila = { caso: string; escenario: string; esperado: string; obtenido: string }

// Resultado esperado por caso, tomado de docs/FIXTURES.md (tabla "Casos").
const ESPERADO_VALIDACION: Record<string, string> = {
  "sol-001": "apta | bloqueos: - | confirmaciones: - | derivados: - | retroactiva: no",
  "sol-002": "no apta | bloqueos: RC1 | confirmaciones: - | derivados: - | retroactiva: no",
  "sol-003": "no apta | bloqueos: RC2,RC3 | confirmaciones: - | derivados: - | retroactiva: no",
  "sol-004": "apta | bloqueos: - | confirmaciones: RC5 | derivados: - | retroactiva: no",
  "sol-005": "apta | bloqueos: - | confirmaciones: RC8 | derivados: - | retroactiva: si",
  "sol-006": "apta | bloqueos: - | confirmaciones: RC6 | derivados: indicador_iva=C1,condiciones_pago=Z030 | retroactiva: no",
}

const ESPERADO_CREACION: Record<string, string> = {
  "sol-001": "creada 4500000001",
  "sol-002": "bloqueada",
  "sol-003": "bloqueada",
  "sol-004": "pendiente_confirmacion",
  "sol-005": "pendiente_confirmacion",
  "sol-006": "pendiente_confirmacion",
}

async function llamar(herramienta: { execute: (a: never, c: typeof ctx) => Promise<string> }, args: object): Promise<Respuesta> {
  return JSON.parse(await herramienta.execute(args as never, ctx)) as Respuesta
}

async function ultimoResultadoControl(): Promise<string> {
  const lineas = (await readFile(path.join(directory, "out", "control.csv"), "utf-8")).trim().split("\n")
  return lineas.at(-1)?.split(",")[1] ?? "?"
}

function describirValidacion(ev: Evaluacion): string {
  const codigos = (hs: Evaluacion["bloqueos"]) => (hs.length ? hs.map((h) => h.codigo).join(",") : "-")
  const derivados = Object.entries(ev.derivados).map(([k, v]) => `${k}=${v}`).join(",") || "-"
  const retro = ev.retroactiva ? "si" : "no"
  return `${ev.apta ? "apta" : "no apta"} | bloqueos: ${codigos(ev.bloqueos)} | confirmaciones: ${codigos(ev.confirmaciones)} | derivados: ${derivados} | retroactiva: ${retro}`
}

async function describirCreacion(r: Respuesta): Promise<string> {
  if (!r.ok) return await ultimoResultadoControl()
  const d = r.data as { numero_oc: string; idempotente: boolean }
  return `${d.idempotente ? "idempotente" : "creada"} ${d.numero_oc}`
}

async function procesar(caso: string, filas: Fila[]): Promise<void> {
  const agregar: Agregar = (escenario, esperado, obtenido) => {
    filas.push({ caso, escenario, esperado, obtenido })
  }
  const paquete = await llamar(oc.leer_paquete, { caso })
  if (!paquete.ok) return agregar("leer_paquete", "ok", paquete.error)
  const validacion = await llamar(oc.validar, { caso })
  if (!validacion.ok) return agregar("validar", "ok", validacion.error)
  agregar("validar", ESPERADO_VALIDACION[caso] ?? "?", describirValidacion(validacion.data as Evaluacion))
  await llamar(oc.generar_evidencia, { caso })
  const payload = await llamar(oc.construir_payload, { caso })
  const orden = payload.ok ? (payload.data as { orden: OrdenCompra }).orden : undefined
  const primero = await llamar(oc.crear, { caso, payload: orden })
  agregar("crear (sin confirmar)", ESPERADO_CREACION[caso] ?? "?", await describirCreacion(primero))
  if (caso === "sol-001") await repetirSol001(orden, agregar)
  if (caso === "sol-004") await confirmarSol004(orden, agregar)
}

type Agregar = (escenario: string, esperado: string, obtenido: string) => void

async function repetirSol001(orden: OrdenCompra | undefined, agregar: Agregar): Promise<void> {
  const segundo = await llamar(oc.crear, { caso: "sol-001", payload: orden })
  agregar("crear otra vez (idempotencia)", "idempotente 4500000001", await describirCreacion(segundo))
}

async function confirmarSol004(orden: OrdenCompra | undefined, agregar: Agregar): Promise<void> {
  const confirmada = await llamar(oc.crear, { caso: "sol-004", payload: orden, confirmado: true })
  agregar("crear con confirmado:true", "creada 4500000002", await describirCreacion(confirmada))
}

function imprimirTabla(filas: Fila[]): void {
  const ancho = (clave: keyof Fila) => Math.max(...filas.map((f) => f[clave].length))
  const col = (texto: string, n: number) => texto.padEnd(n)
  for (const f of filas) {
    const marca = f.esperado === f.obtenido ? "✅" : "❌"
    const detalle = marca === "✅" ? f.obtenido : `${f.obtenido}  (esperado: ${f.esperado})`
    console.log(`${marca} ${col(f.caso, ancho("caso"))}  ${col(f.escenario, ancho("escenario"))}  ${detalle}`)
  }
}

async function main(): Promise<void> {
  await rm(path.join(directory, "out"), { recursive: true, force: true })
  const filas: Fila[] = []
  for (const caso of Object.keys(ESPERADO_VALIDACION)) await procesar(caso, filas)
  imprimirTabla(filas)
  const fallidas = filas.filter((f) => f.esperado !== f.obtenido).length
  console.log(`\n${filas.length - fallidas}/${filas.length} verificaciones correctas`)
  if (fallidas > 0) process.exitCode = 1
}

await main()
