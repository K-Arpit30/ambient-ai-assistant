import { z } from 'zod';

export const TaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  result: z.string().optional()
});

export type Task = z.infer<typeof TaskSchema>;

export interface AgentMessage {
  type: 'heartbeat' | 'log' | 'task_update';
  payload: any;
}
