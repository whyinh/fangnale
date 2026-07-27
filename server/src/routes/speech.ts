import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { ASRClient, TTSClient, LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { getSupabaseClient } from "../storage/database/supabase-client";
import { requireAuth, getVisibleOwnerIds } from "../middleware/auth.js";

const router = Router();
const client = getSupabaseClient();
// 所有语音接口均需登录
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const LLM_MODEL = "doubao-seed-1-8-251228";

function extractJson(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("LLM 未返回 JSON");
  return JSON.parse(match[0]) as Record<string, unknown>;
}

/**
 * POST /api/v1/speech/voice-note
 * 语音速记：录音 → ASR 转写 → LLM 拆解为物品草稿
 * Body（FormData）：audio: 音频文件
 * 返回：{ transcript, name, location, category_id, tags }
 */
router.post("/voice-note", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "请上传音频" });
      return;
    }
    const customHeaders = HeaderUtils.extractForwardHeaders(
      req.headers as Record<string, string>
    );
    const config = new Config();

    // 1. ASR 转写
    const asr = new ASRClient(config, customHeaders);
    const asrResult = await asr.recognize({
      uid: "voice-note",
      base64Data: req.file.buffer.toString("base64"),
    });
    const transcript = (asrResult.text || "").trim();
    if (!transcript) {
      res.status(422).json({ error: "没有听清，请靠近一点再说一次" });
      return;
    }

    // 2. 查询分类，LLM 拆解
    const visibleIds = await getVisibleOwnerIds(req.userId!);
    const { data: cats } = await client
      .from("categories")
      .select("id, name")
      .in("owner_id", visibleIds)
      .order("id", { ascending: true });
    const categoryNames = (cats || []).map((c: { name: string }) => c.name);

    const llm = new LLMClient(config, customHeaders);
    const prompt = `你是物品收纳记录助手。用户用语音说了一句话，描述把某物品放在了哪里。请拆解为结构化数据，返回严格 JSON（不要输出任何其他内容）：
{
  "name": "物品名称（简洁，2-10个字）",
  "location": "存放位置（保留用户说的具体细节，如"书房抽屉第二层"；用户没说则为空字符串）",
  "category": "从分类列表中原样选择最匹配的一个",
  "tags": ["1-3个物品特征标签，每个2-6个字"]
}
分类列表：${categoryNames.join("、")}
用户原话：${transcript}`;

    const response = await llm.invoke([{ role: "user", content: prompt }], {
      model: LLM_MODEL,
      temperature: 0.2,
    });

    let name = "";
    let location = "";
    let tags: string[] = [];
    let categoryId: number | null = cats?.[0]?.id ?? null;
    try {
      const parsed = extractJson(response.content);
      if (typeof parsed.name === "string") name = parsed.name.slice(0, 30);
      if (typeof parsed.location === "string") location = parsed.location.slice(0, 100);
      if (Array.isArray(parsed.tags)) {
        tags = parsed.tags.filter((t): t is string => typeof t === "string").slice(0, 3);
      }
      const matched =
        (cats || []).find((c: { name: string }) => c.name === parsed.category) ||
        (cats || []).find((c: { name: string }) =>
          String(parsed.category || "").includes(c.name)
        ) ||
        (cats || []).find((c: { name: string }) => c.name === "其他") ||
        cats?.[0];
      if (matched) categoryId = matched.id;
    } catch {
      // 拆解失败时返回空草稿，由用户手动填写
    }

    res.json({ transcript, name, location, category_id: categoryId, tags });
  } catch (error) {
    console.error("POST /speech/voice-note error:", error);
    res.status(500).json({ error: "语音识别失败，请重试" });
  }
});

/**
 * POST /api/v1/speech/transcribe
 * 语音转文字（语音查找用）
 * Body（FormData）：audio: 音频文件
 * 返回：{ transcript }
 */
router.post("/transcribe", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "请上传音频" });
      return;
    }
    const customHeaders = HeaderUtils.extractForwardHeaders(
      req.headers as Record<string, string>
    );
    const asr = new ASRClient(new Config(), customHeaders);
    const asrResult = await asr.recognize({
      uid: "voice-ask",
      base64Data: req.file.buffer.toString("base64"),
    });
    const transcript = (asrResult.text || "").trim();
    if (!transcript) {
      res.status(422).json({ error: "没有听清，请再说一次" });
      return;
    }
    res.json({ transcript });
  } catch (error) {
    console.error("POST /speech/transcribe error:", error);
    res.status(500).json({ error: "语音识别失败，请重试" });
  }
});

/**
 * POST /api/v1/speech/tts
 * 文字转语音（问答播报用）
 * Body：{ text: string }
 * 返回：{ audio_url: string }
 */
router.post("/tts", async (req: Request, res: Response) => {
  try {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "请提供文本" });
      return;
    }
    const customHeaders = HeaderUtils.extractForwardHeaders(
      req.headers as Record<string, string>
    );
    const tts = new TTSClient(new Config(), customHeaders);
    const result = await tts.synthesize({
      uid: "voice-ask",
      text: text.trim().slice(0, 300),
      speaker: "zh_female_vv_uranus_bigtts",
      audioFormat: "mp3",
    });
    res.json({ audio_url: result.audioUri });
  } catch (error) {
    console.error("POST /speech/tts error:", error);
    res.status(500).json({ error: "语音合成失败" });
  }
});

export default router;
