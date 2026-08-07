# Oculis Platform

Oculis es una plataforma de monitoreo legislativo y regulatorio de la República
Dominicana. Recolecta información pública del Congreso, organismos reguladores y medios,
la normaliza en PostgreSQL y la presenta en una aplicación web para seguimiento diario,
consulta histórica y auditoría de movimientos publicados.

Oculis opera en modo **exclusivamente factual**: conserva lo publicado por la fuente y
su procedencia, pero no predice probabilidades de aprobación, no calcula riesgo, no
clasifica temas por cuenta propia y no deduce estados legislativos. Un dato ausente
permanece como `null` y se presenta como «No informado». La regla completa está en
[`FACTUAL_DATA_POLICY.md`](./FACTUAL_DATA_POLICY.md).

El resumen operativo para transferencia al equipo técnico está en
[`HANDOFF.md`](./HANDOFF.md).

El repositorio es un monorepo npm. La recolección y la interfaz son procesos separados:
la web **lee** la base de datos y el worker **ingiere y actualiza** los datos. En la nube,
GitHub Actions ejecuta el worker y una base PostgreSQL administrada, como Neon, conserva
la información entre ejecuciones.

## Arquitectura

```mermaid
flowchart LR
  Sources[Fuentes públicas] --> Scrapers[packages/scrapers]
  Scrapers --> Worker[apps/worker]
  Core[packages/core] --> Worker
  Worker --> DB[(PostgreSQL / Neon)]
  DBPackage[packages/db] --> Worker
  DBPackage --> Web[apps/web]
  DB --> Web
  Actions[GitHub Actions] --> Worker
  User[Usuario] --> Web
```

| Ruta                | Responsabilidad                                                     |
| ------------------- | ------------------------------------------------------------------- |
| `apps/web`          | Next.js 16 y React 19; páginas, componentes y rutas API de lectura. |
| `apps/worker`       | CLI de ingesta factual y actualización programada.                  |
| `packages/core`     | Tipos de dominio y utilidades que preservan valores de fuente.      |
| `packages/db`       | Esquema Drizzle, clientes PostgreSQL/PGlite y repositorios.         |
| `packages/scrapers` | Adaptadores para fuentes legislativas, regulatorias y de noticias.  |
| `.github/workflows` | CI y recolección periódica en la nube.                              |

## Requisitos

- Node.js `>=20.9.0`; Node 22 LTS es la versión usada por CI.
- npm y acceso a las fuentes públicas para ejecutar ingestas.
- PostgreSQL para un entorno compartido o persistente. PGlite sirve para desarrollo y CI.

## Configuración local

1. Instala las dependencias desde la raíz:

   ```bash
   npm ci
   ```

2. Crea la configuración privada del worker:

   ```bash
   cp .env.example .env
   ```

3. Elige una base de datos:

   - PostgreSQL: reemplaza `DATABASE_URL` por una URL válida.
   - PGlite: comenta `DATABASE_URL`, activa `DB_DRIVER=pglite` y configura
     `PGLITE_DIR` con una ruta **absoluta**. Una ruta absoluta evita que la web y el
     worker creen bases distintas al ejecutarse desde workspaces diferentes.

4. Para que Next.js reciba la misma configuración, crea `apps/web/.env.local` con las
   variables que necesita la web. No enlaces ni publiques estos archivos.

   ```dotenv
   DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
   PG_POOL_MAX=5
   OCULIS_DB_APP_NAME=oculis-web-local
   NEXT_PUBLIC_MAPBOX_TOKEN=
   ```

   Para PGlite local, usa en su lugar `DB_DRIVER=pglite` y el mismo `PGLITE_DIR`
   absoluto definido en `.env`.

5. Inicializa datos y abre la aplicación:

   ```bash
   npm run ingest:demo -w @oculis/worker
   npm run dev
   ```

   La web queda disponible en [http://localhost:3000](http://localhost:3000).

> PGlite en memoria desaparece al terminar el proceso. Para ver en la web los datos
> escritos por el worker, usa PostgreSQL o un `PGLITE_DIR` persistente compartido.

## Variables de entorno

| Variable                   | Requerida               | Uso                                                                              |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`             | Sí en nube              | Conexión PostgreSQL/Neon. Debe mantenerse secreta y usar TLS.                    |
| `DB_DRIVER`                | Solo PGlite intencional | Define `pglite`; evita el fallback accidental en producción.                     |
| `PGLITE_DIR`               | Para PGlite persistente | Directorio absoluto de la base embebida.                                         |
| `PG_POOL_MAX`              | No                      | Máximo de conexiones por proceso; valor recomendado para Neon Free: `5` o menos. |
| `OCULIS_DB_APP_NAME`       | No                      | Nombre del proceso visible en PostgreSQL.                                        |
| `OCULIS_AUTO_MIGRATE`      | No                      | `1` permite bootstrap DDL desde la web; evitarlo normalmente en producción.      |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | No                      | Habilita el mapa. Es público por diseño; restríngelo por dominio en Mapbox.      |
| `X_BEARER_TOKEN`           | No                      | Feed de X; requiere acceso compatible a la API de X.                             |

Consulta [`.env.example`](./.env.example) para una plantilla sin credenciales reales.

## Comandos principales

| Comando                                            | Descripción                                                |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                                      | Inicia la web en el puerto 3000.                           |
| `npm run build`                                    | Compila los workspaces que exponen un script de build.     |
| `npm run lint`                                     | Ejecuta ESLint en el monorepo.                             |
| `npm run typecheck`                                | Ejecuta TypeScript en todos los workspaces.                |
| `npm test`                                         | Ejecuta las pruebas disponibles de todos los workspaces.   |
| `npm run daily`                                    | Actividad, depósitos y feed del ciclo diario.              |
| `npm run crawl:full -w @oculis/worker`             | Corpus completo de la Cámara, con detalle e historiales.   |
| `npm run crawl:corpus -w @oculis/worker`           | Corpus completo de la Cámara sin enriquecimiento opcional. |
| `npm run senate:corpus -w @oculis/worker`          | Colección legislativa configurada del Senado.              |
| `npm run roster -w @oculis/worker`                 | Legisladores y membresías de comisiones.                   |
| `npm run activity -w @oculis/worker`               | Actividad de comisiones y plenos.                          |
| `npm run movements -w @oculis/worker`              | Historiales de estado publicados por el SIL oficial.       |
| `npm run publications -w @oculis/worker`           | Publicaciones oficiales del Congreso; PDF recientes.       |
| `npm run publications -w @oculis/worker -- --full` | Barrido documental completo programado.                    |
| `npm run feed -w @oculis/worker`                   | Noticias, fuentes oficiales y señales legislativas.        |
| `npm run seed-accounts -w @oculis/worker`          | Actualiza el directorio de cuentas con evidencia.          |
| `npm run check:factual`                            | Impide reintroducir inferencias o scoring en el runtime.   |

Opciones adicionales del worker se pasan después de `--`; por ejemplo:

```bash
npm run ingest -w @oculis/worker -- --limit 100 --enrich --delay 150
npm run ingest -w @oculis/worker -- --regulatory
npm run ingest -w @oculis/worker -- --documents --limit 200
```

## Cobertura, procedencia y actualidad

El catálogo canónico vive en `packages/scrapers/src/sources.ts`. La página
`/estado-fuentes` combina ese registro con `ingestion_runs` y muestra, para cada proceso,
la cobertura declarada, URL, cadencia, última ejecución completa, última observación con
filas, conteos y error literal. Una fuente que nunca corrió, una corrida parcial, una
corrida fallida, una ejecución completa con cero filas y una cobertura todavía no
implementada son estados distintos.

| Cobertura activa                                             | Fuente                       | Cadencia programada                                      |
| ------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------- |
| Agendas de comisiones y orden del Pleno                      | Cámara de Diputados          | Tres veces al día                                        |
| Agendas del Pleno/Asamblea y comisiones                      | Senado                       | Tres veces al día                                        |
| Depósitos recientes de ambas cámaras                         | SIL de cada cámara           | Tres veces al día                                        |
| Corpus perimido y no perimido de la Cámara                   | SIL Cámara                   | Incremental diario; completo semanal y en bootstrap      |
| Historiales oficiales de PDL de la Cámara                    | SIL Cámara                   | Semanal                                                  |
| Colección legislativa configurada del Senado                 | SIL Senado                   | Semanal                                                  |
| Documentos oficiales vinculados a PDL                        | SIL Cámara                   | 500 recientes al día; barrido completo semanal/bootstrap |
| Colecciones documentales y códigos exactos publicados        | Cámara y Senado              | Catálogo diario; PDF recientes diarios y barrido semanal |
| Congresistas y membresías explícitas de comisiones           | Ambas cámaras                | Semanal                                                  |
| Publicaciones regulatorias y consultas públicas              | Seis instituciones           | Diario                                                   |
| Noticias oficiales y señales derivadas de hechos almacenados | Congreso y fuentes enlazadas | Tres veces al día                                        |

«Tres veces al día» no significa transmisión instantánea: la interfaz enseña cuándo se
observó cada dato. Los estados solo cambian cuando un campo oficial cambia expresamente;
una agenda o la existencia de un PDF no se convierten en un estado legislativo.

La recolección documental activa incluye la orden del día conocida por el Pleno de la
Cámara y, en el Senado, iniciativas aprobadas, proyectos perimidos, asistencia a
comisiones, informes para lectura y la página de votaciones electrónicas. Esta última se
registra actualmente con el mensaje vacío literal publicado por el Senado; un conteo cero
no se convierte en «no hubo votaciones». Los PDF de asistencia exponen fechas de reunión,
pero Oculis no deduce asistencia individual de tablas cuya extracción pierde columnas.
Los códigos extraídos que todavía no identifican un único PDL quedan visibles como enlaces
no resueltos y la corrida se marca parcial; nunca se enlazan por similitud ni se ocultan como
si la reconciliación hubiera sido completa. Cada documento conserva categoría, fechas de
carga/modificación, primera y última observación, metadatos `raw` y el fragmento literal que
originó un código cuando el PDF lo permite.

El registro mantiene como `KNOWN_GAP` la página de «iniciativas aprobadas» de la Cámara,
porque actualmente solo publica dos PDF antiguos titulados como iniciativas priorizadas
(2016 y 2017); priorización no equivale a aprobación. También siguen pendientes las actas,
debates y asistencia a sesiones de la Cámara y las actas de sesiones del Senado. Estos
vacíos se muestran como cobertura pendiente, no como fuente fallida ni como ausencia de
actividad.

## Nube sin costo: Neon + GitHub Actions

La configuración incluida usa PostgreSQL administrado y GitHub Actions:

1. Crea una base PostgreSQL en el plan gratuito de Neon y copia su URL con TLS. Usa el
   endpoint con pooler cuando esté disponible.
2. En GitHub abre **Settings → Secrets and variables → Actions** y crea el secreto
   `DATABASE_URL`. Nunca guardes la URL en el repositorio ni en logs.
3. Abre **Actions → Cloud data ingestion → Run workflow** y ejecuta una vez el modo
   `bootstrap`. Este carga iniciativas, roster, fuentes regulatorias, actividad y feed.
4. Revisa que la ejecución finalice correctamente y que las tablas reciban filas antes de
   desplegar la web.
5. Configura `DATABASE_URL` como secreto del servicio donde se despliegue la web. Mantén
   `OCULIS_AUTO_MIGRATE=0`; el worker/bootstrap prepara el esquema.

El workflow `cloud-ingestion.yml` separa las fuentes por cadencia:

- Actividad, depósitos y feed: `06:15`, `14:15` y `22:15` en Santo Domingo.
- Mantenimiento incremental del corpus, fuentes regulatorias y una porción reciente de
  publicaciones oficiales: `02:45` cada día.
- Roster de ambas cámaras: lunes a las `03:30`.
- Corpus completo e historiales oficiales de la Cámara, corpus del Senado, documentos y
  colecciones oficiales completas: domingo a las `04:15`.

GitHub puede retrasar ligeramente los cron durante periodos de alta demanda. El grupo de
concurrencia impide dos ingestas simultáneas, pero no cancela una ingesta ya iniciada.

El workflow de CI es independiente: usa Node 22, instala con `npm ci`, ejecuta lint,
typecheck, pruebas y build. El build usa una base PGlite efímera bajo `.next-ci`; nunca
conecta la CI a la base productiva.

## Operación

- Consulta el historial de **GitHub Actions** después de cambios en scrapers o esquema.
- La tabla `ingestion_runs` registra por fuente el último resultado, cantidad observada y
  errores. Un workflow verde no garantiza que todas las fuentes tengan datos: revisa
  también advertencias, conteos anómalos y fuentes con cero resultados.
- Ejecuta `bootstrap` solamente para inicialización o recuperación controlada. Los modos
  manuales `daily`, `maintenance`, `roster`, `movements`, `publications`, `senate-corpus`
  y `documents` permiten repetir cada cobertura por separado.
- Las páginas públicas pueden cambiar HTML, imponer CAPTCHA o quedar temporalmente fuera
  de servicio. Trata una caída aislada como degradación de una fuente, no como motivo para
  borrar datos históricos.
- Mantén el pool pequeño en planes gratuitos y vigila almacenamiento, horas de cómputo y
  conexiones desde el panel del proveedor.

## Cambios de esquema

El esquema fuente vive en `packages/db/src/schema.ts` y las migraciones versionadas en
`packages/db/drizzle`. Después de modificar el esquema, genera y revisa el SQL con:

```bash
npm run generate -w @oculis/db
```

No apliques automáticamente la migración inicial sobre una base que ya fue creada por el
bootstrap DDL: primero debes registrar esa base como _baseline_. Para instalaciones nuevas,
las migraciones constituyen la historia canónica; `OCULIS_AUTO_MIGRATE=1` queda reservado
para desarrollo, CI o recuperación controlada.

## Seguridad

- La aplicación no incluye todavía autenticación de usuarios ni separación por cliente.
  Trátala como un producto de datos públicos; no cargues notas confidenciales ni la
  expongas como portal privado hasta integrar OIDC/sesiones y autorización server-side.
- No confirmes `.env`, `.env.local`, URLs de base de datos, tokens ni archivos descargados
  con cookies. Los patrones sensibles ya están incluidos en `.gitignore`.
- Usa secretos de GitHub y variables cifradas del proveedor de hosting. Rota cualquier
  credencial que aparezca en terminal, captura, issue o commit.
- `X_BEARER_TOKEN` es opcional y puede depender de un plan pagado. Su ausencia se
  registra como una limitación de esa fuente y no afecta las fuentes oficiales.
- Restringe el token público de Mapbox a los dominios de Oculis y a las APIs necesarias.
- Considera los textos, URLs, imágenes y HTML provenientes de scrapers como datos no
  confiables: valida, limita y escapa antes de presentarlos.
- Para despliegues maduros, separa el rol PostgreSQL de lectura de la web del rol de
  escritura del worker y ejecuta cambios de esquema en un paso de despliegue controlado.

## Solución de problemas

### Safari o Chrome no conecta a `localhost:3000`

La aplicación no está corriendo. Desde la raíz ejecuta `npm run dev`, espera el mensaje de
Next.js y vuelve a abrir la URL. Si el puerto está ocupado, identifica primero el proceso
existente antes de iniciar otra instancia.

### La web abre, pero no muestra datos

Confirma que web y worker usan la misma `DATABASE_URL` o el mismo `PGLITE_DIR` absoluto.
Después ejecuta una ingesta de prueba. Un worker con PGlite en memoria no comparte datos
con otro proceso y los pierde al terminar.

### `DATABASE_URL is required in production`

Configura el secreto en el entorno productivo. Usa `DB_DRIVER=pglite` únicamente para una
ejecución embebida intencional, como el build aislado de CI.

### El build local intenta consultar tablas inexistentes

Para un build aislado sin PostgreSQL, crea una base PGlite desechable y autoriza su
bootstrap explícitamente:

```bash
DB_DRIVER=pglite \
PGLITE_DIR="$(pwd)/.next-ci/pglite" \
OCULIS_AUTO_MIGRATE=1 \
npm run build
```

### Neon reporta demasiadas conexiones

Usa la URL con pooler, reduce `PG_POOL_MAX`, evita múltiples servidores locales y verifica
que no haya workflows manuales antiguos ejecutándose. No publiques la URL al solicitar
soporte.

### Una fuente devuelve cero elementos

Revisa el detalle de la corrida y `ingestion_runs`. Puede ser una ausencia real, una caída
temporal, CAPTCHA o un selector desactualizado. No interpretes automáticamente un cero como
éxito ni borres el último snapshot válido.

### No aparecen publicaciones de X o el mapa

El feed de X requiere `X_BEARER_TOKEN`; sin él, la plataforma conserva el directorio de
cuentas, pero no descarga publicaciones. El mapa requiere `NEXT_PUBLIC_MAPBOX_TOKEN` y una
restricción de dominio que incluya el host actual.

## Contribución

Antes de abrir un pull request ejecuta:

```bash
npm run check:factual
npm run lint
npm run typecheck
npm test
DB_DRIVER=pglite PGLITE_DIR="$(pwd)/.next-ci/pglite" OCULIS_AUTO_MIGRATE=1 npm run build
```

Mantén cambios de scraping, datos, UI e infraestructura en commits distinguibles; documenta
fuentes nuevas y añade pruebas para parsers y normalizadores siempre que sea posible.
