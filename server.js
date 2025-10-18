// server.js — serves from ./public if present, otherwise from repo root
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer ./public if it exists; else use repo root
const publicPath = path.join(__dirname, "public");
const staticDir = fs.existsSync(path.join(publicPath, "index.html"))
  ? publicPath
  : __dirname;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(staticDir));

// Health check
app.get("/health", (_req, res) => res.send("✅ GameSheets server is running"));

// Catch-all → send index.html from chosen directory
app.get("*", (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"), (err) => {
    if (err) {
      res
        .status(404)
        .send(
          `index.html not found in ${staticDir}. Put your index.html there or create a /public folder.`
        );
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Serving static files from: ${staticDir}`);
  console.log(`🚀 GameSheets server running at http://localhost:${PORT}`);
});