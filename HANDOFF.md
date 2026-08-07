# Handoff técnico

Este documento resume el estado operativo de Oculis para el equipo que continuará el
desarrollo. La descripción funcional y los comandos detallados permanecen en
[`README.md`](./README.md); las restricciones de datos son obligatorias y están en
[`FACTUAL_DATA_POLICY.md`](./FACTUAL_DATA_POLICY.md).

## Estado actual

- Monorepo npm con Node 22 como versión de CI.
- Frontend: Next.js 16 y React 19 en `apps/web`.
- Backend de recolección: CLI TypeScript en `apps/worker`.
- Persistencia: PostgreSQL/Neon en entornos compartidos y PGlite para desarrollo o CI.
- Automatización: GitHub Actions ejecuta CI y las ingestas periódicas.
- Política: la plataforma solo conserva hechos explícitos y su procedencia. No genera
  probabilidades, clasificaciones, scores ni estados mediante IA.

La aplicación web es de lectura. El worker es el único proceso encargado de recolectar y
actualizar información. Ambos deben apuntar a la misma base de datos. La recolección en
GitHub Actions es periódica, no tiempo real.

## Preparación del entorno

```bash
npm ci
cp .env.example .env
cp .env.example apps/web/.env.local
```

Configurar `DATABASE_URL` en ambos archivos locales o usar un `PGLITE_DIR` absoluto y
compartido. Los archivos `.env*`, las credenciales de Neon y cualquier token deben
permanecer fuera de Git. Para iniciar la web:

```bash
npm run dev
```

## Validación obligatoria antes de entregar o fusionar

```bash
npm run check:factual
npm run format
npm run audit:dead-code
npm run lint
npm run typecheck
npm test
npm run build
```

El CI ejecuta los mismos controles. `audit:dead-code` usa Knip para impedir archivos,
exportaciones o dependencias sin consumidores. TypeScript también tiene activados
`noUnusedLocals` y `noUnusedParameters`.

Las pruebas unitarias no sustituyen las validaciones contra fuentes públicas. Las pruebas
marcadas como `live` requieren acceso de red y se ejecutan intencionalmente por separado:

```bash
npm run test:live -w @oculis/scrapers
npm run validate:senado-live -w @oculis/scrapers
```

## Operación en la nube

`.github/workflows/cloud-ingestion.yml` usa el secreto `DATABASE_URL` y ejecuta:

- ciclo diario tres veces al día;
- mantenimiento cada madrugada;
- actualización del roster los lunes;
- corpus, historiales y publicaciones completas los domingos.

Revisar GitHub Actions y `/estado-fuentes` después de cada modificación de un adaptador.
Un resultado `PARTIAL` significa que la fuente respondió pero la cobertura factual no fue
completa; `FAILED` significa fallo operativo. Ninguno debe presentarse como cobertura total.

## Limitaciones conocidas

- La pestaña `Hoy` no constituye todavía un registro exhaustivo en tiempo real. Integra
  actividad de agenda y depósitos, pero debe ampliarse para reconciliar cambios de estado,
  votaciones, actas, asistencias e informes publicados por separado.
- Las fuentes oficiales pueden cambiar HTML, contratos de API o disponibilidad. Cada
  adaptador debe conservar el URL de evidencia, reportar vacíos y evitar completar datos
  mediante inferencias.
- La web local puede sentirse lenta cuando consulta Neon desde una conexión doméstica y
  al compilar una ruta por primera vez. Medir antes de modificar cachés o consultas.

## Comandos operativos útiles

```bash
npm run daily -w @oculis/worker
npm run roster -w @oculis/worker
npm run movements -w @oculis/worker
npm run publications -w @oculis/worker
npm run migrate:pglite-to-postgres -w @oculis/worker
```

Las utilidades de diagnóstico adicionales están documentadas en
[`scripts/README.md`](./scripts/README.md).

## Regla de entrega

No fusionar cambios si falla cualquiera de los controles obligatorios, si un secreto quedó
en el diff o si una nueva transformación no puede señalar el campo o documento oficial del
que proviene. Los cambios de esquema o credenciales deben coordinarse con el responsable de
Neon y GitHub Actions antes del despliegue.
