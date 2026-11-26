# Planificación maestra --- ERP SaaS multi-tenant, multisucursal y omnicanal

**Versión:** 2.1 (ver §32 para los cambios respecto a 2.0)\
**Estado:** Especificación arquitectónica y funcional ampliada\
**Stack:** Node.js + TypeScript + NestJS + PostgreSQL + Prisma + pnpm +
Next.js\
**Enfoque:** Monolito modular con límites de dominio y proyección futura
a microservicios

------------------------------------------------------------------------

## 0. Propósito y alcance de esta versión

Este documento actualiza la planificación inicial del ERP sucesor de
Quismar. Conserva la base tecnológica y los principios de seguridad,
aislamiento multi-tenant, inventario por lotes, ventas, caja y cierres,
y amplía el alcance para incluir:

-   Empresas con múltiples sucursales administradas desde un panel
    consolidado.
-   Configuración empresarial, comercial, documental y de impresión.
-   Usuarios, membresías, roles, permisos dinámicos, horarios y
    restricciones contextuales.
-   Precios escalonados con dos modalidades comerciales: con impuestos
    de ley y sin impuestos de ley.
-   Listas de precios asignables a clientes y canales.
-   Inventario multisucursal, multi-almacén y por lotes.
-   Cajas múltiples, sesiones/turnos, arqueos, movimientos y
    conciliaciones.
-   Aprobaciones configurables y notificaciones multicanal.
-   Cotizaciones integradas al ciclo de ventas.
-   Ecommerce independiente y personalizable por empresa.
-   Integraciones omnicanal con WhatsApp, Facebook e Instagram mediante
    APIs oficiales.
-   Importación y exportación Excel con validación, previsualización y
    trazabilidad.
-   Configuración de impresoras por usuario/dispositivo y formatos de
    documentos por empresa/sucursal.

### 0.1 Principios obligatorios

1.  Todo dato operativo pertenece a un `tenantId`.
2.  Los datos operativos localizables pertenecen además a una sucursal,
    almacén, caja u otra unidad organizativa cuando corresponda.
3.  El aislamiento de tenant se fuerza en PostgreSQL mediante RLS y se
    refuerza en aplicación.
4.  La sucursal no es un tenant: una empresa puede tener varias
    sucursales dentro del mismo tenant.
5.  Catálogos y clientes pueden compartirse entre sucursales;
    inventario, cajas y sesiones se controlan por ubicación.
6.  Las operaciones confirmadas con impacto financiero o de stock no se
    editan ni eliminan físicamente: se corrigen con reversos o
    movimientos compensatorios.
7.  Las autorizaciones se verifican en backend; ocultar botones en
    frontend no es seguridad.
8.  Precios comerciales y cálculo fiscal son conceptos relacionados,
    pero no equivalentes.
9.  Las reglas que pueden variar entre empresas deben configurarse y no
    codificarse como constantes.
10. Los eventos de dominio, auditoría, notificaciones y aprobaciones
    deben ser transaccionalmente confiables.

### 0.2 Alcance funcional

El ERP tendrá tres superficies principales:

-   **Consola de plataforma:** administración SaaS global.
-   **Aplicación empresarial:** administración y operación del tenant,
    con visión consolidada y filtros por sucursal.
-   **Tienda pública y canales digitales:** ecommerce de cada tenant,
    pedidos y conversaciones omnicanal.

### 0.3 Fuera de alcance inicial, con puntos de extensión

-   Facturación electrónica oficial del SIN Bolivia hasta que se defina
    su alcance y certificación.
-   Contabilidad general completa (plan de cuentas, asientos y estados
    financieros formales).
-   Aplicaciones móviles nativas.
-   POS offline completo.
-   Marketplace compartido entre tenants.

La arquitectura no debe impedir incorporar estos componentes
posteriormente.

------------------------------------------------------------------------

# 1. Decisiones de arquitectura

  -----------------------------------------------------------------------
  Área                                Decisión
  ----------------------------------- -----------------------------------
  Gestor de paquetes                  pnpm workspaces

  Monorepo                            Turborepo

  Lenguaje                            TypeScript strict

  Backend                             NestJS con Fastify

  ORM                                 Prisma

  Base de datos                       PostgreSQL 16 o versión estable
                                      soportada al iniciar

  Multi-tenancy                       Base compartida, esquema
                                      compartido, `tenantId` y RLS

  Frontend empresarial                Next.js App Router, React, Tailwind
                                      y shadcn/ui

  Consola plataforma                  Next.js

  Ecommerce                           Next.js con resolución por
                                      dominio/subdominio

  Validación                          Zod en contratos compartidos

  API                                 REST + OpenAPI

  Jobs                                BullMQ + Redis

  Archivos                            Almacenamiento S3 compatible

  Excel                               exceljs

  PDF/documentos                      HTML + Chromium/Playwright o
                                      pdfmake

  Tiempo real                         WebSocket o SSE, según caso de uso

  Logs                                pino

  Observabilidad                      OpenTelemetry y Sentry

  Pruebas                             Vitest/Jest, Supertest,
                                      Testcontainers y Playwright

  CI/CD                               GitHub Actions

  Despliegue                          Contenedores; desarrollo local sin
                                      obligar a Docker
  -----------------------------------------------------------------------

### 1.1 Monolito modular

No crear un microservicio por módulo. Los dominios se implementan dentro
de una aplicación NestJS, con módulos independientes, contratos
explícitos, servicios de aplicación y eventos internos. Los procesos
pesados se ejecutan en `worker`.

### 1.2 Identificadores, dinero y cantidades

-   Identificadores UUID v7.
-   Dinero: `Decimal(18,4)` como precisión de almacenamiento; reglas de
    redondeo por moneda y documento.
-   Cantidades: `Decimal(18,4)` para unidades fraccionables.
-   Tasas: precisión superior cuando sea necesario.
-   Fechas almacenadas con semántica explícita; timestamps en UTC y zona
    horaria del tenant/sucursal para presentación y reglas de negocio.
-   Nunca usar `float`/`double` para importes monetarios.

------------------------------------------------------------------------

# 2. Jerarquía organizacional y multisucursal

## 2.1 Jerarquía

``` text
PLATAFORMA SaaS
└── TENANT / EMPRESA
    ├── Configuración empresarial
    ├── Usuarios y membresías
    ├── Roles y permisos
    ├── Clientes y proveedores compartidos
    ├── Catálogo y listas de precios
    ├── Sucursal Central
    │   ├── Almacenes
    │   ├── Cajas
    │   │   └── Sesiones / turnos
    │   ├── Usuarios autorizados
    │   └── Operaciones locales
    ├── Sucursal Norte
    │   ├── Almacenes
    │   ├── Cajas
    │   ├── Usuarios autorizados
    │   └── Operaciones locales
    ├── Ecommerce y canales
    └── Panel consolidado
```

## 2.2 Reglas de multisucursal

-   Cada tenant puede registrar una o muchas sucursales.
-   Toda empresa debe tener al menos una sucursal principal.
-   Una sucursal puede tener varios almacenes y varias cajas.
-   Un usuario puede estar autorizado para una, varias o todas las
    sucursales.
-   El administrador general puede cambiar el contexto de sucursal o
    consultar todas, sujeto a permisos.
-   Los documentos deben guardar `branchId` de origen, incluso cuando se
    consulten desde el panel consolidado.
-   Los clientes, proveedores, productos, categorías y listas de precios
    pueden ser globales al tenant.
-   La existencia es por almacén; el stock de sucursal es una agregación
    de sus almacenes.
-   Transferencias entre sucursales deben generar salida y entrada
    vinculadas, con estados de tránsito y recepción.
-   No se debe compartir una sesión de caja entre sucursales.
-   Los reportes consolidados deben permitir desglose por sucursal y
    comparación entre periodos.
-   Las secuencias pueden configurarse por tenant, sucursal, tipo de
    documento y punto de emisión.

## 2.3 Panel consolidado

El panel empresarial mostrará:

-   Ventas del día/periodo por empresa y sucursal.
-   Compras y recepción de mercadería.
-   Existencias y valorización por sucursal/almacén.
-   Cajas abiertas, cerradas y arqueos pendientes.
-   Ingresos, egresos y medios de pago.
-   Cuentas por cobrar y pagar.
-   Cotizaciones y pedidos pendientes.
-   Solicitudes de aprobación.
-   Alertas de stock y vencimientos.
-   Indicadores ecommerce y canales digitales.
-   Actividad de usuarios y auditoría.

Los filtros de sucursal deben ser explícitos: `Todas las sucursales` o
una sucursal concreta. No se debe mezclar información sin indicar el
alcance del reporte.

------------------------------------------------------------------------

# 3. Estructura del monorepo

``` text
erp/
├── apps/
│   ├── api/                 # NestJS REST API
│   ├── web/                 # ERP empresarial
│   ├── admin/               # Consola SaaS global
│   ├── storefront/          # Tiendas públicas multi-tenant
│   ├── worker/              # BullMQ: jobs y procesos asíncronos
│   └── print-agent/         # Agente local opcional de impresión
├── packages/
│   ├── db/                  # Prisma, migraciones, seeds, RLS
│   ├── contracts/           # Zod schemas, DTOs y enums
│   ├── domain-shared/       # Tipos y políticas compartidas
│   ├── config/              # Configuración TS/ESLint/Prettier
│   ├── ui/                  # Componentes compartidos
│   ├── utils/               # Dinero, fechas, formato y helpers
│   ├── permissions/         # Evaluador de permisos/políticas
│   └── integrations/        # Contratos de proveedores externos
├── infra/
├── docs/
│   ├── architecture/
│   ├── data-model/
│   ├── adr/
│   ├── security/
│   ├── operations/
│   └── migration/
└── pnpm-workspace.yaml
```

Los nombres de paquetes y módulos deben mantener una convención
uniforme. `print-agent` puede desplegarse como aplicación independiente;
no debe ser requisito para usar el ERP en navegador.

------------------------------------------------------------------------

# 4. Plataforma SaaS y multi-tenancy

## 4.1 Actores

-   `PlatformUser`: administrador o soporte de la plataforma SaaS, sin pertenencia ordinaria a un
    tenant.
-   `Tenant`: empresa cliente del SaaS.
-   `User`: identidad de una persona.
-   `Membership`: vincula usuario con tenant.
-   `Role`: rol dentro del tenant.
-   `BranchMembership` o `UserBranchAccess`: acceso del usuario a
    sucursales.
-   Soporte puede realizar impersonación temporal, justificada y
    auditada.

## 4.2 Entidades de plataforma

  Entidad                Propósito
  ---------------------- -----------------------------------------
  PlatformUser           Administradores y soporte de plataforma
  Tenant                 Empresa suscrita
  Plan                   Plan comercial SaaS
  Subscription           Suscripción y vigencia
  ModuleDefinition       Catálogo de módulos
  TenantModule           Módulos habilitados por tenant
  FeatureDefinition      Funcionalidades activables
  TenantFeature          Features y límites
  UsageCounter           Medición de consumo
  PlatformAuditLog       Auditoría global
  TenantDomain           Dominios y subdominios
  TenantInvitation       Invitación inicial
  SupportImpersonation   Acceso de soporte controlado

## 4.3 RLS obligatorio

Todas las tablas de negocio con datos de tenant deben tener
`tenantId NOT NULL` y políticas RLS.

Política conceptual:

``` sql
ALTER TABLE business_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_table FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON business_table
USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);
```

Requisitos:

-   Rol de aplicación sin `BYPASSRLS`.
-   Rol de migraciones separado.
-   `set_config('app.tenant_id', ..., true)` dentro de la misma
    transacción/conexión usada por las consultas.
-   No confiar en `tenantId` enviado por el cliente.
-   Contexto de tenant resuelto desde dominio/sesión/JWT validado.
-   `tenantId` inmutable en registros de negocio.
-   Índices y claves únicas compuestas por tenant.
-   FKs compuestas para impedir referencias entre tenants.
-   Para relaciones locales, incluir también `branchId` cuando aplique.
-   Tests automáticos de RLS en todas las tablas tenant-scoped.
-   Jobs, workers, websockets, exportaciones, archivos y cachés deben
    transportar contexto de tenant.
-   Las tablas globales de plataforma deben estar separadas
    conceptualmente y no exponer datos tenant.

No se debe asumir que una extensión Prisma sustituye las políticas de
PostgreSQL. RLS es la última barrera de aislamiento.

## 4.4 Relaciones seguras

Ejemplo conceptual:

``` sql
UNIQUE (tenant_id, id)
FOREIGN KEY (tenant_id, customer_id)
  REFERENCES customer (tenant_id, id)
```

Para una venta:

``` sql
FOREIGN KEY (tenant_id, branch_id)
  REFERENCES branch (tenant_id, id)
```

Cuando una operación referencia un almacén, caja o usuario, validar que
todos pertenezcan al mismo tenant y que su relación con la sucursal sea
válida.

------------------------------------------------------------------------

# 5. Identidad, roles, permisos y horarios

## 5.1 Autenticación

-   Contraseñas con argon2id.
-   Access token de corta duración.
-   Refresh token rotativo, hasheado y revocable.
-   Cookies seguras HttpOnly/SameSite para aplicaciones web.
-   2FA TOTP para administradores y configurable por política.
-   Rate limit y bloqueo progresivo.
-   Recuperación de cuenta con tokens de un solo uso.
-   Sesiones y dispositivos revocables.

## 5.2 RBAC dinámico

No codificar roles como condiciones fijas (`isAdmin`, `isCashier`). Los
roles iniciales son plantillas editables.

Roles sugeridos:

-   Administrador.
-   Gerente.
-   Supervisor.
-   Vendedor.
-   Cajero.
-   Financiero.
-   Compras.
-   Almacenero.
-   Auditor.
-   Ecommerce.
-   Personalizado.

## 5.3 Permisos

Estructura:

``` text
Permission
  module
  resource
  action
  description

Role
RolePermission
UserRole
UserBranchAccess
UserSchedule
AccessPolicy
```

Convención sugerida:

-   `sales.read`
-   `sales.create`
-   `sales.update_draft`
-   `sales.confirm`
-   `sales.request_void`
-   `sales.approve_void`
-   `sales.execute_void`
-   `sales.apply_discount`
-   `sales.override_price`
-   `cash.open_session`
-   `cash.close_session`
-   `cash.approve_difference`
-   `inventory.adjust.request`
-   `inventory.adjust.approve`
-   `reports.financial.read`
-   `reports.export`

Cada permiso debe poder asociarse a límites o políticas: porcentaje
máximo de descuento, importe máximo, sucursales permitidas, propiedad
del registro, horario y necesidad de aprobación.

## 5.4 Restricciones contextuales

El evaluador de autorización debe considerar:

1.  Tenant y membresía activa.
2.  Rol y permisos.
3.  Sucursal actual y acceso a ella.
4.  Recurso y propiedad.
5.  Horario y fechas de vigencia.
6.  Límites cuantitativos.
7.  Estado de la operación.
8.  Aprobación requerida.
9.  Estado del plan/módulo habilitado.

## 5.5 Horarios

Entidades:

-   `UserSchedule`: calendario asignado.
-   `UserScheduleRule`: día de semana, hora inicial/final, zona horaria.
-   `UserScheduleException`: feriado, permiso, excepción o bloqueo.
-   `UserAccessPolicy`: política de acceso adicional.
-   `UserSession`: sesión autenticada.
-   `UserDevice`: dispositivo registrado.

Los horarios deben usar zona horaria del tenant o de la sucursal según
la política. Definir explícitamente el tratamiento de turnos que cruzan
medianoche. El acceso fuera de horario debe denegarse o requerir
excepción aprobada; no basta con ocultar pantallas.

------------------------------------------------------------------------

# 6. Configuración empresarial, sucursal, documentos e impresión

## 6.1 Niveles de configuración

Jerarquía recomendada:

1.  Plataforma: valores técnicos y límites SaaS.
2.  Tenant: identidad legal, moneda base, idioma, políticas y valores
    predeterminados.
3.  Sucursal: dirección, contacto, almacenes, cajas, secuencias y
    overrides autorizados.
4.  Usuario: preferencias de interfaz, impresora preferida y
    preferencias de notificación.
5.  Dispositivo: impresora física, conexión y formato compatible.

Regla de herencia: la configuración más específica puede sobrescribir
una configuración heredable, pero no puede invalidar políticas de
seguridad o integridad del tenant.

## 6.2 Identidad empresarial

`CompanyProfile`:

-   razón social;
-   nombre comercial;
-   NIT/identificador fiscal;
-   país y jurisdicción;
-   dirección fiscal;
-   teléfonos y correo;
-   sitio web;
-   logo principal, secundario y favicon;
-   colores corporativos;
-   moneda base;
-   idioma;
-   zona horaria;
-   datos legales adicionales.

`Branch`:

-   código y nombre;
-   dirección y geolocalización opcional;
-   teléfonos/correo;
-   responsable;
-   estado;
-   configuración comercial/documental local.

## 6.3 Documentos y plantillas

`DocumentTemplate` debe permitir configurar por tipo de documento:

-   recibo de venta;
-   cotización;
-   orden de compra;
-   nota de entrega/remisión;
-   comprobante de pago;
-   recibo de caja;
-   reporte interno.

Campos configurables:

-   tamaño 58 mm, 80 mm, carta, oficio o personalizado;
-   orientación;
-   márgenes;
-   logo;
-   encabezado y pie;
-   datos empresariales/sucursal;
-   textos legales y comerciales;
-   tamaño de fuente;
-   número de copias;
-   mostrar/ocultar campos según permisos;
-   plantilla/versionado.

Una plantilla comercial no equivale a un documento fiscal oficial. La
integración fiscal debe ser un dominio separado.

## 6.4 Impresoras

`PrinterDevice` y `UserPrinterPreference`:

-   nombre lógico;
-   tipo: térmica, láser, inyección, PDF;
-   protocolo/conexión: sistema operativo, USB/red vía agente,
    PDF/navegador;
-   ancho de papel;
-   formatos admitidos;
-   estado y última comprobación;
-   impresora predeterminada por usuario;
-   asignación por tipo de documento;
-   número de copias.

El navegador no garantiza impresión silenciosa ni selección universal de
impresora. Para control local se implementará un agente de impresión
opcional, autenticado, vinculado a tenant/usuario/dispositivo. Nunca
exponer impresoras locales directamente a la API pública.

------------------------------------------------------------------------

# 7. Maestros, contactos y catálogo

## 7.1 Contactos

Entidades:

-   `Contact`: datos comunes de persona/organización.
-   `Customer`: relación comercial como cliente.
-   `Supplier`: relación comercial como proveedor.
-   `ContactAddress`.
-   `ContactPerson`.
-   `CustomerBranch` solo si se requiere dirección/relación específica.
-   `CustomerPriceList`.
-   `CustomerCreditProfile`.
-   `SupplierProduct`.

Un mismo contacto puede ser cliente y proveedor. No duplicar su
identidad innecesariamente.

## 7.2 Catálogo

-   `Category`
-   `Subcategory` (si la jerarquía lo requiere)
-   `Brand`
-   `Product`
-   `ProductVariant` (opcional)
-   `UnitOfMeasure`
-   `ProductUnitConversion`
-   `ProductImage`
-   `ProductBarcode`
-   `ProductSupplier`
-   `ProductBranchSetting` (si hay políticas locales)
-   `ProductWarehouseSetting` (stock mínimo/máximo por almacén)

Producto global al tenant. La existencia nunca se guarda como un único
campo de producto.

## 7.3 Unidades

Soportar unidad base y conversiones controladas. Toda línea de
compra/venta/movimiento guarda unidad utilizada y factor de conversión
aplicado, para preservar historia si cambia la configuración.

------------------------------------------------------------------------

# 8. Precios, listas y modalidad con/sin impuestos

## 8.1 Requisito funcional confirmado

Una misma empresa puede vender usando ambas modalidades dependiendo del
cliente o de la operación:

-   `WITH_TAX`: precio comercial configurado con impuestos de ley.
-   `WITHOUT_TAX`: precio comercial configurado sin impuestos de ley.

No son dos empresas ni dos productos. Son modalidades de una lista de
precios. Un cliente puede tener modalidad predeterminada y una operación
autorizada puede seleccionar otra.

**Importante:** "precio con impuestos" y "precio sin impuestos" son
modalidades comerciales. El motor fiscal debe determinar los tributos
realmente aplicables, su base, tasa, exenciones y documento. No asumir
que la diferencia entre dos precios es una tasa tributaria ni permitir
que la etiqueta comercial eluda obligaciones legales.

## 8.2 Listas

`PriceList`:

-   tenantId;
-   nombre/código;
-   modalidad;
-   moneda;
-   ámbito (tenant/sucursal/canal);
-   vigencia;
-   prioridad;
-   estado;
-   modo de escalado (`TIER_THRESHOLD` o `PROGRESSIVE`);
-   regla de redondeo.

`ProductPrice`:

-   tenantId;
-   priceListId;
-   productId;
-   vigencia;
-   estado.

`ProductPriceTier`:

-   productPriceId;
-   minQuantity;
-   maxQuantity nullable;
-   unitPrice;
-   prioridad/orden.

Reglas:

-   No permitir tramos superpuestos.
-   Definir si el límite superior es inclusivo.
-   Permitir último tramo abierto.
-   Guardar decimales exactos.
-   Conservar historial de cambios.
-   La lista debe tener una sola modalidad.
-   Precios históricos de la venta son snapshots.
-   El cliente puede tener lista asignada y modalidad predeterminada.
-   La sucursal/canal puede tener una lista predeterminada.
-   Resolver conflictos con precedencia documentada: override autorizado
    de línea \> lista específica cliente \> lista canal/sucursal \>
    lista general.
-   El cambio de modalidad durante venta requiere permiso y debe
    recalcular líneas afectadas de forma explícita.

## 8.3 Escalado

Soportar dos reglas configurables:

-   Por tramo: al alcanzar un tramo, todas las unidades toman el precio
    unitario de ese tramo.
-   Progresivo: cada bloque de unidades se factura a su precio
    correspondiente.

La empresa selecciona la regla por lista. No inferir una regla global
única.

## 8.4 Cliente

`CustomerCommercialProfile` o campos en Customer:

-   defaultPriceMode;
-   defaultPriceListId;
-   paymentTerms;
-   creditLimit;
-   preferredCurrency;
-   taxProfileId cuando corresponda;
-   notas y restricciones.

Valores posibles de modalidad predeterminada: `WITH_TAX`, `WITHOUT_TAX`,
`ASK_EACH_TRANSACTION`.

## 8.5 Snapshot en documento

Cada cotización, pedido y venta debe guardar:

-   priceMode;
-   priceListId y versión aplicable;
-   precio unitario original;
-   precio unitario aplicado;
-   cantidad;
-   descuento;
-   base imponible;
-   impuestos desglosados;
-   total;
-   moneda y tipo de cambio si aplica;
-   usuario que modificó precio y motivo;
-   regla de escalado aplicada.

La cotización aceptada puede preservar el precio acordado según su
vigencia y política; al convertirla se validan inventario, estado y
reglas comerciales.

------------------------------------------------------------------------

# 9. Compras, importaciones y costos

Entidades:

-   `PurchaseOrder`
-   `PurchaseOrderLine`
-   `GoodsReceipt`
-   `GoodsReceiptLine`
-   `PurchaseInvoiceReference` (referencia documental, no implica
    facturación electrónica)
-   `SupplierPayment`
-   `SupplierPaymentAllocation`
-   `PurchaseReturn`
-   `PurchaseReturnLine`
-   `LandedCost`
-   `LandedCostLine`
-   `LandedCostAllocation`
-   `CostType`
-   `ExchangeRate` (definida solo en §20.2)

Requisitos:

-   órdenes y recepciones parciales;
-   recepción en sucursal/almacén específico;
-   lote nuevo o recepción adicional según reglas de trazabilidad;
-   pagos parciales;
-   cuentas por pagar;
-   devoluciones;
-   costos de transporte, aduana, seguro y otros gastos;
-   distribución de costos por valor, cantidad, peso, volumen o regla
    configurable;
-   tipo de cambio aplicado y fuente;
-   costo de lote preservado;
-   documentos y adjuntos.

El costo de inventario es independiente del precio comercial. Modificar
una lista de precios nunca debe alterar el costo histórico de un lote.

------------------------------------------------------------------------

# 10. Inventario multisucursal y lotes

## 10.1 Modelo

-   `Warehouse`: pertenece a una sucursal.
-   `Lot`: producto, lote, almacén de recepción, proveedor/origen,
    fechas, costo.
-   `StockMovement`: libro de movimientos inmutable.
-   `StockBalance`: saldo materializado por almacén/producto/lote.
-   `InventoryValuation`: valoración.
-   `StockReservation`: reservas.
-   `StockTransfer` y `StockTransferLine`: transferencias.
-   `StockAdjustment` y líneas: ajustes.
-   `InventoryCount` y líneas: conteos físicos.
-   `SaleLineLotAllocation`: asignación de lote a línea de venta.
-   `PurchaseReceiptLot`: vínculo recepción-lote.

## 10.2 Datos de lote

-   código interno;
-   producto;
-   tenant;
-   almacén de recepción (inmutable; la ubicación actual se deriva de
    `StockBalance`);
-   proveedor;
-   recepción/compra origen;
-   fecha de ingreso;
-   cantidad inicial;
-   cantidad disponible (derivada de `StockBalance`; no se almacena en
    `Lot`);
-   costo de adquisición;
-   gastos asignados;
-   costo unitario final;
-   moneda y tipo de cambio;
-   fecha de fabricación/vencimiento cuando aplique;
-   serie/identificador externo opcional;
-   estado.

## 10.3 Reglas de inventario

-   `StockMovement` es la fuente histórica de verdad.
-   `StockBalance` es una proyección transaccional mantenida por el
    sistema.
-   El saldo de lote no se modifica manualmente sin movimiento.
-   FIFO predeterminado recomendado, con FIFO/LIFO/promedio configurable
    por tenant o política de valoración.
-   Selección automática de lote como regla normal; selección manual
    solo con permiso/política.
-   Evitar stock negativo salvo configuración excepcional explícita.
-   Ventas, compras, transferencias y ajustes deben ser transaccionales.
-   Las anulaciones generan movimientos inversos; no borrar movimientos.
-   Transferencia entre sucursales tiene estados `DRAFT`, `DISPATCHED`,
    `IN_TRANSIT`, `RECEIVED`, `CANCELLED` con reglas de reversión.
-   Reservas tienen expiración y liberación.
-   Conteos físicos generan diferencias aprobables.
-   Reporte kardex por producto, lote, almacén, sucursal y rango de
    fechas.

------------------------------------------------------------------------

## 10.4 Lotes, ubicación y valoración (decisión v2.1, ADR-004)

-   **`Lot` es identidad, no ubicación.** Guarda producto, origen,
    fechas y costo de adquisición; su almacén de recepción es inmutable.
-   **La ubicación vive en `StockBalance`** (almacén + producto + lote).
    Una transferencia genera salida en el almacén origen y entrada en el
    destino sobre el mismo `lotId`; el lote nunca se duplica ni se
    "mueve".
-   **Cantidad disponible** se obtiene de `StockBalance`; `Lot` no la
    almacena.
-   **Capas de costo.** FIFO y LIFO consumen capas de costo por lote.
    El costo promedio ponderado se calcula por almacén y producto en
    `InventoryValuation`, y no por lote.
-   **La asignación de lote se conserva siempre** (`SaleLineLotAllocation`)
    por trazabilidad, también con costo promedio. En ese caso
    `unitCostSnapshot` guarda el promedio vigente al momento de la venta
    y el lote queda como referencia física, no de costo.
-   **Política de valoración:** un método por tenant y producto, vigente
    desde una fecha. El cambio de método no reescribe historia: aplica
    hacia adelante y genera un documento de revaluación.
-   **Conciliación diaria** de `StockBalance` contra la suma de
    `StockMovement` y de `InventoryValuation` contra los movimientos.

# 11. Ventas, cotizaciones y pedidos

## 11.1 Cotizaciones integradas

Entidades:

-   `Quote`
-   `QuoteLine`
-   `QuoteVersion`
-   `QuoteStatusHistory`
-   `QuoteAttachment`

Estados sugeridos:

`DRAFT → SENT → ACCEPTED / REJECTED / EXPIRED / CANCELLED`

Funciones:

-   cliente existente o prospecto;
-   productos y servicios;
-   modalidad con/sin impuestos;
-   lista y tramos de precio;
-   descuentos y aprobaciones;
-   vigencia;
-   disponibilidad;
-   envío PDF por correo/WhatsApp;
-   versiones;
-   seguimiento;
-   conversión idempotente a pedido o venta;
-   reserva opcional de stock con expiración.

La conversión no debe duplicar una cotización ni cambiar silenciosamente
sus condiciones. Debe volver a validar stock, crédito y estado.

## 11.2 Ventas

Entidades:

-   `Sale`
-   `SaleLine`
-   `SaleLineLotAllocation`
-   `SaleStatusHistory`
-   `SaleDiscount`
-   `SaleReturn`
-   `SaleReturnLine`
-   `SalePayment`
-   `Payment`
-   `PaymentAllocation`
-   `SalespersonCommission`
-   `SalesDocument`

Cada venta registra tenant, sucursal, almacén origen según política,
caja/sesión si corresponde, cliente, vendedor, canal, modalidad de
precio y snapshots comerciales/fiscales.

Estados controlados, por ejemplo:

`DRAFT → CONFIRMED → PARTIALLY_PAID / PAID / CREDIT_PENDING → CANCEL_REQUESTED → CANCELLED`

Los estados exactos deben diseñarse sin mezclar estado comercial, pago,
despacho y aprobación; preferir dimensiones de estado separadas cuando
sea necesario.

## 11.3 Anulación y devoluciones

-   Solicitud de anulación con motivo.
-   Workflow de aprobación.
-   Revisión de pagos, despacho y documentos.
-   Reverso de stock y caja/finanzas.
-   Nota de crédito/devolución interna según el alcance.
-   Prohibir eliminación física de venta confirmada.
-   Registrar actor, aprobador, motivo, fecha y referencias de reverso.

------------------------------------------------------------------------

# 12. Pagos, cuentas por cobrar y pagar

Entidades:

-   `PaymentMethod`
-   `Payment`
-   `PaymentAllocation`
-   `Receivable`
-   `ReceivableInstallment`
-   `ReceivableCollection`
-   `Payable`
-   `PayableInstallment`
-   `SupplierPayment`
-   `Refund`
-   `BankAccount`
-   `BankTransaction`
-   `PaymentProvider`
-   `PaymentProviderConfiguration`

Soportar efectivo, transferencia, QR, tarjeta, cheque, crédito, pagos
mixtos y pagos parciales. La disponibilidad de métodos digitales depende
de integraciones contratadas.

Un pago es un hecho financiero; su aplicación a una o varias
facturas/cuentas se registra en asignaciones. No confundir método de
pago con cuenta/caja donde se recibe el dinero.

------------------------------------------------------------------------

# 13. Cajas, múltiples cajas, sesiones y arqueos

## 13.1 Modelo

-   `CashRegister`: caja física/lógica de una sucursal.
-   `CashSession`: sesión o turno de operación.
-   `CashSessionOpening`: apertura y fondo inicial.
-   `CashMovement`: libro de movimientos.
-   `CashCount`: arqueo.
-   `CashCountDenomination`: detalle por denominación.
-   `CashDifference`: diferencia y justificación.
-   `CashTransfer`: transferencia entre cajas/bóveda.
-   `CashExpense`: egreso/gasto.
-   `CashIncome`: ingreso no asociado a venta.
-   `CashClosing`: cierre confirmado.
-   `CashMovementReversal`: referencia de reverso.

## 13.2 Reglas

-   Una caja pertenece a una sucursal.
-   Una caja no puede tener más de una sesión abierta simultánea, salvo
    modo compartido expresamente habilitado.
-   La sesión pertenece a un usuario responsable y puede tener
    participantes autorizados.
-   El cajero solo opera cajas permitidas.
-   Cada movimiento referencia sesión y origen.
-   Separar efectivo de pagos QR/tarjeta/transferencia.
-   Apertura registra saldo inicial y denominaciones.
-   Cierre calcula saldo esperado por medio de pago.
-   Arqueo registra monto contado por denominación.
-   Diferencias requieren justificación y, según política, aprobación.
-   Cierre confirmado es inmutable; correcciones con movimientos
    compensatorios.
-   Reapertura requiere permiso y workflow.
-   Reportes por usuario, caja, sucursal, turno y consolidado tenant.
-   Cierre de caja no equivale al cierre mensual financiero.

Fórmula de efectivo esperado:

`saldoInicial + ingresosEfectivo - egresosEfectivo - retiros ± reversos = saldoEsperado`

Otros medios de pago se concilian por separado.

------------------------------------------------------------------------

# 14. Aprobaciones y workflows

## 14.1 Motor genérico

Entidades:

-   `ApprovalWorkflow`
-   `ApprovalWorkflowVersion`
-   `ApprovalStep`
-   `ApprovalRule`
-   `ApprovalRequest`
-   `ApprovalDecision`
-   `ApprovalDelegation`
-   `ApprovalEscalation`

Un workflow se configura por evento y condiciones, con roles/usuarios
aprobadores, niveles, plazos, autoaprobación prohibida opcional, motivo
obligatorio, escalamiento y acciones posteriores.

## 14.2 Casos iniciales

-   anulación de venta;
-   descuento extraordinario;
-   cambio manual de precio;
-   devolución/reembolso;
-   ajuste de inventario;
-   diferencia de arqueo;
-   reapertura de caja;
-   transferencia extraordinaria;
-   modificación de costo;
-   compra por encima de umbral;
-   cierre/reapertura de periodo.

## 14.3 Reglas

-   Solicitante y aprobador quedan identificados.
-   No autoaprobar si la política lo prohíbe.
-   La aprobación no debe ejecutar una operación dos veces.
-   Las acciones posteriores deben ser idempotentes.
-   Guardar payload/contexto relevante y snapshot de reglas aplicado.
-   La decisión queda auditada.
-   Rechazo exige motivo.
-   Un workflow no debe modificar permisos de usuario por sí mismo.

------------------------------------------------------------------------

# 15. Notificaciones y eventos

## 15.1 Arquitectura

Usar patrón transactional outbox:

``` text
Transacción de negocio
  ├── escritura de datos
  └── inserción OutboxEvent
          |
          v
      Worker/Dispatcher
          ├── In-app
          ├── WebSocket/SSE
          ├── Email
          ├── WhatsApp
          └── Push (futuro)
```

## 15.2 Entidades

-   `DomainEvent` o `OutboxEvent`
-   `Notification`
-   `NotificationRecipient`
-   `NotificationPreference`
-   `NotificationTemplate`
-   `NotificationDelivery`
-   `NotificationChannel`
-   `NotificationSubscription`

## 15.3 Eventos

Ejemplos:

-   `SaleConfirmed`
-   `SaleVoidRequested`
-   `ApprovalRequested`
-   `ApprovalResolved`
-   `CashSessionOpened`
-   `CashSessionClosed`
-   `CashDifferenceDetected`
-   `StockBelowMinimum`
-   `PurchaseReceived`
-   `QuoteExpiring`
-   `EcommerceOrderCreated`
-   `PaymentConfirmed`
-   `TransferDispatched`
-   `TransferReceived`

Cada evento incluye tenant, sucursal cuando aplique, actor, agregado,
fecha, correlationId e idempotency key. No incluir secretos ni datos
sensibles innecesarios en payloads.

------------------------------------------------------------------------

# 16. Ecommerce por tenant

## 16.1 Tienda independiente

Cada tenant puede activar una tienda pública con:

-   subdominio `empresa.erp-domain.com`;
-   dominio personalizado;
-   catálogo y categorías;
-   productos publicados;
-   stock publicable por sucursal;
-   precios/listas para canal ecommerce;
-   carrito;
-   checkout;
-   pedidos;
-   entregas y retiro;
-   cupones/promociones;
-   métodos de pago;
-   páginas informativas;
-   SEO básico.

## 16.2 Personalización visual

Entidades:

-   `Storefront`
-   `StorefrontDomain`
-   `StorefrontTheme`
-   `StorefrontThemeVersion`
-   `StorefrontPage`
-   `StorefrontBanner`
-   `StorefrontNavigation`
-   `StorefrontAsset`
-   `StorefrontConfiguration`

Configuraciones:

-   logo y favicon;
-   colores;
-   tipografía dentro de opciones permitidas;
-   tema prediseñado;
-   encabezado, pie y navegación;
-   banners;
-   estilo de tarjetas y botones;
-   páginas de contenido;
-   redes sociales.

No permitir HTML/JS arbitrario sin sandbox. Los temas deben usar
componentes y tokens seguros.

## 16.3 Pedidos ecommerce

Entidades:

-   `SalesOrder`
-   `SalesOrderLine`
-   `SalesOrderStatusHistory`
-   `ShoppingCart`
-   `ShoppingCartLine`
-   `Promotion`
-   `Coupon`
-   `Shipment`
-   `ShipmentLine`
-   `DeliveryZone`
-   `DeliveryRate`
-   `StorefrontOrderSource`

El pedido web no se convierte automáticamente en venta fiscal/financiera
confirmada hasta cumplir la política definida (aceptación, pago,
reserva, preparación o despacho).

## 16.4 Stock y sucursal

Configurar:

-   sucursal que prepara pedidos;
-   sucursal por zona o proximidad si se habilita;
-   disponibilidad publicable;
-   reserva temporal;
-   sustitución o falta de stock;
-   retiro en tienda;
-   envío a domicilio.

------------------------------------------------------------------------

# 17. Omnicanalidad: WhatsApp, Facebook e Instagram

## 17.1 Integraciones

Entidades:

-   `IntegrationProvider`
-   `TenantIntegration`
-   `IntegrationCredential`
-   `IntegrationWebhook`
-   `ExternalChannel`
-   `ExternalIdentity`
-   `Conversation`
-   `ConversationParticipant`
-   `ConversationMessage`
-   `ConversationAssignment`
-   `ConversationTag`
-   `ConversationNote`
-   `ChannelEvent`
-   `ExternalOrderReference`

Credenciales cifradas; nunca exponer tokens a frontend o logs. Cada
integración se vincula a tenant y, si aplica, a una sucursal.

## 17.2 Bandeja unificada

-   conversaciones por canal;
-   identificación y ficha del cliente;
-   historial de compras y cotizaciones;
-   asignación a vendedor/agente;
-   estados de atención;
-   notas internas;
-   etiquetas;
-   respuestas rápidas;
-   transferencia entre agentes;
-   historial de mensajes;
-   seguimiento y métricas.

## 17.3 Flujo de pedido

``` text
WhatsApp/Facebook/Instagram/Ecommerce
              |
              v
       Identificar contacto
              |
              v
       Consultar catálogo/precio
              |
              v
       Cotización o pedido
              |
              v
       Aceptación / pago
              |
              v
       Pedido de venta
              |
              v
       Preparación / despacho
              |
              v
       Venta y pago según política
```

Usar APIs oficiales y respetar permisos, ventanas de conversación,
plantillas y políticas de cada proveedor. Diseñar adaptadores para que
el dominio no dependa de una sola plataforma.

------------------------------------------------------------------------

# 18. Importación y exportación Excel

## 18.1 Módulo transversal

Entidades:

-   `ImportJob`
-   `ImportJobFile`
-   `ImportRow`
-   `ImportError`
-   `ImportMapping`
-   `ExportJob`
-   `ExportJobFile`
-   `ExportTemplate`

## 18.2 Flujo de importación

1.  Descargar plantilla.
2.  Cargar archivo.
3.  Detectar columnas y versión.
4.  Mapear columnas.
5.  Validar estructura y datos.
6.  Mostrar previsualización.
7.  Mostrar errores por fila.
8.  Confirmar importación.
9.  Procesar en background.
10. Generar resumen y archivo de errores.
11. Registrar actor, tenant, sucursal, fecha y resultado.

No aplicar cambios antes de confirmar. Reintentos deben ser idempotentes
o usar claves externas.

## 18.3 Plantillas iniciales

-   productos y categorías;
-   precios por lista, modalidad y tramo;
-   clientes/proveedores;
-   lotes y saldos de apertura;
-   inventario por almacén;
-   existencias mínimas;
-   movimientos iniciales controlados;
-   pedidos y cotizaciones, si se define.

Para cargar inventario inicial, generar un documento de apertura y
movimientos; no insertar saldos sin trazabilidad.

## 18.4 Exportaciones

-   productos;
-   listas y escalas de precios;
-   existencias por sucursal/almacén/lote;
-   kardex;
-   compras;
-   ventas;
-   clientes/proveedores;
-   cotizaciones;
-   caja y arqueos;
-   CxC/CxP;
-   reportes ecommerce.

Los costos, márgenes y datos financieros deben respetar permisos de
lectura/exportación.

------------------------------------------------------------------------

# 19. Cierre mensual y periodos

Entidades:

-   `FiscalYear`
-   `FiscalPeriod`
-   `PeriodClose`
-   `PeriodCloseLine`
-   `PeriodLock`
-   `Reconciliation`
-   `CloseDifference`
-   `CloseApproval`

Proceso:

1.  preparar cierre;
2.  validar cajas, pagos, compras, ventas, inventario y cuentas;
3.  detectar documentos pendientes;
4.  conciliar saldos;
5.  generar snapshot;
6.  solicitar aprobación si corresponde;
7.  confirmar cierre;
8.  bloquear operaciones retroactivas;
9.  permitir reapertura solo con autorización y auditoría.

El hash encadenado aporta evidencia de integridad, pero no reemplaza
controles de acceso, almacenamiento inmutable y auditoría. El bloqueo
debe aplicarse en backend y base de datos cuando sea posible.

------------------------------------------------------------------------

# 20. Modelo de datos lógico completo

Esta sección define las entidades principales y sus relaciones. Los
nombres son nombres lógicos; el schema Prisma final debe normalizar
enums, relaciones y restricciones. No significa que cada entidad deba
ser una tabla aislada si el diseño relacional justifica una composición.

Convención general para entidades tenant-scoped:

-   `id UUID`
-   `tenantId UUID`
-   `createdAt`
-   `updatedAt`
-   `createdById` cuando corresponda
-   `deletedAt` solo para maestros donde el borrado lógico sea válido
-   índices compuestos por tenant
-   RLS y FKs compuestas

No agregar `branchId` a toda tabla indiscriminadamente: solo a
documentos, recursos y operaciones que tengan pertenencia
física/operativa a una sucursal. Las tablas globales al tenant se
comparten entre sucursales.

## 20.1 Plataforma e identidad

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  PlatformUser                        id, email, passwordHash, status,
                                      2FA

  Tenant                              id, slug, legalName, status,
                                      country, baseCurrencyId, timezone

  Plan                                id, code, name, limits, status

  Subscription                        tenantId, planId, status, startAt,
                                      endAt, billingCycle

  ModuleDefinition                    code, name

  TenantModule                        tenantId, moduleCode, enabled

  FeatureDefinition                   code, type, defaultValue

  TenantFeature                       tenantId, featureCode, value

  UsageCounter                        tenantId, metric, period, quantity

  TenantDomain                        tenantId, domain, verifiedAt,
                                      isPrimary

  PlatformAuditLog                    actorPlatformUserId, tenantId
                                      nullable, action, target, metadata

  SupportImpersonation                platformUserId, tenantId, reason,
                                      startedAt, endedAt

  User                                id, email, phone, passwordHash,
                                      status

  Membership                          tenantId, userId, status,
                                      defaultBranchId nullable

  Invitation                          tenantId, email, tokenHash,
                                      expiresAt, acceptedAt

  Session                             userId, tenantId, refreshTokenHash,
                                      expiresAt, revokedAt

  UserDevice                          tenantId, userId, deviceName,
                                      fingerprint, status

  Role                                tenantId, code, name,
                                      isSystemTemplate

  Permission                          code, module, resource, action

  RolePermission                      tenantId, roleId, permissionId,
                                      constraints

  UserRole                            tenantId, membershipId, roleId

  UserBranchAccess                    tenantId, membershipId, branchId,
                                      accessLevel

  UserSchedule                        tenantId, name, timezone

  UserScheduleRule                    scheduleId, weekday, startTime,
                                      endTime

  UserScheduleException               scheduleId, date, type, startAt,
                                      endAt, reason

  MembershipSchedule                  membershipId, scheduleId,
                                      validFrom, validTo

  AccessPolicy                        tenantId, code, conditions, effect

  AuditLog                            tenantId, branchId nullable,
                                      actorUserId, action, entityType,
                                      entityId, before, after, ip,
                                      occurredAt
  -----------------------------------------------------------------------

## 20.2 Empresa y configuración

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  CompanyProfile                      tenantId, legalName, tradeName,
                                      taxId, address, contacts,
                                      logoAssetIds, colors

  Branch                              tenantId, code, name, address,
                                      phone, email, status

  BranchSetting                       tenantId, branchId, key, value

  TenantSetting                       tenantId, key, value

  Currency                            code, name, decimalPlaces

  ExchangeRate                        tenantId, fromCurrencyId,
                                      toCurrencyId, rate, effectiveAt,
                                      source

  FiscalYear                          tenantId, name, startDate, endDate,
                                      status

  FiscalPeriod                        tenantId, fiscalYearId, startDate,
                                      endDate, status

  Sequence                            tenantId, branchId nullable,
                                      documentType, prefix, currentValue,
                                      padding

  TaxProfile                          tenantId, code, name, jurisdiction,
                                      appliesTo (PRODUCT | CUSTOMER |
                                      OPERATION). Capa 2, ver §20.8

  TaxRule                             tenantId, taxProfileId, taxCodeId
                                      (FK a TaxCode, §20.8), priority,
                                      calculationType, taxableBaseRule,
                                      exemptionReason, validity. La tasa
                                      no se duplica: se resuelve en
                                      TaxRate por fecha

  DocumentTemplate                    tenantId, branchId nullable,
                                      documentType, paperSize,
                                      orientation, layout, version

  Asset                               tenantId, storageKey, mimeType,
                                      size, checksum, metadata

  PrinterDevice                       tenantId, branchId nullable,
                                      deviceName, connectionType,
                                      capabilities

  UserPrinterPreference               tenantId, userId, deviceId,
                                      documentType, isDefault, copies
  -----------------------------------------------------------------------

## 20.3 Contactos y catálogo

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  Contact                             tenantId, type, name, documentType,
                                      documentNumber, email, phone

  ContactAddress                      tenantId, contactId, type, address,
                                      city, country

  ContactPerson                       tenantId, contactId, name, role,
                                      phone, email

  Customer                            tenantId, contactId, code, status,
                                      defaultPriceMode,
                                      defaultPriceListId

  CustomerCreditProfile               tenantId, customerId, creditLimit,
                                      paymentTermDays, status

  Supplier                            tenantId, contactId, code, status

  Category                            tenantId, parentId nullable, name,
                                      code

  Brand                               tenantId, name, code

  UnitOfMeasure                       tenantId, code, name, precision

  Product                             tenantId, code, name, description,
                                      categoryId, brandId, baseUnitId,
                                      trackLots, trackExpiry, status

  ProductBarcode                      tenantId, productId, barcode,
                                      unitId

  ProductUnitConversion               tenantId, productId, fromUnitId,
                                      toUnitId, factor

  ProductImage                        tenantId, productId, assetId,
                                      sortOrder

  ProductSupplier                     tenantId, productId, supplierId,
                                      supplierCode, leadTime

  ProductBranchSetting                tenantId, branchId, productId,
                                      isSellable, reorderPolicy

  Warehouse                           tenantId, branchId, code, name,
                                      type, status

  WarehouseProductSetting             tenantId, warehouseId, productId,
                                      minStock, maxStock, reorderPoint
  -----------------------------------------------------------------------

## 20.4 Precios y promociones

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  PriceList                           tenantId, code, name, priceMode,
                                      currencyId, scope, branchId
                                      nullable, channel, scalingMode,
                                      validFrom, validTo

  ProductPrice                        tenantId, priceListId, productId,
                                      status

  ProductPriceTier                    tenantId, productPriceId,
                                      minQuantity, maxQuantity nullable,
                                      unitPrice

  CustomerPriceList                   tenantId, customerId, priceListId,
                                      priority, validFrom, validTo

  PriceHistory                        tenantId, productPriceTierId,
                                      previousValue, newValue, actorId,
                                      changedAt

  Promotion                           tenantId, code, type, conditions,
                                      benefits, validFrom, validTo

  Coupon                              tenantId, promotionId, code,
                                      usageLimit, usageCount, validFrom,
                                      validTo
  -----------------------------------------------------------------------

`priceMode` admite `WITH_TAX` y `WITHOUT_TAX`. La lista debe ser de una
sola modalidad. Los impuestos reales se calculan mediante reglas
fiscales independientes.

## 20.5 Compras y costeo

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  PurchaseOrder                       tenantId, branchId, supplierId,
                                      warehouseId, number, status,
                                      currencyId, totals

  PurchaseOrderLine                   tenantId, purchaseOrderId,
                                      productId, unitId, quantity,
                                      unitCost, totals

  GoodsReceipt                        tenantId, branchId, warehouseId,
                                      purchaseOrderId, number,
                                      receivedAt, status

  GoodsReceiptLine                    tenantId, goodsReceiptId,
                                      purchaseOrderLineId, productId,
                                      quantity

  PurchaseReturn                      tenantId, branchId, supplierId,
                                      sourceReceiptId, status

  PurchaseReturnLine                  tenantId, purchaseReturnId,
                                      productId, lotId, quantity

  LandedCost                          tenantId, branchId, reference,
                                      currencyId, exchangeRate, status

  CostType                            tenantId, code, name,
                                      allocationMethod

  LandedCostLine                      tenantId, landedCostId, costTypeId,
                                      amount

  LandedCostAllocation                tenantId, landedCostLineId,
                                      receiptLineId, lotId,
                                      allocatedAmount

  Payable                             tenantId, supplierId,
                                      sourceDocumentId, total, balance,
                                      dueDate, status

  SupplierPayment                     tenantId, branchId, supplierId,
                                      paymentId

  SupplierPaymentAllocation           tenantId, supplierPaymentId,
                                      payableId, amount
  -----------------------------------------------------------------------

## 20.6 Lotes e inventario

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  Lot                                 tenantId, productId,
                                      receivedWarehouseId, code,
                                      supplierId, receiptLineId,
                                      receivedAt, initialQty, unitCost,
                                      status, expiryDate

  StockMovement                       tenantId, branchId, warehouseId,
                                      productId, lotId nullable,
                                      movementType, quantityIn,
                                      quantityOut, unitCost, sourceType,
                                      sourceId, occurredAt

  StockBalance                        tenantId, warehouseId, productId,
                                      lotId nullable, physicalQty,
                                      reservedQty, availableQty, version

  InventoryValuation                  tenantId, warehouseId, productId,
                                      lotId, quantity, unitCost, value,
                                      valuationDate

  StockReservation                    tenantId, branchId, warehouseId,
                                      productId, lotId nullable,
                                      sourceType, sourceId, quantity,
                                      expiresAt, status

  StockTransfer                       tenantId, fromBranchId, toBranchId,
                                      fromWarehouseId, toWarehouseId,
                                      number, status, dispatchedAt,
                                      receivedAt

  StockTransferLine                   tenantId, transferId, productId,
                                      lotId, quantitySent,
                                      quantityReceived

  StockAdjustment                     tenantId, branchId, warehouseId,
                                      number, reason, status,
                                      requestedById, approvedById

  StockAdjustmentLine                 tenantId, adjustmentId, productId,
                                      lotId, systemQty, countedQty,
                                      difference

  InventoryCount                      tenantId, branchId, warehouseId,
                                      status, startedAt, completedAt

  InventoryCountLine                  tenantId, inventoryCountId,
                                      productId, lotId, countedQty

  SaleLineLotAllocation               tenantId, saleLineId, lotId,
                                      quantity, unitCostSnapshot,
                                      totalCostSnapshot

  PurchaseReceiptLot                  tenantId, goodsReceiptLineId,
                                      lotId, quantity
  -----------------------------------------------------------------------

## 20.7 Ventas, cotizaciones y pedidos

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  Quote                               tenantId, branchId, customerId
                                      nullable, number, status,
                                      priceMode, priceListId, validUntil,
                                      totals

  QuoteLine                           tenantId, quoteId, productId,
                                      descriptionSnapshot, quantity,
                                      unitPriceSnapshot, discounts,
                                      taxSnapshot, totals

  QuoteVersion                        tenantId, quoteId, version,
                                      snapshot, createdById

  QuoteStatusHistory                  tenantId, quoteId, fromStatus,
                                      toStatus, reason, actorId

  SalesOrder                          tenantId, branchId, sourceChannel,
                                      customerId, quoteId nullable,
                                      status, totals

  SalesOrderLine                      tenantId, salesOrderId, productId,
                                      quantity, priceSnapshot,
                                      taxSnapshot

  Sale                                tenantId, branchId, warehouseId,
                                      cashSessionId nullable, customerId,
                                      sellerId, number, status,
                                      priceMode, priceListId, currencyId,
                                      totals

  SaleLine                            tenantId, saleId, productId,
                                      descriptionSnapshot, quantity,
                                      unitId, unitPriceSnapshot,
                                      discountSnapshot, taxSnapshot,
                                      costSnapshot, totals

  SaleStatusHistory                   tenantId, saleId, fromStatus,
                                      toStatus, reason, actorId

  SaleReturn                          tenantId, branchId, saleId, status,
                                      reason, totals

  SaleReturnLine                      tenantId, saleReturnId, saleLineId,
                                      lotId nullable, quantity, amount

  CommissionRule                      tenantId, code, calculationType,
                                      value, conditions

  SalespersonCommission               tenantId, saleId, sellerId, amount,
                                      status

  SalesDocument                       tenantId, branchId, documentType,
                                      sourceType, sourceId, sequence,
                                      assetId
  -----------------------------------------------------------------------

## 20.8 Fiscalidad comercial

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  TaxCode                             tenantId, code, name, jurisdiction

  TaxRate                             tenantId, taxCodeId, rate,
                                      validFrom, validTo

  TaxCalculation                      tenantId, sourceType, sourceId,
                                      baseAmount, taxAmount, ruleSnapshot

  TaxCalculationLine                  tenantId, taxCalculationId,
                                      taxCodeId, taxableBase, rate,
                                      taxAmount

  TaxDocumentReference                tenantId, sourceType, sourceId,
                                      documentType, externalReference,
                                      status
  -----------------------------------------------------------------------

No afirmar que el documento generado sea factura fiscal oficial hasta
implementar y validar la integración con la normativa correspondiente.

### Modelo fiscal en capas (decisión v2.1, ADR-002)

Los dos conjuntos de entidades fiscales (`TaxProfile`/`TaxRule` en §20.2
y `TaxCode`/`TaxRate` en esta sección) **se implementan ambos**. No
compiten: cada uno cubre una responsabilidad distinta y se encadenan.

  -----------------------------------------------------------------------
  Capa   Entidades                    Responsabilidad
  ------ ---------------------------- -----------------------------------
  1      TaxCode, TaxRate             Catálogo: qué tributos existen y su
         Catálogo                     tasa vigente por rango de fechas.

  2      TaxProfile, TaxRule          Reglas de aplicación: qué `TaxCode`
         Reglas                       corresponde según el perfil fiscal
                                      del producto, del cliente y de la
                                      operación (exenciones, base
                                      imponible, orden y tipo de cálculo).

  3      TaxCalculation,              Resultado: snapshot inmutable del
         TaxCalculationLine           cálculo de cada documento.
         Cálculo

  4      TaxDocumentReference,        Documento fiscal externo (ver
         FiscalDocument               §33). Dominio separado.
         Documento
  -----------------------------------------------------------------------

Flujo de cálculo en servidor:

1.  Se resuelven los perfiles fiscales (`TaxProfile`) del producto, del
    cliente y de la operación.
2.  Las `TaxRule` activas y ordenadas por `priority` determinan qué
    `TaxCode` aplica, con qué base y con qué exenciones.
3.  La tasa de cada `TaxCode` se toma de `TaxRate` vigente en la fecha
    del documento. `TaxRule` no guarda tasas propias.
4.  Se interpreta `priceMode` (§8): en `WITH_TAX` se desglosa la base
    desde el precio; en `WITHOUT_TAX` se calcula el tributo sobre él.
5.  Se persiste el snapshot completo en `TaxCalculation` y sus líneas,
    incluyendo las reglas y tasas aplicadas.

Restricciones: un cambio en reglas o tasas nunca altera cálculos
históricos; el motor fiscal es independiente del motor de precios; y
toda regla fiscal tiene vigencia y auditoría de cambios.

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  FiscalDocument                      tenantId, branchId, sourceType,
                                      sourceId, fiscalDocumentType,
                                      provider, status, externalNumber,
                                      authorizationCode, issuedAt,
                                      payloadSnapshot, assetId

  FiscalDocumentEvent                 tenantId, fiscalDocumentId, type,
                                      status, response, occurredAt

  FiscalProviderConfiguration         tenantId, branchId nullable,
                                      providerCode, environment,
                                      credentialId, status
  -----------------------------------------------------------------------

`TaxDocumentReference` queda como vínculo ligero a documentos fiscales
externos ya emitidos; `FiscalDocument` modela la emisión propia cuando
se active el adaptador fiscal.

## 20.9 Pagos y finanzas operativas

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  PaymentMethod                       tenantId, code, name, type,
                                      requiresReference, active

  Payment                             tenantId, branchId, methodId,
                                      amount, currencyId, reference,
                                      status, paidAt

  PaymentAllocation                   tenantId, paymentId, targetType,
                                      targetId, amount

  Receivable                          tenantId, customerId, sourceType,
                                      sourceId, total, balance, dueDate,
                                      status

  ReceivableInstallment               tenantId, receivableId, dueDate,
                                      amount, balance, status

  Refund                              tenantId, branchId, paymentId,
                                      amount, reason, status

  BankAccount                         tenantId, name, bankName,
                                      currencyId, accountReference

  BankTransaction                     tenantId, bankAccountId, date,
                                      amount, reference,
                                      reconciliationStatus

  BankReconciliation                  tenantId, bankAccountId,
                                      periodStart, periodEnd, status

  BankReconciliationLine              tenantId, reconciliationId,
                                      bankTransactionId, paymentId
                                      nullable
  -----------------------------------------------------------------------

## 20.10 Cajas y turnos

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  CashRegister                        tenantId, branchId, code, name,
                                      status, allowSharedSession

  CashSession                         tenantId, branchId, cashRegisterId,
                                      responsibleUserId, openedAt,
                                      closedAt, status

  CashSessionParticipant              tenantId, cashSessionId, userId,
                                      role

  CashSessionOpening                  tenantId, cashSessionId,
                                      openingAmount, denominationSnapshot

  CashMovement                        tenantId, branchId, cashSessionId,
                                      movementType, paymentMethodId,
                                      amount, sourceType, sourceId,
                                      occurredAt

  CashCount                           tenantId, cashSessionId,
                                      countedById, expectedAmount,
                                      countedAmount, status

  CashCountDenomination               tenantId, cashCountId,
                                      denomination, quantity, subtotal

  CashDifference                      tenantId, cashCountId, amount,
                                      reason, approvalRequestId

  CashTransfer                        tenantId, branchId,
                                      fromCashRegisterId,
                                      toCashRegisterId, amount, status

  CashExpense                         tenantId, branchId, cashSessionId,
                                      category, amount, description

  CashIncome                          tenantId, branchId, cashSessionId,
                                      category, amount, description

  CashClosing                         tenantId, cashSessionId,
                                      confirmedAt, confirmedById,
                                      snapshot
  -----------------------------------------------------------------------

## 20.11 Aprobaciones, eventos y notificaciones

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  ApprovalWorkflow                    tenantId, code, eventType, status

  ApprovalWorkflowVersion             tenantId, workflowId, version,
                                      definition

  ApprovalStep                        tenantId, workflowVersionId, order,
                                      approverRule

  ApprovalRule                        tenantId, workflowVersionId,
                                      conditions

  ApprovalRequest                     tenantId, branchId nullable,
                                      workflowId, entityType, entityId,
                                      requestedById, status

  ApprovalDecision                    tenantId, approvalRequestId,
                                      stepId, actorId, decision, reason,
                                      decidedAt

  ApprovalDelegation                  tenantId, delegatorId, delegateId,
                                      validFrom, validTo

  OutboxEvent                         tenantId, eventType, aggregateType,
                                      aggregateId, payload, occurredAt,
                                      processedAt

  Notification                        tenantId, eventId, title, body,
                                      targetUrl, priority

  NotificationRecipient               tenantId, notificationId, userId,
                                      readAt

  NotificationPreference              tenantId, userId, eventType,
                                      channel, enabled

  NotificationTemplate                tenantId, eventType, channel,
                                      template

  NotificationDelivery                tenantId, notificationId, channel,
                                      status, providerReference, attempts
  -----------------------------------------------------------------------

## 20.12 Ecommerce y omnicanalidad

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  Storefront                          tenantId, name, status,
                                      primaryDomain, defaultBranchId

  StorefrontDomain                    tenantId, storefrontId, domain,
                                      verifiedAt

  StorefrontTheme                     tenantId, storefrontId, themeCode,
                                      tokens, settings

  StorefrontThemeVersion              tenantId, themeId, version,
                                      snapshot

  StorefrontPage                      tenantId, storefrontId, slug,
                                      content, status

  StorefrontBanner                    tenantId, storefrontId, assetId,
                                      targetUrl, sortOrder

  StorefrontProduct                   tenantId, storefrontId, productId,
                                      published, displayPriceListId

  ShoppingCart                        tenantId, storefrontId, customerId
                                      nullable, sessionKey, status

  ShoppingCartLine                    tenantId, cartId, productId,
                                      quantity, priceSnapshot

  StorefrontOrderSource               tenantId, orderId, storefrontId,
                                      sourceMetadata

  DeliveryZone                        tenantId, branchId, name, coverage,
                                      status

  DeliveryRate                        tenantId, deliveryZoneId, rule,
                                      amount

  Shipment                            tenantId, branchId, salesOrderId,
                                      status, trackingCode

  ShipmentLine                        tenantId, shipmentId,
                                      salesOrderLineId, quantity

  IntegrationProvider                 code, name, capabilities

  TenantIntegration                   tenantId, providerCode, status,
                                      configuration

  IntegrationCredential               tenantId, integrationId,
                                      encryptedSecret, rotatedAt

  IntegrationWebhook                  tenantId, integrationId,
                                      externalId, eventType, receivedAt,
                                      processedAt

  ExternalChannel                     tenantId, integrationId,
                                      channelType, externalAccountId

  ExternalIdentity                    tenantId, channelId, contactId,
                                      externalUserId

  Conversation                        tenantId, branchId nullable,
                                      channelId, customerId nullable,
                                      status, assignedUserId

  ConversationParticipant             tenantId, conversationId,
                                      externalIdentityId, participantType

  ConversationMessage                 tenantId, conversationId,
                                      externalMessageId, direction,
                                      messageType, content, sentAt

  ConversationAssignment              tenantId, conversationId, userId,
                                      assignedAt, unassignedAt

  ConversationNote                    tenantId, conversationId, userId,
                                      note

  ConversationTag                     tenantId, conversationId, tag

  ExternalOrderReference              tenantId, channelId,
                                      externalOrderId, salesOrderId
  -----------------------------------------------------------------------

## 20.13 Archivos, importación, exportación y sistema

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  Asset (definida en §20.2)           Única entidad de archivos; añade
                                      el campo filename. `FileAsset`
                                      queda como alias obsoleto

  ImportJob                           tenantId, branchId nullable, type,
                                      status, createdById, sourceFileId

  ImportRow                           tenantId, importJobId, rowNumber,
                                      status, payload

  ImportError                         tenantId, importJobId, rowNumber,
                                      field, code, message

  ImportMapping                       tenantId, importType, mapping

  ExportJob                           tenantId, branchId nullable, type,
                                      filters, status, createdById

  ExportJobFile                       tenantId, exportJobId, fileAssetId

  IdempotencyRecord                   tenantId, key, operation,
                                      responseReference, expiresAt

  PeriodClose                         tenantId, branchId nullable,
                                      fiscalPeriodId, status, snapshot,
                                      hash

  PeriodLock                          tenantId, branchId nullable,
                                      fiscalPeriodId, lockedAt

  Reconciliation                      tenantId, branchId nullable, type,
                                      period, status

  SystemJobLog                        tenantId nullable, jobType, status,
                                      correlationId
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 20.14 Entidades añadidas o aclaradas en v2.1

  -----------------------------------------------------------------------
  Entidad                             Campos/relaciones esenciales
  ----------------------------------- -----------------------------------
  Product (campo nuevo)               kind: GOODS | SERVICE | KIT;
                                      trackInventory. Los servicios no
                                      generan movimientos de stock

  ProductKitComponent                 tenantId, kitProductId,
                                      componentProductId, quantity,
                                      unitId

  ProductVariant                      tenantId, productId, code, name,
                                      attributes. Opcional por tenant;
                                      stock, precio y lote se
                                      referencian a la variante cuando
                                      el tenant la habilita

  SaleDiscount                        tenantId, saleId, saleLineId
                                      nullable, type, value, amount,
                                      reason, approvalRequestId nullable

  SequenceAllocation                  tenantId, sequenceId, value,
                                      allocatedAt, documentId nullable,
                                      status (para secuencias sin huecos
                                      y trazabilidad de números anulados)

  AuditLog (reforzado)                Particionado por mes; append-only;
                                      sin UPDATE ni DELETE para el rol
                                      de aplicación

  ImportTemplateVersion               tenantId nullable, importType,
                                      version, columns, status
  -----------------------------------------------------------------------

# 21. Relaciones principales del dominio

``` text
Tenant
 ├── CompanyProfile
 ├── Membership ── User ── UserRole ── Role ── RolePermission ── Permission
 ├── Branch
 │    ├── Warehouse ── Lot ── StockBalance
 │    ├── CashRegister ── CashSession ── CashMovement / CashCount
 │    ├── Branch settings / sequences / document templates
 │    └── Sales / Purchases / Transfers / Inventory counts
 ├── Customer ── CustomerPriceList ── PriceList
 ├── Supplier
 ├── Product ── ProductPrice ── ProductPriceTier
 ├── PriceList ── ProductPrice
 ├── PurchaseOrder ── GoodsReceipt ── Lot
 ├── StockMovement ── InventoryValuation
 ├── Quote ── QuoteLine ── SalesOrder / Sale
 ├── Sale ── SaleLine ── SaleLineLotAllocation
 ├── Payment ── PaymentAllocation
 ├── ApprovalWorkflow ── ApprovalRequest ── ApprovalDecision
 ├── OutboxEvent ── Notification
 ├── Storefront ── Theme / Cart / SalesOrder
 └── TenantIntegration ── Conversation ── ConversationMessage
```

Las relaciones de la figura son conceptuales; cada FK debe validar
tenant y, cuando aplique, sucursal.

------------------------------------------------------------------------

# 22. Reglas de integridad transaccional

## 22.1 Venta confirmada

En una sola transacción:

1.  validar tenant, sucursal, permisos y horario;
2.  validar cliente y lista/modalidad;
3.  calcular precios y tributos en servidor;
4.  validar crédito y descuentos;
5.  bloquear/reservar stock y asignar lotes;
6.  crear venta y líneas con snapshots;
7.  crear asignaciones de lotes;
8.  registrar movimientos de stock;
9.  registrar pagos/aplicaciones si los hay;
10. registrar movimientos de caja cuando corresponda;
11. registrar eventos outbox;
12. confirmar idempotencia.

## 22.2 Recepción de compra

En una sola transacción:

1.  validar orden y almacén;
2.  registrar recepción parcial/total;
3.  crear o actualizar lotes conforme a política;
4.  registrar stock movements;
5.  actualizar balances;
6.  registrar costos iniciales;
7.  crear cuentas por pagar según política;
8.  emitir eventos.

## 22.3 Cierre de caja

-   Bloquear sesión para nuevos movimientos.
-   Calcular totales por medio de pago.
-   Capturar conteo.
-   Calcular diferencias.
-   Solicitar aprobación si aplica.
-   Confirmar cierre inmutable.
-   Emitir evento de cierre.

## 22.4 Concurrencia

-   Usar `Serializable` cuando sea adecuado o locks explícitos.
-   Bloquear filas de balance/lote en orden estable.
-   No confiar en validar stock solo antes de iniciar la transacción.
-   Añadir reintentos controlados ante conflictos serializables.
-   Pruebas de ventas concurrentes sobre un mismo lote y de cierre
    concurrente de caja.

------------------------------------------------------------------------

# 23. API y contratos

-   REST versionada (`/api/v1`).
-   OpenAPI generado.
-   Zod compartido para contratos.
-   DTOs explícitos; no exponer modelos Prisma directamente.
-   Paginación por cursor.
-   Filtros y ordenamiento tipados.
-   Errores consistentes (Problem Details/RFC 7807).
-   `Idempotency-Key` en confirmar venta, pago, pedido y otras
    operaciones sensibles.
-   Contexto de tenant/sucursal obtenido de sesión y permisos;
    `branchId` solicitado debe validarse contra acceso del usuario.
-   Auditoría de cambios críticos.
-   Webhooks firmados, verificación de firma, timestamp y protección
    contra replay.

------------------------------------------------------------------------

# 24. Frontend y experiencia de usuario

## 24.1 Aplicación empresarial

-   Selector de sucursal con opción "Todas" solo para consultas
    autorizadas.
-   Dashboard consolidado.
-   Menú por módulos habilitados y permisos.
-   Tablas con filtros, columnas configurables y exportación autorizada.
-   Formularios con validación.
-   POS rápido.
-   Selector de cliente, lista y modalidad de precio.
-   Cotizaciones integradas.
-   Cajas y turnos.
-   Centro de notificaciones.
-   Bandeja de aprobaciones.
-   Centro de importación/exportación.
-   Configuración de empresa, sucursales, usuarios, roles, documentos e
    impresoras.

## 24.2 Consola de plataforma

-   tenants;
-   planes y suscripciones;
-   módulos/features;
-   métricas de uso;
-   dominios;
-   auditoría global;
-   soporte e impersonación temporal;
-   límites y estado del servicio.

## 24.3 Ecommerce

-   storefront independiente por dominio;
-   temas y componentes configurables;
-   catálogo público;
-   carrito y checkout;
-   estado de pedido;
-   métodos de pago;
-   entrega/retiro;
-   SEO;
-   responsive.

------------------------------------------------------------------------

# 25. Seguridad, auditoría y privacidad

-   RLS forzado en tablas tenant-scoped.
-   Claves foráneas compuestas para integridad tenant.
-   Roles de base separados.
-   MFA para roles sensibles.
-   Secretos cifrados en reposo.
-   Rotación de tokens.
-   Webhooks firmados.
-   Rate limit por tenant/canal.
-   Antivirus/validación de archivos cuando corresponda.
-   No registrar credenciales, tokens ni datos sensibles.
-   Auditoría append-only para operaciones críticas.
-   Retención de datos configurable y compatible con obligaciones
    aplicables.
-   Backups cifrados y PITR.
-   Pruebas periódicas de restauración.
-   Exportación de datos por tenant.
-   Impersonación de soporte limitada y auditada.
-   Los permisos de lectura de costos, márgenes y reportes financieros
    deben ser explícitos.

------------------------------------------------------------------------

# 26. Migración desde Quismar

La migración real requiere inspeccionar `DESCRIPCION_SISTEMA.md`, el
esquema MySQL y datos de producción. Este documento no presume que el
modelo legado esté completamente conocido.

Proceso:

1.  inventariar tablas, relaciones, reglas y reportes actuales;
2.  construir matriz de equivalencia origen-destino;
3.  perfilar calidad de datos;
4.  mapear estados y catálogos;
5.  migrar tenant inicial;
6.  reconstruir lotes y movimientos históricos cuando la información lo
    permita;
7.  conciliar existencias, ventas, caja y saldos;
8.  identificar registros no migrables;
9.  ejecutar pruebas de migración en staging;
10. validar con usuarios responsables;
11. plan de corte y reversión.

No inventar movimientos históricos cuando no existan datos suficientes:
registrar saldos de apertura con trazabilidad y fecha de corte.

------------------------------------------------------------------------

# 27. Fases y entregables recomendados

El cronograma inicial de 25--30 semanas debe revisarse: el nuevo alcance
es significativamente mayor. No se debe prometer la entrega completa con
el calendario del MVP anterior.

  -----------------------------------------------------------------------------
  Fase                    Alcance                       Entregable
  ----------------------- ----------------------------- -----------------------
  0                       Descubrimiento, reglas, ERD,  Especificación validada
                          ADR, UX base                  

  1                       Monorepo, CI, tenant context, Dos tenants aislados
                          RLS, auth                     

  2                       Empresa, sucursales,          Panel multisucursal y
                          usuarios, roles, permisos,    seguridad
                          horarios                      

  3                       Configuración, maestros,      Catálogo/precios
                          catálogo, precios y Excel     funcionales

  4                       Compras, lotes, inventario,   Kardex y stock
                          transferencias                confiable

  5                       Cotizaciones, ventas, pagos y Ciclo comercial
                          devoluciones                  

  6                       Cajas, sesiones, arqueos y    Control de caja
                          finanzas operativas           

  7                       Aprobaciones, notificaciones, Control operativo
                          documentos e impresión        

  8                       Ecommerce, temas, pedidos y   Tienda por tenant
                          pagos                         

  9                       WhatsApp/Facebook/Instagram y Omnicanalidad
                          bandeja                       

  10                      Cierre mensual, reportes,     Salida productiva
                          migración, hardening          
  -----------------------------------------------------------------------------

### 27.1 Ajuste de fases v2.1 (prevalece sobre la tabla anterior)

Las aprobaciones, el outbox y la auditoría se necesitan antes de ventas,
caja e inventario, así que se adelantan en versión mínima y se amplían
después.

  -----------------------------------------------------------------------------
  Fase   Alcance                                  Entregable
  ------ ---------------------------------------- -----------------------------
  0      Discovery, ADR-001 a ADR-006, ERD,       Especificación validada y
         estrategia fiscal (§33), NFR (§34),      spike técnico aprobado
         spike Prisma/RLS (§35.1)

  1      Monorepo, CI, tenant/branch context,     Dos tenants aislados con
         RLS, auth, **auditoría append-only y     auditoría y eventos
         outbox mínimo**

  2      Empresa, sucursales, usuarios, roles,    Panel multisucursal y
         permisos, horarios, **motor de           seguridad (hito §30)
         aprobaciones mínimo**

  3      Maestros, catálogo, impuestos (capas     Catálogo, precios e
         1-2), precios y Excel                    impuestos configurables

  4      Compras, lotes, inventario,              Kardex y stock confiable
         transferencias, valoración (§10.4)

  5      Cotizaciones, ventas, motor fiscal       Ciclo comercial con
         (capas 3-4), pagos, devoluciones         cálculo fiscal

  6      Cajas, sesiones, arqueos, finanzas       Control de caja
         operativas

  7      Aprobaciones avanzadas (delegación,      Control operativo
         escalamiento), notificaciones            completo
         multicanal, documentos e impresión

  8      Ecommerce, temas, pedidos y pagos        Tienda por tenant

  9      WhatsApp/Facebook/Instagram y bandeja    Omnicanalidad

  10     Cierre mensual, reportes, migración,     Salida productiva
         hardening
  -----------------------------------------------------------------------------

Se recomienda entregar por incrementos verticales. El orden puede
ajustarse con dependencias y priorización comercial, pero RLS, tenant
context, sucursales y auditoría deben existir desde el principio.

------------------------------------------------------------------------

# 28. Pruebas y definición de terminado

## 28.1 Multi-tenant y multisucursal

-   Tenant A nunca lee/escribe datos de tenant B.
-   Usuario de sucursal A no puede operar en sucursal B sin permiso.
-   Administrador autorizado consulta todas las sucursales.
-   Una FK no puede apuntar a entidad de otro tenant.
-   RLS funciona con consultas Prisma, SQL directo del rol de app,
    workers y procesos asíncronos.

## 28.2 Seguridad

-   permisos aplicados en backend;
-   horarios y excepciones;
-   límites de descuentos;
-   segregación solicitante/aprobador;
-   sesiones revocables;
-   secretos cifrados;
-   auditoría de operaciones sensibles.

## 28.3 Inventario

-   concurrencia sin stock negativo accidental;
-   lotes y costo históricos;
-   transferencias con salida/recepción;
-   reversos;
-   reservas y expiración;
-   conciliación de balances contra movimientos.

## 28.4 Ventas y caja

-   modalidades con/sin impuestos;
-   escalas de precio;
-   snapshot de precio y tributos;
-   pagos mixtos/parciales;
-   venta desde cotización;
-   anulación aprobada;
-   arqueo por denominación;
-   diferencias y cierre inmutable;
-   reportes por sucursal y consolidados.

## 28.5 Ecommerce y canales

-   aislamiento de dominios y tiendas;
-   pedidos ligados al tenant;
-   precios y stock de canal;
-   webhooks duplicados idempotentes;
-   credenciales protegidas;
-   conversaciones asignadas correctamente.

## 28.6 Importación/exportación

-   plantillas versionadas;
-   errores por fila;
-   previsualización;
-   confirmación explícita;
-   reintentos;
-   exportación respetando permisos;
-   límites de tamaño y protección contra fórmulas maliciosas en Excel.

------------------------------------------------------------------------

# 29. Riesgos y decisiones pendientes

  -----------------------------------------------------------------------
  Riesgo/decisión                     Tratamiento
  ----------------------------------- -----------------------------------
  RLS y pool de conexiones            Contexto dentro de transacción;
                                      pruebas directas

  Datos de sucursal mal asociados     FK compuestas y validación de
                                      dominio

  Caja compartida                     Deshabilitada por defecto; política
                                      explícita

  Stock negativo                      Deshabilitado por defecto

  Modalidad comercial vs obligación   Separar pricing y tax engine
  fiscal                              

  Impresión desde navegador           Agente local opcional

  WhatsApp/Meta                       APIs oficiales, permisos y
                                      políticas

  Ecommerce y stock multi-sucursal    Reglas de asignación/reserva
                                      configurables

  Anulación y reversos                Workflow + movimientos
                                      compensatorios

  Alcance/cronograma                  Fases, MVP y estimación después de
                                      discovery

  Migración legado incompleta         Perfilado, conciliación y
                                      excepciones documentadas
  -----------------------------------------------------------------------

### Decisiones confirmadas por requerimiento

-   Una empresa puede tener múltiples sucursales.
-   Administración consolidada desde un panel empresarial.
-   Usuarios pueden acceder a sucursales según permisos.
-   Una empresa puede vender con ambas modalidades de precio.
-   Modalidad predeterminada configurable por cliente y seleccionable
    por operación autorizada.
-   Precios escalonados y listas de precios.
-   Lotes y stock por almacén.
-   Múltiples cajas por sucursal, con turnos y arqueos.
-   Roles y permisos dinámicos.
-   Restricciones horarias.
-   Aprobaciones y notificaciones.
-   Cotizaciones integradas a ventas.
-   Ecommerce configurable por tenant.
-   Canales WhatsApp/Facebook/Instagram.
-   Importación/exportación Excel.
-   Configuración de documentos por empresa/sucursal e impresoras por
    usuario/dispositivo.

### Configuraciones que deben permanecer flexibles

-   FIFO/LIFO/promedio.
-   Precio por tramo/progresivo.
-   Selección automática/manual de lote.
-   Política de stock negativo.
-   Caja compartida.
-   Aprobaciones y umbrales.
-   Modalidad de precio por cliente/venta.
-   Métodos de pago.
-   Asignación de pedidos a sucursales.
-   Temas y diseño de ecommerce.
-   Horarios y excepciones.

------------------------------------------------------------------------

# 30. Primer hito técnico obligatorio

Antes de desarrollar módulos comerciales:

1.  crear tenant A y tenant B;
2.  crear dos sucursales para tenant A y una para tenant B;
3.  crear usuarios con acceso global, multi-sucursal y sucursal única;
4.  configurar roles y permisos;
5.  verificar RLS y FKs compuestas;
6.  probar panel consolidado de tenant A;
7.  demostrar que ningún usuario puede leer ni modificar datos de otro
    tenant;
8.  demostrar que usuario limitado a sucursal no puede operar en otra;
9.  verificar que los workers conservan el contexto tenant;
10. documentar pruebas automatizadas.

**Criterio de aceptación:** aislamiento tenant y autorización por
sucursal demostrados mediante pruebas automatizadas antes de construir
compras, inventario o ventas.

------------------------------------------------------------------------

# 31. Primeros pasos de implementación

1.  Validar este documento con el negocio.
2.  Obtener y analizar `DESCRIPCION_SISTEMA.md` y el esquema real de
    Quismar.
3.  Completar matriz de procesos actuales y nuevos.
4.  Elaborar ERD visual y diccionario de datos.
5.  Definir ADR de RLS, contexto tenant/sucursal, pricing/tax,
    inventario y caja.
6.  Crear monorepo y paquetes base.
7.  Implementar TenantContext y BranchContext.
8.  Implementar RLS y pruebas.
9.  Implementar identidad, roles, permisos y horarios.
10. Construir el primer vertical: empresa → sucursales → usuarios →
    permisos → panel consolidado.

No iniciar el desarrollo de todos los módulos a partir de tablas
aisladas sin cerrar antes los procesos críticos, invariantes, estados y
transacciones.

------------------------------------------------------------------------

# 32. Cambios de la versión 2.1

  -----------------------------------------------------------------------
  Tema                                Resolución
  ----------------------------------- -----------------------------------
  Entidades duplicadas                `Sequence` solo en §20.2; `Asset`
                                      reemplaza a `FileAsset`;
                                      `ExchangeRate` solo en §20.2

  Dos modelos fiscales                Ambos implementados, en capas
                                      (§20.8, ADR-002)

  Lote frente a almacén               `Lot` es identidad; la ubicación va
                                      en `StockBalance` (§10.4, ADR-004)

  Valoración FIFO/LIFO/promedio       Capas de costo por lote para
                                      FIFO/LIFO; promedio por almacén y
                                      producto (§10.4)

  Entidades sin definir               Añadidas en §20.14 (SaleDiscount,
                                      ProductVariant, kits, servicios)

  Orden de fases                      Auditoría, outbox y aprobaciones
                                      mínimas en Fases 1-2 (§27.1)

  Estrategia fiscal Bolivia           Nueva §33

  Requisitos no funcionales           Nueva §34

  Riesgos técnicos                    Nueva §35

  Redacción                           Se elimina "Open SaaS" (§4.1)
  -----------------------------------------------------------------------

### 32.1 ADR a redactar en la Fase 0

-   ADR-001: RLS, contexto de tenant y sucursal, pool de conexiones.
-   ADR-002: modelo fiscal en capas y separación precio/impuesto.
-   ADR-003: estrategia fiscal y facturación SIN (§33).
-   ADR-004: lotes, ubicación y valoración.
-   ADR-005: caja, sesiones y política de diferencias.
-   ADR-006: secuencias de documentos y outbox.

No se genera el schema Prisma definitivo hasta cerrar estos ADR.

# 33. Estrategia fiscal para Bolivia

La decisión de implementar o no la facturación electrónica del SIN **no
está tomada** y debe cerrarse en la Fase 0 (ADR-003). Lo que sí queda
fijado desde ya, para no bloquear ninguna de las dos opciones:

1.  Las ventas se modelan con `TaxCalculation` y `FiscalDocument` (§20.8)
    desde la Fase 5, aunque `FiscalDocument` no tenga emisor activo.
2.  El emisor fiscal se implementa como adaptador en
    `packages/integrations`, tras una interfaz común (emitir, anular,
    consultar estado, reintentar).
3.  Una venta confirmada puede quedar con estado fiscal
    `NOT_REQUIRED | PENDING | ISSUED | REJECTED | VOIDED`, independiente
    del estado comercial y del estado de pago.
4.  Anular una venta con documento fiscal emitido exige la anulación
    fiscal correspondiente, con su propio flujo de aprobación.
5.  Hasta que exista un emisor validado, ningún documento se presenta
    como factura oficial (§6.3 y §20.8).
6.  Las reglas de la normativa vigente (tributos, tasas, modalidad de
    emisión, contingencia) se validan con el responsable fiscal del
    negocio y no se asumen en este documento.

Decisiones que necesitan respuesta del negocio:

-   ¿El ERP emite factura electrónica o se integra con un facturador
    externo?
-   ¿Qué modalidades de emisión y contingencia deben soportarse?
-   ¿Qué tributos y perfiles iniciales se cargan como seed?
-   ¿Se requiere libro de ventas y de compras?

# 34. Requisitos no funcionales (a completar en la Fase 0)

Valores propuestos como punto de partida; deben validarse con el
negocio.

  -----------------------------------------------------------------------
  Aspecto                  Propuesta inicial
  ------------------------ ----------------------------------------------
  Tenants esperados        A definir (propuesta: 50 al primer año)

  Usuarios concurrentes    A definir por tenant (propuesta: 20-50)

  Ventas por tenant/día    A definir (propuesta: hasta 2.000)

  Latencia de confirmar    p95 menor a 500 ms, sin contar la emisión
  venta                    fiscal

  Latencia de consultas    p95 menor a 1 s con filtros indexados;
                           reportes pesados en segundo plano

  Disponibilidad           99,5 % mensual como objetivo inicial

  RPO / RTO                RPO 15 min con PITR; RTO 4 h

  Retención de auditoría   A definir según normativa aplicable

  Tamaño de importación    Límite configurable por plan (propuesta:
  Excel                    50.000 filas por archivo)

  Pruebas de carga         Escenarios de venta concurrente sobre un lote
                           y de cierre de caja antes de producción
  -----------------------------------------------------------------------

# 35. Riesgos técnicos y decisiones de implementación

## 35.1 Spike obligatorio en la Fase 0: Prisma, RLS y FKs compuestas

Antes de congelar el schema se construye un prototipo que demuestre:

-   FKs compuestas `(tenant_id, id)` con columnas nullable.
-   RLS con `FORCE` y `set_config('app.tenant_id', ..., true)` dentro de
    una transacción interactiva de Prisma, con pool de conexiones.
-   Migraciones SQL manuales para RLS y constraints que Prisma no
    expresa.
-   Rol de aplicación sin `BYPASSRLS` ejecutando consultas Prisma y SQL
    directo.
-   Costo en rendimiento de abrir una transacción por request.

Si el spike falla, la alternativa es SQL tipado (Kysely) para las rutas
críticas, manteniendo Prisma para el resto.

## 35.2 Otras decisiones

-   **UUID v7:** PostgreSQL 16 no lo genera de forma nativa. Se genera
    en la aplicación (o con extensión) y se documenta en ADR-001.
-   **Secuencias de documentos:** numeración sin huecos mediante
    `SequenceAllocation` y bloqueo por fila. Los números de documentos
    anulados se conservan y no se reutilizan. Se prueba la contención
    bajo concurrencia.
-   **Outbox:** despacho con `FOR UPDATE SKIP LOCKED`, orden por
    agregado, reintentos con backoff, dead-letter y métricas de retraso.
    Los consumidores son idempotentes.
-   **Panel consolidado:** tablas de resumen o vistas materializadas
    actualizadas por eventos (ventas diarias, stock, caja). Las
    consultas del dashboard no recorren tablas transaccionales.
-   **Auditoría:** tabla particionada por mes, append-only; el rol de
    aplicación no tiene `UPDATE` ni `DELETE` sobre ella.
-   **Importación Excel:** plantillas versionadas
    (`ImportTemplateVersion`), límites de filas y tamaño por plan, y
    neutralización de fórmulas al exportar.

**Fin de la planificación maestra v2.1.**
