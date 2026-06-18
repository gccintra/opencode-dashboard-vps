export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  result?: string;
  status: 'pending' | 'done' | 'error';
}

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

export interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
  message_count: number;
}
