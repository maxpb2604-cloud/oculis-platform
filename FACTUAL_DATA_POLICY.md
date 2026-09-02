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
- relevancia, prioridad o rankings decididos por IA o heurísticas;
- contenido generado por un modelo presentado como información de la fuente.

No se permiten dependencias de modelos generativos en la ruta de ingesta. Una
expresión regular o un parser puede localizar texto explícito, pero debe conservar el
valor publicado y no convertirlo en una conclusión distinta.

### 2.1. Traducción al inglés del título oficial

Por decisión explícita del propietario del producto del 28 de agosto de 2026, se
autoriza traducción automática **únicamente** para ofrecer en la interfaz inglesa una
versión en inglés del título oficial de una iniciativa. La traducción es contenido
derivado de Oculis: nunca sustituye, modifica ni se presenta como el título publicado
por la fuente.

Esta autorización tiene límites obligatorios:

- la entrada es exclusivamente el título oficial íntegro almacenado en
  `initiatives.title`; no se agregan estado, etapa, proponente, partido, comisión ni
  otros hechos;
- solo se permite la dirección español → inglés y se conserva siempre el título
  oficial en español;
- cada resultado vive en una tabla derivada separada, vinculado al ID de iniciativa,
  al texto fuente exacto y a su SHA-256, idioma de destino y modelo;
- si cambia un solo carácter del título oficial, la traducción anterior deja de ser
  elegible automáticamente y no puede reutilizarse para el nuevo texto;
- la interfaz identifica el resultado como «Traducción de Oculis» / «Oculis
  translation» y permite consultar el título oficial en español;
- una traducción ausente o fallida nunca se completa con sustituciones parciales,
  diccionarios improvisados ni servicios públicos no auditados;
- la traducción se ejecuta únicamente mediante un comando del worker y se persiste
  antes de publicarse; nunca se llama a un modelo desde el navegador, una ruta API o
  durante el render de una página;
- el traductor no puntúa, resume, clasifica, interpreta ni completa el título, y no
  recibe instrucciones procedentes del propio texto;
- la procedencia técnica —modelo y fecha de creación— se conserva para auditoría.
- toda salida automática se conserva como borrador no publicable; las consultas de la
  interfaz solo aceptan una traducción cuya procedencia comience con el prefijo reservado
  `oculis-editorial-reviewed-en/`, después de comparar editorialmente el título inglés
  completo con el título oficial exacto. Retirar esa fila vuelve a mostrar el estado
  honesto de traducción pendiente.

Esta excepción no autoriza traducir silenciosamente documentos oficiales, noticias,
agendas, nombres propios, comisiones ni texto libre de la fuente. Esos contenidos
permanecen en su idioma original hasta que exista una autorización y un contrato de
datos independiente.

### 2.2. Presentación de cámara observada y vencimiento normativo

Por decisión explícita del propietario del producto del 1 de septiembre de 2026, la
ficha de cada iniciativa puede mostrar una **presentación derivada y separada** de su
ubicación procesal y de su vencimiento normativo. Esta autorización no convierte el
cálculo en un hecho publicado por la fuente ni permite sobrescribir los campos
canónicos `currentChamber` y `expiresAt`.

La presentación tiene estos límites obligatorios:

- un valor expresamente publicado por la fuente siempre prevalece y se identifica
  como tal;
- cuando la fuente no publica una cámara actual, Oculis puede mostrar únicamente la
  última cámara oficial observada a través de un evento o corpus oficial, con esa
  denominación exacta; no se interpreta el texto del estado ni se presume un traslado;
- la regla de dos legislaturas se aplica solo a un tipo publicado que corresponda a
  un proyecto de ley y comienza con la primera toma en consideración o admisión
  expresamente observada, nunca con la fecha de depósito;
- el cálculo usa las legislaturas ordinarias constitucionales: la primera comienza el
  27 de febrero y la segunda el 16 de agosto, con 150 días cada una; una legislatura
  extraordinaria no cuenta para la perención;
- una fecha de vencimiento calculada se identifica como «Cálculo de Oculis», conserva
  los insumos exactos y cita la base normativa aplicable; no se persiste como
  `initiatives.expiresAt`;
- si el tipo no está cubierto por la regla, el cómputo no ha comenzado, faltan datos,
  existe evidencia contradictoria o una excepción requiere revisión, la interfaz
  muestra ese estado específico y no fabrica una fecha;
- resoluciones, contratos, convenios, nombramientos y otras iniciativas no heredan
  automáticamente el plazo de dos legislaturas de los proyectos de ley;
- toda API que exponga la presentación derivada debe mantenerla en un objeto separado
  con una base explícita (`OFFICIAL`, `OBSERVED` o `DERIVED`) y un código de razón
  auditable.

## 3. Procedencia obligatoria

Cada registro debe conservar, cuando la fuente lo permita:

- identificador de fuente y clave estable del registro;
- URL oficial;
- valor original o carga `raw` para auditoría;
- fecha propia del evento;
- primera y última observación por Oculis.

Una normalización de formato —por ejemplo, convertir una fecha publicada a ISO— es
válida si no cambia su significado. El texto original debe permanecer trazable.

### 3.1. Vinculación de personas entre fuentes oficiales

Una iniciativa puede vincularse a un perfil del directorio únicamente cuando la
identidad queda demostrada por información publicada por las fuentes y se conserva la
cadena completa de procedencia. Son válidas estas dos bases:

- un identificador de persona publicado directamente junto al proponente; o
- el nombre completo publicado en la ficha, resuelto por igualdad exacta contra el
  catálogo de personas de esa misma fuente, seguido de un puente editorial revisado y
  versionado entre el identificador de ese catálogo y el perfil oficial del directorio.

La segunda base se limita a normalizar Unicode, espacios y mayúsculas/minúsculas. No
autoriza distancia de edición, coincidencia parcial, eliminación de apellidos,
comparación por provincia, partido, cargo ni ninguna otra heurística. En listas de
varios proponentes, cada segmento debe coincidir de forma exacta y única; un literal
ambiguo, institucional o desconocido permanece sin vincular.

Cada relación persistida debe conservar como mínimo la iniciativa, el perfil resuelto,
el namespace y el identificador de persona de la fuente, el nombre literal publicado,
la base de la vinculación y evidencia suficiente para auditarla. Un cambio de
cardinalidad, identificador o nombre en el catálogo oficial detiene la reconciliación;
no modifica automáticamente el puente revisado. La interfaz puede describir una
persona como proponente principal o coproponente solo cuando esa cualidad también fue
publicada; `null` no se convierte en ninguna de las dos.

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
datos respecto de los hechos oficiales. La excepción de §2.1 no autoriza ningún otro
uso de IA. No puede ampliarse mediante una variable de entorno oculta ni como fallback.
