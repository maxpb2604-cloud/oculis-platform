# Auditoría de calidad: Movimientos del Congreso y Comisiones & Agendas

Fecha de corte: 4 de septiembre de 2026 (America/Santo_Domingo)

## Alcance y grano

- **Movimientos:** un movimiento por iniciativa, estado, fecha oficial y fuente.
- **Actividad:** una reunión, sesión o publicación oficial por fuente y clave de deduplicación.
- **Vínculo de agenda:** un código oficial exacto enlazado a una sola iniciativa. La cámara de la reunión no implica que la iniciativa haya sido originada por esa cámara.

## Resultado ejecutivo

La auditoría encontró y corrigió dos defectos reproducibles:

1. Las agendas filtraban las iniciativas por la cámara que celebraba la reunión. Esto dejaba sin ficha iniciativas del Senado tratadas en Diputados y viceversa, aunque su código oficial existiera en Oculis.
2. Un barrido operativo limitado de Diputados comparaba sus 1,018 filas solicitadas contra el total global de 6,274 y marcaba una cobertura sana como fallo.

Los códigos exactos y globalmente únicos ahora se resuelven sin importar la cámara de la reunión. La cámara se utiliza únicamente para desempatar duplicados históricos. Los vínculos antiguos todavía nulos también se resuelven al leerlos y el backfill programado puede persistirlos después. Los códigos ausentes o ambiguos permanecen sin enlace: no se inventan títulos ni relaciones.

## Perfil local de datos

| Dimensión | Diputados | Senado |
| --- | ---: | ---: |
| Iniciativas almacenadas | 6,251 | 2,678 |
| Sin código | 0 | 0 |
| Sin estado | 0 | 0 |
| Sin fecha de depósito | 0 | 0 |
| Sin título | 0 | 1 |
| Última fecha oficial de depósito local | 2026-09-02 | 2026-09-02 |

La actividad local de Diputados llega al 4 de septiembre y la del Senado al 2 de septiembre. Una fecha sin filas significa **sin movimiento oficial fechado disponible en el almacén consultado**; no demuestra por sí sola que el Congreso no haya trabajado ese día.

## Integridad de agendas

- Se comprobó el caso real `01755-2026-SLO-SE`: una agenda de Diputados lo mencionaba sin enlace, pero la iniciativa existe como proyecto del Senado y ahora se resuelve correctamente.
- También queda cubierto el caso inverso, por ejemplo un código `...-CD` incluido en una agenda del Senado.
- En actividad reciente quedaron 15 referencias sin enlace antes de la corrección. Las referencias con una coincidencia exacta global quedan reparadas por la nueva reconciliación; las demás se conservan como referencias explícitas sin fabricar coincidencias.
- El archivo histórico de agendas contiene códigos de legislaturas anteriores que no están en el catálogo actual almacenado. Se mantienen sin enlace hasta que exista una ficha oficial exacta.

## Evidencia oficial fresca

La corrida `Official source live health` 33879748011 verificó 159 controles: 158 pasaron y 1 falló por un problema ajeno a estas páginas (37 de 251 vínculos exactos de membresía del padrón del Senado). Las fuentes relevantes para iniciativas y agendas respondieron:

- Catálogo SIL de Diputados: 6,274 iniciativas, 15 grupos.
- Actividad SIL de Diputados: 9 filas; seis todavía sin PDF único publicado por la fuente.
- Publicaciones oficiales de Diputados: 10 registros.
- Agenda del Senado: 6 registros; una reunión sin fecha exacta en el PDF semanal oficial.
- Catálogo SIL del Senado: 2,684 iniciativas.

La ingesta cloud 33883056407 estaba en progreso al cierre de esta auditoría. No se despachó una corrida duplicada y no se escribió directamente en la base de datos.

## Validación de la corrección

- `npm run typecheck`: aprobado en los cinco workspaces.
- `@oculis/db`: 87/87 pruebas aprobadas.
- `@oculis/worker`: 134/134 pruebas aprobadas.
- `@oculis/web`: 366/366 pruebas aprobadas.
- `@oculis/scrapers`: 153 aprobadas y 6 live omitidas en la corrida local; esas seis sí fueron ejercitadas por la corrida live oficial indicada arriba.
- `npm run lint`: aprobado.
- `npm run check:factual`: aprobado.
- Interfaz verificada en `http://localhost:3001/feed` y `http://localhost:3001/hoy?date=2026-09-04&view=week`.

## Límites factuales que deben seguir visibles

- “Agenda no publicada” significa que la reunión sí está publicada pero no existe todavía un enlace oficial exacto al documento.
- “Hora no informada” o “fecha no informada” debe conservarse cuando la fuente omite ese dato.
- Un día vacío no debe reinterpretarse como “el Congreso no tuvo actividad”.
- Una referencia sin coincidencia exacta no debe enlazarse por similitud ni por una suposición basada en la cámara.
