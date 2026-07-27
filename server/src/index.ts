import express from "express";
import cors from "cors";
import categoriesRouter from "./routes/categories.js";
import itemsRouter from "./routes/items.js";
import uploadRouter from "./routes/upload.js";
import speechRouter from "./routes/speech.js";

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
