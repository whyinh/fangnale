/**
 * 火山引擎方舟大模型直连层（OpenAI 兼容端点）
 * 替换原沙箱 coze-coding-dev-sdk 的 LLMClient
 * 文档：https://www.volcengine.com/docs/82379/1298454
 */
import OpenAI from "openai";

const ark = new OpenAI({
  baseURL: process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: process.env.ARK_API_KEY || "",
  timeout: 60_000,
});

const DEFAULT_MODEL = process.env.ARK_MODEL || "doubao-seed-1-8-251228";

// 与沙箱 SDK 对齐的消息形态（content 支持纯文本或多模态数组）
export interface ArkMessage {
  role: "system" | "user" | "assistant";
  content: unknown;
}

export interface ArkInvokeConfig {
  model?: string;
  /** "disabled" 关闭深度思考（更快更省），默认关闭 */
  thinking?: string;
  temperature?: number;
  maxTokens?: number;
}

function buildParams(messages: ArkMessage[], config: ArkInvokeConfig) {
  const params: Record<string, unknown> = {
    model: config.model || DEFAULT_MODEL,
    messages,
    // 方舟扩展字段：控制深度思考（OpenAI 官方无此字段，需 as any 透传）
    thinking: { type: config.thinking === "enabled" ? "enabled" : "disabled" },
  };
  if (config.temperature !== undefined) params.temperature = config.temperature;
  if (config.maxTokens !== undefined) params.max_tokens = config.maxTokens;
  return params;
}

/** 非流式调用，返回 { content }（对齐沙箱 LLMClient.invoke 返回形态） */
export async function llmInvoke(
  messages: ArkMessage[],
  config: ArkInvokeConfig = {}
): Promise<{ content: string }> {
  // 方舟扩展字段（thinking）不在 OpenAI 官方类型内，透传需绕过静态类型
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp = (await ark.chat.completions.create(buildParams(messages, config) as any)) as any;
  const content = resp.choices?.[0]?.message?.content;
  return { content: typeof content === "string" ? content : "" };
}

/** 流式调用，逐块产出 { content }（对齐沙箱 LLMClient.stream 的 chunk.content 形态） */
export async function* llmStream(
  messages: ArkMessage[],
  config: ArkInvokeConfig = {}
): AsyncGenerator<{ content: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = (await ark.chat.completions.create({
    ...buildParams(messages, config),
    stream: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as any;

  for await (const chunk of stream) {
    const content = chunk.choices?.[0]?.delta?.content;
    if (typeof content === "string" && content) {
      yield { content };
    }
  }
}
