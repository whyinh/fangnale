/**
 * 火山引擎语音服务直连（语音识别 ASR + 语音合成 TTS）
 * 替代沙箱 coze-coding-dev-sdk 的 ASRClient/TTSClient
 * 凭据走环境变量：VOLC_SPEECH_APPID / VOLC_SPEECH_ACCESS_TOKEN
 */
import { randomUUID } from "crypto";
import { storageUpload, storagePresignedUrl } from "./storage.js";

const APPID = process.env.VOLC_SPEECH_APPID || "";
const ACCESS_TOKEN = process.env.VOLC_SPEECH_ACCESS_TOKEN || "";
// 语音识别资源集群（一句话识别通用集群，大模型资源可按需切换）
const ASR_CLUSTER = process.env.VOLC_ASR_CLUSTER || "volcengine_input_common";
// 语音合成集群
const TTS_CLUSTER = process.env.VOLC_TTS_CLUSTER || "volcano_tts";

/** 语音识别（一句话识别，≤60s 短语音整段上传），对齐沙箱 ASRClient.recognize 返回形态 */
export async function asrRecognize({
  uid,
  base64Data,
}: {
  uid: string;
  base64Data: string;
}): Promise<{ text: string }> {
  const resp = await fetch("https://openspeech.bytedance.com/api/v1/asr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app: { appid: APPID, token: ACCESS_TOKEN, cluster: ASR_CLUSTER },
      user: { uid },
      audio: {
        format: "m4a",
        rate: 16000,
        bits: 16,
        channel: 1,
        data: base64Data,
      },
      request: {
        reqid: randomUUID(),
        sequence: 1,
        nbest: 1,
        show_utterances: false,
      },
    }),
  });
  if (!resp.ok) {
    throw new Error(`ASR HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    code: number;
    message?: string;
    result?: Array<{ text: string }>;
  };
  if (data.code !== 1000) {
    throw new Error(`ASR failed: ${data.code} ${data.message || ""}`);
  }
  const text = (data.result || []).map((r) => r.text).join("").trim();
  return { text };
}

/**
 * 语音合成，对齐沙箱 TTSClient.synthesize 返回形态（audioUri 为可访问 URL）
 * 流程：火山 TTS 返回 base64 音频 → 上传 TOS → 生成签名 URL
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
  const resp = await fetch("https://openspeech.bytedance.com/api/v1/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer;${ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      app: { appid: APPID, token: ACCESS_TOKEN, cluster: TTS_CLUSTER },
      user: { uid },
      audio: {
        voice_type: speaker || "zh_female_vv_uranus_bigtts",
        encoding: audioFormat,
        speed_ratio: 1.0,
      },
      request: {
        reqid: randomUUID(),
        text,
        text_type: "plain",
        operation: "query",
      },
    }),
  });
  if (!resp.ok) {
    throw new Error(`TTS HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    code: number;
    message?: string;
    data?: string;
  };
  if (data.code !== 3000 || !data.data) {
    throw new Error(`TTS failed: ${data.code} ${data.message || ""}`);
  }
  const audioBuffer = Buffer.from(data.data, "base64");
  const key = await storageUpload({
    fileContent: audioBuffer,
    fileName: `tts_${Date.now()}.${audioFormat}`,
    contentType: audioFormat === "mp3" ? "audio/mpeg" : `audio/${audioFormat}`,
  });
  const audioUri = await storagePresignedUrl({ key, expireTime: 3600 * 1000 });
  return { audioUri };
}
