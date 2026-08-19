# Medizys Procurement AI

Plataforma privada de Medizys Farma para automatizar la comparación de precios
de proveedores farmacéuticos y la generación de cotizaciones y órdenes de
compra.

## Stack

- Next.js 16 (App Router) + TypeScript
- PostgreSQL + Prisma 7
- Tailwind CSS
- Zod
- Vitest

## Requisitos

- Node.js 22+ y npm
- PostgreSQL accesible localmente (por ejemplo, vía Docker)

## Instalación

```bash
npm install
cp .env.example .env
```

Completa `DATABASE_URL` en `.env` con la conexión a tu base de datos local.
El resto de variables (`CLAUDE_API_KEY`, `OPENAI_API_KEY`, etc.) solo son
necesarias a partir de las fases que integran IA y correo electrónico.

## Base de datos local

Este proyecto usa el servidor de desarrollo integrado de Prisma (no requiere
Docker):

```bash
npx prisma dev -d -n medizys   # levanta Postgres local en segundo plano
npx prisma dev ls              # muestra la URL de conexión real (el puerto varía)
```

Copia la URL "TCP" que muestre `prisma dev ls` a `DATABASE_URL` en tu `.env`.
La base de datos `medizys` debe existir antes de migrar (créala una vez con
cualquier cliente de Postgres apuntando al servidor que expone `prisma dev`).

Alternativamente, si tienes Docker Desktop funcionando:

```bash
docker run -d --name medizys-db \
  -e POSTGRES_USER=medizys \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=medizys \
  -p 5432:5432 postgres:16
```

y usa `DATABASE_URL="postgresql://medizys:devpass@localhost:5432/medizys?schema=public"`.

## Ejecutar en desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Base de datos (Prisma)

```bash
npx prisma generate      # genera el cliente a partir de prisma/schema.prisma
npx prisma migrate dev   # crea/aplica migraciones
npx prisma db seed       # inserta datos de prueba (proveedor, laboratorio, producto, oferta)
npx prisma studio        # explorador visual de datos
```

## Pruebas y verificación

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Importar listas de proveedores

En `/proveedores/importar` puedes subir un archivo `.xlsx` o `.csv` de un
proveedor: el sistema detecta encabezados y columnas, propone un mapeo y un
formato de precio (editable), muestra una vista previa y, al confirmar,
guarda las ofertas, mantiene el historial de precios y evita reprocesar el
mismo archivo por accidente (detección por hash).

Notas:

- El formato `.xls` antiguo (Excel 97-2003) no está soportado; expórtalo como `.xlsx`.
- Cada fila requiere una concentración y una presentación reconocibles en el
  nombre del producto (p. ej. "500MG" y "X100"); si no se pueden determinar,
  la fila se reporta como error en vez de adivinar.
- Los archivos originales se guardan en `storage/` (no se sube a git).

## Estructura del proyecto

```text
app/            Páginas y rutas (App Router)
components/     Componentes de UI reutilizables
lib/db/         Cliente de Prisma
lib/ai/         Abstracción de proveedores de IA (Claude / OpenAI)
lib/excel/      Importación y normalización de listas de proveedores
lib/matching/   Homologación inteligente de productos
lib/pricing/    Motor de comparación y selección de ofertas
lib/orders/     Generación de órdenes de compra
lib/email/      Integración con correo electrónico (fase posterior)
prisma/         Esquema y migraciones de la base de datos
types/          Tipos TypeScript compartidos
tests/          Pruebas automatizadas
```

Cada módulo de `lib/` se construye en su propia fase; los que aún no tienen
código incluyen un `README.md` describiendo su alcance futuro.
