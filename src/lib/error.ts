/** Error esperado del negocio: su mensaje ya es legible para la analista. */
export class ErrorNegocio extends Error {}

/** Falta la confirmación humana: el ciclo del agente la expone como `requiere_confirmacion`. */
export class ErrorConfirmacion extends ErrorNegocio {}
