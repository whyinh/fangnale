/**
 * 火山引擎语音服务直连（语音识别 ASR + 语音合成 TTS）
 * 替代沙箱 coze-coding-dev-sdk 的 ASRClient/TTSClient
 *
 * 鉴权：新版控制台统一 API Key（X-Api-Key），环境变量 VOLC_SPEECH_API_KEY
 *
 * ASR：大模型录音文件极速版（一次请求返回结果，无需轮询）
 *   POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash
 *   官方仅支持 wav/mp3/ogg，其他格式（m4a/mp4/webm/aac）先经 ffmpeg 转码为 wav
 * TTS：语音合成大模型 V3 单向 HTTP（chunked 流式返回 base64 音频块）
 *   POST https://openspeech.bytedance.com/api/v3/tts/unidirectional
 */
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { chmodSync } from "fs";
import ffmpegPath from "ffmpeg-static";
import { storageUpload, storagePresignedUrl } from "./storage.js";

const API_KEY = process.env.VOLC_SPEECH_API_KEY || "";
// ffmpeg 二进制路径：优先环境变量（应对 node_modules 锁文件/权限异常环境），默认 ffmpeg-static
const FFMPEG_BIN = process.env.FFMPEG_PATH || (ffmpegPath as unknown as string) || "";
const ASR_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
// 火山 ASR 官方支持的格式（除此以外的格式走 ffmpeg 转码）
const ASR_NATIVE_FORMATS = new Set(["wav", "mp3", "ogg"]);
const DEFAULT_SPEAKER = "zh_female_vv_uranus_bigtts";

/** 从文件名/MIME 推断音频格式 */
export function detectAudioFormat(fileName?: string, mimeType?: string): string {
  const ext = (fileName || "").split(".").pop()?.toLowerCase() || "";
  if (ext && ext !== fileName?.toLowerCase()) {
    if (ext === "oga") return "ogg";
    if (ext === "m4a" || ext === "mp4" || ext === "aac") return "m4a";
    if (["wav", "mp3", "ogg", "webm"].includes(ext)) return ext;
  }
  if (mimeType) {
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mp4") || mimeType.includes("m4a") || mimeType.includes("aac")) return "m4a";
  }
  return "m4a";
}

/** ffmpeg 转码为 16kHz 单声道 wav（PCM），供火山 ASR 使用（stdin/stdout 管道，不落盘） */
function transcodeToWav(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!FFMPEG_BIN) {
      reject(new Error("ffmpeg 不可用（ffmpeg-static 未安装且未配置 FFMPEG_PATH）"));
      return;
    }
    // pnpm/CI 环境可能丢失二进制执行权限，防御性修复
    try {
      chmodSync(FFMPEG_BIN, 0o755);
    } catch {
      // 忽略：权限修复失败时由 spawn 报错
    }
    const proc = spawn(FFMPEG_BIN, [
      "-hide_banner", "-loglevel", "error",
      "-i", "pipe:0",
      "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1",
    ]);
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => outChunks.push(c));
    proc.stderr.on("data", (c: Buffer) => errChunks.push(c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0 && outChunks.length) {
        resolve(Buffer.concat(outChunks));
      } else {
        reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(errChunks).toString().slice(0, 200)}`));
      }
    });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

/** 语音识别（≤2h 音频整段上传），对齐沙箱 ASRClient.recognize 返回形态 */
export async function asrRecognize({
  uid,
  base64Data,
  format = "m4a",
}: {
  uid: string;
  base64Data: string;
  format?: string;
}): Promise<{ text: string }> {
  if (!API_KEY) throw new Error("VOLC_SPEECH_API_KEY 未配置");

  let audioBuf: Buffer<ArrayBufferLike> = Buffer.from(base64Data, "base64");
  let fmt = format.toLowerCase();
  if (!ASR_NATIVE_FORMATS.has(fmt)) {
    audioBuf = await transcodeToWav(audioBuf);
    fmt = "wav";
  }

  const resp = await fetch(ASR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
      "X-Api-Resource-Id": "volc.bigasr.auc_turbo",
      "X-Api-Request-Id": randomUUID(),
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify({
      user: { uid },
      audio: { data: audioBuf.toString("base64"), format: fmt },
      request: { model_name: "bigmodel" },
    }),
  });

  // 业务码在响应头 X-Api-Status-Code（20000000 为成功）；成功时 body 顶层即识别结果
  const statusCode = resp.headers.get("X-Api-Status-Code");
  const statusMessage = resp.headers.get("X-Api-Message") || "";
  const data = (await resp.json().catch(() => null)) as {
    header?: { code?: number; message?: string };
    result?: { text?: string };
  } | null;
  // 错误响应可能走 body.header.code，两种情况都检查
  const bodyCode = data?.header?.code;
  const ok = resp.ok && (statusCode === "20000000" || (statusCode === null && bodyCode === 20000000));
  if (!ok) {
    throw new Error(
      `ASR failed: HTTP ${resp.status} headerCode ${statusCode} ${statusMessage} bodyCode ${bodyCode} ${data?.header?.message || ""}`
    );
  }
  return { text: (data?.result?.text || "").trim() };
}

/**
 * 语音合成，对齐沙箱 TTSClient.synthesize 返回形态（audioUri 为可访问 URL）
 * 流程：火山 TTS chunked 返回 base64 音频块 → 拼接 → 上传 TOS → 生成签名 URL
 */
export async function ttsSynthesize({
  uid,
  text,
  speaker,
  audioFormat = "mp3",
}: {
  uid: string;
  text: string;
  speaker?: string;
  audioFormat?: string;
}): Promise<{ audioUri: string }> {
  if (!API_KEY) throw new Error("VOLC_SPEECH_API_KEY 未配置");

  const resp = await fetch(TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
      "X-Api-Resource-Id": "seed-tts-2.0",
      "X-Api-Request-Id": randomUUID(),
    },
    body: JSON.stringify({
      user: { uid },
      req_params: {
        text,
        speaker: speaker || DEFAULT_SPEAKER,
        audio_params: { format: audioFormat, sample_rate: 24000 },
      },
    }),
  });
  if (!resp.ok) {
    throw new Error(`TTS HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }

  // chunked 响应：每行一个 JSON，data 字段为 base64 音频块；结束行 code=20000000 且 data=null
  const raw = await resp.text();
  const chunks: Buffer[] = [];
  let failMessage = "";
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { code?: number; message?: string; data?: string | null };
      if (parsed.code && parsed.code !== 0 && parsed.code !== 20000000) {
        failMessage = `${parsed.code} ${parsed.message || ""}`;
        break;
      }
      if (parsed.data) chunks.push(Buffer.from(parsed.data, "base64"));
    } catch {
      // 忽略非 JSON 行
    }
  }
  if (failMessage) throw new Error(`TTS failed: ${failMessage}`);
  if (!chunks.length) throw new Error("TTS 未返回音频数据");

  const audioBuffer = Buffer.concat(chunks);
  const key = await storageUpload({
    fileContent: audioBuffer,
    fileName: `tts_${Date.now()}.${audioFormat}`,
    contentType: audioFormat === "mp3" ? "audio/mpeg" : `audio/${audioFormat}`,
  });
  const audioUri = await storagePresignedUrl({ key, expireTime: 3600 * 1000 });
  return { audioUri };
}
