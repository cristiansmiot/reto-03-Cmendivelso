# Fixtures reto 03 — esquema real, rarezas y resultado esperado

## Esquema real (difiere de PRD §7.1 donde se marca +)
- `maestros/proveedores.json`: `{codigo_sap, nit, nombre, condiciones_pago_default, indicador_iva_default, activo}[]` — 5 filas; NIT sin puntos ni DV. `Consultores Ágiles` (901777888) `activo:false`.
- `maestros/centros-costo.json`: `{centro_costo, +nombre, subareas[], aprobadores[{email, +nombre, tope}]}[]`.
  CC-1010 Tecnología {Infraestructura, Soporte, Desarrollo}: mlopez 50M, dgarcia 200M · CC-2020 Administración {Compras, Servicios Generales}: rtorres 30M · CC-3030 Comercial {Preventa, Marketing}: fvargas 80M.
- `maestros/indicadores-iva.json`: `{codigo, descripcion, tasa}[]` — C0 0, C1 0.19, C2 0.05.
- `maestros/condiciones-pago.json`: `{codigo, descripcion, dias}[]` — Z000, Z015, Z030, Z060.
- `<caso>/correo.json`: `{id, de, +para, asunto, fecha, cuerpo, adjuntos[], +nota_fixture}`; `id` = `sol-00N-correo`.
- `<caso>/solicitud.json`: según PRD; los opcionales **se omiten** (no vienen `null`). `solicitud_id` = `SOL-2026-00N`.
- `<caso>/aprobacion.json`: `{de, para, +cc[], fecha, asunto, cuerpo}`.
- `<caso>/cotizacion.txt` (todos) y `factura.txt` (solo sol-005): texto plano UTF-8, ver rarezas.

## Rarezas
- **Fechas**: `fecha_solicitud` = `YYYY-MM-DD`; correo/aprobación = ISO con offset `2026-08-21T10:02:00-05:00`; txt = `Fecha: YYYY-MM-DD` / `Fecha de emisión: YYYY-MM-DD`. Comparar por fecha calendario local (cortar a 10 chars), no por UTC.
- **Validez**: relativa, `Validez de la oferta: 30 días` → `validez_hasta = Fecha + N días`.
- **Montos txt**: `COP 11.400.000` (punto = miles, sin decimales). Parsear quitando `COP` y puntos.
- **Total cotización**: línea `TOTAL (IVA incluido): COP X`. Ojo: también hay `Subtotal:` (dentro de la línea del ítem), `Base gravable:` e `IVA 19%:` con montos → anclar `^TOTAL`. Factura: `TOTAL: COP X`.
- **Precio unitario** de la cotización viene `(IVA incl.)`; `valor_total` de la solicitud también es IVA incluido.
- **NIT cotización**: `NIT: 900.555.111-2` (puntos + dígito de verificación) vs. maestros/solicitud `900555111`. Normalizar: quitar puntos y `-DV`.
  Trampa: la línea `Cliente: Periferia IT Group S.A.S. - NIT 900.123.456-7` también tiene NIT → anclar `^NIT:`. Factura: NIT inline en `Vendedor: … - NIT 800.444.555-3`.
- **Referencia cotización**: primera línea `COTIZACIÓN <ref>` (ej. `COT-TS-2026-0451`) → `cotizacion_ref`. Factura: `FACTURA ELECTRÓNICA DE VENTA No. FC-88231`.
- **"Aprobado"**: todos los cuerpos empiezan con "Aprobado"; sol-003 y sol-004 añaden matices (otro centro / "por 25 millones"). Búsqueda case-insensitive.
- **Emails con tildes** (`sofía.herrera@`, `natalia.ríos@`, `andrés.beltrán@`): solo solicitantes; aprobadores son ASCII.
- **Descripción > 40 chars** en sol-001/002/003/004/006 → truncar para `posiciones[].descripcion`.
- **Unidad** no viene: derivar (`H` para horas en sol-004; `UN` resto).
- **Asunto** del correo truncado a 80 chars; carpeta `sol-00N` ≠ `solicitud_id` `SOL-2026-00N`.
- Ningún caso dispara RC9 ni RC10 (cantidad × valor_unitario cuadra en todos; aprobación ≥ solicitud en todos, sol-004 el mismo día).

## Casos
| Caso | Datos clave | RC disparadas | Resultado esperado |
|---|---|---|---|
| sol-001 | TecnoSuministros 900555111 activo; CC-1010/Infraestructura; 120×95.000 = 11,4M; cot 11,4M; mlopez (50M) | ninguna | ✅ apta, sin confirmaciones → crea OC |
| sol-002 | Soluciones Digitales del Norte, NIT 901999000 (cot `901.999.000-5`) **no existe** en maestros | RC1 bloqueo | ❌ no apta, no se crea |
| sol-003 | CC-2020/Servicios Generales; 74M; aprueba **fvargas** (aprobador de CC-3030) | RC2 bloqueo; RC3 bloqueo (único aprobador CC-2020 rtorres tope 30M < 74M) | ❌ no apta |
| sol-004 | Cloud Andina; 100×250.000 = 25M; cot 100×265.000 = **26,5M** (6 %); dgarcia (200M); aprobación 26-ago 18:45 = mismo día | RC5 confirmación (25.000.000 vs 26.500.000) | ⚠️ apta, requiere confirmación → OC solo con `confirmado=true` |
| sol-005 | Papelería Central; 3,2M; cot 3,2M (05-ago, validez 30 d); factura FC-88231 **10-ago** < solicitud 27-ago; rtorres (30M) | RC8 confirmación, `retroactiva=true`, se registra en control | ⚠️ apta, requiere confirmación |
| sol-006 | Sin `proveedor_nit`, `indicador_iva`, `condiciones_pago`; proveedor por nombre → TecnoSuministros; mlopez; 30×180.000 = 5,4M = cot | RC1 por nombre OK; RC6 deriva C1 + confirmación; RC7 deriva Z030 (informativo) | ⚠️ apta, requiere confirmación de IVA |
