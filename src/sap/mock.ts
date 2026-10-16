import path from "node:path"
import { agregarLinea, leerJson, leerTextoOpcional } from "../lib/fs.ts"
import { normalizarNit } from "../rules/rc.ts"
import { ProveedoresSchema } from "../rules/tipos.ts"
import type { OrdenCompra, SapAdapter } from "./adapter.ts"

const PRIMER_NUMERO = 4500000001

type Registro = { numero_oc: string; fecha: string; solicitud_id: string; orden: OrdenCompra }

// Serializa las escrituras para que dos creaciones simultáneas no reciban el mismo número.
let cola: Promise<unknown> = Promise.resolve()

/** SAP simulado: lee maestros de fixtures/ (solo lectura) y guarda las OC en out/sap/ordenes.jsonl. */
export class SapMock implements SapAdapter {
  private readonly directory: string

  constructor(directory: string) {
    this.directory = directory
  }

  private get archivo(): string {
    return path.join(this.directory, "out", "sap", "ordenes.jsonl")
  }

  private async leerRegistros(): Promise<Registro[]> {
    const texto = await leerTextoOpcional(this.archivo)
    if (!texto) return []
    return texto
      .split("\n")
      .filter((linea) => linea.trim() !== "")
      .map((linea) => JSON.parse(linea) as Registro)
  }

  async consultarProveedor(nit: string) {
    const ruta = path.join(this.directory, "fixtures", "reto-03", "maestros", "proveedores.json")
    const proveedores = ProveedoresSchema.parse(await leerJson(ruta))
    const proveedor = proveedores.find((p) => p.nit === normalizarNit(nit))
    return proveedor ? { codigo_sap: proveedor.codigo_sap, activo: proveedor.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const registro = (await this.leerRegistros()).find((r) => r.solicitud_id === solicitud_id)
    return registro ? { numero_oc: registro.numero_oc } : null
  }

  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const trabajo = cola.then(() => this.insertar(orden))
    cola = trabajo.catch(() => undefined)
    return trabajo
  }

  private async insertar(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const registros = await this.leerRegistros()
    const solicitud_id = orden.referencia.solicitud_id
    const existente = registros.find((r) => r.solicitud_id === solicitud_id)
    if (existente) return { numero_oc: existente.numero_oc, fecha: existente.fecha }
    const nuevo = { numero_oc: String(PRIMER_NUMERO + registros.length), fecha: new Date().toISOString() }
    await agregarLinea(this.archivo, JSON.stringify({ ...nuevo, solicitud_id, orden }))
    return nuevo
  }
}
