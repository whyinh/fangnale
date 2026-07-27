import { Router } from "express";
import multer from "multer";
import { S3Storage } from "coze-coding-dev-sdk";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// 上传接口均需登录
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: "",
  secretKey: "",
  bucketName: process.env.COZE_BUCKET_NAME,
  region: "cn-beijing",
});

// POST /api/v1/upload/photo - 上传物品照片
// FormData: file (image)
router.post("/photo", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "请上传文件" });
    return;
  }

  const { buffer, originalname, mimetype } = req.file;
  const ext = originalname.split(".").pop() || "jpg";
  const fileName = `items/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const fileKey = await storage.uploadFile({
    fileContent: buffer,
    fileName,
    contentType: mimetype,
  });

  const signedUrl = await storage.generatePresignedUrl({
    key: fileKey,
    expireTime: 86400 * 30, // 30 days
  });

  res.json({ key: fileKey, url: signedUrl });
});

// POST /api/v1/upload/photo-url - 根据 key 获取签名 URL
// Body: { key: string }
router.post("/photo-url", async (req, res) => {
  const { key } = req.body;
  if (!key) {
    res.status(400).json({ error: "缺少 key 参数" });
    return;
  }

  const signedUrl = await storage.generatePresignedUrl({
    key,
    expireTime: 86400 * 30,
  });

  res.json({ url: signedUrl });
});

export default router;
