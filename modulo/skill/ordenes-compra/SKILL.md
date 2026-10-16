---
name: ordenes-compra
description: "Conocimiento para validar paquetes de compra y crear órdenes de compra en SAP"
---
# Conocimiento del proceso — Órdenes de Compra SAP

Fuente: PRD Reto 03, secciones 7.3 y 7.4. Si una regla de negocio cambia, se edita este archivo y `src/rules/rc.ts`. Nunca `server.ts`.

## 1. El proceso en una línea

Paquete por correo (solicitud + cotización + aprobación del líder, y a veces factura) → validar contra maestros → construir la OC → evidencia de aprobación → crear la OC en SAP → registrar en control.

## 2. Maestros

| Maestro | Archivo | Uso |
|---|---|---|
| Proveedores | `maestros/proveedores.json` | Existencia, `activo`, `codigo_sap`, IVA y condiciones de pago por defecto |
| Centros de costo | `maestros/centros-costo.json` | Subáreas válidas y aprobadores con su `tope` |
| Indicadores IVA | `maestros/indicadores-iva.json` | Códigos válidos (p. ej. `C1`) y tasa |
| Condiciones de pago | `maestros/condiciones-pago.json` | Códigos válidos (p. ej. `Z030`) y días |

## 3. Matriz de controles

| Regla | Qué verifica | Tipo | Acción sugerida si falla |
|---|---|---|---|
| RC1 | El proveedor existe (por NIT; si no hay NIT, por nombre normalizado) y está `activo` | ⛔ Bloqueo | Pedir a Compras crear o activar el proveedor en SAP, o al solicitante confirmar el NIT correcto |
| RC2 | La aprobación existe, contiene "Aprobado" y viene de un aprobador del centro de costo | ⛔ Bloqueo | Solicitar la aprobación a un aprobador autorizado del centro |
| RC3 | `valor_total` ≤ `tope` del aprobador en ese centro | ⛔ Bloqueo | Escalar a un aprobador con tope suficiente |
| RC4 | La subárea pertenece al centro de costo | ⛔ Bloqueo | Pedir al solicitante corregir el centro o la subárea |
| RC5 | Diferencia cotización vs. solicitud ≤ 2 % del `valor_total`; si no hay cotización, también aplica | ⚠️ Confirmación | Mostrar ambos valores; la analista decide o pide una cotización actualizada |
| RC6 | `indicador_iva` ausente → se toma el `indicador_iva_default` del proveedor | ⚠️ Confirmación + derivado | Confirmar el código derivado |
| RC7 | `condiciones_pago` ausente → se toman del proveedor | ℹ️ Derivado | Solo informar |
| RC8 | Hay factura con fecha anterior a `fecha_solicitud` → `retroactiva = true` | ⚠️ Confirmación | Crear solo con confirmación; queda marcada en `out/control.csv` |
| RC9 | La fecha de aprobación es ≥ `fecha_solicitud` | ⚠️ Confirmación | Confirmar o pedir una aprobación posterior a la solicitud |
| RC10 | `cantidad × valor_unitario` = `valor_total` (± 1 unidad monetaria) | ⛔ Bloqueo | Pedir al solicitante corregir la solicitud |

**Semántica:**
- `apta = false` si hay al menos un bloqueo. Una OC no apta nunca se crea, ni con confirmación.
- Con `apta = true` y confirmaciones pendientes, la OC solo se crea con `confirmado = true`, otorgado por el usuario en el turno inmediatamente anterior.
- Los derivados siempre se informan, con su fuente.

## 4. Orden de compra (resumen del payload)

- `sociedad` y `organizacion_compras` son fijos: `"1000"`.
- `moneda`: `COP` o `USD`.
- Posiciones numeradas 10, 20, 30…; descripción de máximo **40 caracteres** (límite del texto breve de SAP); unidad `UN`, `H` o `MES`.
- `aprobador.evidencia_sha256` = hash del archivo de evidencia de aprobación.
- `excepciones[]` registra cada confirmación aceptada (`codigo`, `detalle`, `confirmado_por`).
- Trazabilidad: cada valor indica su fuente (`solicitud`, `cotizacion`, `maestro.<nombre>` o `derivado`) en `out/<caso>/trazabilidad.json`.

## 5. Creación en SAP (simulado)

- Numeración secuencial desde `4500000001`, guardada en `out/sap/ordenes.jsonl`.
- **Idempotencia:** si ya existe una OC para el mismo `solicitud_id`, se devuelve su número (`idempotente = true`), no se crea otra.
- Cada intento (creada, bloqueada o pendiente) agrega una fila a `out/control.csv`: `solicitud_id, resultado, numero_oc, retroactiva, bloqueos, confirmaciones, ts`.

## 6. Glosario

| Término | Significado |
|---|---|
| OC | Orden de compra |
| Centro de costo / subárea | Imputación contable del gasto |
| Indicador de IVA | Código SAP que define el tratamiento del impuesto |
| Condiciones de pago | Código SAP del plazo de pago (p. ej. 30 días) |
| OC retroactiva | OC creada después de recibir la factura; desvío de proceso que la dirección quiere medir |
| Tope | Monto máximo que un aprobador puede autorizar en un centro de costo |
