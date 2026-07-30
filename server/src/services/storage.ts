/**
 * 火山引擎 TOS 对象存储直连层（S3 兼容协议）
 * 替换原沙箱 coze-coding-dev-sdk 的 S3Storage
 * 文档：https://www.volcengine.com/docs/6349/74822
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const s3 = new S3Client({
  region: process.env.TOS_REGION || "cn-beijing",
  endpoint: process.env.TOS_ENDPOINT || "https://tos-s3-cn-beijing.volces.com",
  credentials: {
    accessKeyId: process.env.TOS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.TOS_SECRET_ACCESS_KEY || "",
  },
  // 实测：TOS S3 兼容端点仅支持 virtual-hosted 风格（bucket 子域名），pathStyle 会报 InvalidPathAccess
  forcePathStyle: false,
});

const BUCKET = process.env.TOS_BUCKET || "fangnale-photos";

/** 存储 key 安全校验：防路径穿越，仅允许安全字符 */
export function isValidStorageKey(key: string): boolean {
  if (!key || key.length > 512) return false;
  if (key.includes("..") || key.startsWith("/") || key.includes("\\")) return false;
  return /^[a-zA-Z0-9/_.\-]+$/.test(key);
}

/**
 * 上传文件，返回存储 key（对齐沙箱 storage.uploadFile 语义）
 */
export async function storageUpload(options: {
  fileContent: Buffer;
  fileName: string;
  contentType?: string;
}): Promise<string> {
  const rawExt = options.fileName.includes(".")
    ? options.fileName.split(".").pop() || "bin"
    : "bin";
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "bin";
  // 与沙箱时期保持同一前缀：upload.ts 代理仅放行 items/，且存量照片 key 均为此前缀
  const key = `items/${Date.now()}-${randomUUID()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: options.fileContent,
      ContentType: options.contentType || "application/octet-stream",
    })
  );
  return key;
}

/**
 * 生成预签名下载 URL（对齐沙箱 storage.generatePresignedUrl 语义）
 * expireTime 单位：毫秒（与沙箱 SDK 一致）
 */
export async function storagePresignedUrl(options: {
  key: string;
  expireTime?: number;
}): Promise<string> {
  const expiresInSec = Math.max(
    60,
    Math.floor((options.expireTime ?? 3_600_000) / 1000)
  );
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: options.key }),
    { expiresIn: expiresInSec }
  );
}
