import test from 'node:test';
import assert from 'node:assert/strict';
import { noteInput, todoInput, positiveInteger } from '../src/lib/workbenchInput.ts';

test('notes preserve text and ignore supplied ownership', () => {
  assert.deepEqual(noteInput({ title: '  会议记录  ', content: '  第一行\n第二行 ', pinned: false, userId: 999 }), {
    title: '会议记录', content: '  第一行\n第二行 ', pinned: false,
  });
  for (const input of [null, [], {}, { title: ' ', content: '', pinned: false }, { title: 'x'.repeat(121), content: '', pinned: false },
    { title: 'x', content: 'x'.repeat(20001), pinned: false }, { title: 'x', content: '', pinned: 'true' }]) {
    assert.throws(() => noteInput(input), { status: 400 });
  }
});

test('todos validate date-only values, booleans and priorities', () => {
  const draft = { title: '整理报告', completed: false, priority: 'high', dueDate: '2028-02-29' };
  assert.equal(todoInput(draft).dueDate.toISOString(), '2028-02-29T00:00:00.000Z');
  assert.equal(todoInput({ ...draft, dueDate: null }).dueDate, null);
  for (const dueDate of ['2026-02-29', '2026-13-01', '2026-01-32', '2026-01-01T12:00:00Z', '', '1899-01-01', '2101-01-01']) {
    assert.throws(() => todoInput({ ...draft, dueDate }), { status: 400 });
  }
  assert.throws(() => todoInput({ ...draft, priority: 'urgent' }), { status: 400 });
  assert.throws(() => todoInput({ ...draft, completed: 'false' }), { status: 400 });
  assert.throws(() => todoInput({ ...draft, title: 'x'.repeat(201) }), { status: 400 });
});

test('IDs and versions must be positive safe integers', () => {
  assert.equal(positiveInteger(1), 1);
  for (const value of [undefined, '1', NaN, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => positiveInteger(value), { status: 400 });
  }
});
