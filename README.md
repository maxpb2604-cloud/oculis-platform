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
| `apps/web`          | Next.js 15 y React 19; páginas, componentes y rutas API de lectura. |
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
> El directorio PGlite es **de un solo proceso**: detén `npm run dev` antes de ejecutar
> una ingesta y vuelve a iniciar la web al terminar. Oculis aplica un lock de proceso y
> rechazará una segunda apertura para proteger el archivo. Usa PostgreSQL cuando la web
> y el worker deban permanecer activos al mismo tiempo.

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

| Comando                                                 | Descripción                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `npm run dev`                                           | Inicia la web en el puerto 3000.                              |
| `npm run build`                                         | Compila los workspaces que exponen un script de build.        |
| `npm run lint`                                          | Ejecuta ESLint en el monorepo.                                |
| `npm run typecheck`                                     | Ejecuta TypeScript en todos los workspaces.                   |
| `npm test`                                              | Ejecuta las pruebas disponibles de todos los workspaces.      |
| `npm run daily`                                         | Actividad, depósitos, Fichas recientes y feed diario.         |
| `npm run crawl:full -w @oculis/worker`                  | Corpus completo de la Cámara, con detalle e historiales.      |
| `npm run crawl:corpus -w @oculis/worker`                | Corpus completo de la Cámara sin enriquecimiento opcional.    |
| `npm run senate:corpus -w @oculis/worker`               | Colección legislativa configurada del Senado.                 |
| `npm run senate:fichas -w @oculis/worker`               | Fichas oficiales del Senado para la ventana reciente.         |
| `npm run senate:fichas:full -w @oculis/worker`          | Enriquecimiento largo de las 2,655 fichas configuradas.       |
| `npm run link:initiative-proponents -w @oculis/worker`  | Vincula proponentes y perfiles con identidad oficial exacta.  |
| `npm run roster -w @oculis/worker`                      | Legisladores y membresías de comisiones.                      |
| `npm run activity -w @oculis/worker`                    | Actividad de comisiones y plenos.                             |
| `npm run movements -w @oculis/worker`                   | Historiales de estado publicados por el SIL oficial.          |
| `npm run movements:incremental -w @oculis/worker`       | Detecta cambios de historial en los índices de ambas cámaras. |
| `npm run publications -w @oculis/worker`                | Publicaciones oficiales del Congreso; PDF recientes.          |
| `npm run publications -w @oculis/worker -- --full`      | Barrido documental completo programado.                       |
| `npm run feed -w @oculis/worker`                        | Noticias, fuentes oficiales y señales legislativas.           |
| `npm run seed-accounts -w @oculis/worker`               | Actualiza el directorio de cuentas con evidencia.             |
| `npm run verify-documents -w @oculis/worker`            | Verifica los PDF oficiales depositados y su disponibilidad.   |
| `npm run translate-initiative-titles -w @oculis/worker` | Traduce títulos ES→EN localmente y fuera de la ingesta.       |
| `npm run check:factual`                                 | Impide reintroducir inferencias o scoring en el runtime.      |

Opciones adicionales del worker se pasan después de `--`; por ejemplo:

```bash
npm run ingest -w @oculis/worker -- --limit 100 --enrich --delay 150
npm run ingest -w @oculis/worker -- --regulatory
npm run ingest -w @oculis/worker -- --documents --limit 200
```

El enriquecimiento de fichas del Senado es deliberadamente un modo separado: autentica el
consultor público del SIL, procesa lotes de hasta 100 expedientes (50 por defecto), verifica
que cada ficha corresponda al código listado y conserva fallos por expediente. Para una
prueba acotada antes del barrido largo, usa
`npm run senate:fichas:full -w @oculis/worker -- --limit 50`; el comando es idempotente y se
puede repetir. Para reanudar un corpus largo sin volver a solicitar fichas ya verificadas y
darle descanso al servidor oficial entre lotes, usa por ejemplo:

```bash
npm run senate:fichas:full -w @oculis/worker -- \
  --resume --batch-size 20 --delay 300 --batch-cooldown 3000 --batch-timeout 600000
```

Si un lote completo falla, el circuito se abre y la corrida termina como parcial, dejando
los expedientes restantes pendientes para otra ejecución con `--resume`; no se martilla la
fuente con miles de reintentos. No ejecutes simultáneamente otro proceso sobre el mismo
`PGLITE_DIR`.

### Vinculación de iniciativas con congresistas

Después de aplicar la migración que crea `initiative_proponents`, detén la web si comparte
el mismo `PGLITE_DIR`. Una instalación o recuperación completa debe respetar este orden:
primero carga ambos corpus, después el roster, luego todas las Fichas oficiales del Senado y,
solo cuando ese barrido reanudable termine, declara la cobertura de la vinculación:

```bash
npm run crawl:full -w @oculis/worker
npm run senate:corpus -w @oculis/worker
npm run roster -w @oculis/worker
npm run senate:fichas:full -w @oculis/worker -- --resume
npm run link:initiative-proponents -w @oculis/worker
```

En la Cámara de Diputados, el proceso usa exclusivamente el `legisladorId` que el SIL publica
junto a cada proponente. En el Senado, compara el nombre completo de la Ficha por igualdad
exacta con el catálogo de personas del propio SIL y luego utiliza un puente editorial
versionado entre el ID de ese catálogo y el perfil oficial del directorio. Los namespaces de
ambas cámaras permanecen separados; no se comparan nombres por similitud, provincia, partido
ni cargo. Un literal desconocido, institucional o ambiguo se conserva como publicado, pero no
se asigna a una persona.

El comando es idempotente. Una colección observada como vacía reemplaza su snapshot por cero
proponentes; una Ficha no observada, un error de fuente o un cambio en el catálogo conserva la
última relación válida y falla de forma visible. Diputados se procesa antes de solicitar el
catálogo del Senado, por lo que una caída de ese servidor no suprime la reconciliación de la
Cámara. La cobertura completa solo se registra cuando no hay límite, no cambia el corpus durante
la corrida, se visitan todos sus candidatos sin fallo y no queda ningún proponente sin identidad
exacta. Una Ficha todavía no observada o un proponente histórico o institucional sin resolver deja
la certificación de ceros como incompleta, nunca como un falso «completo». Esa advertencia no
deshace ni convierte en fallo los vínculos exactos que sí fueron reconciliados correctamente.

El ciclo `daily` vuelve a consultar las Fichas recientes, incluso cuando ya fueron verificadas,
para registrar movimientos oficiales posteriores; también reconcilia relaciones nuevas sin
reemplazar la declaración durable del último barrido completo. `--resume` queda reservado para
un bootstrap o una recuperación operada, no para una corrida recurrente de actualidad. El
`bootstrap` y el barrido semanal automatizan la secuencia
`corpus del Senado → actualización de Fichas completas → vinculación`; una primera
instalación o una base existente debe completar esa secuencia antes de interpretar un cero como
ausencia verificada de iniciativas.

### Traducción local de títulos oficiales

La traducción ES→EN es un comando manual del worker, separado de `daily`, las ingestas, la
web y sus APIs. Usa la versión fijada de `@huggingface/transformers` y el modelo cuantizado
`Xenova/nllb-200-distilled-600M` en la revisión inmutable
`261c31d1a5732c67cdd16d80e8d6088507c7ccea`, con pipeline Oculis `v4`, entrada
`spa_Latn` y salida `eng_Latn`; la inferencia ocurre en el proceso local y no requiere
credenciales. Si los archivos del modelo todavía no están en caché, la primera ejecución
debe descargarlos.
El título español de la fuente nunca se modifica: la traducción se guarda aparte con el
SHA-256 del título fuente exacto, locale y modelo, y deja de mostrarse automáticamente si la
fuente cambia siquiera un carácter.

Las salidas de ese comando son borradores técnicos: por sí solas no aparecen en la web.
Antes de publicar una traducción, un revisor debe comparar el título inglés completo con el
título oficial y persistir la versión aprobada con procedencia
`oculis-editorial-reviewed-en/...`. Las consultas públicas aceptan exclusivamente ese
prefijo editorial; así, un modelo local defectuoso no puede publicar nombres, cifras o
conceptos jurídicos alterados.

El importador editorial exige un archivo JSON con `id`, `code`, `sourceTitle` exacto y
`translatedTitle` por fila. Primero valida todas las filas contra la base actual y vuelve a
aplicar la integridad numérica; solo entonces publica el lote. El actor debe identificarse y
confirmar explícitamente que comparó cada traducción con el título oficial:

```bash
npm run import-reviewed-initiative-titles -w @oculis/worker -- \
  --file /ruta/lote-revisado.json \
  --reviewer "Nombre del revisor" \
  --batch "home-2026-08-28" \
  --confirm-reviewed-against-official-title
```

Detén la web primero si comparte un `PGLITE_DIR` y comienza con un lote acotado:

```bash
npm run translate-initiative-titles -w @oculis/worker -- --limit 25
```

`--home` recorre, en páginas acotadas, las cinco iniciativas depositadas más recientes por
provincia que alimentan HOME. `--initiative-id` admite repeticiones y listas separadas por
comas; ambos modos agotan únicamente su selección explícita. `--all` recorre toda la cola
pendiente con cursor descendente, incluso si un título falla, y `--limit` fija el tamaño de
cada página (25 por defecto, 100 máximo):

```bash
npm run translate-initiative-titles -w @oculis/worker -- --home --limit 25
npm run translate-initiative-titles -w @oculis/worker -- --initiative-id 123,456 --initiative-id 789
npm run translate-initiative-titles -w @oculis/worker -- --all --limit 50
```

El worker rechaza títulos vacíos, demasiado largos o truncados con `...`/`…`, y nunca guarda
una salida vacía, sobredimensionada o con controles invisibles. También protege y restaura
siglas oficiales como `ARS`, `UTECT`, `IDAC` y `PDL`; si el modelo altera o elimina un
marcador, esa traducción falla sin persistirse. La misma protección conserva, con mayúsculas
y acentos exactos, los 32 nombres canónicos de provincias y las variantes de fuente
`Montecristi`, `Bahoruco` y `Santo Domingo de Guzmán`; se aplica a frases completas como
`Distrito Nacional`, pero no al adjetivo aislado `Nacional` ni al uso común en minúsculas
`independencia`. Los títulos completos del Senado escritos
enteramente en mayúsculas siguen siendo traducibles: en ese contexto solo se protegen esas
siglas explícitas y los tokens institucionales alfanuméricos; fechas, montos y demás tokens
puramente numéricos permanecen literales. Los títulos largos se traducen secuencialmente en
fragmentos de hasta 180 caracteres, cortados únicamente entre palabras y preferentemente en
signos de puntuación. Si el modelo duplica o elimina un marcador dentro de un fragmento, el
worker solo lo reintenta dividido en una conjunción coordinante española que separe dos
marcadores; la conjunción y todo el texto se conservan exactamente. Sin ese límite seguro,
el resultado falla en vez de aplicar una división heurística. Antes de persistir, el worker
exige que todos los literales numéricos
aparezcan en el mismo orden y con idénticos dígitos, separadores, moneda y formato; cualquier
omisión, adición, reordenamiento o reformateo rechaza el resultado completo. La única
reparación automática permitida restaura ceros iniciales que el modelo haya quitado de un
entero positivo aislado (`08` → `8` vuelve a `08`) cuando todos los tokens continúan alineados.
También puede consumir únicamente el sufijo ordinal inglés correcto pegado al mismo entero
(`04` → `4th` vuelve a `04`); no se aplica a moneda, signos, decimales, fechas compuestas,
identificadores, sufijos incorrectos ni cambios de valor.

### Verificación factual de PDF depositados

El descubrimiento de documentos y la verificación de sus bytes son procesos distintos. Para
revisar primero las iniciativas que todavía no tienen un PDF depositado registrado, sin
importar cuándo fueron depositadas, ejecuta:

```bash
npm run ingest -w @oculis/worker -- --documents --missing-deposited
```

La asociación se hace únicamente por el ID oficial exacto de la iniciativa en el SIL de la
Cámara de Diputados; nunca por semejanza de título ni por una ventana de fechas. Por eso un
documento publicado hoy puede incorporarse correctamente aunque el proyecto se depositara
hace semanas. `--documents` sin `--missing-deposited` recorre el corpus completo y constituye
el barrido diario, semanal y de recuperación manual.

Una fila del catálogo oficial prueba que la fuente registró metadatos, no que su servidor
ya entregue bytes PDF. Para habilitar únicamente enlaces realmente comprobados, detén la
web si comparte `PGLITE_DIR` y ejecuta un lote acotado:

```bash
npm run verify-documents -w @oculis/worker -- --limit 20
```

El comando aplica el contrato de descarga HTTPS oficial, MIME, magic bytes, hash, extracción
completa y snapshot inmutable. Un éxito queda disponible durante 24 horas; HTML, archivos
vacíos, timeouts y cualquier otro fallo permanecen como metadatos no verificados y nunca
crean un enlace de PDF.

El barrido es descendente y acotado a 20 documentos por defecto (100 máximo). Si llena el
lote imprime un cursor exclusivo; continúa sin solapamiento con:

```bash
npm run verify-documents -w @oculis/worker -- --limit 20 --before-document-id 12345
```

También acepta `--document-id N` para una comprobación/renovación exacta y
`--initiative-id N` para un PDL. Sin cursor, una nueva ejecución comienza por los metadatos
más recientes que todavía no tienen una verificación vigente.

Para la operación completa usa el ciclo durable:

```bash
npm run verify-documents -w @oculis/worker -- --all
```

`--all` fija el ID máximo al empezar, recorre páginas descendentes y guarda en PostgreSQL un
cursor exclusivo después de **cada** documento, incluso cuando la fuente devuelve un fallo
permanente. Si el proceso o su timeout lo interrumpe, el mismo comando reanuda automáticamente
ese ciclo; no combines `--all` con filtros ni con un cursor manual. `--limit N` controla el
tamaño de cada página, no el total del ciclo.

La tarea cloud descubre primero los metadatos faltantes y ejecuta este modo al final de cada
ventana de ocho horas, con un timeout visible de 30 minutos y sin secretos de IA. Un snapshot
entra a renovación a las 12 horas —mientras su enlace todavía
dispone de otras 12 horas de vigencia—, dejando al menos otra ejecución programada antes del
TTL público de 24 horas. Los fallos avanzan el checkpoint y continúan indisponibles; no pueden
bloquear la revisión de documentos más antiguos. Un ciclo que no se agota dentro de 24 horas
queda registrado y reportado como fallo operativo.

## Cobertura, procedencia y actualidad

El catálogo canónico vive en `packages/scrapers/src/sources.ts`. La página
`/estado-fuentes` combina ese registro con `ingestion_runs` y muestra, para cada proceso,
la cobertura declarada, URL, cadencia, última ejecución completa, última observación con
filas, conteos y error literal. Una fuente que nunca corrió, una corrida parcial, una
corrida fallida, una ejecución completa con cero filas y una cobertura todavía no
implementada son estados distintos.

| Cobertura activa                                             | Fuente                       | Cadencia programada                                      |
| ------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------- |
| Reuniones de comisión, PDF diario y orden del Pleno          | Cámara de Diputados          | Tres veces al día                                        |
| Agendas del Pleno/Asamblea y comisiones                      | Senado                       | Tres veces al día                                        |
| Depósitos recientes de ambas cámaras                         | SIL de cada cámara           | Tres veces al día                                        |
| Fichas e historiales recientes del Senado                    | SIL Senado                   | Tres veces al día                                        |
| Corpus perimido y no perimido de la Cámara                   | SIL Cámara                   | Incremental diario; completo semanal y en bootstrap      |
| Historiales oficiales de PDL de la Cámara                    | SIL Cámara                   | Semanal                                                  |
| Colección legislativa y actualización de Fichas del Senado   | SIL Senado                   | Completa semanal; bootstrap reanudable                   |
| Documentos oficiales vinculados a PDL                        | SIL Cámara                   | Faltantes 3 veces/día; barrido completo diario y semanal |
| Colecciones documentales y códigos exactos publicados        | Cámara y Senado              | Catálogo diario; PDF recientes diarios y barrido semanal |
| Congresistas y membresías explícitas de comisiones           | Ambas cámaras                | Semanal                                                  |
| Publicaciones regulatorias y consultas públicas              | Seis instituciones           | Diario                                                   |
| Noticias oficiales y señales derivadas de hechos almacenados | Congreso y fuentes enlazadas | Tres veces al día                                        |

«Tres veces al día» no significa transmisión instantánea: la interfaz enseña cuándo se
observó cada dato. Los estados solo cambian cuando un campo oficial cambia expresamente;
una agenda o la existencia de un PDF no se convierten en un estado legislativo.
Las ventanas de fecha se calculan en `America/Santo_Domingo`; así, la corrida local de las
`22:15` no se etiqueta por error con el día UTC siguiente.

Para las comisiones de la Cámara, el SIL aporta la identidad, fecha, hora y lugar de la
reunión, mientras que la sección oficial `Agenda Comisiones` publica un PDF diario que
puede incluir varias comisiones. Oculis conserva el ID técnico del SIL como procedencia,
pero el enlace visible abre únicamente el archivo WPFD correspondiente a la fecha y a la
comisión verificadas. Si el PDF todavía no existe, no contiene esa comisión o hay más de
un candidato distinto, la ficha queda sin botón externo; nunca se sustituye por un JSON,
la portada del archivo o el perfil general de la comisión.

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

El workflow `cloud-ingestion.yml` separa las fuentes por cadencia y mantiene cada proceso
aislado: un fallo queda visible en el job, pero no impide que las demás fuentes de esa ventana
se intenten mientras la configuración de base de datos sea válida.

- A las `06:15`, `14:15` y `22:15` en Santo Domingo: busca metadatos depositados faltantes
  en todo el corpus, actualiza depósitos/Fichas recientes, detecta movimientos cambiados en
  ambas cámaras y, por último, verifica los PDF descubiertos en esa misma corrida.
- A las `02:45` cada día: mantenimiento incremental, fuentes regulatorias, barrido completo
  de metadatos documentales sin límite y verificación de esos PDF.
- Roster de ambas cámaras: lunes a las `03:30`.
- Corpus completo e historiales oficiales de ambas cámaras, otro barrido documental completo
  con verificación y colecciones oficiales completas: domingo a las `04:15`.

GitHub Actions puede retrasar o, excepcionalmente, omitir una ejecución programada; su cron no
ofrece un SLA de hora exacta. Estas ventanas reducen la latencia esperada, pero no prometen
captura en tiempo real. El grupo de concurrencia impide dos ingestas simultáneas y no cancela
una ingesta ya iniciada. Revisa `ingestion_runs` y el historial de Actions para confirmar la
hora real de cada observación.

El workflow de CI es independiente: usa Node 22, instala con `npm ci`, ejecuta lint,
typecheck, pruebas y build. El build usa una base PGlite efímera bajo `.next-ci`; nunca
conecta la CI a la base productiva.

El workflow independiente `live-source-health.yml` ejecuta las seis comprobaciones live de
fuentes oficiales cada seis horas, a las `23:37`, `05:37`, `11:37` y `17:37` de Santo
Domingo. Corre los archivos en serie para reducir presión sobre los portales, no recibe
`DATABASE_URL` ni credenciales de inteligencia artificial y conserva durante 30 días el log
y el reporte JUnit de cada intento. También puede ejecutarse manualmente desde
**Actions → Official source live health → Run workflow**. Un fallo de este monitor es visible,
pero no bloquea ni cancela la ingestión principal.

## Operación

- Consulta el historial de **GitHub Actions** después de cambios en scrapers o esquema.
- La tabla `ingestion_runs` registra por fuente el último resultado, cantidad observada y
  errores. Un workflow verde no garantiza que todas las fuentes tengan datos: revisa
  también advertencias, conteos anómalos y fuentes con cero resultados.
- Ejecuta `bootstrap` solamente para inicialización o recuperación controlada. Los modos
  manuales `daily`, `maintenance`, `roster`, `movements-incremental`, `movements`,
  `publications`, `publications-full`, `senate-corpus`, `senate-fichas`, `link-initiative-proponents`,
  `documents-missing` y `documents` permiten repetir cada cobertura por separado.
  `movements-incremental` ejecuta el detector de cambios de ambas cámaras; `movements` fuerza
  el safety net completo; `documents-missing` descubre y verifica solo la cola prioritaria;
  `documents` hace descubrimiento y verificación completos. `publications` refresca tres
  páginas recientes; `publications-full` recorre las colecciones documentales completas como
  recuperación manual independiente, sin ejecutar el `bootstrap` de las demás fuentes.
  Para cobertura histórica de proponentes, conserva el orden documentado en
  «Vinculación de iniciativas con congresistas».
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
