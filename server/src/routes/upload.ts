import { Router } from "express";
import multer from "multer";
import { storageUpload, storagePresignedUrl } from "../services/storage";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// GET /api/v1/upload/photo?key=xxx - 图片代理（302 重定向到签名 URL）
// 免登录：key 为不可枚举的随机路径，与签名 URL 的公开可访问性质一致
// 前端使用此稳定 URL 作为图片 uri，expo-image 磁盘缓存可永久生效
// 注意：必须在 router.use(requireAuth) 之前注册
router.get("/photo", async (req, res) => {
  const key = req.query.key as string | undefined;
  if (!key || typeof key !== "string") {
    res.status(400).json({ error: "缺少 key 参数" });
    return;
  }
  // 防路径穿越/任意 key 探测：仅允许 items/ 前缀
  if (!key.startsWith("items/") || key.includes("..")) {
    res.status(403).json({ error: "非法的 key" });
    return;
  }
  try {
    const signedUrl = await storagePresignedUrl({
      key,
      expireTime: 86400 * 30,
    });
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.redirect(302, signedUrl);
  } catch (e) {
    res.status(404).json({ error: "图片不存在" });
  }
});

// 除图片代理外，其余上传接口均需登录
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
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

  const fileKey = await storageUpload({
    fileContent: buffer,
    fileName,
    contentType: mimetype,
  });

  const signedUrl = await storagePresignedUrl({
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

  const signedUrl = await storagePresignedUrl({
    key,
    expireTime: 86400 * 30,
  });

  res.json({ url: signedUrl });
});

export default router;
