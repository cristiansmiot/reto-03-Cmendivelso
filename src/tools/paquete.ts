import path from "node:path"
import { ErrorNegocio } from "../lib/error.ts"
import { leerJson, leerJsonOpcional, leerTextoOpcional } from "../lib/fs.ts"
import { normalizarNit } from "../rules/rc.ts"
import {
  AprobacionSchema,
  CentrosSchema,
  CondicionesPagoSchema,
  CorreoSchema,
  IndicadoresIvaSchema,
  ProveedoresSchema,
  SolicitudSchema,
} from "../rules/tipos.ts"
import type { Aprobacion, Cotizacion, Factura, Maestros, Paquete } from "../rules/tipos.ts"

const FECHA = /(\d{4}-\d{2}-\d{2})/

function campo(texto: string, patron: RegExp): string | null {
  return texto.match(patron)?.[1]?.trim() ?? null
}

/** `COP 11.400.000` → 11400000 (punto = miles, sin decimales). */
export function parsearMonto(texto: string, etiqueta: string): number {
  const limpio = texto.replace(/COP|USD/i, "").replace(/[.\s]/g, "")
  const monto = /^\d+$/.test(limpio) ? Number(limpio) : NaN
  if (Number.isNaN(monto)) throw new ErrorNegocio(`Monto no numérico en ${etiqueta}: "${texto}"`)
  return monto
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function parsearCotizacion(texto: string): Cotizacion {
  const total = campo(texto, /^TOTAL[^:\n]*:\s*(.+)$/m)
  if (!total) throw new ErrorNegocio("La cotización no tiene una línea TOTAL")
  const fecha = campo(texto, new RegExp(`^Fecha:\\s*${FECHA.source}`, "m"))
  const dias = campo(texto, /^Validez de la oferta:\s*(\d+)/m)
  const nit = campo(texto, /^NIT:\s*(.+)$/m)
  return {
    ref: campo(texto, /^COTIZACI[ÓO]N\s+(\S+)/m),
    proveedor: campo(texto, /^Proveedor:\s*(.+)$/m) ?? "",
    nit: nit ? normalizarNit(nit) : null,
    fecha,
    total: parsearMonto(total, "la cotización"),
    moneda: total.match(/^[A-Z]{3}/)?.[0] ?? "COP",
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    texto,
  }
}

export function parsearFactura(texto: string): Factura {
  const numero = campo(texto, /^FACTURA[^\n]*?No\.\s*(\S+)/m)
  const fecha = campo(texto, new RegExp(`^Fecha de emisi[óo]n:\\s*${FECHA.source}`, "m"))
  const total = campo(texto, /^TOTAL:\s*(.+)$/m)
  if (!numero || !fecha || !total) throw new ErrorNegocio("La factura no tiene número, fecha de emisión o TOTAL")
  return { numero, fecha, total: parsearMonto(total, "la factura") }
}

/** RC2: "Aprobado" como palabra completa; "no aprobado", "desaprobado" y "rechazado" lo anulan. */
export function esAprobado(cuerpo: string): boolean {
  return /\baprobado\b/i.test(cuerpo) && !/\b(no\s+aprobado|desaprobado|rechazado)\b/i.test(cuerpo)
}

function parsearAprobacion(json: unknown): Aprobacion {
  const a = AprobacionSchema.parse(json)
  const aprobado = esAprobado(a.cuerpo)
  return { de: a.de.toLowerCase(), para: a.para, asunto: a.asunto, fecha: a.fecha, aprobado, texto: a.cuerpo }
}

const raizFixtures = (directory: string) => path.join(directory, "fixtures", "reto-03")

export async function cargarMaestros(directory: string): Promise<Maestros> {
  const dir = path.join(raizFixtures(directory), "maestros")
  return {
    proveedores: ProveedoresSchema.parse(await leerJson(path.join(dir, "proveedores.json"))),
    centros: CentrosSchema.parse(await leerJson(path.join(dir, "centros-costo.json"))),
    iva: IndicadoresIvaSchema.parse(await leerJson(path.join(dir, "indicadores-iva.json"))),
    pago: CondicionesPagoSchema.parse(await leerJson(path.join(dir, "condiciones-pago.json"))),
  }
}

export type PaqueteLeido = { paquete: Paquete; faltantes: string[] }

/** Lee y normaliza el caso. Lo que falta queda en `null` y su nombre en `faltantes`; solicitud.json es imprescindible. */
export async function cargarPaquete(directory: string, caso: string): Promise<PaqueteLeido> {
  if (!/^[\w-]+$/.test(caso)) throw new ErrorNegocio(`Nombre de caso inválido: "${caso}"`)
  const dir = path.join(raizFixtures(directory), "solicitudes", caso)
  const solicitud = SolicitudSchema.parse(await leerJson(path.join(dir, "solicitud.json")))
  const correo = await leerJsonOpcional(path.join(dir, "correo.json"))
  const aprobacion = await leerJsonOpcional(path.join(dir, "aprobacion.json"))
  const cotizacion = await leerTextoOpcional(path.join(dir, "cotizacion.txt"))
  const factura = await leerTextoOpcional(path.join(dir, "factura.txt"))
  const paquete: Paquete = {
    correo: correo ? CorreoSchema.parse(correo) : null,
    solicitud,
    cotizacion: cotizacion ? parsearCotizacion(cotizacion) : null,
    aprobacion: aprobacion ? parsearAprobacion(aprobacion) : null,
    factura: factura ? parsearFactura(factura) : null,
  }
  const faltantes = [
    correo ? null : "correo.json",
    aprobacion ? null : "aprobacion.json",
    cotizacion ? null : "cotizacion.txt",
  ].filter((f): f is string => f !== null)
  return { paquete, faltantes }
}
