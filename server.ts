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

  app.use(express.json());

  const upload = multer({ storage: multer.memoryStorage() });

  // API Routes
  app.post('/api/extract-text', upload.single('file'), async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      let content = '';
      const mimetype = req.file.mimetype;

      if (mimetype === 'application/pdf') {
        const dataBuffer = req.file.buffer;
        let extractedText = '';

        // Handle the newer pdf-parse (mehmet-kozan version) which uses a class
        if (pdfModule && (pdfModule as any).PDFParse) {
          const PDFParseClass = (pdfModule as any).PDFParse;
          const parser = new PDFParseClass({ data: dataBuffer });
          try {
            const result = await parser.getText();
            extractedText = result.text || '';
            await parser.destroy();
          } catch (err) {
            console.error('Error with PDFParse class:', err);
            throw err;
          }
        } 
        // Handle the classic pdf-parse (unreal-sh version) or interop as a function
        else if (typeof pdfModule === 'function' || (pdfModule as any).default) {
          const parseFunc = typeof pdfModule === 'function' ? pdfModule : (pdfModule as any).default;
          if (typeof parseFunc === 'function') {
             const data = await parseFunc(dataBuffer);
             extractedText = data.text || '';
          } else {
             throw new Error('PDF parsing function not found in module');
          }
        }
        else {
          // Last ditch effort: try to require it
          try {
            const require = createRequire(import.meta.url);
            const pdfReq = require('pdf-parse');
            if (typeof pdfReq === 'function') {
              const data = await pdfReq(dataBuffer);
              extractedText = data.text || '';
            } else if (pdfReq && pdfReq.PDFParse) {
              const parser = new pdfReq.PDFParse({ data: dataBuffer });
              const result = await parser.getText();
              extractedText = result.text || '';
              await parser.destroy();
            } else {
              throw new Error('PDF library incompatible');
            }
          } catch (e) {
            console.error('Final fallback failed:', e);
            throw new Error('PDF parsing library misconfigured or incompatible with runtime');
          }
        }

        content = extractedText;
      } 
      else if (mimetype.startsWith('image/')) {
        const { data: { text } } = await Tesseract.recognize(req.file.buffer, 'ben+eng');
        content = text;
      }
      else {
        content = req.file.buffer.toString('utf-8');
      }
      
      if (!content || !content.trim()) {
        return res.status(422).json({ error: 'No readable text content found in file. Ensure the PDF contains actual text (not scanned images) and is not password protected.' });
      }

      // Run Python Logic
      const pyResult = await runPythonLogic(content);

      // Only send what's needed to the frontend to save memory
      res.json({ 
        content: pyResult.processed_text || content, 
        stats: { 
          word_count: pyResult.word_count, 
          language: pyResult.language 
        } 
      });
    } catch (error: any) {
      console.error('Extraction error:', error);
      res.status(500).json({ error: error.message || 'Failed to extract text from material' });
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
        SUM(is_correct) as correct_answers
      FROM user_progress
    `).get();
    res.json(stats);
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

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
