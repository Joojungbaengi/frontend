/**
 * AWS Bedrock에서 Claude를 호출해 최종 3종을 선정한다.
 * AWS 자격 증명은 .env.local의 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION 에서 읽는다.
 * (이 파일은 서버에서만 import 할 것 — 브라우저 번들에 들어가면 안 됨)
 */
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { buildUserPrompt, RECOMMEND_SCHEMA, SYSTEM_PROMPT } from "./prompt";
import type { ScoredDrink, SurveyAnswers } from "./types";

// 이 계정에서 접근 가능한 최신 모델 (global 크로스 리전 프로파일 — us-east-1에서 호출)
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-sonnet-4-5-20250929-v1:0";

let client: AnthropicBedrock | null = null;

function getClient(): AnthropicBedrock {
  if (!client) {
    client = new AnthropicBedrock({
      awsRegion: process.env.AWS_REGION ?? "us-east-1",
    });
  }
  return client;
}

/** AWS 자격 증명이 설정되어 있는지 (없으면 route에서 규칙 기반 fallback 사용) */
export function isBedrockConfigured(): boolean {
  return Boolean(
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
      (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  );
}

export interface AiPick {
  id: string;
  reason: string;
}

/**
 * Top 10 후보 + 유저 취향을 Claude에 전달해 3개 선정.
 * 구조화 출력(json_schema)으로 항상 유효한 JSON을 보장한다.
 */
export async function pickTop3(answers: SurveyAnswers, candidates: ScoredDrink[]): Promise<AiPick[]> {
  const response = await getClient().messages.create({
    model: MODEL_ID,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: RECOMMEND_SCHEMA } },
    messages: [{ role: "user", content: buildUserPrompt(answers, candidates) }],
  });

  // 구조화 출력이므로 첫 text 블록이 스키마에 맞는 JSON이다 (thinking 블록이 앞에 올 수 있음)
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`Bedrock 응답에 text 블록이 없음 (stop_reason: ${response.stop_reason})`);
  }

  const parsed = JSON.parse(textBlock.text) as { recommendations: AiPick[] };

  // 할루시네이션 방지: 후보 목록에 있는 id만 통과시킨다
  const validIds = new Set(candidates.map((c) => c.drink.id));
  const picks = parsed.recommendations.filter((r) => validIds.has(r.id)).slice(0, 3);
  if (picks.length === 0) {
    throw new Error("Bedrock이 후보 목록에 없는 id만 반환함");
  }
  return picks;
}
