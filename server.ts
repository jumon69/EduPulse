/**
 * HSC MCQ Genie - Backend Server
 * Handles file parsing, session storage, and persistent offline SQLite database.
 * Designed to be portable to Python/WebView patterns or standalone Node environments.
 */
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import multer from 'multer';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import Tesseract from 'tesseract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database('hsc_mcq_genie.db');

// Improved Python interaction using spawn for large data
async function runPythonLogic(text: string): Promise<any> {
  return new Promise((resolve) => {
    // Calling main.py as requested for stronger architecture
    const pyProcess = spawn('python3', ['main.py']);
    let outputData = '';
    let errorData = '';

    pyProcess.stdout.on('data', (data) => {
      outputData += data.toString();
    });

    pyProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    pyProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Python process exited with code ${code}. Stderr: ${errorData}`);
        resolve({ word_count: text.split(/\s+/).length, language: 'unknown', processed_text: text });
      } else {
        try {
          resolve(JSON.parse(outputData));
        } catch (e) {
          console.error('Failed to parse Python output:', e);
          resolve({ word_count: text.split(/\s+/).length, language: 'unknown', processed_text: text });
        }
      }
    });

    // Handle large standard input properly
    pyProcess.stdin.write(text, (err) => {
      if (err) console.error('Stdin write error:', err);
      pyProcess.stdin.end();
    });
  });
}

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS study_sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    content TEXT,
    summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_created ON study_sessions(created_at);

  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    question TEXT,
    options TEXT, -- JSON string
    correct_idx INTEGER,
    explanation TEXT,
    FOREIGN KEY(session_id) REFERENCES study_sessions(id)
  );
  CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id);

  CREATE TABLE IF NOT EXISTS user_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id TEXT,
    is_correct INTEGER,
    answered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(question_id) REFERENCES questions(id)
  );
  CREATE INDEX IF NOT EXISTS idx_progress_question ON user_progress(question_id);
`);

// AI processing moved to frontend to comply with Gemini API security guidelines.

async function startServer() {
  const app = express();
  const port = 3000;

  // Global Request Logger - BEFORE EVERYTHING ELSE
  app.use((req, res, next) => {
    const memory = process.memoryUsage();
    console.log(`[GLOBAL-LOG] ${req.method} ${req.originalUrl} - RSS: ${Math.round(memory.rss / 1024 / 1024)}MB`);
    next();
  });

  app.use(express.json({ limit: "500mb" }));
  app.use(express.urlencoded({ limit: "500mb", extended: true }));

  const upload = multer({ 
    storage: multer.diskStorage({
      destination: path.join(__dirname, "temp_uploads"),
      filename: (req, file, cb) => {
        cb(null, `mcq-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${file.originalname.replace(/[^a-z0-9.]/gi, "_")}`);
      }
    }),
    limits: { 
      fileSize: 1024 * 1024 * 1024, // 1GB
      fieldSize: 1024 * 1024 * 1024
    }
  });

  // Ensure temp directories exist and clean up old ones on start
  const fs = await import("fs/promises");
  const tempUploadsDir = path.join(__dirname, "temp_uploads");
  const chunksDir = path.join(__dirname, "chunks");
  
  await fs.mkdir(tempUploadsDir, { recursive: true });
  await fs.mkdir(chunksDir, { recursive: true });
  
  // Optional cleanup on start
  try {
    const chunkFiles = await fs.readdir(chunksDir);
    for (const f of chunkFiles) {
      await fs.rm(path.join(chunksDir, f), { recursive: true, force: true }).catch(() => {});
    }
  } catch (e) {}

  // Chunked Upload Endpoint
  app.post("/api/upload-chunk", upload.single("chunk"), async (req: any, res: any) => {
    const { uploadId, index } = req.body;
    
    if (!uploadId || index === undefined || !req.file) {
      console.error("[API-ERROR] Missing chunk data for uploadId:", uploadId);
      return res.status(400).json({ error: "Missing chunk data" });
    }

    const chunkDir = path.join(__dirname, "chunks", uploadId);
    try {
      await fs.mkdir(chunkDir, { recursive: true });
      const chunkPath = path.join(chunkDir, index.toString());
      
      // Use copyFile + unlink for better reliability across different filesystems
      await fs.copyFile(req.file.path, chunkPath);
      await fs.unlink(req.file.path).catch(() => {});
      
      res.json({ success: true, index });
    } catch (e: any) {
      console.error(`[API-ERROR] Chunk upload error (ID: ${uploadId}, index: ${index}):`, e);
      res.status(500).json({ error: e.message });
    }
  });

  // Reassemble and Extract Text
  app.post("/api/extract-text-chunked", async (req: any, res: any) => {
    const { uploadId, fileName, totalChunks } = req.body;
    
    if (!uploadId || !totalChunks) {
      return res.status(400).json({ error: "Missing upload identity" });
    }

    const chunkDir = path.join(__dirname, "chunks", uploadId);
    const finalDir = path.join(__dirname, "temp_uploads");
    const finalPath = path.join(finalDir, `mcq-final-${Date.now()}-${fileName.replace(/[^a-z0-9.]/gi, "_")}`);
    
    console.log(`[API-LOG] Reassembling ${fileName} (${totalChunks} chunks) -> ${finalPath}`);
    
    try {
      // Ensure directory exists
      await fs.mkdir(finalDir, { recursive: true });
      
      // Clear finalPath if it somehow exists
      try { await fs.unlink(finalPath).catch(() => {}); } catch(e) {}

      // Reassemble - sequentially to maintain order and avoid memory spikes
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(chunkDir, i.toString());
        try {
          const chunkData = await fs.readFile(chunkPath);
          await fs.appendFile(finalPath, chunkData);
        } catch (readErr) {
          console.error(`[API-ERROR] Chunk ${i} missing for ${uploadId} mapping to ${chunkPath}`);
          throw new Error(`চাক্স ${i} পাওয়া যায়নি। আবার আপলোড করুন।`);
        }
      }

      const fileStats = await fs.stat(finalPath);
      if (fileStats.size === 0) throw new Error("সংগৃহীত ফাইলটি ফাঁকা।");

      console.log(`[API-LOG] Reassembly successful. ${fileStats.size} bytes.`);

      let mimetype = "text/plain";
      const ext = fileName.toLowerCase();
      if (ext.endsWith(".pdf")) mimetype = "application/pdf";
      else if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) mimetype = "image/jpeg";
      else if (ext.endsWith(".png")) mimetype = "image/png";
      else if (ext.endsWith(".webp")) mimetype = "image/webp";
      else if (ext.endsWith(".bmp")) mimetype = "image/bmp";
      
      await processFile(finalPath, fileName, mimetype, res);
      
    } catch (e: any) {
      console.error("[API-ERROR] Reassembly/Extraction error:", e);
      if (!res.headersSent) {
        res.status(500).json({ error: "ফাইল প্রসেসিং ব্যর্থ হয়েছে: " + e.message });
      }
    } finally {
      // Cleanup chunks and reassembled file
      setTimeout(async () => {
        try { await fs.rm(chunkDir, { recursive: true, force: true }).catch(() => {}); } catch (e) {}
        try { await fs.unlink(finalPath).catch(() => {}); } catch (e) {}
      }, 5000); // Slight delay for safety
    }
  });

  async function processFile(filePath: string, originalName: string, mimetype: string, res: any) {
    const fs = await import("fs/promises");
    console.log(`[API-LOG] Processing file: ${originalName} (${mimetype})`);
    try {
      let content = "";
      const isPdf = mimetype === "application/pdf" || originalName.toLowerCase().endsWith(".pdf");
      const isImage = mimetype.startsWith("image/") || /\.(jpg|jpeg|png|webp|bmp)$/i.test(originalName);
      
      if (isPdf) {
        try {
          const dataBuffer = await fs.readFile(filePath);
          const require = createRequire(import.meta.url);
          const pdfParse = require("pdf-parse");
          
          // PDF Parsing can be CPU intensive and error-prone in Node ESM
          const data = await pdfParse(dataBuffer);
          content = data.text || "";
          console.log(`[API-LOG] PDF extracted. Chars: ${content.length}`);
          
          // Fallback to OCR if PDF text is too short (scanned PDF)
          if (content.trim().length < 50 && content.trim().length > 0) {
             console.log("[API-LOG] PDF text too short, might be a scan. You might need OCR separately.");
          }
        } catch (pdfErr: any) {
          console.error("[API-ERROR] PDF Parser fatal:", pdfErr);
          // If PDF parse fails, let's try to see if it's maybe just a text/image disguised or corrupted
          throw new Error("পিডিএফ ফাইলটি পড়া যায়নি। এটি কি পাসওয়ার্ড প্রটেক্টেড? দয়া করে আনলক করে পুনরায় চেষ্টা করুন।");
        }
      } 
      else if (isImage) {
        console.log(`[API-LOG] Starting OCR for image: ${originalName}`);
        try {
          const { data: { text } } = await Tesseract.recognize(filePath, 'eng+ben', {
            logger: m => console.log(`[OCR-PROGRESS] ${m.status}: ${Math.round(m.progress * 100)}%`)
          });
          content = text;
          console.log(`[API-LOG] OCR complete. Length: ${content.length}`);
        } catch (ocrErr: any) {
          console.error("OCR failed:", ocrErr);
          throw new Error("ছবি থেকে লেখা বের করা সম্ভব হয়নি। পরিষ্কার ছবি দিয়ে আবার চেষ্টা করুন।");
        }
      }
      else {
        const dataBuffer = await fs.readFile(filePath);
        content = dataBuffer.toString("utf-8");
        console.log(`[API-LOG] Text file read. Length: ${content.length}`);
      }
      
      if (!content || !content.trim()) {
        console.warn(`[API-LOG] Empty content extracted from ${originalName}`);
        return res.status(422).json({ error: "ফাইল থেকে কোনো লেখা পাওয়া যায়নি। ফাইলটি ফাঁকা কি না চেক করে দেখুন।" });
      }

      console.log(`[API-LOG] Running Python logic on content...`);
      const pyResult = await runPythonLogic(content);
      console.log(`[API-LOG] Python processing complete. Status: ${pyResult.error ? 'Error' : 'Success'}`);

      if (pyResult.error) {
         console.warn(`[API-LOG] Python Error: ${pyResult.error}`);
      }

      res.json({ 
        content: pyResult.processed_text || content, 
        stats: { 
          word_count: pyResult.word_count || 0, 
          language: pyResult.language || "unknown"
        } 
      });
    } catch (error: any) {
      console.error(`[API-LOG] processFile Error:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  }

  // Direct API Routes
  app.post("/api/extract-text", upload.single("file"), async (req: any, res: any) => {
    console.log(`[API-LOG] Extract text request for: ${req.file?.originalname}`);
    if (!req.file) return res.status(400).json({ error: "ফাইল পাওয়া যায়নি।" });
    
    try {
      await processFile(req.file.path, req.file.originalname, req.file.mimetype, res);
    } finally {
      if (req.file.path) {
        const fs = await import("fs/promises");
        try { await fs.unlink(req.file.path).catch(() => {}); } catch (e) {}
      }
    }
  });

  app.post("/api/save-session", (req: any, res: any) => {
    const { id, name, content, summary, questions } = req.body;
    try {
      const contentSnippet = typeof content === "string" ? content.substring(0, 20000) : "";
      db.prepare("INSERT INTO study_sessions (id, name, content, summary) VALUES (?, ?, ?, ?)").run(id, name, contentSnippet, summary);
      const insertQuestion = db.prepare("INSERT INTO questions (id, session_id, question, options, correct_idx, explanation) VALUES (?, ?, ?, ?, ?, ?)");
      const transaction = db.transaction((qs: any[]) => {
        for (const q of qs) insertQuestion.run(q.id, id, q.question, JSON.stringify(q.options), q.correctIdx, q.explanation);
      });
      transaction(questions);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Save failed" });
    }
  });

  app.get("/api/sessions", (req: any, res: any) => {
    res.json(db.prepare("SELECT * FROM study_sessions ORDER BY created_at DESC").all());
  });

  app.get("/api/session/:id", (req: any, res: any) => {
    const session: any = db.prepare("SELECT * FROM study_sessions WHERE id = ?").get(req.params.id);
    if (!session) return res.status(404).json({ error: "Not found" });
    const questions: any[] = db.prepare("SELECT * FROM questions WHERE session_id = ?").all();
    res.json({ ...session, questions: questions.map((q: any) => ({ ...q, options: JSON.parse(q.options) })) });
  });

  app.post("/api/track-progress", (req: any, res: any) => {
    db.prepare("INSERT INTO user_progress (question_id, is_correct) VALUES (?, ?)").run(req.body.question_id, req.body.is_correct ? 1 : 0);
    res.json({ success: true });
  });

  app.get("/api/stats", (req: any, res: any) => {
    const stats: any = db.prepare("SELECT COUNT(*) as total_attempts, IFNULL(SUM(is_correct), 0) as correct_answers FROM user_progress").get();
    res.json(stats);
  });

  app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

  app.delete("/api/session/:id", (req: any, res: any) => {
    try {
      db.prepare("DELETE FROM user_progress WHERE question_id IN (SELECT id FROM questions WHERE session_id = ?)").run(req.params.id);
      db.prepare("DELETE FROM questions WHERE session_id = ?").run(req.params.id);
      db.prepare("DELETE FROM study_sessions WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("[API-ERROR] Delete session failed:", error);
      res.status(500).json({ error: "Delete failed" });
    }
  });

  // Vite Integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global error handler - MUST be after all routes and Vite middleware
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('[CRITICAL] Global Server Error:', err);
    if (res.headersSent) return next(err);
    if (req.path.startsWith('/api')) {
      return res.status(500).json({ error: 'সার্ভারে অভ্যন্তরীণ সমস্যা হয়েছে।', details: err.message });
    }
    next(err);
  });

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  // Set timeout to 10 minutes for large file processing
  server.timeout = 600000;
  server.requestTimeout = 600000;
  server.keepAliveTimeout = 601000;
  server.headersTimeout = 602000;
}

startServer();
