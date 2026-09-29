# Oculis en un VPS de OVHcloud

Este directorio contiene una base operativa reproducible para publicar Oculis sin
depender de la Mac local. La aplicación queda detrás de Caddy, escucha únicamente en
`127.0.0.1:3000`, usa PostgreSQL en `127.0.0.1:5432` y se actualiza mediante releases
atómicos identificados por commit.

Las plantillas no contienen credenciales y no aprovisionan por sí solas una cuenta de
OVHcloud. Deben aplicarse cuando el VPS tenga IP, sistema operativo y acceso SSH.

## Arquitectura y puertos

```text
Internet :80/:443
       │
       ▼
     Caddy ─────► Next.js 127.0.0.1:3000
                         │
                         ▼
                 PostgreSQL 127.0.0.1:5432

systemd timers ─► workers de ingesta ─► PostgreSQL
systemd timer  ─► pg_dump verificado ─► /var/backups/oculis
```

Solo `22/tcp` (restringido), `80/tcp` y `443/tcp` deben estar expuestos. Nunca publique
los puertos 3000 o 5432. Antes de cambiar reglas SSH/firewall, conserve una segunda
sesión abierta para evitar perder acceso al servidor.

Recomendación de capacidad: Ubuntu 24.04 LTS o Debian 12, 4 vCPU, 8 GB de RAM y al
menos 80 GB SSD. El mínimo práctico es 2 vCPU, 4 GB y 40 GB. Instale Node.js 22,
PostgreSQL 16 (o la versión soportada por el sistema), `git`, `curl`, `util-linux`
(provee `flock`), Caddy y los clientes PostgreSQL. Confirme `node --version` (debe
satisfacer `>=20.9`) antes de continuar.

## 1. Usuario y directorios

Ejecute como `root` una sola vez:

```bash
adduser --system --group --home /var/lib/oculis --shell /bin/bash oculis
adduser --system --group --home /var/lib/oculis-build --shell /usr/sbin/nologin oculis-build
chown root:root /var/lib/oculis
chmod 0755 /var/lib/oculis
install -d -o root -g root -m 0755 /opt/oculis/releases
install -d -o root -g root -m 0711 /opt/oculis/.deploy
install -d -o oculis -g oculis -m 0750 /var/lib/oculis/documents
install -d -o oculis -g oculis -m 0750 /var/lib/oculis/health /var/lib/oculis/runtime
install -d -o oculis -g oculis -m 0750 /var/lib/oculis/restic
install -d -o root -g root -m 0755 /var/lib/oculis/locks /var/lib/oculis-state
install -o oculis -g oculis -m 0660 /dev/null /var/lib/oculis/locks/ingestion.lock
install -d -o oculis -g oculis -m 0750 /var/log/oculis
install -d -o oculis-build -g oculis-build -m 0750 /var/lib/oculis-build/.npm
install -d -o oculis -g oculis -m 0700 /var/backups/oculis/postgresql
install -d -o root -g root -m 0755 /etc/oculis
```

El wrapper y el motor de release son root-owned. Solo `npm ci`, las comprobaciones y el
build se ejecutan como `oculis-build`, una cuenta sin acceso a los env de runtime. La
aplicación y los chequeos de base se ejecutan como `oculis`. No agregue ninguno de esos
usuarios al grupo del otro.

`/var/lib/oculis` es root-owned para que el proceso web no pueda reemplazar sus
subdirectorios. Solo `documents`, `health`, `runtime` y `restic` son escribibles por
`oculis`. El directorio de locks y `/var/lib/oculis-state` también son root-owned; el
worker puede abrir el inode precreado `ingestion.lock`, pero no reemplazarlo. El SHA
activo vive en `/var/lib/oculis-state/release.env`, escrito atómicamente por el runner
y leído por systemd, nunca por una ruta controlada por la aplicación.

## 2. PostgreSQL y secretos separados

Cree la función y base con una contraseña aleatoria. `createuser --pwprompt` evita que
la contraseña aparezca en el historial:

```bash
sudo -u postgres createuser --pwprompt oculis
sudo -u postgres createdb --owner=oculis oculis
```

Separe los secretos según el proceso que realmente los necesita. Sustituya todos los
marcadores `REPLACE_*` y aplique `root:root 0600` a cada archivo. systemd lee los env
antes de bajar privilegios al usuario del servicio:

```bash
install -o root -g root -m 0600 ops/vps/env.example /etc/oculis/web.env
install -o root -g root -m 0600 ops/vps/worker.env.example /etc/oculis/worker.env
install -o root -g root -m 0600 ops/vps/backup.env.example /etc/oculis/backup.env
editor /etc/oculis/web.env
editor /etc/oculis/worker.env
editor /etc/oculis/backup.env
```

Para evitar diferencias entre URI, Bash y libpq, use una contraseña PostgreSQL
compuesta por caracteres hexadecimales; por ejemplo, genérela con
`openssl rand -hex 32`. Repita ese valor únicamente en `DATABASE_URL` de web/worker y
en `PGPASSWORD` de backup. Genere de forma independiente `OCULIS_SESSION_SECRET` con
al menos 32 caracteres.

El servicio web no recibe las credenciales de `pg_dump`, restic o ingesta; los workers
no reciben el secreto de sesión ni la contraseña administrativa. La migración completa
debe importar la cuenta administrativa y su hash; no instale `bootstrap.env` en ese
flujo. Si un procedimiento de recuperación revisado necesita crear el primer admin,
instale temporalmente `bootstrap.env.example` como `root:root 0600` y úselo únicamente
por HTTPS confiable. Después del primer login verificado, elimínelo y reinicie la web:

```bash
rm -- /etc/oculis/bootstrap.env
systemctl restart oculis-web.service
```

La cuenta y su hash permanecen en PostgreSQL; la contraseña en claro ya no queda en el
entorno del proceso. También elimine cualquier copia temporal o backup sin cifrar de
ese archivo. No copie ningún env real al repositorio, logs o tickets. El token Mapbox
es público por diseño, pero el secreto de sesión, la contraseña administrativa y
PostgreSQL no lo son. `OCULIS_PUBLIC_URL` es obligatorio en `web.env`: debe ser el
origen HTTPS canónico, sin ruta ni `/` final, y debe coincidir con `OCULIS_DOMAIN` en
Caddy.

## 3. Datos existentes antes de publicar

El despliegue normal **no modifica el esquema, no inventa datos y no migra el contenido
actual**. La publicación inicial debe importar un volcado completo y verificado de las
tablas de la instancia local (iniciativas, movimientos, agendas, documentos,
regulaciones, legisladores, cuentas, clientes y asignaciones). El migrador histórico
que solo copia `initiatives` y `status_events` no es suficiente para esta transición.

Cuando el proceso de exportación completo produzca un artefacto, verifique primero su
checksum. Ejecute después el importador que acompañe ese artefacto: no use a ciegas
`pg_restore`, porque un dump de esquema completo y uno de solo datos requieren órdenes
distintos. El importador debe detenerse ante cualquier error y comprobar secuencias,
claves foráneas y conteos antes de devolver éxito.

No cambie DNS todavía. Compare al menos conteos de iniciativas, movimientos, agendas,
documentos, regulaciones, legisladores y cuentas, y verifique relaciones huérfanas. La
migración de datos requiere su propio procedimiento de paridad; estas plantillas
deliberadamente no aceptan una copia parcial como una migración exitosa. Ajuste
`OCULIS_MIN_READY_INITIATIVES` al mismo piso aceptado en `web.env` y `worker.env`, nunca
a cero. Readiness exige además las tablas operativas esenciales y al menos un
administrador activo con contraseña. El inicio de sesión se prueba más adelante,
únicamente sobre el origen HTTPS final como explica la sección 5.

Si primero ejecutó `oculis-deploy bootstrap-empty`, el esquema remoto ya existe. El
importador de PGlite debe ejecutarse **sin** `--bootstrap-schema` (por ejemplo,
`npm run db:migrate:pglite -- --execute`) y luego verificarse con
`npm run db:verify:pglite`; intentar un segundo bootstrap sobre esa base no es un flujo
válido.

## 4. Unidades systemd

Desde un checkout de este repositorio, como `root`:

```bash
install -o root -g root -m 0644 ops/vps/systemd/oculis-web.service /etc/systemd/system/
install -o root -g root -m 0644 ops/vps/systemd/oculis-ingest@.service /etc/systemd/system/
install -o root -g root -m 0644 ops/vps/systemd/oculis-ingest-*.timer /etc/systemd/system/
install -o root -g root -m 0644 ops/vps/systemd/oculis-health.service /etc/systemd/system/
install -o root -g root -m 0644 ops/vps/systemd/oculis-health.timer /etc/systemd/system/
install -o root -g root -m 0644 ops/vps/systemd/oculis-source-health.service /etc/systemd/system/
install -o root -g root -m 0644 ops/vps/systemd/oculis-source-health.timer /etc/systemd/system/
install -o root -g root -m 0644 ops/vps/systemd/oculis-backup.service /etc/systemd/system/
install -o root -g root -m 0644 ops/vps/systemd/oculis-backup.timer /etc/systemd/system/
install -o root -g root -m 0644 ops/vps/systemd/oculis-failure-log@.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable oculis-web.service
```

No habilite todavía ingestas, health ni Caddy en una base vacía. Los timers se habilitan
después de importar y validar los datos en la sección 7. Las unidades y Caddy son
configuración root-owned: cambios futuros bajo `ops/vps/systemd/` o `Caddyfile` requieren
revisión y reinstalación manual; un release automático de la aplicación no los cambia.

Cada servicio escribe stdout/stderr en journald. `OnFailure` inicia
`oculis-failure-log@.service`, que conserva en el journal el estado detallado de la
unidad que falló. Esto **no** representa una notificación externa: conecte su monitor
o alerta a systemd/journald por separado si necesita avisos fuera del servidor.

Los horarios se expresan en UTC para que no dependan de la zona configurada en el VPS:

| Ciclo                           | UTC                        | Santo Domingo       |
| ------------------------------- | -------------------------- | ------------------- |
| Frecuente                       | 02:15, 10:15, 18:15 diario | 22:15, 06:15, 14:15 |
| Mantenimiento                   | 06:45 diario               | 02:45               |
| Padrón                          | lunes 07:30                | lunes 03:30         |
| Reconciliación completa         | domingo 08:15              | domingo 04:15       |
| Fuentes oficiales, solo lectura | 03:37, 09:37, 15:37, 21:37 | cada 6 horas        |
| Backup                          | 05:30 diario               | 01:30               |

Todos los ciclos de escritura comparten un `flock`; jamás se ejecutan dos ingestas al
mismo tiempo. Un fallo de una fuente queda en `journalctl` y no impide que se consulten
las demás fuentes independientes del mismo ciclo. El servicio termina con error si
cualquier paso falla, por lo que la alerta no queda falsamente verde.

## 5. Primer release y actualizaciones posteriores

El motor de release clona el SHA solicitado, ejecuta instalación reproducible, política
factual, TypeScript y un build aislado. El despliegue normal solo verifica el esquema;
no ejecuta DDL. Si cambió cualquiera de los archivos que definen el esquema, se niega a
publicar: los cambios de esquema automatizados están deshabilitados hasta contar con
migraciones transaccionales y versionadas. Solo después cambia
atómicamente `/opt/oculis/current`. Comprueba que `/api/health` anuncie el commit nuevo,
que `/api/ready` confirme datos esenciales y que se respete el piso de iniciativas; si
algo falla, restaura el symlink anterior y reinicia el release previo.

El runner rechaza Node.js anterior a 20.9. La instalación y el build corren como
`oculis-build` dentro de un entorno sanitizado que contiene solo variables públicas;
esa cuenta tampoco puede leer los env root-only. Los secretos se cargan después y solo
las variables mínimas de base se entregan al verificador como `oculis`. Se usa
explícitamente `npm ci --include=dev`: los workers productivos ejecutan sus
CLI con `tsx` y la verificación de fuentes usa Vitest. No ejecute después `npm prune
--omit=dev`; dejaría inoperantes las ingestas y comprobaciones programadas.

Instale además el punto de entrada estable usado por GitHub Actions. El wrapper es
propiedad de root, acepta únicamente las formas documentadas y SHA hexadecimales de 40
caracteres. El runner baja exclusivamente el build a `oculis-build` y los chequeos de
base a `oculis`:

```bash
install -d -o root -g root -m 0755 /usr/local/libexec/oculis
install -o root -g root -m 0755 ops/vps/scripts/deploy-release.sh \
  /usr/local/libexec/oculis/deploy-release.sh
install -o root -g root -m 0755 ops/vps/scripts/rollback-release.sh \
  /usr/local/libexec/oculis/rollback-release.sh
install -o root -g root -m 0755 ops/vps/scripts/run-ingest.sh \
  /usr/local/libexec/oculis/run-ingest.sh
install -o root -g root -m 0755 ops/vps/scripts/oculis-deploy-wrapper.sh \
  /usr/local/sbin/oculis-deploy
install -o root -g root -m 0644 ops/vps/deploy.env.example /etc/oculis/deploy.env
```

El archivo `deploy.env` no contiene secretos; parametriza repositorio, rutas, retención
y unidad web. El wrapper usa **siempre** estos runners root-owned. Esto evita que un
release roto o atrasado cambie la lógica privilegiada de despliegue. Las mejoras a los
runners se instalan manualmente con los comandos anteriores después de revisión.

Para el primer release, mantenga Caddy detenido, DNS sin apuntar al VPS y 80/443
cerrados. Resuelva el SHA completo y cree el esquema vacío mediante la operación
explícita de una sola vez:

```bash
sudo /usr/local/sbin/oculis-deploy bootstrap-empty COMMIT_SHA_DE_40_CARACTERES
```

Este comando detiene primero cualquier web anterior. Puede arrancar la nueva web solo
en `127.0.0.1:3000` durante la validación, pero reporta estado
`private-bootstrap-not-public` y no declara la plataforma lista. El runner valida la
liveness local (y readiness si ya hay datos) y después **detiene `oculis-web` antes de
liberar el lock de ingesta**; conserva el symlink `current` apuntando al release
preparado. Importe entonces el snapshot completo, incluida la cuenta administrativa
con su hash, y valide paridad. No
intente validar sesiones por HTTP mediante un túnel: `OCULIS_PUBLIC_URL`, same-origin y
la cookie segura requieren HTTPS. El verificador directo confirma la cuenta durante la
fase privada; pruebe el login en navegador solo sobre el origen HTTPS final. Mientras
continúa la migración puede probar otro commit, todavía privado, con:

```bash
sudo /usr/local/sbin/oculis-deploy private COMMIT_SHA_DE_40_CARACTERES
```

Cuando `/api/ready` y el verificador de migración sean satisfactorios, un deploy normal
promueve el commit con esquema inalterado y vuelve a arrancar la web:

```bash
sudo /usr/local/sbin/oculis-deploy COMMIT_SHA_DE_40_CARACTERES
```

Durante toda la transferencia, `oculis-web`, los workers y todos los timers deben
permanecer detenidos; no ejecute ingestas ni habilite timers entre `bootstrap-empty` y
la verificación final. Confirme primero `npm run db:verify:pglite` y solo entonces
ejecute el deploy normal anterior. El runner privado rechaza el inicio si detecta un
timer habilitado/activo o un worker activo. Los timers se habilitan después, en la
sección 7.

`bootstrap-empty` es exclusivamente para la base inicial realmente vacía. El bootstrap
DDL actual no se ejecuta en una única transacción: una interrupción puede dejar un
esquema parcial. Si ocurre, el siguiente deploy se niega a continuar. No repita
`bootstrap-empty` ni intente una restauración destructiva automática; inspeccione el
estado y ejecute una recuperación manual revisada.

Para cualquier DDL futuro, el wrapper falla de forma cerrada: no existe una operación
automática de esquema. Hasta implementar migraciones transaccionales y versionadas,
programe una ventana de mantenimiento revisada, retire tráfico público y detenga web,
workers y todos los timers. Cree y verifique un backup, ensaye su restauración en una
base separada y prepare una migración y activación revisadas. El runner actual seguirá
rechazando el release que cambie archivos de esquema aunque la base se haya alterado
manualmente; no lo eluda de manera improvisada. Primero incorpore un mecanismo de
migración transaccional/versionado y su gate de compatibilidad, y solo entonces ejecute
y valide el cambio. El rollback del symlink no deshace DDL ni datos y el runner no
intenta restaurarlos automáticamente.

El rollback remoto restaura un release retenido por SHA y vuelve a pasar
health/readiness:

```bash
sudo /usr/local/sbin/oculis-deploy rollback SHA_PREVIO_DE_40_CARACTERES
```

Ese rollback cambia código y symlink; no revierte DDL ni datos. El runner compara la
huella de los archivos de esquema y rechaza un rollback de código entre huellas
distintas. Un cambio de esquema requiere un plan de restauración compatible con su
backup y una intervención explícita del operador.

Por defecto conserva cinco releases. `OCULIS_DEPLOY_TESTS=1` añade la suite completa al
gate cuando se llama directamente al motor de release. El workflow
`.github/workflows/deploy-vps.yml` invoca este wrapper por SSH. Para su usuario SSH
dedicado, autorice únicamente este comando en sudoers (sustituya `VPS_USER` por el
usuario real):

```text
VPS_USER ALL=(root) NOPASSWD: /usr/local/sbin/oculis-deploy *
```

El wrapper acepta únicamente las formas documentadas y SHA completos aunque sudoers
use el comodín. Configure en GitHub los secretos `VPS_HOST`, `VPS_USER`,
`VPS_SSH_PRIVATE_KEY`, `VPS_KNOWN_HOSTS`; y las variables `OCULIS_PUBLIC_URL`,
`VPS_DEPLOY_ENABLED=true` y, si aplica, `VPS_SSH_PORT`. Capture `known_hosts` por un
canal confiable; no haga `ssh-keyscan` dentro del workflow. Nunca guarde una clave
privada ni ningún archivo env real en el repositorio.

## 6. Caddy, HTTPS y DNS

Solo después de completar la promoción productiva, copie las plantillas y configure el
dominio sin `https://` ni rutas. Debe ser el mismo host de `OCULIS_PUBLIC_URL`:

```bash
install -o root -g root -m 0644 ops/vps/Caddyfile /etc/caddy/Caddyfile
install -d -o root -g root -m 0755 /etc/systemd/system/caddy.service.d
install -o root -g root -m 0644 ops/vps/systemd/caddy-oculis.conf \
  /etc/systemd/system/caddy.service.d/oculis.conf
install -o root -g caddy -m 0640 ops/vps/caddy.env.example /etc/oculis/caddy.env
editor /etc/oculis/caddy.env
install -d -o caddy -g caddy -m 0750 /var/log/caddy
systemctl daemon-reload
bash -lc 'set -a; source /etc/oculis/caddy.env; set +a; caddy validate --config /etc/caddy/Caddyfile'
systemctl restart caddy
```

Apunte los registros A/AAAA al VPS solo después de validar la paridad de datos por IP o
entrada temporal en `/etc/hosts`. Caddy obtiene y renueva TLS automáticamente cuando el
DNS público resuelve y 80/443 están accesibles. Tras el cambio, pruebe expresamente el
login y todas las operaciones administrativas: la protección same-origin debe recibir
correctamente `Host` y `X-Forwarded-Proto` del proxy. La API administrativa de Caddy
está desactivada y su active health usa `/api/ready`, no la simple liveness. La cabecera
HSTS no incluye subdominios inicialmente. Agregue `includeSubDomains` solo después del
cutover verificado y únicamente si **todos** los subdominios presentes y futuros usan
HTTPS; no active preload como parte de esta primera publicación.

## 7. Arranque y comprobaciones

Una vez desplegado, importados los datos y configurado Caddy:

```bash
systemctl start oculis-web.service
systemctl enable --now oculis-ingest-frequent.timer oculis-ingest-maintenance.timer
systemctl enable --now oculis-ingest-roster.timer oculis-ingest-weekly.timer
systemctl enable --now oculis-health.timer oculis-source-health.timer oculis-backup.timer
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
curl --fail --silent --show-error http://127.0.0.1:3000/api/ready
systemctl list-timers 'oculis-*'
```

Ejecute y observe una ingesta manual antes de declarar la plataforma actualizada:

```bash
systemctl start oculis-ingest@frequent.service
journalctl -u oculis-ingest@frequent.service -f
```

Comandos operativos útiles:

```bash
journalctl -u oculis-web.service -n 200 --no-pager
journalctl -u 'oculis-ingest@*' --since today
journalctl -u oculis-source-health.service --since today
journalctl -u 'oculis-failure-log@*' --since today
systemctl status oculis-health.service oculis-backup.service
systemctl start oculis-ingest@regulatory.service
```

## 8. Backups y restauración ensayada

Cada backup usa formato custom, se valida con `pg_restore --list`, recibe SHA-256 y se
retiene 14 días por defecto. Un backup que vive solo en el mismo VPS no protege contra
pérdida total del servidor. Configure `RESTIC_REPOSITORY` y su credencial para una copia
cifrada fuera de OVH, o replique el archivo por otro mecanismo seguro.

Ensaye periódicamente la restauración en una base separada, nunca directamente sobre
producción:

```bash
sha256sum --check /var/backups/oculis/postgresql/oculis-TIMESTAMP.dump.sha256
sudo -u postgres createdb --owner=oculis oculis_restore_test
sudo bash -lc \
  'set -a; source /etc/oculis/backup.env; set +a; pg_restore --exit-on-error --no-owner --no-acl --dbname=oculis_restore_test /var/backups/oculis/postgresql/oculis-TIMESTAMP.dump'
sudo -u postgres dropdb oculis_restore_test
```

## Criterio de salida a producción

- El commit servido por `/api/health` coincide con el release solicitado y
  `/api/ready` confirma PostgreSQL.
- PostgreSQL contiene el conjunto completo y los conteos esperados, no solo dos tablas.
- Login de administrador, clientes, asignaciones y cambio de contraseña funcionan por
  HTTPS.
- `/estado-fuentes` muestra ejecuciones reales y no silenciosamente omitidas.
- Una corrida `frequent` y la prueba de fuentes oficiales terminan satisfactoriamente.
- Existe al menos un backup verificado y una copia fuera del VPS.
- 3000 y 5432 no responden desde Internet; 80/443 sí, con TLS válido.
- El despliegue de un commit nuevo y el rollback automático han sido ensayados.
