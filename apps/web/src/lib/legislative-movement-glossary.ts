import type { Lang } from "@/lib/i18n";

type BilingualText = Readonly<Record<Lang, string>>;

export type LegislativeMovementDefinition = Readonly<{
  id: string;
  label: BilingualText;
  description: BilingualText;
  patterns: readonly RegExp[];
}>;

export type LocalizedLegislativeMovementDefinition = Readonly<{
  id: string;
  label: string;
  description: string;
  known: boolean;
}>;

function normalizeMovement(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[.,:;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Plain-language explanations of the source-literal movements seen in the
 * official Chamber of Deputies and Senate histories. These definitions explain
 * the procedural step only; they never rewrite the stored source value.
 */
export const LEGISLATIVE_MOVEMENT_DEFINITIONS: readonly LegislativeMovementDefinition[] = [
  {
    id: "filed",
    label: { es: "Iniciativa depositada", en: "Initiative filed" },
    description: {
      es: "La cámara registró formalmente la iniciativa y abrió su expediente. El depósito inicia el trámite documentado; no significa que haya sido aprobada.",
      en: "The chamber formally registered the initiative and opened its record. Filing starts the documented process; it does not mean the initiative was approved.",
    },
    patterns: [/^(iniciativa )?depositad[oa]$/],
  },
  {
    id: "reintroduced",
    label: { es: "Iniciativa reintroducida", en: "Initiative reintroduced" },
    description: {
      es: "La propuesta fue presentada nuevamente como un expediente legislativo nuevo. La reintroducción no revive ni cambia la vigencia del expediente anterior.",
      en: "The proposal was filed again as a new legislative record. Reintroduction does not revive or change the validity of the former record.",
    },
    patterns: [/^reintroducid[oa]$/],
  },
  {
    id: "agenda-consideration",
    label: { es: "En agenda para tomar en consideración", en: "Scheduled for consideration" },
    description: {
      es: "La iniciativa fue incluida en una agenda para que el pleno decida si la admite formalmente a trámite. Estar en agenda no equivale a aprobación.",
      en: "The initiative was placed on an agenda so the plenary may decide whether to formally take it up. Being scheduled does not equal approval.",
    },
    patterns: [/^en agenda para tomar en consideracion$/],
  },
  {
    id: "agenda",
    label: { es: "En agenda", en: "On the agenda" },
    description: {
      es: "La fuente incluyó la iniciativa para conocimiento o tratamiento en una sesión. Este movimiento no confirma que ya fue debatida ni votada.",
      en: "The source listed the initiative for notice or treatment in a session. This movement does not confirm that it was already debated or voted on.",
    },
    patterns: [/^en agenda$/],
  },
  {
    id: "taken-into-consideration",
    label: { es: "Tomada en consideración", en: "Taken into consideration" },
    description: {
      es: "El pleno aceptó conocer la iniciativa y permitir que continúe su trámite. Todavía no es una aprobación final.",
      en: "The plenary agreed to take up the initiative and allow its process to continue. This is not final approval.",
    },
    patterns: [/^tomad[oa] en consideracion$/],
  },
  {
    id: "sent-to-committee",
    label: { es: "Enviada a Comisión", en: "Sent to Committee" },
    description: {
      es: "La iniciativa fue remitida a una comisión para estudio, consultas y posible informe. La remisión no significa que la comisión ni el pleno la hayan aprobado.",
      en: "The initiative was referred to a committee for study, consultation, and a possible report. Referral does not mean the committee or plenary approved it.",
    },
    patterns: [/^enviad[oa] a comision$/, /^en comision$/],
  },
  {
    id: "fixed-deadline",
    label: { es: "Con plazo fijo", en: "Committee given a fixed deadline" },
    description: {
      es: "La comisión recibió una fecha límite específica para rendir su informe. Es un plazo del trámite: no significa aprobación, promulgación ni vigencia legislativa.",
      en: "The committee received a specific deadline to submit its report. This is a procedural deadline; it does not mean approval, enactment, or legislative validity.",
    },
    patterns: [/^con plazo fijo$/],
  },
  {
    id: "deadline-expired",
    label: { es: "Plazo vencido", en: "Procedural deadline expired" },
    description: {
      es: "Terminó el plazo procesal asignado para completar una actuación, normalmente un informe de comisión. No equivale por sí solo a que la iniciativa esté perimida o no vigente.",
      en: "The procedural deadline assigned to complete an action, usually a committee report, ended. By itself, this does not mean the initiative expired legislatively or is no longer valid.",
    },
    patterns: [/^plazo vencido$/],
  },
  {
    id: "committee-report",
    label: { es: "Informe emitido por Comisión", en: "Committee report issued" },
    description: {
      es: "La comisión concluyó su estudio y emitió un informe para la cámara. Oculis no presume que fue favorable o desfavorable si la fuente no lo indica.",
      en: "The committee completed its study and issued a report to the chamber. Oculis does not assume it was favorable or unfavorable unless the source says so.",
    },
    patterns: [/^con informe de (la )?comision$/, /^informe emitido por comision$/],
  },
  {
    id: "report-read",
    label: { es: "Informe leído", en: "Committee report read" },
    description: {
      es: "El informe de la comisión fue leído o presentado ante el pleno. La lectura no significa que el informe o la iniciativa hayan sido aprobados.",
      en: "The committee report was read or presented to the plenary. Reading it does not mean the report or initiative was approved.",
    },
    patterns: [/^informe leido$/],
  },
  {
    id: "released-from-committee",
    label: { es: "Liberada de Comisión", en: "Released from Committee" },
    description: {
      es: "La cámara dispuso que la iniciativa continúe sin permanecer en la comisión indicada. El siguiente paso debe leerse en el movimiento posterior publicado por la fuente.",
      en: "The chamber allowed the initiative to continue without remaining before the named committee. The next step must be read from the following source-published movement.",
    },
    patterns: [/^liberad[oa] de comision$/],
  },
  {
    id: "procedures-waived",
    label: { es: "Liberada de trámites", en: "Procedural steps waived" },
    description: {
      es: "La cámara dispensó uno o más trámites ordinarios para acelerar el conocimiento de la iniciativa. Esta dispensa no es, por sí sola, una aprobación.",
      en: "The chamber waived one or more ordinary procedural steps to accelerate consideration. The waiver is not, by itself, approval.",
    },
    patterns: [/^liberad[oa] de tramites$/],
  },
  {
    id: "tabled",
    label: { es: "Sobre la mesa", en: "Tabled" },
    description: {
      es: "El conocimiento de la iniciativa fue aplazado o diferido. No significa que haya sido rechazada ni que haya perdido su vigencia legislativa.",
      en: "Consideration of the initiative was postponed or deferred. It does not mean it was rejected or lost its legislative validity.",
    },
    patterns: [/^sobre la mesa(?: .*discusion)?$/],
  },
  {
    id: "next-session-order",
    label: { es: "Orden del día de la siguiente sesión", en: "Next session's order of business" },
    description: {
      es: "La cámara dispuso incluir la iniciativa en el orden del día de su próxima sesión. Aún no acredita debate ni votación.",
      en: "The chamber ordered the initiative placed on the next session's order of business. It does not yet establish that debate or a vote occurred.",
    },
    patterns: [/^orden del dia de (la )?siguiente sesion$/],
  },
  {
    id: "order-of-business",
    label: { es: "En orden del día", en: "On the order of business" },
    description: {
      es: "La iniciativa quedó colocada para debate o decisión en el orden del día. Si la fuente señala primera o segunda discusión, esa es la etapa programada; todavía no prueba aprobación.",
      en: "The initiative was placed for debate or decision on the order of business. When the source names a first or second reading, that is the scheduled stage; it does not yet prove approval.",
    },
    patterns: [/^en orden del dia(?: para .*discusion)?$/],
  },
  {
    id: "urgent-second-approved",
    label: {
      es: "Declarada de urgencia y aprobada en segunda lectura",
      en: "Declared urgent and approved on second reading",
    },
    description: {
      es: "La cámara aplicó el trámite de urgencia y aprobó la iniciativa en segunda lectura. Aún pueden quedar pasos formales posteriores antes de una eventual promulgación.",
      en: "The chamber used the urgent procedure and approved the initiative on second reading. Formal steps may still remain before possible enactment.",
    },
    patterns: [/^declarad[oa] de urgencia y aprobad[oa] en (seg|segunda|2da).*lectura$/],
  },
  {
    id: "urgent-first-approved",
    label: {
      es: "Declarada de urgencia y aprobada en primera lectura",
      en: "Declared urgent and approved on first reading",
    },
    description: {
      es: "La cámara aplicó el trámite de urgencia y aprobó la iniciativa en primera lectura. No es todavía una aprobación definitiva cuando corresponde una segunda lectura.",
      en: "The chamber used the urgent procedure and approved the initiative on first reading. It is not yet final approval when a second reading is required.",
    },
    patterns: [/^declarad[oa] de urgencia y aprobad[oa] en (1ra|primera).*lectura$/],
  },
  {
    id: "urgent",
    label: { es: "Declarada de urgencia", en: "Declared urgent" },
    description: {
      es: "La cámara acordó un trámite acelerado para conocer la iniciativa. La declaración de urgencia no equivale por sí sola a aprobación.",
      en: "The chamber agreed to use an accelerated procedure to consider the initiative. An urgency declaration does not by itself equal approval.",
    },
    patterns: [/^declarad[oa] de urgencia$/],
  },
  {
    id: "approved-first",
    label: { es: "Aprobada en primera lectura", en: "Approved on first reading" },
    description: {
      es: "La cámara aprobó la iniciativa en su primera lectura. Cuando el procedimiento exige una segunda lectura, aún no es la aprobación legislativa final.",
      en: "The chamber approved the initiative on first reading. When a second reading is required, this is not yet final legislative approval.",
    },
    patterns: [/^aprobad[oa] en (1ra|primera).*lectura$/],
  },
  {
    id: "approved-second",
    label: { es: "Aprobada en segunda lectura", en: "Approved on second reading" },
    description: {
      es: "La cámara aprobó la iniciativa en segunda lectura. Pueden quedar firma, despacho, conocimiento de la otra cámara o promulgación, según corresponda.",
      en: "The chamber approved the initiative on second reading. Signatures, dispatch, consideration by the other chamber, or enactment may still remain, as applicable.",
    },
    patterns: [/^aprobad[oa] en (2da|segunda).*lectura$/],
  },
  {
    id: "approved-single",
    label: { es: "Aprobada en única lectura", en: "Approved in a single reading" },
    description: {
      es: "La cámara aprobó la iniciativa en el único debate requerido para esa etapa. Esto no equivale automáticamente a promulgación ni publicación como ley.",
      en: "The chamber approved the initiative in the single debate required for that stage. This does not automatically equal enactment or publication as law.",
    },
    patterns: [/^aprobad[oa] en unica lectura$/],
  },
  {
    id: "approved",
    label: { es: "Aprobada", en: "Approved" },
    description: {
      es: "La fuente registra una aprobación sin especificar aquí la lectura o el alcance. Deben revisarse los movimientos y documentos siguientes antes de asumir que el trámite concluyó.",
      en: "The source records approval without specifying the reading or scope here. Later movements and documents should be reviewed before assuming the process concluded.",
    },
    patterns: [/^aprobad[oa]$/],
  },
  {
    id: "under-audit",
    label: { es: "En auditoría legislativa", en: "Under legislative audit" },
    description: {
      es: "El texto está en revisión técnica legislativa para comprobar su forma y correspondencia con lo decidido. No es una nueva votación ni una declaración de vigencia.",
      en: "The text is under legislative technical review to verify its form and correspondence with the decision. This is not a new vote or a validity determination.",
    },
    patterns: [/^en auditoria legislativa$/],
  },
  {
    id: "audited",
    label: { es: "Auditada", en: "Legislative audit completed" },
    description: {
      es: "La revisión técnica legislativa fue completada para esta etapa. El movimiento no equivale a promulgación.",
      en: "The legislative technical review was completed for this stage. This movement does not equal enactment.",
    },
    patterns: [/^auditad[oa](?: .*discusion)?$/],
  },
  {
    id: "transcription",
    label: { es: "En transcripción legislativa", en: "In legislative transcription" },
    description: {
      es: "El texto resultante está siendo preparado o transcrito para los pasos formales posteriores. No indica una decisión legislativa nueva.",
      en: "The resulting text is being prepared or transcribed for later formal steps. It does not indicate a new legislative decision.",
    },
    patterns: [/^en transcripcion legislativa$/],
  },
  {
    id: "certified",
    label: { es: "Certificada", en: "Certified" },
    description: {
      es: "La secretaría de la cámara completó la certificación correspondiente a esta etapa. Certificación no significa promulgación por el Poder Ejecutivo.",
      en: "The chamber secretariat completed the certification for this stage. Certification does not mean enactment by the Executive Branch.",
    },
    patterns: [/^certificad[oa](?: .*discusion)?$/],
  },
  {
    id: "awaiting-signatures",
    label: {
      es: "Esperando firmas de Presidencia y Secretarías",
      en: "Awaiting chamber officers' signatures",
    },
    description: {
      es: "El documento está pendiente de las firmas formales de las autoridades de la cámara. Todavía no equivale a promulgación.",
      en: "The document is awaiting the formal signatures of chamber officers. It does not yet equal enactment.",
    },
    patterns: [/^esperando firmas? (de )?presidente y secretarios$/],
  },
  {
    id: "signed",
    label: { es: "Firmada por Presidencia y Secretarías", en: "Signed by chamber officers" },
    description: {
      es: "Las autoridades de la cámara completaron las firmas formales del documento. Este paso no es lo mismo que la promulgación del Poder Ejecutivo.",
      en: "The chamber officers completed the document's formal signatures. This step is not the same as enactment by the Executive Branch.",
    },
    patterns: [/^firmad[oa] presidencia y secretarios(?: .*unica)?$/],
  },
  {
    id: "dispatched",
    label: { es: "Despachada", en: "Dispatched" },
    description: {
      es: "La cámara remitió formalmente el expediente al órgano o etapa siguiente que corresponda. El destino exacto debe confirmarse en la evidencia oficial.",
      en: "The chamber formally sent the record to the applicable next body or stage. The exact destination should be confirmed in the official evidence.",
    },
    patterns: [/^despachad[oa](?: unica lectura)?$/],
  },
  {
    id: "promulgated",
    label: { es: "Promulgada", en: "Enacted" },
    description: {
      es: "El Poder Ejecutivo promulgó la iniciativa aprobada. Su publicación y fecha de entrada en vigor deben verificarse en la norma o gaceta correspondiente.",
      en: "The Executive Branch enacted the approved initiative. Publication and effective date must be verified in the resulting law or official gazette.",
    },
    patterns: [/^promulgad[oa]$/],
  },
  {
    id: "merged",
    label: { es: "Fusionada", en: "Merged" },
    description: {
      es: "El contenido fue unido a otra iniciativa o expediente para continuar bajo un trámite común. Debe seguirse el expediente receptor indicado por la fuente.",
      en: "The content was combined with another initiative or record to continue under a common process. Follow the receiving record identified by the source.",
    },
    patterns: [/^fusionad[oa]$/],
  },
  {
    id: "withdrawn",
    label: { es: "Retirada", en: "Withdrawn" },
    description: {
      es: "La iniciativa fue retirada y dejó de continuar bajo este expediente, según la fuente oficial.",
      en: "The initiative was withdrawn and stopped proceeding under this record, according to the official source.",
    },
    patterns: [/^retirad[oa]$/],
  },
  {
    id: "expired-legislatively",
    label: { es: "Perimida — no vigente", en: "Expired — no longer legislatively valid" },
    description: {
      es: "El expediente superó sus dos períodos legislativos sin concluir y sin una reintroducción aplicable. Perdió vigencia legislativa; una reintroducción se trata como un expediente nuevo.",
      en: "The record exceeded its two legislative periods without concluding and without an applicable reintroduction. It lost legislative validity; a reintroduction is treated as a new record.",
    },
    patterns: [/^perimid[oa]$/],
  },
  {
    id: "rejected",
    label: { es: "Rechazada", en: "Rejected" },
    description: {
      es: "La cámara rechazó la iniciativa en la decisión registrada por la fuente, por lo que ese expediente no continúa su trámite ordinario.",
      en: "The chamber rejected the initiative in the decision recorded by the source, so that record does not continue through the ordinary process.",
    },
    patterns: [/^rechazad[oa]$/],
  },
  {
    id: "archives",
    label: { es: "En Archivo y Correspondencia", en: "In Archives and Correspondence" },
    description: {
      es: "El expediente se encuentra en una etapa administrativa de archivo, registro o correspondencia. Este movimiento no es una aprobación sustantiva.",
      en: "The record is in an administrative archive, registration, or correspondence stage. This movement is not substantive approval.",
    },
    patterns: [/^(remitid[oa] a )?archivo y correspondencia$/, /^en archivo y correspondencia$/],
  },
  {
    id: "plenary",
    label: { es: "En Pleno", en: "Before the plenary" },
    description: {
      es: "La iniciativa está ante el pleno para conocimiento o decisión. El movimiento específico siguiente indica si hubo debate, votación o aplazamiento.",
      en: "The initiative is before the plenary for consideration or decision. The next specific movement indicates whether debate, a vote, or postponement occurred.",
    },
    patterns: [/^en pleno$/],
  },
  {
    id: "valid",
    label: { es: "Vigente", en: "Legislatively valid" },
    description: {
      es: "Es una condición de vigencia legislativa: la iniciativa permanece dentro de sus dos períodos legislativos o fue reintroducida como expediente nuevo. No describe un movimiento del trámite.",
      en: "This is a legislative-validity condition: the initiative remains within its two legislative periods or was reintroduced as a new record. It does not describe a procedural movement.",
    },
    patterns: [/^vigente$/],
  },
  {
    id: "not-valid",
    label: { es: "No vigente", en: "No longer legislatively valid" },
    description: {
      es: "Es una condición de vigencia legislativa: el expediente ya no está dentro de los dos períodos legislativos permitidos y no fue reintroducido como un expediente nuevo. No describe una consulta pública ni un plazo de comisión.",
      en: "This is a legislative-validity condition: the record is no longer within the two permitted legislative periods and was not reintroduced as a new record. It does not describe a public consultation or committee deadline.",
    },
    patterns: [/^no vigente$/],
  },
] as const;

export function legislativeMovementDefinition(
  status: string | null | undefined,
  lang: Lang,
): LocalizedLegislativeMovementDefinition | null {
  if (!status?.trim()) return null;
  const normalized = normalizeMovement(status);
  const definition = LEGISLATIVE_MOVEMENT_DEFINITIONS.find(({ patterns }) =>
    patterns.some((pattern) => pattern.test(normalized)),
  );

  if (definition) {
    return {
      id: definition.id,
      label: definition.label[lang],
      description: definition.description[lang],
      known: true,
    };
  }

  return {
    id: `source-${normalized || "unknown"}`,
    label: status,
    description:
      lang === "es"
        ? "La fuente oficial publicó este texto como movimiento. Oculis lo conserva literalmente porque todavía no cuenta con una definición procedimental verificada para este término."
        : "The official source published this text as a movement. Oculis preserves it literally because it does not yet have a verified procedural definition for this term.",
    known: false,
  };
}

export function localizedLegislativeMovementGlossary(
  lang: Lang,
): readonly LocalizedLegislativeMovementDefinition[] {
  return LEGISLATIVE_MOVEMENT_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label[lang],
    description: definition.description[lang],
    known: true,
  }));
}
