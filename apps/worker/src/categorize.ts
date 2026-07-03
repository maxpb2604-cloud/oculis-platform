/**
 * Auto-categorization of initiatives into the Oculis taxonomy (Phase 3).
 *
 * Two implementations behind one `Categorizer` interface:
 *   - HeuristicCategorizer  — maps the source's own subject group → our Category
 *     deterministically. Works with NO API key; used as the offline default and as a
 *     cheap pre-filter. Lower confidence; unmapped groups return null (stays needsReview).
 *   - ClaudeCategorizer     — uses Claude (Anthropic API) with structured outputs to
 *     classify from title + subject + purpose. Used when ANTHROPIC_API_KEY is set.
 *
 * `createCategorizer()` picks Claude when a key is present, else the heuristic.
 *
 * MODEL NOTE: defaults to `claude-haiku-4-5` for this high-volume classification job
 * (cheapest model that supports structured outputs). Override with OCULIS_CLASSIFIER_MODEL
 * (e.g. `claude-opus-4-8`). Billing requires a funded Anthropic key — see app/.env.example.
 */
import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@oculis/core";

export interface CategorizeInput {
  title: string;
  sourceCategory: string | null; // e.g. SIL grupo / materia
  purpose?: string | null;
}

export interface CategoryResult {
  category: Category | null;
  confidence: number; // 0..1
  by: "heuristic" | "claude";
}

export interface Categorizer {
  readonly kind: "heuristic" | "claude";
  categorize(input: CategorizeInput): Promise<CategoryResult>;
}

/**
 * Maps the Cámara de Diputados SIL subject groups (Grupos) to our taxonomy.
 * The mapping is approximate — SIL groups are coarser and don't align 1:1 with the
 * Oculis business categories — so confidences are modest and unknown groups defer to
 * Claude/analyst review.
 */
const GRUPO_TO_CATEGORY: Array<[RegExp, Category, number]> = [
  [/municipal|administraci[oó]n/i, "ASUNTOS_MUNICIPALES", 0.7],
  [/agric|agro|pesca|ganader/i, "AGRO", 0.8],
  [/econom|finanz|presupuesto|tribut|fiscal|aduana/i, "FISCAL", 0.7],
  [/salud|sanitar/i, "SALUD", 0.85],
  [/trabajo|laboral|empleo/i, "LABORAL", 0.85],
  [/energ/i, "ENERGIA", 0.85],
  [/turismo/i, "TURISMO", 0.85],
  [/transport|tr[aá]nsito|movilidad/i, "MOVILIDAD", 0.8],
  [/medio ambiente|sostenib|ambiental/i, "SOSTENIBILIDAD", 0.8],
  [/telecom|tecnolog|tic|digital/i, "TIC", 0.8],
  [/industri|comercio/i, "INDUSTRIA_Y_COMERCIO", 0.7],
  [/seguridad|defensa|polic/i, "SEGURIDAD_PUBLICA", 0.75],
  [/justic|legal|jur[ií]dic/i, "LEGAL", 0.6],
  [/electoral|fiscalizaci[oó]n|gobierno|institucion/i, "GOBIERNO_E_INSTITUCIONES", 0.6],
];

export class HeuristicCategorizer implements Categorizer {
  readonly kind = "heuristic" as const;
  async categorize(input: CategorizeInput): Promise<CategoryResult> {
    const hay = `${input.sourceCategory ?? ""} ${input.title}`;
    for (const [re, category, confidence] of GRUPO_TO_CATEGORY) {
      if (re.test(hay)) return { category, confidence, by: "heuristic" };
    }
    return { category: null, confidence: 0, by: "heuristic" };
  }
}

const SYSTEM_PROMPT = `Eres un analista de Oculis Auribus, una firma de monitoreo legislativo y regulatorio en República Dominicana. Clasificas iniciativas legislativas y regulatorias en UNA categoría temática de negocio. Responde solo con la categoría más relevante y una confianza de 0 a 1.`;

const CATEGORY_LIST = CATEGORIES.map((c) => `${c} (${CATEGORY_LABELS[c]})`).join(", ");

export class ClaudeCategorizer implements Categorizer {
  readonly kind = "claude" as const;
  private readonly model: string;
  constructor(
    private readonly client: Anthropic,
    model = process.env.OCULIS_CLASSIFIER_MODEL || "claude-haiku-4-5",
  ) {
    this.model = model;
  }

  async categorize(input: CategorizeInput): Promise<CategoryResult> {
    const user = [
      `Título: ${input.title}`,
      input.sourceCategory ? `Materia/Grupo de origen: ${input.sourceCategory}` : "",
      input.purpose ? `Objeto: ${input.purpose}` : "",
      "",
      `Categorías válidas: ${CATEGORY_LIST}`,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["category", "confidence"],
            properties: {
              category: { type: "string", enum: [...CATEGORIES] },
              confidence: { type: "number" },
            },
          },
        },
      },
    });

    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return { category: null, confidence: 0, by: "claude" };
    let parsed: { category: string; confidence: number };
    try {
      parsed = JSON.parse(text.text) as typeof parsed;
    } catch {
      // Malformed/truncated model JSON — per-item null result (stays needsReview).
      // Deliberately NOT thrown: one bad response must not degrade the whole run.
      return { category: null, confidence: 0, by: "claude" };
    }
    const category = (CATEGORIES as readonly string[]).includes(parsed.category)
      ? (parsed.category as Category)
      : null;
    return { category, confidence: clamp01(parsed.confidence ?? 0), by: "claude" };
  }
}

/** Clamp a model-returned confidence to [0,1] (8 or -0.3 must not persist). */
function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Wraps a primary categorizer (Claude) with the offline heuristic as a fallback.
 * On the FIRST primary failure it logs once and switches to the heuristic for the
 * rest of the run, so a billing/API outage degrades gracefully instead of failing
 * the whole scrape. Degrading the entire run is intentional: malformed model JSON
 * is handled per-item inside ClaudeCategorizer and never throws, so any error that
 * reaches this catch is a real API failure (no credit, bad key, rate limit,
 * network) that would recur on every subsequent call.
 */
export class FallbackCategorizer implements Categorizer {
  readonly kind = "claude" as const;
  private readonly fallback = new HeuristicCategorizer();
  private degraded = false;
  constructor(private readonly primary: Categorizer) {}

  async categorize(input: CategorizeInput): Promise<CategoryResult> {
    if (this.degraded) return this.fallback.categorize(input);
    try {
      return await this.primary.categorize(input);
    } catch (err) {
      this.degraded = true;
      console.warn(
        `⚠️  Categorizador Claude no disponible (${(err as Error).message}). ` +
          `Usando heurística offline para el resto de esta corrida.`,
      );
      return this.fallback.categorize(input);
    }
  }
}

/**
 * Pick the categorizer. The offline heuristic is the default and ALWAYS works
 * with no API key. Claude is STRICTLY OPT-IN (OCULIS_USE_CLAUDE=1 + ANTHROPIC_API_KEY)
 * and, when enabled, is wrapped so any API failure falls back to the heuristic.
 */
export function createCategorizer(): Categorizer {
  const optedIn = process.env.OCULIS_USE_CLAUDE === "1";
  if (optedIn && process.env.ANTHROPIC_API_KEY) {
    return new FallbackCategorizer(new ClaudeCategorizer(new Anthropic()));
  }
  return new HeuristicCategorizer();
}
