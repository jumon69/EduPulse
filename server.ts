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
import { exec } from 'child_process';
import Tesseract from 'tesseract.js';

import * as pdfModule from 'pdf-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database('hsc_mcq_genie.db');

// Helper to run python logic
async function runPythonLogic(text: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const process = exec('python3 processor.py', (error, stdout, stderr) => {
      if (error) {
        console.error('Python error:', stderr);
        // Fallback to basic result if python fails
        resolve({ word_count: text.split(/\s+/).length, language: 'unknown', processed_text: text });
      }
      else resolve(JSON.parse(stdout));
    });
    process.stdin?.write(text);
    process.stdin?.end();
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

  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    question TEXT,
    options TEXT, -- JSON string
    correct_idx INTEGER,
    explanation TEXT,
    FOREIGN KEY(session_id) REFERENCES study_sessions(id)
  );

  CREATE TABLE IF NOT EXISTS user_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id TEXT,
    is_correct INTEGER,
    answered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(question_id) REFERENCES questions(id)
  );
`);

// AI processing moved to frontend to comply with Gemini API security guidelines.

async function startServer() {
  const app = express();
  const port = 3000;

  app.use(express.json({ limit: '350mb' }));
  app.use(express.urlencoded({ limit: '350mb', extended: true }));

  // Global error handler for JSON
  app.use((err: any, req: any, res: any, next: any) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    next(err);
  });

  app.use('/api', (req, res, next) => {
    console.log(`[MCQ-GENIE-API] ${req.method} ${req.url}`);
    next();
  });

  // Use memory storage for smaller files if disk is failing for some reason
  const upload = multer({ 
    storage: multer.diskStorage({
      destination: '/tmp',
      filename: (req, file, cb) => {
        cb(null, `mcq-${Date.now()}-${file.originalname.replace(/[^a-z0-9.]/gi, '_')}`);
      }
    }),
    limits: { fileSize: 350 * 1024 * 1024 }
  });

  app.post('/api/extract-text', (req, res, next) => {
    console.log('Hitting extract-text route handler');
    next();
  }, upload.single('file'), async (req: any, res: any) => {
    console.log('Multer finished upload. File:', req.file?.originalname);
    const fs = await import('fs/promises');
    const filePath = req.file?.path;

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      console.log(`Processing file: ${req.file.originalname} (${req.file.size} bytes)`);

      let content = '';
      const mimetype = req.file.mimetype;

      const isPdf = mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf');
      
      if (isPdf) {
        const dataBuffer = await fs.readFile(filePath);
        console.log('PDF Read complete, starting parse...');
        let extractedText = '';

        try {
          // Handle the newer pdf-parse (mehmet-kozan version) which uses a class
          if (pdfModule && (pdfModule as any).PDFParse) {
            console.log('Using PDFParse class...');
            const PDFParseClass = (pdfModule as any).PDFParse;
            const parser = new PDFParseClass({ data: dataBuffer });
            const result = await parser.getText();
            extractedText = result.text || '';
            await parser.destroy();
          } 
          // Handle the classic pdf-parse (unreal-sh version) or interop as a function
          else if (typeof pdfModule === 'function' || (pdfModule as any).default) {
            console.log('Using pdf-parse function...');
            const parseFunc = typeof pdfModule === 'function' ? pdfModule : (pdfModule as any).default;
            if (typeof parseFunc === 'function') {
               const data = await parseFunc(dataBuffer);
               extractedText = data.text || '';
            } else {
               throw new Error('PDF parsing function not found');
            }
          }
          else {
            console.log('Attempting PDF require fallback...');
            const require = createRequire(import.meta.url);
            const pdfReq = require('pdf-parse');
            const data = await pdfReq(dataBuffer);
            extractedText = data.text || '';
          }
        } catch (pdfErr) {
          console.error('PDF library failed, trying backup parser...');
          throw pdfErr;
        }

        content = extractedText;
      } 
      else if (mimetype.startsWith('image/')) {
        const dataBuffer = await fs.readFile(filePath);
        const { data: { text } } = await Tesseract.recognize(dataBuffer, 'ben+eng');
        content = text;
      }
      else {
        const dataBuffer = await fs.readFile(filePath);
        content = dataBuffer.toString('utf-8');
      }
      
      if (!content || !content.trim()) {
        return res.status(422).json({ error: 'No readable text content found in file. Ensure the PDF contains actual text (not scanned images) and is not password protected.' });
      }

      console.log(`Extracted ${content.length} characters. Running python logic...`);

      // Run Python Logic
      const pyResult = await runPythonLogic(content);

      res.setHeader('Content-Type', 'application/json');
      res.json({ 
        content: pyResult.processed_text || content, 
        stats: { 
          word_count: pyResult.word_count, 
          language: pyResult.language 
        } 
      });
    } catch (error: any) {
      console.error('Extraction error:', error);
      res.status(500).json({ error: error.message || 'টেক্সট এক্সট্রাকশন ব্যর্থ হয়েছে।' });
    } finally {
      // Cleanup uploaded file
      if (filePath) {
        try {
          await fs.unlink(filePath).catch(() => {});
        } catch (e) {}
      }
    }
  });

  app.post('/api/save-session', (req: any, res: any) => {
    const { id, name, content, summary, questions } = req.body;
    
    try {
      // Limit stored content in DB to prevent massive DB growth on mobile
      const contentSnippet = typeof content === 'string' ? content.substring(0, 10000) : '';
      const insertSession = db.prepare('INSERT INTO study_sessions (id, name, content, summary) VALUES (?, ?, ?, ?)');
      insertSession.run(id, name, contentSnippet, summary);

      const insertQuestion = db.prepare('INSERT INTO questions (id, session_id, question, options, correct_idx, explanation) VALUES (?, ?, ?, ?, ?, ?)');
      
      const transaction = db.transaction((qs: any[]) => {
        for (const q of qs) {
          insertQuestion.run(q.id, id, q.question, JSON.stringify(q.options), q.correctIdx, q.explanation);
        }
      });

      transaction(questions);
      res.json({ success: true });
    } catch (error) {
      console.error('Save session error:', error);
      res.status(500).json({ error: 'Failed to save session' });
    }
  });

  app.get('/api/sessions', (req: any, res: any) => {
    const sessions = db.prepare('SELECT * FROM study_sessions ORDER BY created_at DESC').all();
    res.json(sessions);
  });

  app.get('/api/session/:id', (req: any, res: any) => {
    const session: any = db.prepare('SELECT * FROM study_sessions WHERE id = ?').get(req.params.id);
    const questions: any[] = db.prepare('SELECT * FROM questions WHERE session_id = ?').all();
    
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    res.json({ 
      ...session, 
      questions: questions.map((q: any) => ({
        ...q,
        options: JSON.parse(q.options)
      }))
    });
  });

  app.post('/api/track-progress', (req: any, res: any) => {
    const { question_id, is_correct } = req.body;
    db.prepare('INSERT INTO user_progress (question_id, is_correct) VALUES (?, ?)').run(question_id, is_correct ? 1 : 0);
    res.json({ success: true });
  });

  app.get('/api/stats', (req: any, res: any) => {
    const stats: any = db.prepare(`
      SELECT 
        COUNT(*) as total_attempts,
        IFNULL(SUM(is_correct), 0) as correct_answers
      FROM user_progress
    `).get();
    res.json(stats);
  });

  // Final catch-all for /api before Vite middleware
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API endpoint ${req.url} not found` });
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
  server.keepAliveTimeout = 61000;
  server.headersTimeout = 62000;
}

startServer();
