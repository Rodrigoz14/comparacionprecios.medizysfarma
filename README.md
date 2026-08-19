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

## Base de datos local con Docker

```bash
docker run -d --name medizys-db \
  -e POSTGRES_USER=medizys \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=medizys \
  -p 5432:5432 postgres:16
```

Esto coincide con el `DATABASE_URL` por defecto de `.env.example`.

## Ejecutar en desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Base de datos (Prisma)

```bash
npx prisma generate      # genera el cliente a partir de prisma/schema.prisma
npx prisma migrate dev   # crea/aplica migraciones (cuando existan modelos)
npx prisma studio        # explorador visual de datos
```

## Pruebas y verificación

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

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
