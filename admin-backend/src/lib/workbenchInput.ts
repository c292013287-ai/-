export class WorkbenchError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new WorkbenchError(400, '记录编号或版本无效');
  }
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkbenchError(400, '提交内容无效');
  }
  return value as Record<string, unknown>;
}

function title(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new WorkbenchError(400, `标题不能为空，且不能超过 ${max} 字`);
  }
  return value.trim();
}

export function noteInput(value: unknown) {
  const body = object(value);
  if (typeof body.content !== 'string' || body.content.length > 20000 || typeof body.pinned !== 'boolean') {
    throw new WorkbenchError(400, '笔记内容不能超过 20000 字，置顶状态须有效');
  }
  return { title: title(body.title, 120), content: body.content, pinned: body.pinned };
}

export function todoInput(value: unknown) {
  const body = object(value);
  if (typeof body.completed !== 'boolean' || !['low', 'normal', 'high'].includes(body.priority as string)) {
    throw new WorkbenchError(400, '待办状态或优先级无效');
  }
  let dueDate: Date | null = null;
  if (body.dueDate !== null) {
    if (typeof body.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
      throw new WorkbenchError(400, '截止日期无效');
    }
    dueDate = new Date(`${body.dueDate}T00:00:00.000Z`);
    if (!Number.isFinite(dueDate.getTime()) || dueDate.toISOString().slice(0, 10) !== body.dueDate
      || dueDate.getUTCFullYear() < 1900 || dueDate.getUTCFullYear() > 2100) {
      throw new WorkbenchError(400, '截止日期无效');
    }
  }
  return { title: title(body.title, 200), completed: body.completed, priority: body.priority as string, dueDate };
}
