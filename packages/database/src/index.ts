import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL || 'http://localhost:54321';
  const supabaseKey = process.env.SUPABASE_ANON_KEY || 'your-anon-key';
  return createClient(supabaseUrl, supabaseKey);
}

// Minimal stub for testing locally without full Supabase running
export class MockDatabase {
  private memoryLogs: any[] = [];
  
  async saveLog(log: string) {
    this.memoryLogs.push({ timestamp: new Date().toISOString(), log });
    console.log("MockDB saved log:", log);
  }
  
  async getLogs() {
    return this.memoryLogs;
  }
}
