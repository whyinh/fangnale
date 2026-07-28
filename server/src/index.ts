import express from "express";
import cors from "cors";
import categoriesRouter from "./routes/categories.js";
import itemsRouter from "./routes/items.js";
import uploadRouter from "./routes/upload.js";
import speechRouter from "./routes/speech.js";
import authRouter from "./routes/auth.js";
import familiesRouter from "./routes/families.js";
import locationsRouter from "./routes/locations.js";
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
