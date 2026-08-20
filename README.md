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
npx prisma db push       # aplica el esquema directamente (recomendado con `prisma dev`)
npx prisma migrate dev   # crea/aplica migraciones con historial (requiere una shadow DB sana)
npx prisma db seed       # inserta datos de prueba (proveedores, laboratorios, productos, ofertas, sinónimos)
npx prisma studio        # explorador visual de datos
```

> La shadow database que usa `migrate dev` para validar cambios no siempre es
> fiable con el Postgres embebido de `prisma dev` en este entorno. Si falla,
> usa `prisma db push` para aplicar el esquema y genera el SQL de la migración
> aparte con `prisma migrate diff --from-config-datasource prisma.config.ts
> --to-schema prisma/schema.prisma --script`, guardándolo a mano en
> `prisma/migrations/<timestamp>_<nombre>/migration.sql`.

## Pruebas y verificación

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Los tests de integración comparten una sola base de datos de desarrollo, así
que Vitest los ejecuta con los archivos en secuencia (`fileParallelism:
false` en `vitest.config.ts`) para evitar agotar el pool de conexiones.

## Importar listas de proveedores

En `/proveedores/importar` puedes subir un archivo `.xlsx` o `.csv` de un
proveedor: el sistema detecta encabezados y columnas, propone un mapeo y un
formato de precio (editable), muestra una vista previa y, al confirmar,
guarda las ofertas, mantiene el historial de precios y evita reprocesar el
mismo archivo por accidente (detección por hash).

Notas:

- Soporta `.xlsx`, `.xlsm` (Excel con macros) y `.csv`. El formato `.xls` antiguo (Excel 97-2003) no está soportado; expórtalo como `.xlsx`.
- Si la presentación viene en su propia columna (p. ej. "CAJA X 10 AMPOLLAS X 3ML"), mapéala al campo "Presentación": se combina con el nombre del producto para extraer la cantidad. Igual con "Forma farmacéutica" si el proveedor la reporta aparte — es más confiable que adivinarla del nombre.
- Cada fila requiere una concentración y una presentación reconocibles en el
  nombre del producto (p. ej. "500MG" y "X100"); si no se pueden determinar,
  la fila se reporta como error en vez de adivinar.
- Los archivos originales se guardan en `storage/` (no se sube a git).

## Homologación de productos

`lib/matching` resuelve a qué producto del catálogo corresponde un texto libre
(la descripción de un proveedor o lo que escribe un cliente): normaliza el
texto, extrae atributos, busca candidatos por principio activo (incluyendo
sinónimos controlados en `IngredientSynonym`, p. ej. paracetamol =
acetaminofén), compara atributos estructurados y decide `MATCH` / `REVIEW` /
`NO_MATCH`. La IA solo se usa para desempatar entre candidatos ya acotados por
reglas determinísticas (`POST /api/matching/resolve` para probarlo
manualmente) — nunca decide sola, y su respuesta se valida antes de aceptarla.

Ni el laboratorio ni la presentación son criterio de homologación ni de
selección: un mismo genérico ofrecido por distintos laboratorios o en
presentaciones distintas (caja x30 vs x100) son productos distintos en la
base de datos (`Product.normalizedName` los distingue), pero comparten
`Product.genericKey` para que el motor de precios los compare por precio
unitario y se quede con el más barato (ver "Comparar precios" abajo). Cuando
un cliente escribe su pedido no hace falta indicar presentación (solo
cantidad, en un campo aparte); al importar un archivo de proveedor sí es
obligatoria, porque ahí sí es un dato real necesario para calcular el precio
por unidad.

Los proveedores no siempre escriben el ingrediente activo en el mismo orden
(p. ej. Ramédicas usa "VALPROICO ACIDO" alfabetizado, Disfarma "ACIDO
VALPROICO"): `Product.ingredientKey` guarda las palabras del ingrediente
ordenadas alfabéticamente para que ambas formas se traten como el mismo
principio activo, tanto en la búsqueda como en la comparación de precios
entre proveedores.

## Comparar precios para un cliente

En `/solicitudes/nueva` escribes el nombre del cliente y los productos que
pide (texto libre + cantidad). Por cada línea, el sistema homologa el
producto (Sección 5) y, si lo encuentra, compara todas las ofertas del mismo
genérico entre proveedores — de cualquier laboratorio — y selecciona la más
barata que tenga disponibilidad suficiente (`lib/pricing`). Muestra el
proveedor ganador, el total, las alternativas descartadas y por qué, y el
ahorro estimado frente a la oferta más cara. Cada comparación queda guardada
en `PriceComparison` para poder auditarla después.

Los cálculos (totales, ahorro) siempre los hace el backend con aritmética
simple — nunca la IA (Sección 6.32).

## Autenticación

La aplicación entera requiere sesión (páginas y API). Sesión con cookie
httpOnly firmada (JWT vía `jose`), sin librería externa de auth. `proxy.ts`
hace un chequeo optimista (redirige a `/login` si no hay cookie) y cada
página/ruta de API vuelve a verificar la sesión de verdad
(`lib/auth/dal.ts`) — la redirección del proxy no es la única protección.

El primer usuario (ADMIN) se crea en el seed (`npx prisma db seed`), que
imprime el correo y una contraseña temporal una sola vez. Por ahora no hay
pantalla para crear usuarios adicionales — se hace directamente en la base
de datos (`role`: `ADMIN`, `COMPRAS` o `CONSULTA`).

`AUTH_SECRET` es obligatorio (ver `.env.example` para generarlo) y debe ser
distinto en cada entorno — nunca reutilices el de desarrollo en producción.

## Estructura del proyecto

```text
app/            Páginas y rutas (App Router)
components/     Componentes de UI reutilizables
lib/db/         Cliente de Prisma
lib/auth/       Sesión (JWT en cookie), contraseñas y verificación de acceso
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
