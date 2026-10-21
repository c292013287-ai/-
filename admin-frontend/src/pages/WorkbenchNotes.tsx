import { useEffect, useState } from 'react';
import { Alert, App, Button, Empty, Input, Modal, Popconfirm, Switch, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, PushpinFilled, PushpinOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { deleteWorkbenchNote, saveWorkbenchNote, workbenchError, type NoteDraft, type WorkbenchNote } from '../api/workbench';

const emptyDraft: NoteDraft = { title: '', content: '', pinned: false };

export default function WorkbenchNotes({ notes, onChange }: { notes: WorkbenchNote[]; onChange: (notes: WorkbenchNote[]) => void }) {
  const { message, modal } = App.useApp();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkbenchNote>();
  const [draft, setDraft] = useState<NoteDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const initial = editing || emptyDraft;
  const dirty = draft.title !== initial.title || draft.content !== initial.content || draft.pinned !== initial.pinned;

  useEffect(() => {
    if (!open || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [open, dirty]);

  const edit = (note?: WorkbenchNote) => {
    setEditing(note);
    setDraft(note ? { title: note.title, content: note.content, pinned: note.pinned } : emptyDraft);
    setError(''); setOpen(true);
  };
  const close = () => {
    if (saving) return;
    if (!dirty) { setOpen(false); return; }
    modal.confirm({ title: '放弃未保存的笔记？', okText: '放弃修改', cancelText: '继续编辑', okButtonProps: { danger: true }, onOk: () => setOpen(false) });
  };
  const save = async () => {
    setSaving(true); setError('');
    try {
      const note = await saveWorkbenchNote(draft, editing);
      onChange([note, ...notes.filter(item => item.id !== note.id)]);
      if (!editing) setSearch('');
      setOpen(false); message.success('笔记已保存');
    } catch (err) { setError(workbenchError(err)); } finally { setSaving(false); }
  };
  const pin = async (note: WorkbenchNote) => {
    setBusy(true);
    try {
      const saved = await saveWorkbenchNote({ ...note, pinned: !note.pinned }, note);
      onChange(notes.map(item => item.id === saved.id ? saved : item));
    } catch (err) { message.error(workbenchError(err)); } finally { setBusy(false); }
  };
  const remove = async (note: WorkbenchNote) => {
    setBusy(true);
    try { await deleteWorkbenchNote(note); onChange(notes.filter(item => item.id !== note.id)); message.success('笔记已删除'); }
    catch (err) { message.error(workbenchError(err)); } finally { setBusy(false); }
  };
  const query = search.trim().toLocaleLowerCase();
  const visible = notes.filter(note => `${note.title}\n${note.content}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);

  return (
    <section aria-label="记事本">
      <div className="workbench-toolbar">
        <Input className="workbench-search" prefix={<SearchOutlined />} aria-label="搜索笔记" placeholder="搜索笔记" value={search} onChange={event => setSearch(event.target.value)} allowClear />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>新建笔记</Button>
      </div>
      {visible.length ? <ul className="workbench-notes">
        {visible.map(note => <li className="workbench-note" key={note.id}>
          <button type="button" className="workbench-note-body" onClick={() => edit(note)} aria-label={`编辑笔记：${note.title}`}>
            <h3>{note.pinned && <PushpinFilled className="workbench-pin" aria-label="已置顶" />}{note.title}</h3>
            <p>{note.content || '无正文'}</p>
          </button>
          <div className="workbench-note-footer">
            <time dateTime={note.updatedAt}>{dayjs(note.updatedAt).format('MM-DD HH:mm')}</time>
            <div className="workbench-row-actions">
              <Tooltip title={note.pinned ? '取消置顶' : '置顶'}><Button type="text" aria-label={note.pinned ? '取消置顶' : '置顶'} icon={note.pinned ? <PushpinFilled /> : <PushpinOutlined />} disabled={busy} onClick={() => void pin(note)} /></Tooltip>
              <Tooltip title="编辑笔记"><Button type="text" aria-label="编辑笔记" icon={<EditOutlined />} onClick={() => edit(note)} /></Tooltip>
              <Popconfirm title="删除这条笔记？" description="删除后无法恢复" okText="删除" cancelText="取消" onConfirm={() => remove(note)} okButtonProps={{ danger: true }} onOpenChange={visible => setDeleteConfirmId(visible ? note.id : null)}>
                <Tooltip title="删除笔记" open={deleteConfirmId === note.id ? false : undefined}><Button type="text" danger aria-label="删除笔记" icon={<DeleteOutlined />} disabled={busy} /></Tooltip>
              </Popconfirm>
            </div>
          </div>
        </li>)}
      </ul> : <Empty className="workbench-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? '没有匹配的笔记' : '暂无笔记'} />}
      <Modal title={editing ? '编辑笔记' : '新建笔记'} open={open} onCancel={close} width={760} maskClosable={false} keyboard={!saving} closable={!saving}
        footer={<><Button onClick={close} disabled={saving}>取消</Button><Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!draft.title.trim() || !dirty} onClick={() => void save()}>保存笔记</Button></>}>
        <div className="workbench-editor">
          {error && <Alert type="error" showIcon title={error} />}
          <label htmlFor="workbench-note-title">标题</label>
          <Input id="workbench-note-title" maxLength={120} value={draft.title} disabled={saving} onChange={event => setDraft({ ...draft, title: event.target.value })} />
          <label htmlFor="workbench-note-content">正文</label>
          <Input.TextArea id="workbench-note-content" className="workbench-note-content" rows={12} maxLength={20000} showCount value={draft.content} disabled={saving} onChange={event => setDraft({ ...draft, content: event.target.value })} />
          <div className="workbench-editor-meta"><label htmlFor="workbench-note-pinned">置顶</label><Switch id="workbench-note-pinned" checked={draft.pinned} disabled={saving} onChange={pinned => setDraft({ ...draft, pinned })} /></div>
        </div>
      </Modal>
    </section>
  );
}
