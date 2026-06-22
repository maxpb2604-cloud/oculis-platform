/**
 * Real risk scoring — estimates the three analyst-judgment inputs per initiative so the
 * ported Excel formulas in `@oculis/core` produce a genuine ALTO/MEDIO/BAJO spread
 * (instead of the placeholder "everything is MEDIO").
 *
 * Mirrors the Categorizer pattern in categorize.ts:
 *   - HeuristicScoreEstimator — free, derives weak signal from party (ruling party → more
 *     likely executive support). Used when Claude is not opted in.
 *   - ClaudeScoreEstimator    — Claude (Haiku, structured outputs) reads the bill's title,
 *     purpose, sponsor and party and estimates executive support, key-stakeholder support,
 *     and public-opinion pressure, with a short rationale. Opt-in (OCULIS_USE_CLAUDE=1).
 *
 * The five scoring inputs combine here: party strength + sponsor record (derived elsewhere)
 * plus these three estimated fields. Scores stay `needsReview` (labelled "IA" in the UI)
 * until an analyst confirms them.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { YesNo } from "@oculis/core";

export interface ScoreEstimateInput {
  title: string;
  purpose: string | null;
  sponsor: string | null;
  party: string | null;
  category: string | null;
  partyStrength: "GOBIERNO" | "OPOSICION_TERCIO" | "OPOSICION_MENOR" | null;
}

export interface ScoreEstimate {
  executiveSupport: YesNo;
  stakeholderSupport: YesNo;
  socialPressureCount: number; // 0..20, bucketed by the formula (<6 / 6-10 / >10)
  rationale: string;
  confidence: number;
  by: "heuristic" | "claude";
}

export interface ScoreEstimator {
  readonly kind: "heuristic" | "claude";
  estimate(input: ScoreEstimateInput): Promise<ScoreEstimate>;
}

export class HeuristicScoreEstimator implements ScoreEstimator {
  readonly kind = "heuristic" as const;
  async estimate(input: ScoreEstimateInput): Promise<ScoreEstimate> {
    // Ruling-party bills tend to have executive backing; everything else conservative.
    const exec: YesNo = input.partyStrength === "GOBIERNO" ? "SI" : "NO";
    return {
      executiveSupport: exec,
      stakeholderSupport: "NO",
      socialPressureCount: 0,
      rationale: "Estimación heurística (sin IA): apoyo ejecutivo inferido del partido.",
      confidence: 0.3,
      by: "heuristic",
    };
  }
}

const SYSTEM = `Eres analista de riesgo legislativo de Oculis Auribus (República Dominicana). Evalúas una iniciativa y estimas tres factores que determinan su probabilidad de aprobación y riesgo para el sector empresarial. Sé realista y conservador; básate solo en la información dada y el contexto político dominicano (partido de gobierno actual: PRM).`;

export class ClaudeScoreEstimator implements ScoreEstimator {
  readonly kind = "claude" as const;
  private readonly model: string;
  constructor(
    private readonly client: Anthropic,
    model = process.env.OCULIS_CLASSIFIER_MODEL || "claude-haiku-4-5",
  ) {
    this.model = model;
  }

  async estimate(input: ScoreEstimateInput): Promise<ScoreEstimate> {
    const user = [
      `Título: ${input.title}`,
      input.purpose ? `Objeto: ${input.purpose}` : "",
      input.sponsor ? `Proponente: ${input.sponsor}` : "",
      input.party ? `Partido: ${input.party}` : "",
      input.category ? `Categoría: ${input.category}` : "",
      "",
      "Estima:",
      "- executiveSupport: ¿cuenta con apoyo del Poder Ejecutivo? (SI/NO)",
      "- stakeholderSupport: ¿existen grupos/asociaciones clave que la apoyan? (SI/NO)",
      "- socialPressureCount: nivel de presión/atención de la opinión pública, en una escala 0-20 (0=ninguna, >10=alta cobertura/presión)",
      "- rationale: una frase breve justificando.",
      "- confidence: 0 a 1.",
    ]
      .filter(Boolean)
      .join("\n");

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "executiveSupport",
              "stakeholderSupport",
              "socialPressureCount",
              "rationale",
              "confidence",
            ],
            properties: {
              executiveSupport: { type: "string", enum: ["SI", "NO"] },
              stakeholderSupport: { type: "string", enum: ["SI", "NO"] },
              socialPressureCount: { type: "integer" },
              rationale: { type: "string" },
              confidence: { type: "number" },
            },
          },
        },
      },
    });

    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return new HeuristicScoreEstimator().estimate(input);
    const p = JSON.parse(text.text) as {
      executiveSupport: YesNo;
      stakeholderSupport: YesNo;
      socialPressureCount: number;
      rationale: string;
      confidence: number;
    };
    return {
      executiveSupport: p.executiveSupport === "SI" ? "SI" : "NO",
      stakeholderSupport: p.stakeholderSupport === "SI" ? "SI" : "NO",
      socialPressureCount: clamp(p.socialPressureCount ?? 0, 0, 20),
      rationale: p.rationale ?? "",
      confidence: p.confidence ?? 0,
      by: "claude",
    };
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function createScoreEstimator(): ScoreEstimator {
  if (process.env.OCULIS_USE_CLAUDE === "1" && process.env.ANTHROPIC_API_KEY) {
    return new ClaudeScoreEstimator(new Anthropic());
  }
  return new HeuristicScoreEstimator();
}
