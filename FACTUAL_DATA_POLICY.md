# Política de datos factuales de Oculis

Oculis es un registro de hechos publicados por sus fuentes. No es un sistema de
predicción ni un analista automático. Esta política es obligatoria para scrapers,
worker, base de datos, API, interfaz y procesos de mantenimiento.

## 1. Regla de evidencia explícita

Un valor solamente puede mostrarse como hecho cuando aparece expresamente en la
fuente enlazada. Esto incluye, entre otros:

- código, título, tipo y objeto de un PDL;
- estado y fecha de cada movimiento;
- proponentes, partido, provincia y cámara;
- comisión, cargo y membresía;
- fecha, órgano y contenido de una agenda;
- documentos, informes y textos depositados;
- condición de consulta pública y su fecha límite.

Si la fuente no publica el dato, el valor debe permanecer `null` y la interfaz debe
mostrar «No informado» cuando sea necesario. Ausencia de información no significa
«no», «bajo», «rechazado», «inactivo» ni ningún otro estado.

## 2. Procesos prohibidos

La plataforma no puede producir ni publicar:

- probabilidad de aprobación;
- nivel de riesgo o posibilidad de intervención;
- apoyo político, ejecutivo, sectorial o social estimado;
- estados legislativos deducidos por contexto;
- categorías temáticas creadas por Oculis;
- resúmenes, relevancia, prioridad o rankings decididos por IA o heurísticas;
- contenido generado por un modelo presentado como información de la fuente.

No se permiten dependencias de modelos generativos en la ruta de ingesta. Una
expresión regular o un parser puede localizar texto explícito, pero debe conservar el
valor publicado y no convertirlo en una conclusión distinta.

## 3. Procedencia obligatoria

Cada registro debe conservar, cuando la fuente lo permita:

- identificador de fuente y clave estable del registro;
- URL oficial;
- valor original o carga `raw` para auditoría;
- fecha propia del evento;
- primera y última observación por Oculis.

Una normalización de formato —por ejemplo, convertir una fecha publicada a ISO— es
válida si no cambia su significado. El texto original debe permanecer trazable.

## 4. Estados y movimientos

El estado actual de un PDL es el último estado **expresamente publicado** por la
fuente oficial. El historial solo puede contener eventos publicados por esa fuente.
Oculis no completa pasos faltantes ni interpreta una agenda como aprobación,
rechazo, lectura concluida o cambio de estado.

Que un PDL aparezca en una agenda significa únicamente que la fuente lo incluyó en
esa agenda. Que exista un archivo significa únicamente que hay un documento oficial
enlazado; no equivale por sí solo a un estado legislativo.

## 5. Fallos y ausencia de resultados

- Una corrida fallida no puede borrar el último dato válido.
- Una respuesta vacía se registra con conteo cero; no se interpreta como ausencia de
  actividad sin evidencia adicional.
- Los mínimos de integridad protegen contra HTML incompleto o cambios de selector,
  pero no alteran datos legislativos.
- Cada fuente debe exponer última ejecución, último éxito, conteos y error literal.
- «Tiempo real» significa la última observación disponible según la cadencia visible;
  nunca se debe ocultar la antigüedad de una fuente.

## 6. Fuentes periodísticas y sociales

Una publicación externa conserva autor, medio, URL y hora de publicación. Oculis no
la convierte en estado oficial de un PDL. Las cuentas del directorio deben tener una
verificación explícita y trazable; no se seleccionan por una opinión de relevancia ni
por un ranking generado.

## 7. Cambios futuros

Todo cambio que introduzca scoring, inferencia, clasificación propia o IA requiere
una decisión explícita del propietario del producto y una separación visual y de
datos respecto de los hechos oficiales. No puede habilitarse mediante una variable de
entorno oculta ni como fallback.
