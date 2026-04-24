export interface Question {
  id: string;
  question: string;
  options: string[];
  correctIdx: number;
  explanation: string;
}

export interface StudySession {
  id: string;
  name: string;
  content: string;
  summary: string;
  created_at?: string;
  questions?: Question[];
}

export interface Stats {
  total_attempts: number;
  correct_answers: number;
}
