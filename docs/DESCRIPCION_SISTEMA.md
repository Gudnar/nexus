# Sistema Quismar (sis-quismar) — Descripción completa

Documento para trasladar/replicar el sistema en otro proyecto. Se generó leyendo el código fuente; los esquemas de tablas están **inferidos** del uso en el código (no hay dump SQL en el repo).

---

## 1. Qué es

ERP/administrativo web para una **empresa importadora y distribuidora** (Bolivia: moneda, IVA, NIT, facturación, tipo de cambio, formato de fecha dd/mm/yyyy, localización `es_BO`). Cubre el ciclo completo:

**Compra (importación) → logística/gastos de importación → ingreso a inventario por lotes → cotización → venta/factura → cobro → caja/arqueo → cierre mensual → reportes.**

Es un sistema monolítico en PHP, de una sola página (SPA parcial): el menú carga módulos por AJAX dentro de un `<div id="content">`.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Servidor | Apache + PHP (XAMPP), sin framework ni Composer |
| Base de datos | MySQL, base `smv` (config en `model/configRedBeans.php`) |
| ORM | **RedBeanPHP** (`model/rb.php`, uso `R::dispense/load/find/findOne/getAll/store`) |
| Frontend | jQuery 1.9.1, Bootstrap 3.3, plantilla **AdminLTE** (skin-blue, sidebar-mini), Font Awesome, Ionicons |
| Tablas | DataTables + Buttons (print, html5, colVis, jszip) |
| Formularios | bootstrapValidator (`es_BO.js`), bootstrap-datepicker, jquery.form, TinyMCE |
| PDF | mPDF 6.0 (`resources/lib/mpdf60`), dompdf, FPDF (`controller/fpdf.php`) |
| Excel | PHPExcel (`resources/Classes/PHPExcel`) — importación de productos/planillas |

Sin Composer, todas las librerías van copiadas en `resources/` y `view/`.

---

## 3. Arquitectura y estructura de carpetas

```
index.php                → include main.php
main.php                 → si no hay sesión muestra login_view.php; si hay, el layout (header, sidebar, #content)
login_view.php           → formulario de login (usa view/js/app-login.js)
controller/              → endpoints AJAX (POST) que devuelven JSON (o HTML). Uno por acción: xxxAdd, xxxEdit, xxxDel, xxxGet
model/                   → DAOs estáticos por tabla (xxxDAO.php) sobre RedBean; configRedBeans.php (conexión), funciones.php
view/modules/            → "pantallas" (HTML+PHP) cargadas por AJAX: listados y reportes
view/modules/forms/      → modales/formularios (Add/Edit/Del/Ver) cargados por AJAX
view/modules/reports/    → generadores PDF (mPDF): venta, nota de remisión, pago, inventario, arqueo, logística…
view/js/app-*.js         → un JS por módulo (app-ventas.js, app-logistica.js, app-compras.js, app-arqueo.js …)
view/css, fonts, images  → estáticos
resources/               → librerías de terceros (PHPExcel, mPDF, dompdf, fpdf fonts)
upload/                  → Excels importados (renombrados con timestamp) + upload/img
```

### Patrón de funcionamiento
1. `main.php` define el layout y el menú. Cada opción llama `getContent('modulo','')`.
2. `getContent` (en `view/js/app.js`) hace `POST view/modules/<modulo>.php` y vuelca el HTML en `#content`. Hay un flag `swSave` que bloquea la navegación si hay cambios sin guardar (modal `#modalNoSaved`).
3. Los módulos usan su `app-*.js` para llamar a `controller/*.php` por AJAX y recibir JSON `{success, msg, ...}`.
4. Los controllers incluyen los DAO que necesitan y operan con RedBean.
5. Reportes PDF: se abren desde `view/modules/reports/*-pdf.php`.

### Autenticación / sesión
- `controller/login.php`: busca `usuario` + `credencial` (rol) por `user`/`pass` con `estado='ACTIVO'`.
- Variables de sesión: `user`, `name`, `user_id`, `cod_rol` (código de credencial/rol), `gestion_id`, `gestion_title`, `gestion_setting` (gestión = año fiscal activo, tabla `gestion`).
- `controller/session.php` se incluye en los controllers para exigir sesión. `controller/logout.php` cierra sesión.
- Cambio de contraseña desde el menú de usuario (`showFormPass`).
- No hay control de permisos por rol en el menú: todos ven todo (la tabla `credencial` solo aporta el nombre del rol).

---

## 4. Módulos funcionales (menú principal)

| Menú | Opciones | Estado |
|---|---|---|
| **Cuentas** | Listado de cuentas (`cuenta-listado`) | Implementado. Extracto, Hoja de Balance, Balance de prueba, Flujo de fondos, Informe cuenta de pago: **solo placeholders** |
| **Usuarios** | Usuarios, Credenciales | Placeholders |
| **Configuración** | Gestión, Info empresa, Sucursales/almacenes, Ubicaciones, Correlativo ventas | Placeholders (DAOs existen: gestion, sucursal, almacen) |
| **Contactos** | Clientes, Proveedores (+ representantes de cada uno) | Implementado |
| **Compras** | Agregar compra (ingreso mercadería), Listado de compras, Registro de pagos por compra | Implementado |
| **Logística** | Agregar gastos de logística, Listado/tipos de gasto, Tipo de cambio por lote | Implementado |
| **Transferencias** | Agregar / Listado | Menú sin módulo |
| **Ajustes de stock** | Crear / Listar | Placeholders |
| **Productos** | Categoría, Subcategoría, Producto (alta + importación Excel) | Implementado |
| **Ventas** | Ventas y facturación, Búsqueda de ventas, Cotización, Búsqueda de cotización | Implementado (crédito/historial comentados) |
| **Gastos (caja chica)** | Agregar gastos | Implementado |
| **Caja** | Agregar ingresos, Arqueo y cierre de caja | Implementado |
| **Reportes** | Ingresos, Inventarios, Kardex, Stock mínimo, Clientes, Arqueo, Registro de ventas, Resumen de ventas, Gastos | Parcial: implementados `rep-ingresos`, `rep-inventarios`, `rep-minimos`, `rep-gastos`; Kardex/clientes/arqueo/ventas/resumen figuran en menú sin archivo |

---

## 5. Modelo de datos (inferido)

Estados por columna `estado`: `ACTIVO`, `PENDIENTE`, `ANULADO`/inactivo (borrado lógico). RedBean crea FKs con convención `<tabla>_id`.

**Catálogos y maestros**
- `usuario` (user, pass, nombre, estado, credencial_id), `credencial` (codigo = rol)
- `gestion` (nombre, estado ACTIVO/PENDIENTE) — año fiscal
- `sucursal`, `almacen`, `moneda`, `pais`, `origen`, `unidad`, `medida` (nombre, cantidad por medida)
- `categoria`, `subcategoria` (categoria_id)
- `cliente` (codigo, nombre/empresa, nit, direccion, telefono, email) + `representante`
- `proveedor` (nombre, nit, tipo, ciudad, contacto, moneda_id, …) + `representante`
- `producto` (codigo, codigoproveedor, nombre, subcategoria_id, medida_id, origen_id, proveedor_id), `productoproveedor`
- `cuenta` (abreviado, descripcion, usuario_id) — cuentas bancarias/caja
- `tipocambiario` (tipo de cambio), `tipogasto` (tipos de gasto de logística)

**Inventario**
- `almacenproducto` (almacen_id, producto_id) — producto en almacén
- `ordenentrada` (nroentrada, proveedor_id, estado PENDIENTE→ACTIVO, fechaconfirmacion) — cabecera de compra
- `entrada` (ordenentrada_id, producto_id, almacenproducto_id, cantidad, preciocompra, precio, estado) — detalle de compra
- `lote` (almacenproducto_id, ordenentrada_id, entrada_id, nrolote, cantidad **= stock vivo**, preciomedida, preciounidad, proveedor_id, unitario, porcentaje, ventasf, ventacf, utilidadsf, utilidadcf, estado)
- `precio`

**Compras y costos de importación**
- `ordencompra` (ordenentrada_id, fecha, total, acuenta, saldo, nropago, porcentaje, moneda_id, cuenta_id, estado) — pagos al proveedor
- `logistica` (ordenentrada_id, tipogasto_id, pais_id, descripcion, glosa, cantidad, costo, total, fecha, hora, moneda_id, cuenta_id, estado) — gastos de importación por compra

**Ventas**
- `cotizacion` + `detallecot` (detalle)
- `factura` (cabecera de venta: nrofactura, estado PENDIENTE→ACTIVO, totalpagar, descuento (=comisión), monto pagado, cambio, deuda, saldo, observacion = método de pago, cliente…)
- `venta` (detalle: factura_id, producto_id, cantidad, precio, estado)
- `tipofactura` (pagos de la factura: factura_id, tipo EFECTIVO/DEPOSITO/TRANSFERENCIA/QR/CHEQUE, monto, cuenta_id, transaccion, fechapago, horapago)
- `comision`, `talonario` (correlativo de facturación)

**Caja y contabilidad**
- `cajachica` + `cajachicadetalle`, `gastos` (monto, tipo, destinatario, descripcion, nrocaja, cuenta_id, moneda_id, fecha, hora)
- `cajaingreso` (ingresos adicionales)
- `arqueo` (ini=1 apertura, total, moneda_id, cuenta_id, fecha, mes, horaini), `arqueocierre`
- `cierremensual` (periodo AAAA-MM, moneda_id, cuenta_id, saldo_inicial, total ingresos/egresos, saldo_final, estado ABIERTO/CERRADO, hash), `cierrediferencia`, `cierreauditoria`, `movimientoconciliado`, `periodobloqueado`

(El archivo `resetear base de datos.txt` lista las tablas a truncar para reiniciar datos de prueba; incluye tablas heredadas como `asistencia`, `compra`, `movimiento`, `pedido`, `proforma`, `unidad`.)

---

## 6. Reglas de negocio clave (lo más importante a replicar)

1. **Compra en dos pasos.** Se crea `ordenentrada` en `PENDIENTE` con sus `entrada`. Al finalizar (`productoEntradaFinalizarAdd`) pasa a `ACTIVO` y se crea un **lote** por cada línea (`nrolote = nroentrada`).
2. **Costeo por lote con logística.** Los gastos de importación (`logistica`: flete, aduana, etc., en distintas monedas) se asignan a la orden de compra. En `logisticaFinalizarAdd` se calcula por producto: **precio por kilo (costo unitario puesto en almacén)**, **% de margen**, **precio de venta sin factura**, **precio de venta con factura (IVA)**, y **utilidad SF/CF**; todo se guarda en el lote. Fórmula usada en JS: `ventacf = ventasf + ventasf*porcentaje/100`; `utilidad = venta − unitario`.
3. **Tipo de cambio por lote** (`logistica-cambio`): cada lote puede llevar su tipo de cambio para convertir costos en moneda extranjera.
4. **Inventario por lotes, salida FIFO-inverso.** Al finalizar una venta, por cada producto se descuenta de los lotes activos con `cantidad > 0` ordenados por `nrolote DESC` (consume primero el lote más reciente). Si no hay stock suficiente devuelve "¡Productos sin stock!". Solo se vende desde `almacen_id = 1`.
5. **Venta en dos pasos.** `factura` nace `PENDIENTE` con sus `venta`; al finalizar pasa a `ACTIVO`, se asigna **nrofactura correlativo** (`FacturaDao::getNroFacturaEnd()+1`), se registra el pago y se descuenta stock.
6. **Pagos mixtos.** 14 combinaciones de método (efectivo, depósito, transferencia, QR, cheque y mezclas de dos). Cada componente genera un registro en `tipofactura` con su cuenta bancaria y número de comprobante. Si hay `saldo > 0` la factura queda como **venta a crédito** (`deuda=1`) y admite pagos posteriores (`ventaFinalizarPagoAdd`, `facturaPagos`).
7. **Comisión** sobre la venta (`ventaFinalizarComisionAdd`, `facturaComision`), guardada en `descuento`.
8. **Precio con/sin factura**: el sistema maneja dos precios por lote (`ventasf` / `ventacf`) y se elige según si la venta lleva factura.
9. **Cotizaciones** (`cotizacion`/`detallecot`) y conversión posterior a venta; búsquedas propias de ventas y cotizaciones.
10. **Anulación/edición de factura** (`facturaEliminar`, `facturaAnular`, `facturaEditar`): borrado lógico.
11. **Caja:** apertura de arqueo (`arqueo.ini=1`) por cuenta y moneda; gastos (caja chica) e ingresos extra por cuenta; reporte de arqueo en PDF.
12. **Cierre mensual** (`CierremensualDao::procesarCierre`): por periodo + moneda + cuenta:
    saldo inicial (saldo final del mes anterior cerrado, o la apertura de arqueo) → recolecta movimientos (ventas efectivo, ventas digitales, compras, logística, gastos, ingresos adicionales) → totales → valida contra saldo final declarado (tolerancia 0,01) → crea cierre con **hash de verificación**, marca movimientos conciliados, registra diferencia si la hay, **bloquea el periodo** y deja auditoría. Existe `reabrirCierre` con motivo y auditoría.
13. **Importación masiva por Excel** (`productoAddImportar`, `planillaAddImportar`, `tablaAddImportar`): .xlsx con columnas fijas (B código proveedor, C código, D categoría, E subcategoría, F nombre, G medida, H cantidad por medida …). Crea/relaciona categoría, subcategoría y medida si no existen; omite productos duplicados; guarda el archivo en `upload/` con prefijo timestamp.
14. **Multi-moneda** en proveedores, compras, logística, gastos, arqueo y cierre.
15. **Borrado lógico** generalizado (`estado`), y búsquedas tipo autocompletado de productos/clientes (`listadoProducto*`, `codigoClienteGet*`).

---

## 7. Reportes y documentos PDF
Venta (con y sin servicios), nota de remisión, comprobante de pago, entrada de inventario, inventario, ingresos, arqueo, búsqueda, reporte de logística, cabecera carta. Hay CSS específicos de impresión (`stylesprint*.css`, `stylescarton*.css`, catálogo) y exportación DataTables a Excel/imprimir.

---

## 8. Cómo trasladarlo a otro proyecto

**Mínimo a llevar**
1. `model/` completo (+ `rb.php`) y ajustar `configRedBeans.php` (host, base, usuario, clave).
2. `controller/` y `view/` completos, `resources/` solo las librerías necesarias (PHPExcel, mPDF).
3. Recrear la BD: al no haber dump, **exportar la estructura desde la BD `smv` actual** (`mysqldump --no-data smv`) — RedBean en modo no-freeze puede crear columnas automáticamente, pero conviene congelar el esquema. Necesita datos semilla: `credencial`, `usuario` admin, `gestion` ACTIVO, `moneda`, `almacen` id=1, `sucursal`, `tipocambiario`.
4. Cambiar branding: `view/images/logo*.jpg`, títulos "Quismar", datos de empresa en `view/modules/reports/cabeceraCarta.php`.

**Si se reescribe en otro stack**: respetar el flujo de §1 y las reglas de §6; las entidades de §5 mapean casi 1:1 a tablas relacionales.

---

## 9. Deuda técnica / problemas a NO replicar

- **SQL injection**: `UsuarioDao::recoverLoginPassword` y `CierremensualDao` concatenan `$_POST` en SQL. Usar consultas parametrizadas (`R::getAll($sql, [$x])`).
- **Contraseñas en texto plano** (`u.pass='...'`); usar `password_hash/password_verify`.
- **Sin autorización por rol**; el menú es igual para todos. Varios controllers no incluyen `session.php`.
- `display_errors` activado en controllers de producción; ficheros `error_log` dentro del repo.
- Credenciales de BD de producción comentadas en `configRedBeans.php` (rotarlas y moverlas a variables de entorno).
- `cierreMensualProcesar.php` mezcla `$_SESSION['user']` (nombre) como `usuarioId`, y calcula ventas con `$idCuenta` (objeto bean) en vez del id.
- Bug: `productoEntradaFinalizarAdd.php` usa `$loteAnt` sin definir.
- Duplicados de código: `rep-inventarios copy 3…7.php`, `logisticaAdd copy.php`, `cotizacionbusquedaSearch copy.php`.
- `venta` solo descuenta de `almacen_id = 1` (hard-coded) y la validación de stock se hace *después* de guardar la factura (sin transacción) → puede quedar factura activa sin descontar stock. Envolver en transacción (`R::begin/commit/rollback`).
- Mezcla de lógica de negocio en controllers y en JS (cálculo de precios en cliente); centralizar en servidor.
- Módulos del menú sin implementar (ver §4).
