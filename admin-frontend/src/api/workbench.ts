import client from './client';
import { getEntityAccessToken } from './entities';

export interface NoteDraft { title: string; content: string; pinned: boolean }
export interface WorkbenchNote extends NoteDraft { id: number; version: number; createdAt: string; updatedAt: string }
export type TodoPriority = 'low' | 'normal' | 'high';
export interface TodoDraft { title: string; completed: boolean; priority: TodoPriority; dueDate: string | null }
export interface WorkbenchTodo extends TodoDraft { id: number; version: number; completedAt: string | null; createdAt: string; updatedAt: string }

function access() {
  return { headers: { 'X-Entity-Access-Token': getEntityAccessToken() || '' } };
}

export async function getWorkbenchNotes(): Promise<WorkbenchNote[]> {
  return (await client.get('/workbench/notes', access())).data;
}
export async function saveWorkbenchNote(draft: NoteDraft, note?: WorkbenchNote): Promise<WorkbenchNote> {
  return note
    ? (await client.put(`/workbench/notes/${note.id}`, { ...draft, version: note.version }, access())).data
    : (await client.post('/workbench/notes', draft, access())).data;
}
export async function deleteWorkbenchNote(note: WorkbenchNote): Promise<void> {
  await client.delete(`/workbench/notes/${note.id}`, { ...access(), data: { version: note.version } });
}
export async function getWorkbenchTodos(): Promise<WorkbenchTodo[]> {
  return (await client.get('/workbench/todos', access())).data;
}
export async function saveWorkbenchTodo(draft: TodoDraft, todo?: WorkbenchTodo): Promise<WorkbenchTodo> {
  return todo
    ? (await client.put(`/workbench/todos/${todo.id}`, { ...draft, version: todo.version }, access())).data
    : (await client.post('/workbench/todos', draft, access())).data;
}
export async function deleteWorkbenchTodo(todo: WorkbenchTodo): Promise<void> {
  await client.delete(`/workbench/todos/${todo.id}`, { ...access(), data: { version: todo.version } });
}

export function workbenchError(error: unknown): string {
  const response = error as { response?: { data?: { error?: string }; status?: number } };
  return response.response?.data?.error || '操作失败，请检查网络后重试';
}
