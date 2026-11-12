import { describe, expect, it } from 'vitest';
import { rejectUnlessAuthorized } from './tasks';

const cron = (h?: string) => new Request('http://x/api/cron/y', { headers: h ? { authorization: h } : {} });
const task = (h?: string) => new Request('http://x/api/tasks/y', { method: 'POST', headers: h ? { 'x-task-secret': h } : {} });

describe('rejectUnlessAuthorized', () => {
  it('requires the cron bearer secret', () => {
    expect(rejectUnlessAuthorized(cron(), 'cron')?.status).toBe(401);
    expect(rejectUnlessAuthorized(cron('Bearer wrong'), 'cron')?.status).toBe(401);
    expect(rejectUnlessAuthorized(cron(`Bearer ${process.env.CRON_SECRET}`), 'cron')).toBeNull();
  });

  it('requires the task secret header, and the cron secret does not work for tasks', () => {
    expect(rejectUnlessAuthorized(task(), 'task')?.status).toBe(401);
    expect(rejectUnlessAuthorized(task(process.env.CRON_SECRET), 'task')?.status).toBe(401);
    expect(rejectUnlessAuthorized(task(process.env.TASKS_SECRET), 'task')).toBeNull();
  });
});
