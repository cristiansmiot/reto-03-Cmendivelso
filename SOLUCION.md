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

TODO: documentar proveedor, modelo, justificación y costo estimado por caso.

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

TODO: registrar al menos tres decisiones, sus alternativas descartadas y la razón.

## 9. Supuestos

TODO: enumerar los supuestos adoptados al interpretar el PRD.

## 10. Cobertura

TODO: construir la tabla de historias de usuario, estado y brechas para producción.

## 11. Uso de IA

TODO: declarar asistentes, tareas realizadas, propuestas descartadas y motivos.

## 12. Riesgos

TODO: identificar riesgos de producción y sus mitigaciones.
