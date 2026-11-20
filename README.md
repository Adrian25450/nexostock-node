# NexoStock · Inventory Operations Suite

Aplicación de operaciones para pequeñas bodegas. Centraliza existencias, alertas de reposición, proveedores y trazabilidad de entradas/salidas en un panel claro.

## Funcionalidades

- Dashboard con valor total, referencias activas, unidades y alertas de reposición.
- Catálogo con búsqueda, categorías, SKU, proveedor y stock mínimo.
- Alta, edición y archivado de productos con validación en el servidor.
- Registro transaccional de entradas y salidas; bloquea egresos superiores al stock disponible.
- Historial auditable de movimientos con usuario y motivo.
- Filtros de inventario y exportación CSV para informes.
- Autenticación con sesiones persistentes, hash bcrypt y roles `ADMIN`, `OPERADOR`, `LECTOR`.
- Diseño responsive y navegación de una sola página.

## Tecnologías

Node.js 20+, Express, Prisma ORM, SQLite, bcryptjs, express-session, connect-sqlite3 y Helmet.

## Inicio local

```bash
npm install
copy .env.example .env   # PowerShell / CMD
npm run db:push
npm run seed
npm run dev
```

Abre `http://localhost:3000`.

**Cuenta demostrativa:** `admin@nexostock.local` · **Contraseña:** `NexoDemo2026!`

La cuenta es solo para pruebas locales. Cambia `SESSION_SECRET`, no uses contraseñas reales y no expongas esta demo a internet.

## Estructura

```text
prisma/schema.prisma  modelos de usuarios, productos, proveedores y movimientos
prisma/seed.js        catálogo y movimientos ficticios para recorrer el panel
src/app.js            sesión, API REST, validaciones y reglas de inventario
public/               interfaz web responsive
```

## Reglas y seguridad implementadas

- Las contraseñas se almacenan con bcrypt; nunca se guardan en texto claro.
- Las rutas API requieren sesión y respetan permisos por rol.
- Las cookies son `httpOnly` y `sameSite=lax`; en producción activan `secure`.
- Las acciones de escritura llevan límite de frecuencia.
- El inventario se ajusta dentro de una transacción junto con su movimiento de auditoría.
- Se rechazan cantidades negativas, identificadores inválidos, duplicados de SKU y salidas que dejarían stock negativo.
- El borrado del catálogo es lógico: conserva el historial de movimientos.

## CV

> Desarrollé NexoStock, una aplicación full-stack de inventario con Node.js y Express, Prisma y SQLite; implementé catálogo y proveedores, roles de acceso, registro transaccional de movimientos, alertas de stock y exportación CSV.

## Alcance

Proyecto de portafolio con información ficticia y ejecución local. Una puesta en producción requiere HTTPS, gestión segura de secretos, copias de respaldo, recuperación de cuenta, revisión de configuración, pruebas de seguridad y base de datos administrada.

