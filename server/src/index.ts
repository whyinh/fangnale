import express from "express";
import cors from "cors";
import categoriesRouter from "./routes/categories.js";
import itemsRouter from "./routes/items.js";
import uploadRouter from "./routes/upload.js";
import speechRouter from "./routes/speech.js";
import authRouter from "./routes/auth.js";
import familiesRouter from "./routes/families.js";
import locationsRouter from "./routes/locations.js";
import premiumRouter from "./routes/premium.js";
import { getSupabasePublicConfig } from "./storage/database/supabase-client.js";

// 全局兜底：未捕获的 Promise 拒绝/异常只记录不崩溃
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const app = express();
const port = process.env.PORT || 9091;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/api/v1/health", (_req, res) => {
  console.log("Health check success");
  res.status(200).json({ status: "ok" });
});

// Routes
app.use("/api/v1/categories", categoriesRouter);
app.use("/api/v1/items", itemsRouter);
app.use("/api/v1/upload", uploadRouter);
app.use("/api/v1/speech", speechRouter);
app.use("/api/v1/auth", authRouter);

// Supabase 公开配置（前端初始化 Auth 客户端用）
app.get("/api/v1/supabase-config", (_req, res) => {
  res.json(getSupabasePublicConfig());
});
app.use("/api/v1/families", familiesRouter);
app.use("/api/v1/locations", locationsRouter);
app.use("/api/v1/premium", premiumRouter);

// 隐私政策页面（App Store 审核要求，公开访问）
app.get("/privacy", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>隐私政策 - 放哪了</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; color: #1a1a2e; line-height: 1.8; }
  h1 { font-size: 26px; } h2 { font-size: 18px; margin-top: 32px; }
  p, li { font-size: 15px; color: #333; }
  .updated { color: #888; font-size: 13px; }
</style>
</head>
<body>
<h1>隐私政策</h1>
<p class="updated">更新日期：2026 年 3 月 1 日 · 生效日期：2026 年 3 月 1 日</p>
<p>"放哪了"（以下简称"本应用"）是一款帮助您记录和查找家庭物品存放位置的应用。我们非常重视您的隐私，本政策说明我们收集哪些信息、如何使用以及您的权利。</p>

<h2>一、我们收集的信息</h2>
<ul>
  <li><strong>账号信息</strong>：您注册时提供的电子邮箱地址，用于登录和账号安全。</li>
  <li><strong>您主动创建的内容</strong>：物品照片、物品名称、存放位置、分类、备注等您录入的数据。</li>
  <li><strong>语音内容</strong>：当您主动使用语音记录或语音查找功能时采集的录音，仅用于实时转写为文字，处理完成后不保留原始音频。</li>
  <li><strong>设备信息</strong>：设备型号、操作系统版本，用于问题排查与兼容性优化。</li>
</ul>

<h2>二、权限使用说明</h2>
<ul>
  <li><strong>相机</strong>：用于拍摄物品照片以进行 AI 识别和位置记录，仅在您主动点击拍摄时启用。</li>
  <li><strong>相册</strong>：用于从相册选择物品照片，仅在您主动选择时访问。</li>
  <li><strong>麦克风</strong>：用于语音记录和语音查找功能，仅在您主动使用语音功能时启用。</li>
</ul>
<p>本应用<strong>不收集</strong>您的精确地理位置信息。</p>

<h2>三、信息的使用</h2>
<ul>
  <li>物品照片会通过安全的云端 AI 服务进行内容识别（识别物品名称、类别），识别结果仅用于为您提供记录和查找服务。</li>
  <li>您的数据仅用于提供和改进本应用的核心功能，我们不会将您的个人信息出售给任何第三方。</li>
</ul>

<h2>四、信息的存储与保护</h2>
<ul>
  <li>您的数据存储于采用行业标准加密措施的云端服务器，传输过程全程使用 HTTPS 加密。</li>
  <li>物品照片存储于私有对象存储空间，通过临时签名地址访问，不对外公开。</li>
</ul>

<h2>五、您的权利</h2>
<ul>
  <li>您可以随时在应用内查看、修改、删除您记录的物品数据。</li>
  <li>如需删除账号及全部关联数据，请通过下方联系方式与我们取得联系，我们将在 15 个工作日内处理。</li>
</ul>

<h2>六、第三方服务</h2>
<p>本应用使用云端 AI 大模型服务进行物品图像识别与语音理解，处理过程遵循最小必要原则，不用于其他目的。</p>

<h2>七、政策更新</h2>
<p>本政策更新时，我们会在本页面公布最新版本并更新生效日期。</p>

<h2>八、联系我们</h2>
<p>如对本政策或隐私保护有任何疑问，请联系：<strong>support@fangnale.app</strong></p>
</body>
</html>`);
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Server error:", err.message);
  if (err instanceof Error && err.message.includes("MulterError")) {
    res.status(413).json({ error: "文件大小超过限制（最大 20MB）" });
    return;
  }
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
});
