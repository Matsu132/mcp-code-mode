import {z} from 'zod';

export const executionSettings = z.strictObject({
  concurrency:z.number().int().min(1).max(16),
  queueSize:z.number().int().min(0).max(32),
  queueWaitMs:z.number().int().min(100).max(15000),
  timeoutMs:z.number().int().min(100).max(15000),
});

export type ExecutionSettings = z.infer<typeof executionSettings>;

export function defaults(env:NodeJS.ProcessEnv) {
  return executionSettings.parse({
    concurrency:Number(env.EXECUTION_CONCURRENCY??4),
    queueSize:Number(env.EXECUTION_QUEUE_SIZE??8),
    queueWaitMs:Number(env.EXECUTION_QUEUE_WAIT_MS??5000),
    timeoutMs:Number(env.EXECUTION_TIMEOUT_MS??15000),
  });
}
