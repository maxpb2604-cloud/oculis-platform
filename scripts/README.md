# Operación programada

Los runners de este directorio ejecutan la recolección factual del worker. No llaman
modelos generativos, no clasifican temas, no calculan scores y no deducen estados.

## Ejecución local en macOS

- `daily-run.sh`: actividad, depósitos, feed y fuentes regulatorias. El `launchd`
  incluido lo programa seis veces al día.
- `roster-run.sh`: congresistas y membresías de comisiones, una vez por semana.
- `refresh-feed.sh`: variante compacta que ejecuta el ciclo `daily` una sola vez.

Los scripts exigen una base persistente configurada mediante `DATABASE_URL` o un
`DB_DRIVER=pglite` intencional con `PGLITE_DIR`. Cada fallo conserva un código de salida
distinto de cero para que el programador no lo presente como una corrida exitosa.

Instalación opcional de los agentes locales:

```bash
mkdir -p ~/Library/LaunchAgents
cp scripts/com.fhc.monitoring.daily.plist ~/Library/LaunchAgents/
cp scripts/com.fhc.monitoring.roster.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.fhc.monitoring.daily.plist
launchctl load ~/Library/LaunchAgents/com.fhc.monitoring.roster.plist
```

La programación local solo funciona mientras esta Mac esté encendida. Para continuidad,
usa `.github/workflows/cloud-ingestion.yml` con una base PostgreSQL persistente. La página
`/estado-fuentes` muestra el resultado literal de cada proceso, incluyendo fuentes nunca
ejecutadas, fallos, respuestas con cero elementos, conteos y último éxito.

## Utilidades de auditoría

- `check-factual-policy.mjs` bloquea en CI dependencias y campos de inferencia retirados.
- `verify-x-handles.mjs` comprueba que un identificador responde en la API de X; esa
  comprobación no demuestra por sí sola la identidad de la cuenta.
- `capture-sil-request.mjs` y `weekly-activity.mjs` ayudan a inspeccionar endpoints
  oficiales sin alterar estados en la base.

Consulta [`FACTUAL_DATA_POLICY.md`](../FACTUAL_DATA_POLICY.md) antes de agregar un parser,
una fuente o un campo derivado.
