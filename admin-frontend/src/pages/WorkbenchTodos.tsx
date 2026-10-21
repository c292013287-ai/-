import { useEffect, useState } from 'react';
import { Alert, App, Button, Checkbox, DatePicker, Empty, Input, Modal, Popconfirm, Segmented, Select, Tag, Tooltip } from 'antd';
import { CalendarOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { deleteWorkbenchTodo, saveWorkbenchTodo, workbenchError, type TodoDraft, type TodoPriority, type WorkbenchTodo } from '../api/workbench';

const emptyDraft: TodoDraft = { title: '', completed: false, priority: 'normal', dueDate: null };
const priorities = { high: { text: '高优先级', rank: 0, color: 'red' }, normal: { text: '普通', rank: 1, color: 'blue' }, low: { text: '低优先级', rank: 2, color: 'default' } };

export default function WorkbenchTodos({ todos, onChange }: { todos: WorkbenchTodo[]; onChange: (todos: WorkbenchTodo[]) => void }) {
  const { message, modal } = App.useApp();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('open');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkbenchTodo>();
  const [draft, setDraft] = useState<TodoDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const initial = editing ? { ...editing, dueDate: editing.dueDate?.slice(0, 10) || null } : emptyDraft;
  const dirty = draft.title !== initial.title || draft.priority !== initial.priority || draft.dueDate !== initial.dueDate;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const pending = todos.filter(todo => !todo.completed).length;
  const query = search.trim().toLocaleLowerCase();
  const visible = todos.filter(todo => (filter === 'all' || (filter === 'done' ? todo.completed : !todo.completed)) && todo.title.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(a.completed) - Number(b.completed) || priorities[a.priority].rank - priorities[b.priority].rank
      || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || b.id - a.id);

  useEffect(() => {
    if (!open || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [open, dirty]);

  const edit = (todo?: WorkbenchTodo) => {
    setEditing(todo); setDraft(todo ? { title: todo.title, priority: todo.priority, dueDate: todo.dueDate?.slice(0, 10) || null, completed: todo.completed } : emptyDraft);
    setError(''); setOpen(true);
  };
  const close = () => {
    if (saving) return;
    if (!dirty) { setOpen(false); return; }
    modal.confirm({ title: '放弃未保存的待办？', okText: '放弃修改', cancelText: '继续编辑', okButtonProps: { danger: true }, onOk: () => setOpen(false) });
  };
  const save = async () => {
    setSaving(true); setError('');
    try {
      const todo = await saveWorkbenchTodo(draft, editing);
      onChange([todo, ...todos.filter(item => item.id !== todo.id)]);
      if (!editing) { setFilter('open'); setSearch(''); }
      setOpen(false); message.success('待办已保存');
    } catch (err) { setError(workbenchError(err)); } finally { setSaving(false); }
  };
  const toggle = async (todo: WorkbenchTodo) => {
    setBusy(true);
    try {
      const saved = await saveWorkbenchTodo({ ...todo, dueDate: todo.dueDate?.slice(0, 10) || null, completed: !todo.completed }, todo);
      onChange(todos.map(item => item.id === saved.id ? saved : item));
    } catch (err) { message.error(workbenchError(err)); } finally { setBusy(false); }
  };
  const remove = async (todo: WorkbenchTodo) => {
    setBusy(true);
    try { await deleteWorkbenchTodo(todo); onChange(todos.filter(item => item.id !== todo.id)); message.success('待办已删除'); }
    catch (err) { message.error(workbenchError(err)); } finally { setBusy(false); }
  };

  return <section aria-label="待办清单">
    <div className="workbench-toolbar">
      <Input className="workbench-search" prefix={<SearchOutlined />} aria-label="搜索待办" placeholder="搜索待办" allowClear value={search} onChange={event => setSearch(event.target.value)} />
      <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>新建待办</Button>
    </div>
    <Segmented className="workbench-todo-filters" value={filter} onChange={setFilter} options={[
      { label: `未完成 ${pending}`, value: 'open' }, { label: `已完成 ${todos.length - pending}`, value: 'done' }, { label: '全部', value: 'all' },
    ]} />
    {visible.length ? <ul className="workbench-todos">{visible.map(todo => {
      const dueDate = todo.dueDate?.slice(0, 10);
      const overdue = !todo.completed && !!dueDate && dueDate < today;
      return <li key={todo.id} className={`workbench-todo${todo.completed ? ' is-complete' : ''}`}>
        <Checkbox checked={todo.completed} disabled={busy} aria-label={`${todo.completed ? '恢复待办' : '完成待办'}：${todo.title}`} onChange={() => void toggle(todo)} />
        <div className="workbench-todo-main">
          <button type="button" className="workbench-todo-title" onClick={() => edit(todo)}>{todo.title}</button>
          <div className="workbench-todo-meta"><Tag color={priorities[todo.priority].color}>{priorities[todo.priority].text}</Tag>
            {dueDate && <span className={overdue ? 'workbench-overdue' : ''}><CalendarOutlined /> {dueDate}{overdue ? ' · 已逾期' : !todo.completed && dueDate === today ? ' · 今天到期' : ''}</span>}
          </div>
        </div>
        <div className="workbench-row-actions">
          <Tooltip title="编辑待办"><Button type="text" aria-label="编辑待办" icon={<EditOutlined />} onClick={() => edit(todo)} disabled={busy} /></Tooltip>
          <Popconfirm title="删除这条待办？" okText="删除" cancelText="取消" onConfirm={() => remove(todo)} okButtonProps={{ danger: true }} onOpenChange={visible => setDeleteConfirmId(visible ? todo.id : null)}>
            <Tooltip title="删除待办" open={deleteConfirmId === todo.id ? false : undefined}><Button type="text" danger aria-label="删除待办" icon={<DeleteOutlined />} disabled={busy} /></Tooltip>
          </Popconfirm>
        </div>
      </li>;
    })}</ul> : <Empty className="workbench-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? '没有匹配的待办' : filter === 'done' ? '暂无已完成待办' : '暂无待办'} />}
    <Modal title={editing ? '编辑待办' : '新建待办'} open={open} onCancel={close} maskClosable={false} keyboard={!saving} closable={!saving}
      footer={<><Button onClick={close} disabled={saving}>取消</Button><Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!draft.title.trim() || !dirty} onClick={() => void save()}>保存待办</Button></>}>
      <div className="workbench-editor">
        {error && <Alert type="error" showIcon title={error} />}
        <label htmlFor="workbench-todo-title">待办事项</label>
        <Input.TextArea id="workbench-todo-title" autoSize={{ minRows: 2, maxRows: 5 }} maxLength={200} showCount value={draft.title} disabled={saving} onChange={event => setDraft({ ...draft, title: event.target.value })} />
        <label htmlFor="workbench-todo-priority">优先级</label>
        <Select id="workbench-todo-priority" value={draft.priority} disabled={saving} onChange={(priority: TodoPriority) => setDraft({ ...draft, priority })} options={Object.entries(priorities).map(([value, item]) => ({ value, label: item.text }))} />
        <label htmlFor="workbench-todo-date">截止日期</label>
        <DatePicker id="workbench-todo-date" value={draft.dueDate ? dayjs(draft.dueDate) : null} disabled={saving} onChange={value => setDraft({ ...draft, dueDate: value?.format('YYYY-MM-DD') || null })} minDate={dayjs('1900-01-01')} maxDate={dayjs('2100-12-31')} />
      </div>
    </Modal>
  </section>;
}
