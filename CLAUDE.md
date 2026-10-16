# Reto 03 — Agente conversacional "Órdenes de Compra SAP"

Spec completa: `docs/PRD.md` (cita la sección, no lo releas completo).
Datos reales de los fixtures y resultado esperado por caso: `docs/FIXTURES.md`.

## Stack
- Bun + TypeScript estricto (`strict: true`, sin `any`).
- Hono (HTTP), zod v4 (`z.toJSONSchema`), `@anthropic-ai/sdk`.
- Front: `web/index.html` único, vanilla, sin build (marked por CDN).
- P1 opcional: `pdf-lib`.

## Estructura (no inventes otra)
```
agent/prompt.md              comportamiento (system prompt)
src/knowledge/*.md           conocimiento del proceso (se concatena al prompt)
src/tools/oc.ts              ejecución: herramientas (export X → nombre oc_X)
src/rules/rc.ts              RC1..RC10 como funciones puras
src/sap/adapter.ts           interfaz SapAdapter (PRD §7.4)
src/sap/mock.ts              implementación sobre out/sap/
src/llm/adapter.ts           interfaz LlmAdapter con tipos propios neutros
src/llm/anthropic.ts         implementación Anthropic
src/agent/loop.ts            ciclo del agente
src/lib/                     result, log, control.csv, fs helpers
src/server.ts                Hono: API + estáticos de web/
demo.ts                      ejecuta herramientas sin modelo
modulo/                      bonus, generado por scripts/sync-modulo.ts
```

## Contrato de herramientas (obligatorio)
```ts
{ description: string,               // una frase precisa
  args: Record<string, ZodType>,     // cada campo con .describe()
  execute(args, ctx: { directory: string; sessionId: string }): Promise<string> }
```
- `execute` devuelve `JSON.stringify({ ok: true, data })` o `{ ok: false, error }` con mensaje legible en español.
- **Nunca lanza**: envuelve todo en try/catch.
- Rutas siempre con `path.join(ctx.directory, ...)`. `fixtures/` es solo lectura; se escribe solo en `out/`.
- Sin comandos de shell. Sin red salvo el adaptador LLM.

## Reglas de diseño (no negociables)
1. Cada RC es una función pura `(paquete, maestros) => Hallazgo[]` con
   `Hallazgo = { tipo: "bloqueo" | "confirmacion" | "derivado", codigo: "RC1".."RC10", detalle: string, valor?: unknown }`.
   `oc_validar` solo compone y resume.
2. `oc_crear` **no confía** en el payload recibido: lo reconstruye desde el caso y rechaza si difiere (hash).
3. `oc_crear` exige `apta = true` y (`confirmaciones` vacío o `confirmado = true`). Idempotente por `solicitud_id`
   vía `buscarOrdenPorReferencia`. Cada intento escribe una fila en `out/control.csv`.
4. Toda llamada a herramienta va a `out/log.jsonl`: `{ ts, herramienta, caso, ok, resumen }`.
5. Confirmación aplicada en el servidor: si el usuario no confirmó en el turno inmediatamente anterior,
   el servidor fuerza `confirmado = false` aunque el modelo lo envíe.
6. Reglas de negocio solo en `src/rules`, `src/tools` y `src/knowledge`. Nunca en `server.ts` ni `loop.ts`.
7. Clave del LLM solo desde `process.env`. Nunca en logs, respuestas de API ni front.
8. Funciones < 30 líneas, nombres en español como el PRD.

## Comandos
- `bun install`
- `bun run demo.ts`: debe correr sin clave y mostrar la tabla ✅/❌ por caso.
- `bun run dev`: servidor + front en `http://localhost:${PORT}`.

## Forma de trabajar
- Al terminar cada tarea: corre `bun run demo.ts` y reporta SOLO la tabla de resultados y errores.
- Entrega archivos/diffs. Sin explicaciones largas salvo que se pidan.
- No agregues dependencias fuera del stack sin preguntar. No agregues base de datos ni frameworks de front.
