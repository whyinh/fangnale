import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { llmInvoke } from "../services/llm.js";
import { asrRecognize, ttsSynthesize, detectAudioFormat } from "../services/speech.js";
import { getSupabaseClient } from "../storage/database/supabase-client";
import { requireAuth, getVisibleOwnerIds } from "../middleware/auth.js";
import { resolveCategoryId, type CategoryBrief } from "../utils/auto-category.js";

const router = Router();
const client = getSupabaseClient();
// 所有语音接口均需登录
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

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
    // 1. ASR 转写
    const asrResult = await asrRecognize({
      uid: "voice-note",
      base64Data: req.file.buffer.toString("base64"),
      format: detectAudioFormat(req.file.originalname, req.file.mimetype),
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

    const prompt = `你是物品收纳记录助手。用户用语音说了一句话，描述把某物品放在了哪里。请拆解为结构化数据，返回严格 JSON（不要输出任何其他内容）：
{
  "name": "物品名称（简洁，2-10个字）",
  "location": "存放位置（保留用户说的具体细节，如"书房抽屉第二层"；用户没说则为空字符串）",
  "category": "优先从分类列表中原样选择最匹配的一个；都不合适时给一个简洁的新大类名（2-4个字），系统会自动创建",
  "tags": ["1-3个物品特征标签，每个2-6个字"]
}
分类列表：${categoryNames.join("、")}
用户原话：${transcript}`;

    const response = await llmInvoke([{ role: "user", content: prompt }], {
      temperature: 0.2,
    });

    let name = "";
    let location = "";
    let tags: string[] = [];
    let categoryId: number | null = null;
    let categoryName = "";
    try {
      const parsed = extractJson(response.content);
      if (typeof parsed.name === "string") name = parsed.name.slice(0, 30);
      if (typeof parsed.location === "string") location = parsed.location.slice(0, 100);
      if (Array.isArray(parsed.tags)) {
        tags = parsed.tags.filter((t): t is string => typeof t === "string").slice(0, 3);
      }
      // 精确/模糊匹配现有分类；匹配不上则按 AI 建议自动创建新分类
      const resolved = await resolveCategoryId(
        req.userId!,
        (cats || []) as CategoryBrief[],
        typeof parsed.category === "string" ? parsed.category : ""
      );
      categoryId = resolved.id;
      categoryName = resolved.name;
    } catch (resolveError) {
      // 拆解或分类解析失败时兜底「其他」，仍返回草稿由用户确认
      console.error("voice-note 分类解析失败，兜底其他:", resolveError);
      try {
        const fallback = await resolveCategoryId(req.userId!, (cats || []) as CategoryBrief[], "其他");
        categoryId = fallback.id;
        categoryName = fallback.name;
      } catch (fallbackError) {
        console.error("兜底分类创建失败:", fallbackError);
      }
    }

    res.json({ transcript, name, location, category_id: categoryId, category_name: categoryName, tags });
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
    const asrResult = await asrRecognize({
      uid: "voice-ask",
      base64Data: req.file.buffer.toString("base64"),
      format: detectAudioFormat(req.file.originalname, req.file.mimetype),
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
    const result = await ttsSynthesize({
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
