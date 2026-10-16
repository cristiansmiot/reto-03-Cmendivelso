# Solución — Agente OC SAP

## 1. Problema en una frase

TODO: resumir el problema y su impacto en la analista administrativa.

## 2. Arquitectura

La solución separa conversación, coordinación y reglas deterministas. El modelo decide qué herramienta invocar y redacta la respuesta, pero no inventa datos ni ejecuta las reglas de negocio.

```text
┌─────────────────────────────┐
│ Front web/index.html        │
│ chat · tool calls ·         │
│ confirmación humana         │
└──────────────┬──────────────┘
               │ HTTP / JSON
               ▼
┌─────────────────────────────────────────────────────┐
│ Backend Hono (src/server.ts)                        │
│ sesión · límites · confirmación del turno anterior  │
│                                                     │
│  ┌────────────────────┐    ┌─────────────────────┐  │
│  │ Loop del agente    │───▶│ Adaptador LLM      │  │
│  │ src/agent/loop.ts  │◀───│ Anthropic          │  │
│  └─────────┬──────────┘    └─────────────────────┘  │
└────────────┼────────────────────────────────────────┘
             │ llamadas tipadas
             ▼
┌─────────────────────────────┐
│ Herramientas src/tools      │
│ Reglas puras src/rules      │
└──────────────┬──────────────┘
               │
        ┌──────┴───────┐
        ▼              ▼
┌──────────────┐  ┌──────────────────────────────┐
│ fixtures/    │  │ out/                         │
│ solo lectura │  │ SAP mock · log · control.csv │
└──────────────┘  └──────────────────────────────┘
```

Las responsabilidades se dividen así:

- `agent/prompt.md` contiene el comportamiento conversacional y las restricciones del agente.
- `src/knowledge/*.md` contiene el conocimiento explicativo del proceso de compras.
- `src/tools/` implementa las operaciones disponibles y sus contratos tipados.
- `src/rules/` contiene RC1–RC10 como funciones puras; allí vive la decisión determinista de bloqueo, confirmación o dato derivado.
- `src/agent/loop.ts` coordina mensajes, modelo y herramientas sin incorporar reglas de negocio.
- `src/sap/` aísla la integración mediante `SapAdapter`, por lo que el mock puede reemplazarse por SAP real sin cambiar el ciclo del agente.

Esta separación mantiene una sola fuente para comportamiento, conocimiento y ejecución, y permite probar las herramientas sin depender del modelo, como exige el PRD §6.1.

## 3. Ciclo del agente

TODO: documentar el bucle, sus límites y la confirmación humana aplicada por el servidor.

## 4. Elección del modelo

**Proveedor y modelo.** Anthropic, a través de `src/llm/anthropic.ts`. El modelo sale de la variable `MODEL`; si no se define, `src/server.ts` usa `claude-haiku-5-5` (mismo valor en `.env.example`). El ciclo del agente solo conoce la interfaz neutra `LlmAdapter` (`src/llm/adapter.ts`), así que cambiar de modelo es cambiar una variable y cambiar de proveedor es escribir otro adaptador. `LLM_PROVIDER` distinto de `anthropic` hoy falla con un error explícito: no hay segundo proveedor implementado.

**Por qué un modelo pequeño.** El modelo solo decide qué herramienta llamar y redacta; las reglas, el payload y el hash los calcula el código. No se comparó la calidad de varios modelos: la elección de `claude-haiku-5-5` es por defecto de costo/latencia y no está respaldada por un benchmark propio.

**Costo por caso: no medido.** No incluyo tokens inventados. Al redactar esto no existía `out/llm.jsonl` (se limpia con `demo.ts`, que no usa modelo) ni había `ANTHROPIC_API_KEY` en el entorno, así que no hay cifras reales de sol-001 ni de sol-004 en dos turnos. Para obtenerlas:

1. Con clave en `.env`, ejecutar `bun run dev` y procesar sol-001 en una sesión nueva; luego sol-004 en otra (turno 1: procesar; turno 2: "confirmo").
2. Leer `GET /api/sessions/<id>`: el campo `tokens` trae `{ entrada, salida }` acumulados de toda la sesión, incluido el paso final de texto.
3. `out/llm.jsonl` guarda `{ ts, sessionId, herramienta, ok, entrada, salida }` solo para los pasos del modelo que pidieron una herramienta; el paso final que solo redacta no se registra ahí, así que la suma de ese archivo subestima el total.

| Caso | Tokens de entrada | Tokens de salida | Costo |
|---|---|---|---|
| sol-001 (sin confirmación, 1 turno) | [MEDIR] | [MEDIR] | [MEDIR] |
| sol-004 (con confirmación, 2 turnos) | [MEDIR] | [MEDIR] | [MEDIR] |

Fórmula: `costo (USD) = (tokens_entrada × 0,10 + tokens_salida × 0,50) / 1.000.000`.

Precio verificado el 2026-10-16 en la página oficial de precios de Anthropic ([claude.com/pricing](https://claude.com/pricing), a la que redirige anthropic.com/pricing): Haiku 5.5, prompts de hasta 100K tokens, **USD 0,10 por millón de tokens de entrada y USD 0,50 por millón de salida**. Para prompts de más de 100K tokens la página lista USD 0,50 y 2,50. La página nombra el modelo "Haiku 5.5", no el id `claude-haiku-5-5`; asumo que son el mismo. El precio puede cambiar: revisar antes de usar la cifra.

Orden de magnitud: el tope de sesión es de 200.000 tokens (`MAX_TOKENS_SESION`). Como el tope se comprueba antes de cada llamada al modelo, una sesión puede pasarse por un paso. Aun así, 200.000 tokens facturados todos como salida costarían USD 0,10, y todos como entrada USD 0,02. Es una cota del tope configurado, no una medición de sol-001 ni de sol-004: esas cifras siguen pendientes.

**Topes de gasto implementados** (`src/agent/loop.ts`, `src/server.ts`): `MAX_ITER` = 25 pasos por turno, `MAX_TOKENS_SESION` = 200.000 por sesión, `MAX_TOKENS_RESPUESTA` = 2.048 por respuesta, `LLM_TIMEOUT_MS` = 60.000 y 200 sesiones simultáneas. Todos son configurables por variable de entorno salvo el límite de sesiones, que es una constante.

## 5. Matriz de controles

TODO: resumir la implementación de RC1–RC10 e identificar el control más difícil.

## 6. Diseño del adaptador SAP real

### Opción principal

La integración principal usaría la API OData V2 `API_PURCHASEORDER_PROCESS_SRV` de SAP S/4HANA, mediada por SAP Integration Suite. El agente no llamaría a SAP directamente: invocaría un endpoint estable de Integration Suite y el flujo de integración validaría el contrato, transformaría el payload, aplicaría políticas de seguridad y llamaría a `A_PurchaseOrder`. La API permite crear la cabecera con `POST` y modela posiciones e imputaciones con las entidades `A_PurchaseOrderItem` y `A_PurOrdAccountAssignment`.

Integration Suite es la opción preferida porque desacopla el contrato interno de la versión y topología concretas de SAP, centraliza credenciales, mapeos, observabilidad, rate limiting y reintentos, y permite conectar tanto S/4HANA Cloud como una instalación privada mediante los mecanismos corporativos aprobados. Antes de construir el flujo se validarán la edición y versión de S/4HANA, los campos obligatorios configurados por la compañía y la disponibilidad del servicio; el servicio OData V2 debe versionarse detrás del endpoint propio para facilitar una migración futura.

### Mapeo del payload del PRD §7.4

| Campo del payload | Nivel OData | Campo o tratamiento propuesto |
|---|---|---|
| `referencia.solicitud_id` | Cabecera `A_PurchaseOrder` | `CorrespncExternalReference`; es la clave externa de idempotencia. Si la longitud/configuración no permite conservarla completa, se usa un campo custom de cabecera indexado. |
| `referencia.correo_id` | Cabecera | `CorrespncInternalReference` o campo custom; también queda en el registro de auditoría de Integration Suite. |
| `referencia.cotizacion_ref` | Cabecera | `SupplierQuotationExternalID` cuando semánticamente corresponda; en otro caso, campo custom o nota de cabecera. |
| `sociedad` | Cabecera | `CompanyCode`. |
| `organizacion_compras` | Cabecera | `PurchasingOrganization`. El `PurchasingGroup` requerido por la configuración SAP se deriva mediante una tabla de mapeo administrada, no por el modelo. |
| `proveedor.codigo_sap` | Cabecera | `Supplier`. |
| `proveedor.nit`, `proveedor.nombre` | Validación/auditoría | Se contrastan con el maestro antes de crear. SAP recibe el código de proveedor; NIT y nombre no sustituyen datos maestros. |
| `moneda` | Cabecera | `DocumentCurrency`. |
| `condiciones_pago` | Cabecera | `PaymentTerms`. |
| `aprobador.email` | Cabecera/auditoría | Campo custom o nota de cabecera; no se fuerza sobre un campo estándar con otra semántica. |
| `aprobador.fecha_aprobacion` | Cabecera/auditoría | Campo custom o metadato de auditoría asociado a la OC. |
| `aprobador.evidencia_sha256` | Evidencia | Metadato del adjunto o campo custom; el PDF se adjunta en un segundo paso con el mecanismo documental habilitado en el landscape. |
| `posiciones[].numero` | Posición `A_PurchaseOrderItem` | `PurchaseOrderItem`, normalizado al formato que espera SAP. |
| `posiciones[].descripcion` | Posición | `PurchaseOrderItemText`, respetando el máximo validado antes de enviar. |
| `posiciones[].cantidad` | Posición | `OrderQuantity`. |
| `posiciones[].unidad` | Posición | `PurchaseOrderQuantityUnit`; los códigos internos se mapean a unidades SAP configuradas. |
| `posiciones[].precio_unitario` | Posición | `NetPriceAmount`, con `NetPriceQuantity = 1` salvo que la unidad de precio configurada exija otra base. |
| `posiciones[].indicador_iva` | Posición | `TaxCode`. |
| `posiciones[].centro_costo` | Imputación `A_PurOrdAccountAssignment` | `CostCenter`; la posición lleva `AccountAssignmentCategory` con el valor configurado para imputación a centro de costo y la imputación usa `AccountAssignmentNumber`. |
| `posiciones[].subarea` | Imputación | `ProfitCenter` o `FunctionalArea` solo si el diseño contable confirma esa equivalencia; de lo contrario, campo custom. No se asumirá una correspondencia semántica sin aprobación de Finanzas. |
| `excepciones[]` | Auditoría | No se convierte en dato contable estándar. Se registra en el log de integración y, si Auditoría lo exige, en una nota o extensión de cabecera con código, detalle y quién confirmó. |

La orden se enviará como deep insert si la versión de SAP y la configuración lo soportan; si no, Integration Suite orquestará una operación `$batch` consistente. Las transformaciones de códigos —unidad, impuesto, imputación, grupo de compras y campos custom— estarán versionadas y cubiertas con pruebas de contrato.

### Autenticación y secretos

Se usará OAuth 2.0 Client Credentials para las comunicaciones máquina a máquina. El cliente que llama a Integration Suite tendrá scopes mínimos para el endpoint de órdenes; Integration Suite mantendrá por alias las credenciales necesarias para llamar a SAP. `client_id`, `client_secret`, certificados y URLs sensibles vivirán en el secret manager corporativo y en el almacén de material de seguridad de Integration Suite, con rotación y auditoría. El agente, el prompt, el repositorio, el navegador y los logs nunca recibirán secretos ni tokens.

### Idempotencia, errores parciales y reintentos

Antes de crear, `buscarOrdenPorReferencia(solicitud_id)` consulta `CorrespncExternalReference` —o el campo custom indexado— y devuelve la OC existente. Integration Suite repite la misma comprobación dentro del límite transaccional antes del `POST`; así se cierra la carrera entre dos solicitudes simultáneas. La correlación incluye `solicitud_id`, un identificador de intento y el número de mensaje de Integration Suite.

Los errores de validación o negocio (`4xx`) no se reintentan automáticamente: se devuelven normalizados y sin secretos. Los errores transitorios (`429`, timeout o `5xx`) usan reintentos acotados con backoff exponencial y jitter. Ante una respuesta ambigua, se consulta primero la referencia externa; nunca se repite el `POST` a ciegas. Si SAP crea la OC pero falla un paso posterior, como adjuntar la evidencia, el resultado queda en estado `parcial` con el número de OC y se reintenta únicamente el paso pendiente. Cada transición es auditable y una cola de errores permite reproceso manual.

### Alternativa descartada: `BAPI_PO_CREATE1`

`BAPI_PO_CREATE1` es una alternativa válida cuando la organización ya opera integraciones RFC estables, pero no es la primera elección. Requiere conectividad RFC hacia la red SAP, manejo de estructuras ABAP y `COMMIT`, y aumenta el acoplamiento con la instalación y su configuración. Eso complica exposición segura, monitoreo y evolución desde una aplicación web. Se conservaría como opción detrás de Integration Suite si la versión de S/4HANA no expone la API requerida; el agente seguiría viendo el mismo `SapAdapter`.

### Plan B sin conexión transaccional

Si la viabilidad técnica o de seguridad no permite escritura en SAP, el agente sigue validando y produce dos salidas: un archivo de carga masiva con columnas, códigos y orden acordados con el equipo SAP, y una vista “OC lista para pegar” organizada según las pantallas de ME21N. La analista revisa el resumen, copia o carga los datos y registra el número de OC resultante. El archivo incluye `solicitud_id` como referencia, posiciones, imputaciones y un manifiesto con el hash de la evidencia; los secretos no forman parte de la salida. Este plan conserva el ahorro en validación y digitación, aunque mantiene un control humano antes de contabilizar.

Referencias técnicas: [Purchase Order OData — operaciones](https://help.sap.com/docs/SAP_S4HANA_CLOUD/bb9f1469daf04bd894ab2167f8132a1a/46dcde53d7964b768dcf75f97f4e3db9.html), [cabecera `A_PurchaseOrder`](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/91af7f8d3acd47da90d33aaacfcd0d59/7955d657867b6264e10000000a4450e5.html), [posición `A_PurchaseOrderItem`](https://help.sap.com/docs/SAP_S4HANA_CLOUD/bb9f1469daf04bd894ab2167f8132a1a/3c55df577ec43528e10000000a441470.html), [OAuth 2.0 en Integration Suite](https://help.sap.com/docs/integration-suite/sap-integration-suite/oauth-2-0).

## 7. Lectura del proceso

Una OC retroactiva no es solo una anomalía de fecha: indica que el compromiso con el proveedor pudo ocurrir antes de reservar presupuesto, validar al proveedor, comprobar la autoridad del aprobador o acordar condiciones comerciales. La orden deja de funcionar como control preventivo y se convierte en regularización. Eso eleva el riesgo de compras no autorizadas, facturas sin respaldo, menor poder de negociación, clasificación contable incorrecta y observaciones de auditoría. Conviene medir el fenómeno sin ocultarlo ni bloquear de inmediato la operación, porque un rechazo brusco puede trasladar el problema a procesos informales.

Propongo un indicador mensual **% de OC retroactivas** calculado desde `out/control.csv`: numerador = solicitudes únicas con `retroactiva=true` y resultado final `creada` o `idempotente`; denominador = solicitudes únicas con resultado final `creada` o `idempotente` en el mes, según `ts`. Se deduplica por `solicitud_id` para que los reintentos no inflen el indicador. El tablero debe mostrar también monto, centro de costo, proveedor y responsable cuando esas dimensiones estén disponibles, además de la tendencia de tres meses. Como controles de calidad, el total se reconcilia con las OC creadas en SAP y se separan regularizaciones autorizadas de incumplimientos evitables.

La política recomendada es **“No PO, No Pay”**: salvo excepciones definidas, una factura no se procesa si no referencia una OC aprobada y creada antes del compromiso o de la prestación. La implantación tendría un periodo de transición de tres meses. En el primer mes se mide una línea base y se notifica sin bloquear; en el segundo se exige justificación y aprobación del responsable para cada excepción; en el tercero se rechazan nuevos casos fuera del catálogo autorizado. Compras y Finanzas deben publicar las excepciones —emergencias, servicios regulados u otras justificadas—, su aprobador y su tiempo máximo de regularización.

El objetivo no debe ser simplemente llevar el porcentaje a cero, sino eliminar causas raíz. Cada mes Dirección revisaría las áreas con mayor recurrencia, tiempos de creación, razones de excepción y acciones correctivas. Para evitar incentivos perversos, el indicador se acompañaría de tiempo de ciclo y facturas pagadas a tiempo: el control tiene que adelantarse a la compra sin paralizar la operación.

## 8. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **Confirmación aplicada en el servidor.** `forzarConfirmacion` (`src/agent/confirmacion.ts`) ignora el `confirmado` que envía el modelo: solo es `true` si el mensaje actual es un afirmativo y había un caso pendiente en la sesión. | Instruir en el prompt "no pongas `confirmado: true` sin permiso". | Un prompt no es un control: el modelo puede equivocarse o ser inducido por el texto de un correo. El costo es una regla rígida (regex de afirmativos en español, ver §12) y un bug que ya ocurrió: el estado pendiente se perdía tras `oc_generar_evidencia`; se corrigió y `demo.ts` tiene una regresión de dos turnos con un modelo falso. |
| 2 | **`oc_crear` reconstruye el payload y compara hash.** Rehace la OC desde el caso y compara `huella()` (sha256 del JSON canónico, sin `confirmado_por` ni `confirmado_ts`) con el payload recibido; si difiere, registra `rechazada` y no crea. | Confiar en el payload que pasa el modelo, validado solo con zod. | zod valida forma, no verdad: un monto cambiado "para que cuadre" sería válido en esquema. Coincide con el riesgo del PRD §10. Costo: cada creación relee fixtures y regenera la evidencia, y el modelo debe reenviar `orden` sin tocarlo. |
| 3 | **RC1–RC10 como funciones puras** `(paquete, maestros) => Hallazgo[]` en `src/rules/rc.ts`; `evaluarPaquete` solo las compone. | Un validador monolítico con un `if` por regla, o dejar que el modelo razone las reglas. | Cada regla se prueba sola, sin modelo ni disco, y el resultado es determinista. Costo: hay que mantener el arreglo `REGLAS` y que ciertas reglas se apoyen en otras (RC2 omite el centro inexistente porque lo reporta RC4). |
| 4 | **Argumentos validados con zod; el error vuelve al modelo.** `ejecutarLlamada` hace `safeParse` del esquema de la herramienta y, si falla, devuelve `{ ok: false, error }` legible como resultado de la herramienta. | Lanzar la excepción y abortar el turno, o aceptar los argumentos sin validar. | El modelo ve el mensaje y puede corregir y reintentar dentro del mismo turno, con tope en `MAX_ITER`. Nada que viene del modelo llega sin validar a una herramienta. Costo: un reintento consume tokens; no hay prueba automática de este camino con un modelo real. |
| 5a | **Front en un `web/index.html` sin build.** | React u otro framework con build. | Arranque con un comando, sin dependencias de front (marked por CDN) y nada que compilar para desplegar. Costo: sin componentes ni tipado en el front, y depende de un CDN. |
| 5b | **Hono sobre `Bun.serve` directo.** | Router a mano sobre `Bun.serve`. | Rutas y estáticos con poco código y respuestas JSON tipadas; solo suma una dependencia pequeña. `server.ts` sigue exportando `{ port, fetch }`, que es lo que Bun consume. |
| 6 | **Sesiones en memoria** (`Map` en `server.ts`) con tope de 200 sesiones, de tokens por sesión y de iteraciones por turno. | Persistirlas en archivo o base de datos. | El PRD no pide persistencia y CLAUDE.md prohíbe agregar base de datos. Costo: se pierden al reiniciar y no se evictan (ver §12). Los topes cumplen el requisito de costo del PRD §8. |
| 7 | **`modulo/` generado por `scripts/sync-modulo.ts`** desde `agent/prompt.md`, `src/knowledge/*.md` y `src/tools/oc.ts`; `--check` detecta divergencias. | Mantener copias a mano de cada archivo. | Una sola fuente por contenido: editar el prompt y olvidar la copia es justo lo que penaliza el bonus. Costo: hay que correr `bun run sync` tras cada cambio del prompt, el conocimiento o las herramientas. |

## 9. Supuestos

Tomados del PRD §10:
- Los maestros de `fixtures/` están completos y vigentes. En producción habría que consultarlos en SAP en tiempo real.
- El correo de aprobación es evidencia suficiente. Auditoría podría exigir firma digital.

Adoptados al interpretar el PRD y el código:
- **Aprobación literal.** Se considera aprobada si el cuerpo contiene "aprobado" como palabra completa (sin distinguir mayúsculas) y no contiene "no aprobado", "desaprobado" ni "rechazado" (`esAprobado` en `src/tools/paquete.ts`, con casos en `demo.ts`). Sigue siendo una heurística de texto: no entiende frases como "aprobado si baja el precio" ni un "aprobado" citado de un correo anterior.
- **RC10**: tolerancia de ±1 unidad monetaria (`|cantidad × valor_unitario − valor_total| ≤ 1`), como pide el PRD §7.3. **RC5**: tolerancia de 2 % sobre el valor de la solicitud.
- **Clave del caso** = nombre de la carpeta en `fixtures/reto-03/solicitudes/` (p. ej. `sol-004`). El servidor la normaliza a minúsculas y toma el último segmento si el modelo envía una ruta.
- **Un caso, una OC.** La idempotencia es por `solicitud_id`: una segunda creación devuelve el número existente aunque el payload cambie.
- **Fechas** (RC8 y RC9) se comparan solo por día (`YYYY-MM-DD`), sin hora.
- **RC3 sin aprobador identificado**: se usa el mayor tope del centro, de modo que el bloqueo por tope no oculta que falta el aprobador (lo reporta RC2).
- **Proveedor** se busca por NIT sin puntos ni dígito de verificación; solo si la solicitud no trae NIT se busca por nombre normalizado (sin tildes ni signos).
- **Descripción de la posición** truncada a 40 caracteres en el payload, y registrada en la trazabilidad como truncamiento.
- **Confirmación humana** = mensaje que empieza con un afirmativo en español ("sí", "confirmo", "dale", "adelante"…) y no contiene negaciones. `confirmado_por` se escribe como `analista (sesión <id>)`: es el identificador de la sesión del navegador, no una identidad autenticada.
- **Una sesión equivale a una conversación**; no hay usuarios ni autenticación.
- **Numeración SAP simulada**: secuencial desde 4500000001 en `out/sap/ordenes.jsonl`.

## 10. Cobertura

Estado según el código y `demo.ts` (15 verificaciones, sin modelo). La conversación con el modelo real se probó a mano y no tiene prueba automática.

| HU | Estado | Qué hay | Qué falta para producción |
|---|---|---|---|
| HU-1 Leer el paquete | **Hecho** | `oc_leer_paquete` normaliza correo, solicitud, cotización, aprobación y factura opcional; un adjunto ausente se reporta en `faltantes` sin lanzar excepción. | Adjuntos reales (no JSON ni texto), ver P1. El PRD pide `null` por adjunto ausente; aquí se devuelve además la lista `faltantes`. |
| HU-2 Validar | **Hecho** | RC1–RC10 como funciones puras; `oc_validar` devuelve `apta`, `bloqueos`, `confirmaciones` y `derivados`. `demo.ts` comprueba el resultado esperado de los seis casos. | Maestros desde SAP en tiempo real; pruebas unitarias por regla con casos límite (hoy solo cubren los seis fixtures). |
| HU-3 Payload | **Hecho** | `oc_construir_payload` valida con zod y guarda `out/<caso>/trazabilidad.json` con la fuente de cada valor. | Mapeo al servicio OData real (ver §6); no se probó contra SAP. |
| HU-4 Evidencia | **Parcial** | P0: `out/<caso>/aprobacion.txt` con encabezados, cuerpo y sha256. | **P1 no hecho:** no se genera `aprobacion.pdf` y `pdf-lib` no está en las dependencias. Para producción: PDF adjunto a la OC en SAP y, si auditoría lo exige, firma digital. |
| HU-5 Crear OC | **Hecho** | Exige `apta` y confirmación, reconstruye y compara hash, número secuencial desde 4500000001, idempotente por `solicitud_id`, una fila en `out/control.csv` por intento. | Adaptador SAP real, almacenamiento duradero de `out/` y bloqueo distribuido en lugar de la cola en memoria del mock. |
| HU-6 Errores | **Parcial** | Las herramientas nunca lanzan: devuelven `{ ok: false, error }` en español; zod valida los argumentos; el modelo agotado o con timeout produce un mensaje claro. | `demo.ts` no ejercita JSON malformado ni montos no numéricos. Que el agente "sugiera qué pedir al solicitante" depende del prompt y no está verificado con pruebas. |
| P1 `oc_leer_excel` (`.xlsx`) | **No hecho** | No existe la herramienta ni hay `.xlsx` en los fixtures; la solicitud se lee de JSON. | Lector de `.xlsx` y de PDF de cotización con validación de formato. |

Bonus: `modulo/` (agente, skill y herramientas) se genera con `bun run sync`; `bun run sync --check` verifica que no diverja.

## 11. Uso de IA

| Asistente | Para qué lo usé |
|---|---|
| Claude (chat, Opus) | Elegir el reto, definir la arquitectura y las decisiones de diseño (confirmación en servidor, reconstrucción del payload, RC como funciones puras), redactar CLAUDE.md/AGENTS.md, agent/prompt.md y src/knowledge/, planificar el trabajo en paralelo y el despliegue, y diagnosticar fallos durante las pruebas. |
| Claude Code (VS Code, Opus en plan / Sonnet en implementación) | Leer los fixtures y producir docs/FIXTURES.md; implementar herramientas, reglas RC, SAP mock, demo.ts, adaptador LLM, ciclo del agente y servidor; corregir bugs (entre ellos el del flujo de confirmación y la detección de "Aprobado"); redactar en SOLUCION.md las secciones 4, 8, 9, 10 y 12 a partir del código y de docs/PRD.md, que luego revisé. |
| Codex (VS Code) | Front web/index.html, scripts/sync-modulo.ts, README.md y el borrador de SOLUCION.md (§2, §6, §7). |

**Cómo los coordiné:** un CLAUDE.md/AGENTS.md con el contrato y las reglas no negociables, que ambos asistentes leen; propiedad de archivos separada (Claude Code: src/, demo.ts; Codex: web/, scripts/, docs), para evitar conflictos; `/clear` entre fases y `demo.ts` como verificación en lugar de conversación, para ahorrar tokens.

**Qué descarté o corregí de lo que propusieron:**
- La primera versión de la confirmación se probó solo con un modelo falso, que llamaba `oc_crear` en el primer turno. Con el modelo real (que primero pregunta y crea en el segundo turno), el servidor no reconocía el "confirmo". Lo detecté en la prueba de punta a punta y pedí corregirlo, con un test de regresión en `demo.ts` que simula exactamente esos dos turnos a través del ciclo del agente. Lección: un mock que no reproduce el comportamiento real da falsa confianza.
- El modelo inventó una causa técnica al fallar (`confirmado_por: null`). Ajusté el prompt para que cite el error de la herramienta en vez de especular.
- El modelo le pasaba a `oc_crear` el objeto equivocado; la validación zod lo atrapó y el modelo reintentó. Aun así, precisé el prompt para evitar el reintento.
- Errores crudos del SDK (JSON) llegaban al chat; pedí traducirlos a mensajes legibles (HU-6, CA5).
- Al revisar la sección de supuestos detecté que "desaprobado" se leía como aprobado; pedí corregir la detección y documentarla.
- Rechacé agregar dependencias, base de datos o un framework de front: no aportaban a los criterios del reto (por eso tampoco está `pdf-lib`, ver §10).

**Qué hice yo:** elegir el reto y el enfoque, revisar cada entrega, probar los 6 casos con el modelo real en local y en Railway, configurar GitHub y Railway, y decidir qué correcciones aplicar. Puedo explicar cada componente y cada decisión de este documento.

## 12. Riesgos

| Riesgo | Situación actual | Mitigación |
|---|---|---|
| `out/` efímero en Railway | Las OC, `control.csv` y los logs se escriben en `out/` del disco del contenedor; el repositorio no configura ningún volumen. Si el contenedor se reinicia o se vuelve a desplegar, el mock SAP vuelve a numerar desde 4500000001 y se pierde la auditoría. | Montar un volumen o, mejor, reemplazar `SapMock` por el adaptador real (§6) y enviar `control.csv` y `log.jsonl` a un almacén duradero. |
| Sesiones en memoria | Un reinicio pierde historial y confirmaciones pendientes: el usuario que dijo "confirmo" después recibe un agente sin contexto. Además, no hay expiración: tras 200 sesiones, `/api/chat` responde 429 a sesiones nuevas hasta reiniciar. | Persistir sesiones con expiración (TTL) o limitar por IP; mientras tanto, reiniciar libera el cupo. |
| Confirmación por regex solo en español | `esAfirmativo` reconoce una lista fija de afirmativos al inicio del mensaje y rechaza cualquier negación. Un "claro, procede" o un mensaje en inglés (salvo "yes" y "ok") no confirma; también hay falsos negativos como "sí, pero primero revisa". Falla del lado seguro: no crea la OC. | Botón de confirmación en el front que envíe una señal explícita al servidor en lugar de interpretar texto libre. |
| Payload mal formado del modelo | Puede enviar un `payload` incompleto, con tipos errados o alterado. | Dos capas: zod rechaza la forma y el hash contra la OC reconstruida rechaza cualquier diferencia de contenido; en ambos casos se registra el intento en `control.csv` y el modelo recibe el error. Queda abierto que el modelo pierda iteraciones reintentando (tope `MAX_ITER`). |
| Maestros estáticos | Proveedores, centros y aprobadores se leen de `fixtures/`. Un proveedor bloqueado o un aprobador que cambió de cargo en SAP no se detectaría. | Consultarlos en SAP en cada validación (`SapAdapter.consultarProveedor` ya existe; falta para centros y aprobadores) con caché corta. |
| Costo y abuso del link público | El enlace no tiene autenticación ni límite por IP; el `sessionId` lo elige el cliente. Los topes por sesión (200.000 tokens, 25 pasos por turno) limitan una conversación, pero nada limita cuántas sesiones abre un mismo cliente hasta el tope global de 200; con esas sesiones puede gastar la clave del modelo y bloquear a los demás usuarios. | Autenticación o un token de acceso, límite de peticiones por IP, tope diario de gasto en la cuenta del proveedor, y la clave solo en variables de entorno del servidor (así está). |
| Heurística de "Aprobado" | La detección es por texto: palabra completa "aprobado", anulada por "no aprobado", "desaprobado" o "rechazado". Sigue aceptando aprobaciones condicionales ("aprobado si baja el precio") y rechaza correos que mezclen "aprobado" y "rechazado" aunque el sentido sea otro. | Aprobación estructurada (formulario o firma) en lugar de leer texto libre. |
| Evidencia sin PDF | Solo hay `aprobacion.txt` con sha256 (P1 no hecho). | Generar el PDF y adjuntarlo a la OC. |
