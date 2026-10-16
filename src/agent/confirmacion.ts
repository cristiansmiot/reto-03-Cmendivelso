import type { Sesion } from "./sesion.ts"

const AFIRMATIVO =
  /^\s*[¡¿]?\s*(sí|si|confirmo|confirmado|dale|ok|okay|adelante|procede|proceda|hazlo|créala|creala|de acuerdo|correcto|afirmativo|yes)(?![\p{L}])/iu
const NEGACION = /(?<![\p{L}])(no|nunca|cancela|cancelar|espera|todavía)(?![\p{L}])/iu

/** Afirmativo explícito al inicio del mensaje y sin negaciones ("sí, pero no la crees" no cuenta). */
export function esAfirmativo(texto: string): boolean {
  return AFIRMATIVO.test(texto) && !NEGACION.test(texto)
}

/** Clave estable del caso: el nombre de la carpeta, aunque el modelo envíe una ruta o mayúsculas. */
export function claveCaso(caso: string): string {
  return caso.trim().replace(/\\/g, "/").split("/").filter(Boolean).at(-1)?.toLowerCase() ?? ""
}

/** Casos cuya confirmación vale en este turno: solo si había una pendiente y el usuario acaba de afirmar. */
export function casosConfirmados(sesion: Sesion, mensaje: string): string[] {
  return sesion.pendiente && esAfirmativo(mensaje) ? sesion.pendiente.casos : []
}

/** Ignora el `confirmado` del modelo: solo es true si el usuario confirmó ese caso en el turno anterior. */
export function forzarConfirmacion(
  args: Record<string, unknown>,
  admiteConfirmado: boolean,
  confirmados: string[],
): Record<string, unknown> {
  if (!admiteConfirmado) return args
  const caso = typeof args.caso === "string" ? claveCaso(args.caso) : ""
  return { ...args, confirmado: confirmados.includes(caso) }
}
