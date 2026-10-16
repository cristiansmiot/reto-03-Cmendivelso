import { z } from "zod"

export const SolicitudSchema = z.object({
  solicitud_id: z.string(),
  solicitante: z.string(),
  proveedor_nombre: z.string(),
  proveedor_nit: z.string().optional(),
  descripcion: z.string(),
  centro_costo: z.string(),
  subarea: z.string(),
  cantidad: z.number(),
  valor_unitario: z.number(),
  valor_total: z.number(),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string(),
})

export const CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
})

export const AprobacionSchema = z.object({
  de: z.string(),
  para: z.string(),
  fecha: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
})

export const ProveedoresSchema = z.array(
  z.object({
    codigo_sap: z.string(),
    nit: z.string(),
    nombre: z.string(),
    condiciones_pago_default: z.string(),
    indicador_iva_default: z.string(),
    activo: z.boolean(),
  }),
)

export const CentrosSchema = z.array(
  z.object({
    centro_costo: z.string(),
    subareas: z.array(z.string()),
    aprobadores: z.array(z.object({ email: z.string(), tope: z.number() })),
  }),
)

export const IndicadoresIvaSchema = z.array(z.object({ codigo: z.string(), tasa: z.number() }))
export const CondicionesPagoSchema = z.array(z.object({ codigo: z.string(), dias: z.number() }))

export type Solicitud = z.infer<typeof SolicitudSchema>
export type Proveedor = z.infer<typeof ProveedoresSchema>[number]
export type Centro = z.infer<typeof CentrosSchema>[number]

export type Maestros = {
  proveedores: Proveedor[]
  centros: Centro[]
  iva: z.infer<typeof IndicadoresIvaSchema>
  pago: z.infer<typeof CondicionesPagoSchema>
}

export type Cotizacion = {
  ref: string | null
  proveedor: string
  nit: string | null
  fecha: string | null
  total: number
  moneda: string
  validez_hasta: string | null
  texto: string
}

export type Aprobacion = {
  de: string
  para: string
  asunto: string
  fecha: string
  aprobado: boolean
  texto: string
}

export type Factura = { numero: string; fecha: string; total: number }

export type Paquete = {
  correo: z.infer<typeof CorreoSchema> | null
  solicitud: Solicitud
  cotizacion: Cotizacion | null
  aprobacion: Aprobacion | null
  factura: Factura | null
}

export type CodigoRC = "RC1" | "RC2" | "RC3" | "RC4" | "RC5" | "RC6" | "RC7" | "RC8" | "RC9" | "RC10"

export type Hallazgo = {
  tipo: "bloqueo" | "confirmacion" | "derivado"
  codigo: CodigoRC
  detalle: string
  valor?: unknown
}
