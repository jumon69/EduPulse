import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  Upload, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  BarChart3, 
  History,
  ChevronLeft,
  Loader2,
  Trash2,
  BrainCircuit,
  Camera,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera as CameraCap, CameraResultType, CameraSource } from '@capacitor/camera';
import { Preferences } from '@capacitor/preferences';

// Stability Constants for Mobile
const MAX_CONTENT_LENGTH = 100000;
const MAX_SUMMARY_LENGTH = 1500;
const ANALYSIS_CHUNK_SIZE = 15000;
const MAX_ANALYSIS_CHUNKS = 10;
import { analyzeMaterial } from './ai/gemini';
import { getFileNameWithoutExtension, cleanExtractedText } from './lib/pdfUtils';
import { Question, StudySession, Stats } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [showSplash, setShowSplash] = useState(true);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [stats, setStats] = useState<Stats>({ total_attempts: 0, correct_answers: 0 });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState("");
  const [view, setView] = useState<'dashboard' | 'quiz' | 'history' | 'profile'>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [userName, setUserName] = useState(() => localStorage.getItem('hsc_user_name') || 'ছাত্রের নাম');
  const [userBatch, setUserBatch] = useState(() => localStorage.getItem('hsc_user_batch') || '২০২৬ ব্যাচ');
  const [userAvatar, setUserAvatar] = useState(() => localStorage.getItem('hsc_user_avatar') || '');
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('hsc_gemini_api_key') || '');
  const [joke, setJoke] = useState('');
  const [searchHistory, setSearchHistory] = useState("");
  const [filterTopic, setFilterTopic] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'az'>('newest');

  const jokes = [
    "ডাক্তার: আপনার দাঁত তো সব ঠিকই আছে, তাহলে ব্যথা কেন?\nরোগী: দাঁতগুলো ঠিক ঠিক জায়গায় নেই ডাক্তার সাহেব, একটা তো আমার পকেটে!",
    "মা: কিরে, রেজাল্ট কী?\nছেলে: হেডমাস্টারের ছেলে ফেল করেছে।\nমা: তোর কী?\nছেলে: পাশের বাড়ির উকিলের ছেলেও ফেল করেছে।\nমা: আরে গাধা, তোর রেজাল্ট বল!\nছেলে: আমি কী জজ-ব্যারিস্টারের চেয়েও বড় পন্ডিত নাকি যে একলা পাস করবো?",
    "শিক্ষক: বল্টু, তুই বড় হয়ে কী করতে চাস?\nবল্টু: বিয়ে করতে চাই স্যার।\nশিক্ষক: না, আমি বলতে চেয়েছি বড় হয়ে কী হবি?\nবল্টু: জামাই হবো স্যার!",
    "স্ত্রী: ওগো শুনছো, বিয়ের আগে তো তুমি আমাকে কতো উপহার দিতে। এখন কেন দাও না?\nস্বামী: তুমি কি কখনো দেখেছো কাউকে মাছ ধরার পর মাছকে খাবার দিতে?",
  ];

  useEffect(() => {
    if (isUploading) {
      const interval = setInterval(() => {
        setJoke(jokes[Math.floor(Math.random() * jokes.length)]);
      }, 5000);
      setJoke(jokes[Math.floor(Math.random() * jokes.length)]);
      return () => clearInterval(interval);
    }
  }, [isUploading]);

  async function fetchSessions() {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error('Failed to fetch sessions');
      const data = await res.json();
      setSessions(data);
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    fetchSessions();
    fetchStats();
    
    // Splash screen timeout
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3500);
    return () => clearTimeout(timer);
  }, []);

  const takePhoto = async () => {
    try {
      const image = await CameraCap.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        promptLabelHeader: 'ছবি তুলুন',
        promptLabelPhoto: 'গ্যালারি থেকে নিন',
        promptLabelPicture: 'ছবি তুলুন'
      });

      if (image.base64String) {
        // Convert base64 to File object
        const byteCharacters = atob(image.base64String);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: `image/${image.format}` });
        const file = new File([blob], `capture-${Date.now()}.${image.format}`, { type: `image/${image.format}` });
        handleFileUploadInternal(file);
      }
    } catch (err) {
      console.warn("Camera cancelled or failed", err);
      // Fallback to traditional input if camera plugin fails
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e: any) => {
        const file = e.target.files[0];
        if (file) handleFileUploadInternal(file);
      };
      input.click();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUploadInternal(file);
  };

  const handleFileUploadInternal = async (file: File) => {
    const existingSession = sessions.find(s => s.name === getFileNameWithoutExtension(file.name));
    if (existingSession) {
      if (confirm(`"${existingSession.name}" এর জন্য পূর্ববর্তী অনুশীলন সেশন পাওয়া গেছে। আপনি কি সেটি লোড করতে চান?`)) {
        loadSession(existingSession.id);
        return;
      }
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress("0% - আপলোড শুরু হচ্ছে...");

    try {
      const uploadId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const CHUNK_SIZE = 1 * 1024 * 1024; // Reduced to 1MB for maximum mobile stability
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      
      console.log(`[MCQ-GENIE] Starting chunked upload for ${file.name}. Size: ${file.size}, Total chunks: ${totalChunks}`);

      // 1. Upload chunks sequentially with retry logic
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        
        const uploadProgressValue = Math.round((i / totalChunks) * 40);
        setUploadProgress(`${uploadProgressValue}% - ফাইল আপলোড হচ্ছে (${i + 1}/${totalChunks})...`);

        let retryCount = 0;
        const maxRetries = 2;
        let success = false;

        while (retryCount <= maxRetries && !success) {
          try {
            const formData = new FormData();
            formData.append('chunk', chunk, file.name);
            formData.append('uploadId', uploadId);
            formData.append('index', i.toString());
            formData.append('total', totalChunks.toString());

            const res = await fetch('/api/upload-chunk', {
              method: 'POST',
              body: formData
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => ({ error: "Server error" }));
              throw new Error(errData.error || `Chunk ${i} upload failed.`);
            }
            success = true;
          } catch (chunkErr) {
            retryCount++;
            if (retryCount > maxRetries) throw chunkErr;
            console.warn(`[MCQ-GENIE] Retry chunk ${i} (attempt ${retryCount})`);
            await new Promise(r => setTimeout(r, 1500)); 
          }
        }
      }

      setUploadProgress("40% - ফাইল প্রসেস করা হচ্ছে...");
      
      // 2. Finalize and extract text with retry
      let finalizeRes;
      let finalizeRetry = 0;
      while (finalizeRetry < 3) {
        try {
          finalizeRes = await fetch('/api/extract-text-chunked', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadId, fileName: file.name, totalChunks })
          });
          if (finalizeRes.ok) break;
        } catch (e) {
          console.warn(`Finalize attempt ${finalizeRetry} failed`, e);
        }
        finalizeRetry++;
        await new Promise(r => setTimeout(r, 2000));
      }

      if (!finalizeRes || !finalizeRes.ok) {
        const errData = finalizeRes ? await finalizeRes.json().catch(() => ({})) : {};
        throw new Error(errData.error || "ফাইল প্রসেস করতে সমস্যা হয়েছে। নেটওয়ার্ক চেক করে আবার চেষ্টা করুন।");
      }

      const extractData = await finalizeRes.json();
      const { content } = extractData;
      
      if (!content) throw new Error("ফাইল থেকে কোনো তথ্য পাওয়া যায়নি।");

      const cleanedContent = cleanExtractedText(content);
      
      const chunks = [];
      const contentForChunks = cleanedContent.substring(0, MAX_CONTENT_LENGTH);
      for (let i = 0; i < contentForChunks.length && chunks.length < MAX_ANALYSIS_CHUNKS; i += ANALYSIS_CHUNK_SIZE) {
        chunks.push(contentForChunks.substring(i, i + ANALYSIS_CHUNK_SIZE));
      }

      let allQuestions: any[] = [];
      let finalSummary = "";
      const sessionId = Math.random().toString(36).substring(7);

      let lastError = "";
      for (let i = 0; i < chunks.length; i++) {
        const chunkProgress = Math.round(40 + ((i / chunks.length) * 50));
        setUploadProgress(`${chunkProgress}% - AI দিয়ে বিশ্লেষণ করা হচ্ছে (অংশ ${i + 1}/${chunks.length})...`);
        
        let chunkRetry = 0;
        let chunkSuccess = false;
        
        while (chunkRetry < 2 && !chunkSuccess) {
          try {
            const { summary, questions } = await analyzeMaterial(chunks[i]);
            
            if (questions && Array.isArray(questions) && questions.length > 0) {
              const processedQuestions = questions.map((q, qIdx) => ({
                ...q,
                id: `${sessionId}-q-${i}-${qIdx}-${Math.random().toString(36).substring(2, 7)}`
              }));
              allQuestions = [...allQuestions, ...processedQuestions];
            }
            
            if (summary) {
              finalSummary += summary + "\n";
            }
            chunkSuccess = true;
          } catch (analysisErr: any) {
            chunkRetry++;
            console.error(`[MCQ-GENIE] Chunk ${i} analysis attempt ${chunkRetry} failed:`, analysisErr);
            lastError = analysisErr.message || String(analysisErr);
            if (chunkRetry < 2) await new Promise(r => setTimeout(r, 2000));
          }
        }
      }

      if (allQuestions.length === 0) {
        const errorMsg = lastError 
          ? `AI প্রসেসিং ব্যর্থ হয়েছে: ${lastError}` 
          : "ফাইলটি থেকে কোনো MCQ তৈরি করা সম্ভব হয়নি। ফাইলটি পরিষ্কার এবং লেখাগুলো স্পষ্ট কিনা নিশ্চিত করুন।";
        throw new Error(errorMsg);
      }

      setUploadProgress("95% - প্রশ্নগুলো সেভ করা হচ্ছে...");

      const sessionData: StudySession = {
        id: sessionId,
        name: getFileNameWithoutExtension(file.name),
        content: "",
        summary: finalSummary.substring(0, MAX_SUMMARY_LENGTH) + (finalSummary.length > MAX_SUMMARY_LENGTH ? "..." : ""),
        questions: allQuestions.slice(0, 50) // Limit to 50 questions for mobile performance
      };

      await fetch('/api/save-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sessionData, content: cleanedContent.substring(0, MAX_CONTENT_LENGTH) })
      });

      setSessions([sessionData, ...sessions]);
      setActiveSession(sessionData);
      setView('quiz');
      setIsSidebarOpen(false);
    } catch (err: any) {
      console.error("[MCQ-GENIE] CRITICAL UPLOAD ERROR:", err);
      let errorMsg = err.message || "একটি অপ্রত্যাশিত সমস্যা হয়েছে।";
      
      // Handle specific network errors
      if (err.name === 'AbortError' || errorMsg.includes("Failed to fetch") || errorMsg.includes("load failed")) {
        errorMsg = "সার্ভারের সাথে যোগাযোগ বিচ্ছিন্ন হয়েছে। ফাইলটি খুব বড় হতে পারে বা ইন্টারনেট স্লো। (Network Error)";
      }
      
      setUploadError(errorMsg);
      
      // In mobile, toast is better but alert is reliable
      if (errorMsg.length < 200) {
        try {
          alert(`Error: ${errorMsg}`);
        } catch (e) {}
      }
    } finally {
      setIsUploading(false);
      setUploadProgress("");
    }
  };

  const deleteSession = async (id: string) => {
    if (!confirm("আপনি কি নিশ্চিতভাবে এই সেশনটি মুছে ফেলতে চান?")) return;
    try {
      await fetch(`/api/session/${id}`, { method: 'DELETE' });
      setSessions(sessions.filter(s => s.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const loadSession = async (id: string) => {
    const res = await fetch(`/api/session/${id}`);
    const data = await res.json();
    setActiveSession(data);
    setView('quiz');
    setIsSidebarOpen(false);
  };

  const NavContent = () => (
    <>
      <div className="p-6 md:p-8 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => { setView('dashboard'); setIsSidebarOpen(false); }}>
            <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <BrainCircuit className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-xl text-white tracking-tight">EduPulse HSC</span>
          </div>
          <button className="md:hidden text-slate-400 p-2" onClick={() => setIsSidebarOpen(false)}>
            <XCircle className="w-6 h-6" />
          </button>
        </div>
      </div>
      
      <div className="flex-1 px-4 space-y-2 overflow-y-auto">
        <button 
          onClick={() => { setView('dashboard'); setIsSidebarOpen(false); }}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium",
            view === 'dashboard' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          )}
        >
          <Upload className="w-5 h-5" />
          <span>আপলোড মেটেরিয়াল</span>
        </button>
        
        <button 
          onClick={() => { setView('history'); setIsSidebarOpen(false); }}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium",
            view === 'history' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          )}
        >
          <History className="w-5 h-5" />
          <span>অধ্যয়নের ইতিহাস</span>
        </button>

        <button 
          onClick={() => { setView('profile'); setIsSidebarOpen(false); }}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium",
            view === 'profile' ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          )}
        >
          {userAvatar ? (
            <img src={userAvatar} className="w-6 h-6 rounded-full object-cover border border-slate-700" alt="Avatar" />
          ) : (
            <div className="w-5 h-5 bg-slate-700 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-300">
              {userName.substring(0, 2).toUpperCase()}
            </div>
          )}
          <span>প্রোফাইল সেটিংস</span>
        </button>
      </div>

      <div className="p-4 mb-4 mx-4 bg-slate-800/50 rounded-2xl border border-slate-700/50">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Database Status</div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
          <span className="text-sm text-slate-300 font-medium whitespace-nowrap">Offline Mode Active</span>
        </div>
        <div className="mt-2 text-xs text-slate-500 font-medium">SQLite: {sessions.length} sessions stored</div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-100 font-sans selection:bg-blue-100 selection:text-blue-700">
      <AnimatePresence>
        {showSplash && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, filter: "blur(10px)" }}
            transition={{ duration: 1, ease: [0.43, 0.13, 0.23, 0.96] }}
            className="fixed inset-0 z-[100] bg-[#0f172a] flex flex-col items-center justify-center overflow-hidden"
          >
            {/* Animated stars/particles background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {[...Array(20)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ 
                    x: Math.random() * 100 + "%", 
                    y: Math.random() * 100 + "%",
                    opacity: 0,
                    scale: 0
                  }}
                  animate={{ 
                    opacity: [0, 0.5, 0],
                    scale: [0, 1, 0],
                    y: ["-10%", "110%"]
                  }}
                  transition={{ 
                    duration: Math.random() * 5 + 5, 
                    repeat: Infinity,
                    delay: Math.random() * i
                  }}
                  className="absolute w-1 h-1 bg-blue-400 rounded-full blur-[1px]"
                />
              ))}
            </div>

            <motion.div 
              animate={{ 
                scale: [1, 1.1, 1],
                opacity: [0.15, 0.3, 0.15]
              }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0 bg-blue-600/20 blur-[120px] rounded-full" 
            />
            
            <div className="relative flex flex-col items-center">
              {/* Animated Logo Icon with glow */}
              <motion.div
                initial={{ scale: 0, rotate: -45, y: 50 }}
                animate={{ scale: 1, rotate: 0, y: 0 }}
                transition={{ 
                  type: "spring", 
                  damping: 15, 
                  stiffness: 100, 
                  delay: 0.2 
                }}
                className="relative mb-10"
              >
                <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-40 animate-pulse" />
                <div className="relative w-28 h-28 bg-gradient-to-br from-blue-400 via-blue-600 to-indigo-700 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-blue-900/50">
                  <BrainCircuit className="w-14 h-14 text-white" />
                </div>
              </motion.div>

              {/* Title with staggered reveal */}
              <div className="text-center overflow-hidden">
                <motion.h1
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.8, ease: "easeOut" }}
                  className="text-5xl md:text-7xl font-black bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-slate-500 mb-4 tracking-tighter"
                >
                  HSC MCQ Genie
                </motion.h1>
                
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 1, delay: 1.2 }}
                  className="flex items-center justify-center gap-4"
                >
                  <div className="h-[1px] w-8 bg-gradient-to-r from-transparent to-blue-500" />
                  <p className="text-blue-400 text-xs md:text-sm font-bold tracking-[0.5em] uppercase">
                    Ultimate Learning AI
                  </p>
                  <div className="h-[1px] w-8 bg-gradient-to-l from-transparent to-blue-500" />
                </motion.div>
              </div>

              {/* Loading Indicator */}
              <div className="mt-12 h-1 w-64 bg-slate-800 rounded-full overflow-hidden border border-slate-700/30">
                <motion.div 
                  initial={{ x: "-100%" }}
                  animate={{ x: "0%" }}
                  transition={{ duration: 2.8, ease: "linear", delay: 0.5 }}
                  className="h-full w-full bg-gradient-to-r from-blue-600 to-indigo-400"
                />
              </div>
            </div>

            {/* Credits - FROM Akhtar Ujjaman - Positioned with more elegance */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.8, duration: 1 }}
              className="absolute bottom-16 flex flex-col items-center"
            >
              <div className="flex items-center gap-4 mb-3">
                <div className="h-px w-6 bg-slate-700" />
                <span className="text-slate-500 text-[10px] font-black tracking-[0.4em] uppercase">Built with magic</span>
                <div className="h-px w-6 bg-slate-700" />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-slate-600 text-[9px] font-bold uppercase tracking-widest">FROM</span>
                <h2 className="text-2xl font-black text-white tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-blue-300 via-white to-indigo-300">
                  AKHTAR UJJAMAN
                </h2>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex h-[100dvh] bg-slate-50 text-slate-900 font-sans overflow-hidden selection:bg-blue-100">
      {/* Desktop Sidebar */}
      <nav className="hidden md:flex w-64 bg-slate-900 flex-col border-r border-slate-700 shrink-0">
        <NavContent />
      </nav>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
          >
            <motion.nav 
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-72 h-full bg-slate-900 flex flex-col border-r border-slate-700"
              onClick={e => e.stopPropagation()}
            >
              <NavContent />
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 md:px-8 flex items-center justify-between flex-none sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button 
              className="md:hidden p-2 text-slate-600 hover:bg-slate-50 rounded-lg"
              onClick={() => setIsSidebarOpen(true)}
            >
              <History className="w-6 h-6 rotate-90" /> {/* Hamburger replacement icon */}
            </button>
            <div className="flex items-center gap-2 min-w-0">
              {activeSession && view === 'quiz' ? (
                <h1 className="text-sm md:text-lg font-semibold text-slate-800 truncate max-w-[150px] md:max-w-md italic">{activeSession.name}</h1>
              ) : (
                <h1 className="text-lg font-semibold text-slate-800 capitalize">
                  {view === 'dashboard' ? 'প্র্যাকটিস হাব' : 
                   view === 'history' ? 'ইতিহাস' : 
                   view === 'profile' ? 'প্রোফাইল' : 'কুইজ'}
                </h1>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
             <div className="text-right hidden sm:block">
                <div className="text-[10px] md:text-[11px] font-bold text-slate-400 uppercase tracking-wider">HSC Mastery</div>
                <div className="text-xs md:text-sm font-bold text-slate-900 italic">{userBatch}</div>
             </div>
             <button 
               onClick={() => setView('profile')}
               className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-600 shadow-sm text-sm hover:bg-slate-200 transition-colors overflow-hidden"
             >
               {userAvatar ? (
                 <img src={userAvatar} className="w-full h-full object-cover" alt="Profile" />
               ) : (
                 userName.substring(0, 2).toUpperCase()
               )}
             </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isUploading && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-[32px] p-8 md:p-12 shadow-2xl space-y-8 max-w-lg w-full text-center relative overflow-hidden"
              >
                <div className="absolute top-0 inset-x-0 h-2 bg-blue-600" />
                <div className="w-24 h-24 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto animate-bounce">
                    <BrainCircuit className="w-12 h-12" />
                </div>
                
                <div className="space-y-2">
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight">ম্যাজিক চলছে...</h2>
                    <p className="text-slate-500 font-bold">{uploadProgress}</p>
                </div>

                {parseInt(uploadProgress) > 0 && (
                  <div className="w-full bg-slate-100 h-4 rounded-full overflow-hidden border border-slate-200">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${parseInt(uploadProgress)}%` }}
                        className="h-full bg-blue-600"
                      />
                  </div>
                )}

                <div className="p-6 bg-amber-50 border-2 border-amber-100 rounded-2xl text-slate-700 text-sm font-medium italic relative">
                    <div className="absolute -top-3 left-6 px-2 bg-amber-100 text-[10px] font-black uppercase text-amber-700 rounded-full">বোরড হচ্ছেন? একটি জোকস পড়ুন</div>
                    {joke}
                </div>

                {uploadError && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-600 text-sm font-bold">
                    ত্রুটি: {uploadError}
                    <button onClick={() => setUploadError(null)} className="ml-2 underline">ঠিক আছে</button>
                  </div>
                )}
                
                <div className="pt-4 flex items-center justify-center gap-2 text-slate-400">
                  <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
                  <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse delay-75" />
                  <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse delay-150" />
                </div>
              </motion.div>
            </div>
          )}
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-10">
            <AnimatePresence mode="wait">
              {view === 'dashboard' && (
                <motion.div 
                  key="dashboard"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6 md:space-y-10"
                >
                  <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 md:gap-8 text-center md:text-left">
                    <div className="max-w-xl mx-auto md:mx-0">
                      <h1 className="text-3xl md:text-5xl font-black tracking-tight text-slate-900 leading-tight">আপনার HSC প্রস্তুতি এখন আরও সহজ।</h1>
                      <p className="text-slate-500 mt-2 md:mt-4 text-sm md:text-lg font-medium leading-relaxed">AI চালিত একমাত্র অ্যাসিস্ট্যান্ট যা আপনাকে HSC-তে সেরা হতে সাহায্য করবে। আপলোড করুন, অ্যানালাইজ করুন এবং এক্সেল করুন।</p>
                    </div>
                    
                    <div className="flex flex-wrap justify-center gap-3 md:gap-4 shrink-0">
                      <div className="bg-white p-3 md:p-5 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm flex items-center gap-3 md:gap-5 min-w-[140px] md:min-w-[180px]">
                        <div className="w-8 h-8 md:w-12 md:h-12 bg-blue-50 text-blue-600 rounded-xl md:rounded-2xl flex items-center justify-center shadow-inner shrink-0">
                          <CheckCircle2 className="w-4 h-4 md:w-6 md:h-6" />
                        </div>
                        <div>
                          <div className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">Accuracy</div>
                          <div className="text-lg md:text-2xl font-black text-slate-900 tracking-tight">
                            {stats.total_attempts > 0 ? Math.round((stats.correct_answers / stats.total_attempts) * 100) : 0}%
                          </div>
                        </div>
                      </div>
                      <div className="bg-white p-3 md:p-5 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm flex items-center gap-3 md:gap-5 min-w-[140px] md:min-w-[180px]">
                        <div className="w-8 h-8 md:w-12 md:h-12 bg-slate-50 text-slate-600 rounded-xl md:rounded-2xl flex items-center justify-center shadow-inner shrink-0">
                          <BrainCircuit className="w-4 h-4 md:w-6 md:h-6" />
                        </div>
                        <div>
                          <div className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">Mastery</div>
                          <div className="text-lg md:text-2xl font-black text-slate-900 tracking-tight">{stats.total_attempts}</div>
                        </div>
                      </div>
                    </div>
                  </header>

                  {/* Upload Section */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div 
                      id="upload-button"
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.pdf,.txt,image/*';
                        input.onchange = (e: any) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUploadInternal(file);
                        };
                        input.click();
                      }}
                      className="relative group cursor-pointer h-56 md:h-72 border-2 border-dashed border-slate-200 hover:border-blue-500 hover:shadow-xl hover:shadow-blue-500/5 rounded-[24px] md:rounded-[32px] flex flex-col items-center justify-center transition-all bg-white px-6 text-center"
                    >
                      <div className="w-16 h-16 md:w-20 md:h-20 bg-blue-50 text-blue-600 rounded-[20px] md:rounded-[24px] flex items-center justify-center mb-4 md:mb-6 group-hover:scale-110 transition-transform shadow-inner">
                        <Upload className="w-7 h-7 md:w-9 md:h-9" />
                      </div>
                      <p className="text-lg md:text-xl font-black text-slate-900">PDF/ইমেজ আপলোড করুন</p>
                      <p className="text-slate-400 mt-1 md:mt-2 font-medium text-xs md:text-sm">Tap to select study material</p>
                    </div>

                    <div 
                      id="camera-button"
                      onClick={takePhoto}
                      className="relative group cursor-pointer h-56 md:h-72 border-2 border-dashed border-slate-200 hover:border-blue-500 hover:shadow-xl hover:shadow-blue-500/5 rounded-[24px] md:rounded-[32px] flex flex-col items-center justify-center transition-all bg-white px-6 text-center"
                    >
                      <div className="w-16 h-16 md:w-20 md:h-20 bg-slate-900 text-white rounded-[20px] md:rounded-[24px] flex items-center justify-center mb-4 md:mb-6 group-hover:scale-110 transition-transform shadow-inner">
                        <Camera className="w-7 h-7 md:w-9 md:h-9 text-blue-400" />
                      </div>
                      <p className="text-lg md:text-xl font-black text-slate-900">প্রশ্ন এর ছবি তুলুন</p>
                      <p className="text-slate-400 mt-1 md:mt-2 font-medium text-xs md:text-sm">Capture from camera</p>
                    </div>
                  </div>

                  {/* Recent Sessions */}
                  <div className="pt-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 md:mb-8 gap-4">
                      <div className="flex flex-col">
                        <h2 className="text-xl md:text-2xl font-black tracking-tight text-slate-900">সাম্প্রতিক সেশনসমূহ</h2>
                        <button 
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/health?_t=${Date.now()}`);
                              const data = await res.json();
                              alert(`Server is UP at ${data.time}`);
                            } catch (e) {
                              alert(`Server connection failed: ${e}`);
                            }
                          }}
                          className="text-[10px] text-left text-slate-400 hover:text-blue-500 underline mt-1"
                        >
                          সার্ভার কানেকশন চেক করুন
                        </button>
                      </div>
                      <div className="flex gap-4">
                        <button onClick={() => setView('history')} className="text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center gap-2 group transition-colors">
                          সবগুলো দেখুন <ChevronLeft className="w-4 h-4 rotate-180 group-hover:translate-x-1 transition-transform" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
                      {sessions.slice(0, 3).map((session) => (
                        <div 
                          key={session.id}
                          onClick={() => loadSession(session.id)}
                          className="bg-white border border-slate-200 p-6 md:p-8 rounded-[20px] md:rounded-[28px] hover:shadow-2xl hover:shadow-slate-200 transition-all cursor-pointer group flex flex-col h-full active:scale-95 duration-200"
                        >
                          <div className="flex items-start justify-between mb-4 md:mb-6">
                            <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-50 text-blue-600 rounded-lg md:rounded-2xl flex items-center justify-center shadow-sm shrink-0">
                              <FileText className="w-5 h-5 md:w-6 md:h-6" />
                            </div>
                            <span className="text-[9px] md:text-[11px] text-slate-400 font-bold uppercase tracking-widest bg-slate-50 px-2 py-0.5 md:px-3 md:py-1 rounded-full whitespace-nowrap">{new Date(session.created_at!).toLocaleDateString()}</span>
                          </div>
                          <h3 className="font-extrabold text-lg md:text-xl leading-tight line-clamp-2 text-slate-900 group-hover:text-blue-600 transition-colors mb-3 md:mb-4">{session.name}</h3>
                          <p className="text-slate-500 text-xs md:text-sm leading-relaxed line-clamp-3 font-medium flex-1">{session.summary}</p>
                        </div>
                      ))}
                      {sessions.length === 0 && !isUploading && (
                        <div className="col-span-full py-16 bg-white rounded-[24px] md:rounded-[32px] border-2 border-dotted border-slate-200 flex flex-col items-center px-6 text-center">
                          <BookOpen className="w-10 h-10 text-slate-200 mb-4" />
                          <p className="text-slate-400 font-bold mb-6">No study sessions found yet.</p>
                          <label className="bg-blue-600 text-white px-6 md:px-8 py-3 rounded-xl md:rounded-2xl font-bold cursor-pointer hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/10 active:scale-95 text-sm md:text-base">
                            Upload your first material
                            <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.txt" />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {view === 'quiz' && activeSession && (
                <QuizView 
                  session={activeSession} 
                  onBack={() => { setView('dashboard'); fetchStats(); }} 
                />
              )}

              {view === 'history' && (
                 <motion.div 
                   key="history"
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   exit={{ opacity: 0, y: -10 }}
                   className="space-y-8"
                 >
                   <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                     <div className="flex items-center gap-4">
                       <button onClick={() => setView('dashboard')} className="w-10 h-10 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center transition-all shadow-sm active:scale-95">
                         <ChevronLeft className="w-6 h-6" />
                       </button>
                       <div>
                        <h1 className="text-3xl font-black tracking-tight text-slate-900 leading-none">অধ্যয়নের ইতিহাস</h1>
                        <p className="text-slate-500 font-medium text-sm mt-1">আপনার সকল পূর্ববর্তী স্টাডি সেশন</p>
                       </div>
                     </div>
                     
                      <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                        <select 
                          value={filterTopic}
                          onChange={(e) => setFilterTopic(e.target.value)}
                          className="bg-white border border-slate-200 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-bold text-slate-700 text-sm appearance-none cursor-pointer shadow-sm"
                        >
                          <option value="all">সব বিষয়</option>
                          <option value="science">বিজ্ঞান</option>
                          <option value="arts">মানবিক</option>
                        </select>
                        
                        <select 
                          value={sortOrder}
                          onChange={(e) => setSortOrder(e.target.value as any)}
                          className="bg-white border border-slate-200 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-bold text-slate-700 text-sm appearance-none cursor-pointer shadow-sm"
                        >
                          <option value="newest">নতুনগুলো আগে</option>
                          <option value="oldest">পুরানো গুলো আগে</option>
                          <option value="az">A-Z</option>
                        </select>

                        <div className="relative flex-1 md:max-w-xs">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                          <input 
                            type="text"
                            placeholder="সেশন খুঁজুন..."
                            value={searchHistory}
                            onChange={(e) => setSearchHistory(e.target.value)}
                            className="w-full bg-white border border-slate-200 py-3 pl-11 pr-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold text-sm text-slate-900 shadow-sm"
                          />
                        </div>
                      </div>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                     {sessions
                       .filter(s => {
                          const matchesSearch = s.name.toLowerCase().includes(searchHistory.toLowerCase()) || 
                                              (s.summary && s.summary.toLowerCase().includes(searchHistory.toLowerCase()));
                          if (!matchesSearch) return false;
                          if (filterTopic === 'all') return true;
                          const name = s.name.toLowerCase();
                          const scienceKeywords = ['বিজ্ঞান', 'physic', 'chemist', 'biology', 'math', 'জীববিজ্ঞান', 'রসায়ন', 'পদার্থ', 'গণিত'];
                          const artsKeywords = ['ইতিহাস', 'বাংলা', 'পৌরনীতি', 'ভূগোল', 'sociology', 'history', 'bangla', 'civics'];
                          
                          if (filterTopic === 'science') return scienceKeywords.some(key => name.includes(key.toLowerCase()));
                          if (filterTopic === 'arts') return artsKeywords.some(key => name.includes(key.toLowerCase()));
                          return true;
                        })
                        .sort((a, b) => {
                          if (sortOrder === 'newest') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
                          if (sortOrder === 'oldest') return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
                          if (sortOrder === 'az') return a.name.localeCompare(b.name);
                          return 0;
                        })
                       .map((session) => (
                       <motion.div 
                         layout
                         key={session.id}
                         onClick={() => loadSession(session.id)}
                         className="bg-white border border-slate-200 p-8 rounded-[32px] hover:shadow-2xl hover:shadow-slate-200/50 transition-all cursor-pointer group flex flex-col h-full relative"
                       >
                         <div className="flex items-start justify-between mb-6">
                           <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner shrink-0 group-hover:scale-110 transition-transform">
                             <FileText className="w-6 h-6" />
                           </div>
                           <button 
                             onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                             className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                           >
                             <Trash2 className="w-5 h-5" />
                           </button>
                         </div>
                         
                         <div className="space-y-4 flex-1">
                           <div className="flex flex-col gap-1">
                             <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{new Date(session.created_at!).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                             <h3 className="font-extrabold text-xl leading-tight text-slate-900 group-hover:text-blue-600 transition-colors">{session.name}</h3>
                           </div>
                           <p className="text-slate-500 text-sm leading-relaxed line-clamp-4 font-medium italic overflow-hidden h-[5.6rem]">
                             {session.summary || "No summary available for this session."}
                           </p>
                         </div>

                         <div className="mt-8 pt-6 border-t border-slate-50 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                               <div className="w-2 h-2 rounded-full bg-blue-500" />
                               <span className="text-xs font-bold text-slate-500">Practice Session</span>
                            </div>
                            <span className="text-blue-600 font-bold text-sm flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                               শুরু করুন <ChevronLeft className="w-4 h-4 rotate-180" />
                            </span>
                         </div>
                       </motion.div>
                     ))}

                     {sessions.length > 0 && sessions.filter(s => s.name.toLowerCase().includes(searchHistory.toLowerCase())).length === 0 && (
                       <div className="col-span-full py-20 text-center space-y-4">
                         <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-200">
                           <Search className="w-10 h-10" />
                         </div>
                         <h3 className="text-xl font-bold text-slate-900">কোন সেশন পাওয়া যায়নি</h3>
                         <p className="text-slate-500">আপনার সার্চ কুয়েরি পরিবর্তন করে চেষ্টা করুন।</p>
                       </div>
                     )}

                     {sessions.length === 0 && (
                       <div className="col-span-full py-24 bg-white rounded-[40px] border-2 border-dotted border-slate-100 flex flex-col items-center px-10 text-center">
                         <div className="w-20 h-20 bg-blue-50 text-blue-200 rounded-full flex items-center justify-center mb-6">
                           <History className="w-10 h-10" />
                         </div>
                         <h3 className="text-2xl font-black text-slate-900 mb-2">ইতিহাস শুন্য!</h3>
                         <p className="text-slate-500 font-medium mb-8 max-w-sm">আপনি এখনো কোনো স্টাডি সেশন শুরু করেননি। ড্যাশবোর্ড থেকে একটি ফাইল আপলোড করে শুরু করুন।</p>
                         <button 
                           onClick={() => setView('dashboard')}
                           className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-bold hover:bg-slate-800 transition-all active:scale-95 shadow-xl shadow-slate-900/10"
                         >
                           প্রথম সেশন শুরু করুন
                         </button>
                       </div>
                     )}
                   </div>
                 </motion.div>
              )}

              {view === 'profile' && (
                <ProfileView 
                  userName={userName}
                  userBatch={userBatch}
                  userAvatar={userAvatar}
                  userApiKey={userApiKey}
                  onUpdateName={(n) => { setUserName(n); localStorage.setItem('hsc_user_name', n); }}
                  onUpdateBatch={(b) => { setUserBatch(b); localStorage.setItem('hsc_user_batch', b); }}
                  onUpdateAvatar={(a) => { setUserAvatar(a); localStorage.setItem('hsc_user_avatar', a); }}
                  onUpdateApiKey={(k) => { setUserApiKey(k); localStorage.setItem('hsc_gemini_api_key', k); }}
                  stats={stats}
                  onBack={() => setView('dashboard')}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  </div>
);
}

function ProfileView({ 
  userName, 
  userBatch, 
  userAvatar,
  userApiKey,
  onUpdateName, 
  onUpdateBatch, 
  onUpdateAvatar,
  onUpdateApiKey,
  stats,
  onBack 
}: { 
  userName: string, 
  userBatch: string, 
  userAvatar: string,
  userApiKey: string,
  onUpdateName: (n: string) => void, 
  onUpdateBatch: (b: string) => void,
  onUpdateAvatar: (a: string) => void,
  onUpdateApiKey: (k: string) => void,
  stats: Stats,
  onBack: () => void
}) {
  const [name, setName] = useState(userName);
  const [batch, setBatch] = useState(userBatch);
  const [apiKey, setApiKey] = useState(userApiKey);
  const [avatar, setAvatar] = useState(userAvatar);
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = () => {
    onUpdateName(name);
    onUpdateBatch(batch);
    onUpdateApiKey(apiKey);
    onUpdateAvatar(avatar);
    setIsEditing(false);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatar(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="max-w-4xl mx-auto space-y-8"
    >
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="w-10 h-10 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center transition-all shadow-sm">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-3xl font-black tracking-tight text-slate-900">ছাত্র প্রোফাইল</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Avatar & Main Info */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white border border-slate-200 p-8 rounded-[32px] text-center space-y-6 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 inset-x-0 h-2 bg-blue-500" />
            
            <div className="relative w-24 h-24 mx-auto group">
              <div className="w-24 h-24 bg-slate-100 rounded-3xl flex items-center justify-center text-4xl font-black text-slate-400 border-4 border-white shadow-xl overflow-hidden">
                {avatar ? (
                  <img src={avatar} className="w-full h-full object-cover" alt="Avatar" />
                ) : (
                  userName.substring(0, 2).toUpperCase()
                )}
              </div>
              {isEditing && (
                <label className="absolute inset-0 bg-black/40 rounded-3xl flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="w-8 h-8 text-white" />
                  <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
                </label>
              )}
            </div>

            <div>
              <h2 className="text-2xl font-black text-slate-900">{userName}</h2>
              <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-1">{userBatch}</p>
            </div>
            <div className="pt-6 border-t border-slate-50">
              <button 
                onClick={() => setIsEditing(!isEditing)}
                className="w-full py-3 rounded-2xl font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors active:scale-95"
              >
                {isEditing ? 'বাতিল করুন' : 'প্রোফাইল এডিট'}
              </button>
            </div>
          </div>

          <div className="bg-blue-600 p-8 rounded-[32px] text-white space-y-4 shadow-xl shadow-blue-600/20">
             <div className="flex items-center gap-3">
               <BrainCircuit className="w-6 h-6" />
               <span className="font-black tracking-tight">HSC মাস্টারি লেভেল</span>
             </div>
             <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold uppercase tracking-wider opacity-80">
                  <span>অগ্রগতি</span>
                  <span>{Math.min(100, stats.total_attempts * 5)}%</span>
                </div>
                <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                   <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, stats.total_attempts * 5)}%` }}
                    className="h-full bg-white"
                   />
                </div>
             </div>
          </div>
        </div>

        {/* Right Column: Settings & Detailed Stats */}
        <div className="lg:col-span-2 space-y-8">
          {isEditing ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm space-y-6"
            >
              <h3 className="text-xl font-black text-slate-900">ব্যক্তিগত তথ্য</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">পুরো নাম</label>
                  <input 
                    type="text" 
                    value={name} 
                    onChange={e => setName(e.target.value)}
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    placeholder="আপনার নাম লিখুন"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">ব্যাচ / গ্রুপ</label>
                  <input 
                    type="text" 
                    value={batch} 
                    onChange={e => setBatch(e.target.value)}
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    placeholder="উদা: ২০২৬ ব্যাচ - বিজ্ঞান"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Gemini API Key (ঐচ্ছিক)</label>
                  <input 
                    type="password" 
                    value={apiKey} 
                    onChange={e => setApiKey(e.target.value)}
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                    placeholder="Paste your API Key here"
                  />
                  <p className="text-[10px] text-slate-400 font-medium ml-1">ফাঁকা থাকলে ডিফল্ট কি ব্যবহার হবে।</p>
                </div>
              </div>
              <button 
                onClick={handleSave}
                className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black shadow-lg shadow-blue-600/20 hover:scale-105 transition-all active:scale-95"
              >
                পরিবর্তন সেভ করুন
              </button>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm flex flex-col justify-between">
                <div>
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-6">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div className="text-4xl font-black text-slate-900 tracking-tight">{stats.correct_answers}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Correct Answers</div>
                </div>
                <p className="text-xs text-slate-500 mt-4 font-medium">Keep practicing to improve your accuracy!</p>
              </div>

              <div className="bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm flex flex-col justify-between">
                <div>
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-6">
                    <BarChart3 className="w-6 h-6" />
                  </div>
                  <div className="text-4xl font-black text-slate-900 tracking-tight">
                    {stats.total_attempts > 0 ? ((stats.correct_answers / stats.total_attempts) * 100).toFixed(1) : '0.0'}%
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Success Rate</div>
                </div>
                <p className="text-xs text-slate-500 mt-4 font-medium">Based on your total objective evaluations.</p>
              </div>

              <div className="md:col-span-2 bg-slate-900 p-8 rounded-[32px] text-white relative overflow-hidden group">
                <div className="relative z-10">
                   <h3 className="text-xl font-black mb-2">Total Learning Sessions</h3>
                   <div className="text-6xl font-black tracking-tighter text-blue-400">{stats.total_attempts}</div>
                   <p className="text-slate-400 font-medium mt-4 max-w-xs">Every attempt brings you closer to your HSC goals. Stay consistent!</p>
                </div>
                <div className="absolute top-1/2 -right-8 -translate-y-1/2 opacity-10 group-hover:scale-110 transition-transform">
                   <BrainCircuit className="w-48 h-48" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function QuizView({ session, onBack }: { session: StudySession, onBack: () => void }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [viewMode, setViewMode] = useState<'quiz' | 'summary'>('summary');

  const questions = session.questions || [];
  const currentQ = questions[currentIdx];

  const handleAnswer = async (idx: number) => {
    if (selectedIdx !== null) return;
    
    setSelectedIdx(idx);
    const correct = idx === currentQ.correctIdx;
    if (correct) setScore(s => s + 1);
    
    setShowExplanation(true);
    
    try {
      await fetch('/api/track-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: currentQ.id, is_correct: correct })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const nextQuestion = () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setSelectedIdx(null);
      setShowExplanation(false);
    } else {
      setIsFinished(true);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-5xl mx-auto space-y-6 md:space-y-8 pb-32"
    >
      <div className="flex flex-col sm:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 md:gap-6">
          <button onClick={onBack} className="w-10 h-10 md:w-12 md:h-12 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg md:rounded-2xl flex items-center justify-center transition-all shadow-sm group">
            <ChevronLeft className="w-5 h-5 md:w-6 md:h-6 group-hover:-translate-x-0.5 transition-transform" />
          </button>
          <div className="min-w-0">
            <h2 className="text-xl md:text-2xl font-black text-slate-900 truncate max-w-[200px] sm:max-w-[400px] md:max-w-lg">{session.name}</h2>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Topic Analysis Mode</div>
          </div>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-xl md:rounded-2xl shadow-inner w-fit">
           <button 
             onClick={() => setViewMode('summary')}
             className={cn("px-4 md:px-6 py-2 md:py-2.5 rounded-lg md:rounded-xl text-xs md:text-sm font-black transition-all", viewMode === 'summary' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
           >
             Core Summary
           </button>
           <button 
             onClick={() => setViewMode('quiz')}
             className={cn("px-4 md:px-6 py-2 md:py-2.5 rounded-lg md:rounded-xl text-xs md:text-sm font-black transition-all", viewMode === 'quiz' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
           >
             Knowledge Test
           </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {viewMode === 'summary' ? (
          <motion.div 
            key="summary-view"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="bg-white border border-slate-200 p-6 md:p-12 rounded-[24px] md:rounded-[32px] shadow-sm relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-4 md:p-8 opacity-5 pointer-events-none">
               <FileText className="w-24 h-24 md:w-40 md:h-40" />
            </div>
            <h3 className="text-xl md:text-2xl font-black text-slate-900 mb-6 md:mb-8 flex items-center gap-3">
              <FileText className="w-5 h-5 md:w-6 md:h-6 text-blue-600" /> মূল সারসংক্ষেপ
            </h3>
            <div className="prose prose-slate max-w-none">
              <p className="text-base md:text-xl leading-relaxed text-slate-700 font-medium whitespace-pre-wrap">
                {session.summary}
              </p>
            </div>
            <div className="mt-10 md:mt-16 pt-8 md:pt-10 border-t border-slate-100 flex justify-center">
               <button 
                onClick={() => setViewMode('quiz')}
                className="w-full sm:w-auto bg-blue-600 text-white px-8 md:px-10 py-3 md:py-4 rounded-xl md:rounded-2xl font-black hover:scale-105 transition-all shadow-xl shadow-blue-600/20 flex items-center justify-center gap-3 active:scale-95 text-sm md:text-base"
               >
                 নলেজ কুইজ শুরু করুন <BookOpen className="w-5 h-5 md:w-6 md:h-6" />
               </button>
            </div>
          </motion.div>
        ) : (
          !isFinished ? (
            <motion.div 
              key="quiz-view"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-6 md:space-y-10"
            >
              <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] md:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">অবজেক্টিভ অ্যাসেসমেন্ট</span>
                  <div className="text-slate-900 font-bold text-base md:text-lg font-mono italic">প্রশ্ন {currentIdx + 1} / {questions.length}</div>
                </div>
                <div className="flex flex-col sm:items-end">
                   <div className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 font-mono">{Math.round(((currentIdx + 1) / questions.length) * 100)}% সম্পন্ন</div>
                   <div className="w-full sm:w-48 h-1.5 bg-slate-200 rounded-full overflow-hidden shadow-inner shrink-0">
                    <div className="h-full bg-blue-600 transition-all duration-700 ease-out" style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }} />
                  </div>
                </div>
              </header>

              <div className="bg-white border border-slate-200 p-6 md:p-12 rounded-[24px] md:rounded-[32px] shadow-sm">
                <h3 className="text-xl md:text-3xl font-black text-slate-900 leading-tight">{currentQ.question}</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                {currentQ.options.map((option, idx) => (
                  <button
                    key={idx}
                    disabled={selectedIdx !== null}
                    onClick={() => handleAnswer(idx)}
                    className={cn(
                      "group p-4 md:p-6 rounded-[20px] md:rounded-2xl border-2 text-left transition-all duration-300 flex items-center justify-between relative overflow-hidden min-h-[80px]",
                      selectedIdx === null 
                        ? "bg-white border-slate-100 hover:border-blue-500 hover:shadow-xl hover:shadow-blue-500/5" 
                        : idx === currentQ.correctIdx
                          ? "bg-emerald-50 border-emerald-500 text-emerald-900 shadow-md"
                          : selectedIdx === idx
                            ? "bg-red-50 border-red-500 text-red-900"
                            : "bg-white border-slate-100 opacity-40"
                    )}
                  >
                    <div className="flex items-center gap-4 md:gap-5 z-10">
                      <span className={cn(
                        "w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl border-2 flex items-center justify-center font-black text-sm md:text-base transition-colors shrink-0",
                        selectedIdx === null ? "bg-slate-50 border-slate-100 text-slate-400 group-hover:bg-blue-600 group-hover:border-blue-600 group-hover:text-white" : "border-current"
                      )}>
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span className="font-bold text-base md:text-lg tracking-tight leading-tight">{option}</span>
                    </div>
                    {selectedIdx !== null && idx === currentQ.correctIdx && (
                      <div className="absolute right-4 md:right-6 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-6 h-6 md:w-7 md:h-7 text-emerald-600" />
                      </div>
                    )}
                    {selectedIdx === idx && idx !== currentQ.correctIdx && (
                      <div className="absolute right-4 md:right-6 flex items-center justify-center shrink-0">
                        <XCircle className="w-6 h-6 md:w-7 md:h-7 text-red-600" />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              <AnimatePresence>
                {showExplanation && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.98, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    className="bg-white border border-slate-200 border-l-8 border-l-blue-600 p-6 md:p-10 rounded-[24px] md:rounded-3xl shadow-xl space-y-4 md:space-y-6"
                  >
                    <div className="flex items-center gap-3 text-slate-900">
                      <div className="p-2 bg-blue-50 rounded-lg shrink-0">
                        <BrainCircuit className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />
                      </div>
                      <h4 className="font-black text-lg md:text-xl tracking-tight">ইন্টেলিজেন্স ফিডব্যাক</h4>
                    </div>
                    <p className="text-slate-600 leading-relaxed text-[15px] md:text-lg font-medium italic bg-slate-50 p-4 md:p-6 rounded-xl md:rounded-2xl border border-slate-100">
                      {currentQ.explanation}
                    </p>
                    <div className="pt-4 md:pt-6 flex justify-center sm:justify-end">
                      <button 
                        onClick={nextQuestion}
                        className="w-full sm:w-auto bg-slate-900 text-white px-8 md:px-10 py-3 md:py-4 rounded-xl md:rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-lg active:scale-95 text-sm md:text-base"
                      >
                        {currentIdx === questions.length - 1 ? 'ফলাফল দেখুন' : 'পরবর্তী প্রশ্ন'}
                        <ChevronLeft className="w-5 h-5 rotate-180" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div 
              key="result-view"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white border border-slate-200 p-8 md:p-16 rounded-[32px] md:rounded-[48px] shadow-2xl text-center space-y-8 md:space-y-10 relative overflow-hidden"
            >
              <div className="absolute top-0 inset-x-0 h-2 bg-emerald-500 overflow-hidden">
                 <motion.div 
                  initial={{ x: '-100%' }}
                  animate={{ x: '0%' }}
                  transition={{ duration: 1.5, ease: 'easeOut' }}
                  className="h-full w-full bg-emerald-300 opacity-30"
                 />
              </div>

              <div className="space-y-4">
                <div className="w-16 h-16 md:w-24 md:h-24 bg-emerald-50 text-emerald-600 rounded-[20px] md:rounded-[32px] flex items-center justify-center mx-auto mb-4 md:mb-6 shadow-inner ring-4 md:ring-8 ring-emerald-50/50 shrink-0">
                  <CheckCircle2 className="w-8 h-8 md:w-12 md:h-12" />
                </div>
                <h2 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight">অভিনন্দন! সফলভাবে সম্পন্ন হয়েছে।</h2>
                <p className="text-slate-500 text-base md:text-xl font-medium px-4">সেশন স্ট্যাটাস: <span className="text-slate-900 font-bold underline decoration-blue-500/30 underline-offset-4">{session.name}</span></p>
              </div>
              
              <div className="flex flex-col sm:flex-row justify-center gap-8 md:gap-16 py-8 md:py-12 border-y border-slate-100">
                <div className="text-center group">
                  <div className="text-4xl md:text-5xl font-black text-slate-900 tracking-tighter transition-transform group-hover:scale-110">{score}<span className="text-slate-200 font-normal">/</span>{questions.length}</div>
                  <div className="text-[10px] md:text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] mt-2 md:mt-3">সঠিক উত্তর</div>
                </div>
                <div className="hidden sm:block w-px h-12 md:h-16 bg-slate-100 my-auto" />
                <div className="text-center group">
                  <div className="text-4xl md:text-5xl font-black text-emerald-600 tracking-tighter transition-transform group-hover:scale-110">{Math.round((score / questions.length) * 100)}%</div>
                  <div className="text-[10px] md:text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] mt-2 md:mt-3">সাফল্যের হার</div>
                </div>
              </div>

              <div className="pt-4 md:pt-8 flex flex-col sm:flex-row items-center justify-center gap-4 md:gap-6">
                <button 
                  onClick={() => {
                    setCurrentIdx(0);
                    setSelectedIdx(null);
                    setShowExplanation(false);
                    setScore(0);
                    setIsFinished(false);
                  }}
                  className="w-full sm:w-auto px-8 md:px-10 py-3 md:py-4 rounded-xl md:rounded-2xl border-2 border-slate-100 font-black text-slate-900 hover:bg-slate-50 hover:border-slate-200 transition-all active:scale-95 text-sm md:text-base"
                >
                  আবার চেষ্টা করুন
                </button>
                <button 
                  onClick={onBack}
                  className="w-full sm:w-auto bg-blue-600 text-white px-8 md:px-12 py-3 md:py-4 rounded-xl md:rounded-2xl font-black hover:scale-105 transition-all shadow-xl shadow-blue-600/20 active:scale-95 text-sm md:text-base"
                >
                  ড্যাশবোর্ডে ফিরে যান
                </button>
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </motion.div>
  );
}
