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
import * as pdfModule from 'pdf-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database('hsc_mcq_genie.db');

// Improved Python interaction using spawn for large data
async function runPythonLogic(text: string): Promise<any> {
  return new Promise((resolve) => {
    const pyProcess = spawn('python3', ['processor.py']);
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
    console.log(`[GLOBAL-LOG] ${req.method} ${req.originalUrl} - IP: ${req.ip}`);
    next();
  });

  app.use(express.json({ limit: "500mb" }));
  app.use(express.urlencoded({ limit: "500mb", extended: true }));

  const upload = multer({ 
    storage: multer.diskStorage({
      destination: "/tmp",
      filename: (req, file, cb) => {
        cb(null, `mcq-${Date.now()}-${file.originalname.replace(/[^a-z0-9.]/gi, "_")}`);
      }
    }),
    limits: { 
      fileSize: 400 * 1024 * 1024,
      fieldSize: 400 * 1024 * 1024
    }
  });

  // Direct API Routes
  app.post("/api/extract-text", upload.single("file"), async (req: any, res: any) => {
    console.log(`[API-LOG] Extract text request for: ${req.file?.originalname}`);
    const fs = await import("fs/promises");
    const filePath = req.file?.path;

    try {
      if (!req.file) {
        return res.status(400).json({ error: "ফাইল পাওয়া যায়নি বা অবৈধ ফরম্যাট।" });
      }

      let content = "";
      const mimetype = req.file.mimetype;
      const isPdf = mimetype === "application/pdf" || req.file.originalname.toLowerCase().endsWith(".pdf");
      
      if (isPdf) {
        const dataBuffer = await fs.readFile(filePath);
        let extractedText = "";

        try {
          if (pdfModule && (pdfModule as any).PDFParse) {
            const PDFParseClass = (pdfModule as any).PDFParse;
            const parser = new PDFParseClass({ data: dataBuffer });
            const result = await parser.getText();
            extractedText = result.text || "";
            await parser.destroy();
          } else {
            const require = createRequire(import.meta.url);
            const pdfReq = require("pdf-parse");
            const data = await pdfReq(dataBuffer);
            extractedText = data.text || "";
          }
        } catch (pdfErr: any) {
          console.error("PDF Parse error:", pdfErr);
          throw new Error("পিডিএফ ফাইলটি পড়া যাচ্ছে না।");
        }
        content = extractedText;
      } 
      else if (mimetype.startsWith("image/")) {
        const dataBuffer = await fs.readFile(filePath);
        const { data: { text } } = await Tesseract.recognize(dataBuffer, "ben+eng");
        content = text;
      }
      else {
        const dataBuffer = await fs.readFile(filePath);
        content = dataBuffer.toString("utf-8");
      }
      
      if (!content || !content.trim()) {
        return res.status(422).json({ error: "ফাইল থেকে কোনো লেখা পাওয়া যায়নি।" });
      }

      const pyResult = await runPythonLogic(content);

      res.json({ 
        content: pyResult.processed_text || content, 
        stats: { 
          word_count: pyResult.word_count, 
          language: pyResult.language 
        } 
      });
    } catch (error: any) {
      console.error("API Error:", error);
      res.status(500).json({ error: "সার্ভারে সমস্যা হয়েছে: " + (error.message || "Unknown error") });
    } finally {
      if (filePath) {
        try { await fs.unlink(filePath).catch(() => {}); } catch (e) {}
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
  server.keepAliveTimeout = 61000;
  server.headersTimeout = 62000;
}

startServer();
