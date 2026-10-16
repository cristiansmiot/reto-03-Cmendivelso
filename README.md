# Agente OC SAP

Agente conversacional que valida paquetes de compra contra reglas y maestros, prepara el payload de una orden de compra y la crea de forma idempotente en un adaptador SAP simulado. Incluye una interfaz web, trazabilidad de herramientas y confirmación humana para excepciones.

## Requisitos

- [Bun](https://bun.sh/) instalado.
- Una clave de Anthropic para usar el chat. La demo de herramientas no necesita clave.

## Ejecutar en local

1. Copia `.env.example` como `.env` y completa las variables necesarias.
2. Instala las dependencias y levanta el servidor:

```bash
bun install && bun run dev
```

La aplicación queda disponible en `http://localhost:3000` de forma predeterminada.

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---:|---|
| `LLM_PROVIDER` | Sí | Proveedor del modelo; actualmente `anthropic`. |
| `ANTHROPIC_API_KEY` | Sí para el chat | Clave del proveedor. Solo se lee en el backend. |
| `MODEL` | Sí | Modelo usado por el adaptador LLM. |
| `PORT` | No | Puerto HTTP; el ejemplo usa `3000`. |
| `MAX_ITER` | No | Máximo de iteraciones del agente por turno. |
| `MAX_TOKENS_SESION` | No | Límite acumulado de tokens por sesión. |
| `MAX_TOKENS_RESPUESTA` | No | Máximo de tokens de una respuesta del modelo. |
| `LLM_TIMEOUT_MS` | No | Tiempo límite de una llamada al proveedor, en milisegundos. |
| `ACCESS_KEY` | No | Protección opcional del enlace público; vacío permite acceso libre. |

No publiques `.env` ni expongas la clave en el navegador, respuestas o logs.

## Demo sin modelo

Ejecuta las herramientas directamente sobre los fixtures y muestra el resultado esperado por caso:

```bash
bun run demo.ts
```

## Módulo reutilizable

Genera `modulo/` desde el prompt, el conocimiento y las herramientas que usa la aplicación:

```bash
bun run sync
```

Para comprobar si el módulo está actualizado sin escribir archivos:

```bash
bun run sync --check
```

## API

| Método | Ruta | Entrada | Respuesta |
|---|---|---|---|
| `POST` | `/api/chat` | `{ "sessionId": string, "message": string }` | `{ reply, toolCalls, needsConfirmation }` o `{ error }`. |
| `GET` | `/api/sessions/:id` | Identificador en la ruta. | Estado e historial visible de la sesión, incluido `needsConfirmation`; `404` si no existe. |
| `GET` | `/api/health` | — | `{ ok, provider, model }`. |

## Link de prueba: &lt;PENDIENTE&gt;
