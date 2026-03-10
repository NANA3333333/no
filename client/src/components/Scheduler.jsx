import React, { useState, useEffect } from 'react';
import { Clock, Plus, Trash2, Edit3, Save, X } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

export default function Scheduler({ apiUrl, contacts }) {
    const { t, lang } = useLanguage();
    const [tasks, setTasks] = useState([]);
    const [isFormOpen, setIsFormOpen] = useState(false);

    // Form state
    const [editId, setEditId] = useState(null);
    const [formCharId, setFormCharId] = useState(contacts[0]?.id || '');
    const [formTime, setFormTime] = useState('08:00');
    const [formAction, setFormAction] = useState('chat');
    const [formPrompt, setFormPrompt] = useState('');
    const [formEnabled, setFormEnabled] = useState(true);

    const loadTasks = async () => {
        try {
            // we will fetch all tasks. The backend API is GET /api/scheduler/:charId
            // Let's modify our approach slightly to fetch all if we pass 'all'
            const res = await fetch(`${apiUrl}/scheduler/all`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('cp_token') || ''}` }
            });
            if (res.ok) {
                const data = await res.json();
                setTasks(data);
            }
        } catch (e) {
            console.error('Failed to load tasks', e);
        }
    };

    useEffect(() => {
        if (contacts && contacts.length > 0 && !formCharId) {
            setFormCharId(contacts[0].id);
        }
        loadTasks();
    }, [apiUrl, contacts]);

    const handleSave = async () => {
        if (!formCharId || !formTime || !formAction) {
            alert(lang === 'en' ? 'Please fill all required fields' : '请填写所有必填项');
            return;
        }

        const payload = {
            character_id: formCharId,
            cron_expr: formTime,
            action_type: formAction,
            task_prompt: formPrompt,
            is_enabled: formEnabled ? 1 : 0
        };

        try {
            let res;
            if (editId) {
                res = await fetch(`${apiUrl}/scheduler/${editId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('cp_token') || ''}` },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetch(`${apiUrl}/scheduler`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('cp_token') || ''}` },
                    body: JSON.stringify(payload)
                });
            }

            if (res.ok) {
                setIsFormOpen(false);
                setEditId(null);
                loadTasks();
            } else {
                const data = await res.json();
                alert('Error: ' + data.error);
            }
        } catch (e) {
            console.error('Failed to save task', e);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm(lang === 'en' ? 'Delete this scheduled task?' : '确定删除此定时任务吗？')) return;
        try {
            const res = await fetch(`${apiUrl}/scheduler/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('cp_token') || ''}` }
            });
            if (res.ok) {
                loadTasks();
            }
        } catch (e) {
            console.error('Failed to delete task', e);
        }
    };

    const toggleEnable = async (task) => {
        const payload = {
            ...task,
            is_enabled: task.is_enabled ? 0 : 1
        };
        try {
            const res = await fetch(`${apiUrl}/scheduler/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('cp_token') || ''}` },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                loadTasks();
            }
        } catch (e) {
            console.error('Failed to toggle task', e);
        }
    };

    const openEdit = (task) => {
        setEditId(task.id);
        setFormCharId(task.character_id);
        setFormTime(task.cron_expr);
        setFormAction(task.action_type);
        setFormPrompt(task.task_prompt || '');
        setFormEnabled(task.is_enabled === 1);
        setIsFormOpen(true);
    };

    const openNew = () => {
        setEditId(null);
        setFormCharId(contacts[0]?.id || '');
        setFormTime('08:00');
        setFormAction('chat');
        setFormPrompt('早上好！');
        setFormEnabled(true);
        setIsFormOpen(true);
    };

    const getCharName = (id) => {
        const c = contacts.find(c => String(c.id) === String(id));
        return c ? c.name : id;
    };

    // ─── Render ───
    return (
        <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #eee' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Clock size={20} /> {lang === 'en' ? 'Scheduled Tasks' : '定时任务 (DLC)'}
                </h2>
                <button
                    onClick={openNew}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', backgroundColor: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
                    <Plus size={16} /> {lang === 'en' ? 'Add Task' : '新建任务'}
                </button>
            </div>

            {isFormOpen && (
                <div style={{ backgroundColor: '#f9f9f9', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ddd' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                        <h3 style={{ margin: 0, fontSize: '16px' }}>{editId ? (lang === 'en' ? 'Edit Task' : '编辑任务') : (lang === 'en' ? 'New Task' : '新建任务')}</h3>
                        <button onClick={() => setIsFormOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}><X size={20} /></button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>{lang === 'en' ? 'Character' : '目标角色'}</label>
                            <select value={formCharId} onChange={e => setFormCharId(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}>
                                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>{lang === 'en' ? 'Time (HH:MM)' : '触发时间 (HH:MM)'}</label>
                            <input type="time" value={formTime} onChange={e => setFormTime(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }} required />
                        </div>
                    </div>

                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>{lang === 'en' ? 'Action Type' : '执行动作'}</label>
                        <select value={formAction} onChange={e => setFormAction(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}>
                            <option value="chat">{lang === 'en' ? 'Send Proactive Prompt (Chat)' : '触发主动指令 (私聊)'}</option>
                            <option value="moment">{lang === 'en' ? 'Force Post Moment' : '定时发朋友圈 (Moment)'}</option>
                            <option value="diary">{lang === 'en' ? 'Force Write Diary' : '定时写日记 (Diary)'}</option>
                            <option value="memory_aggregation">{lang === 'en' ? 'Daily Memory Aggregation' : '执行全天记忆总结 (Daily Aggregation)'}</option>
                        </select>
                    </div>

                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>{lang === 'en' ? 'Internal Prompt / Content' : '交给 AI 的后台指令'}</label>
                        <textarea
                            value={formPrompt}
                            onChange={e => setFormPrompt(e.target.value)}
                            placeholder={lang === 'en' ? 'e.g. Say good morning and cheer me up...' : '例如：向我发一句早安，并且拍一张你的早餐照片...'}
                            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', minHeight: '80px', resize: 'vertical' }}
                        />
                        <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                            {lang === 'en' ? 'This text is sent to the AI behind the scenes as a system directive.' : '此内容将作为系统指令在后台发给 AI，强制它按照此指令主动发消息。'}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 16px', backgroundColor: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
                            <Save size={16} /> {lang === 'en' ? 'Save Task' : '保存设置'}
                        </button>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {tasks.length === 0 && !isFormOpen ? (
                    <div style={{ color: '#999', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>
                        {lang === 'en' ? 'No scheduled tasks.' : '暂无定时任务。'}
                    </div>
                ) : (
                    tasks.map(t => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', border: '1px solid #f0f0f0', borderRadius: '6px', backgroundColor: t.is_enabled ? '#fff' : '#f5f5f5', opacity: t.is_enabled ? 1 : 0.6 }}>
                            <div>
                                <div style={{ fontWeight: '500', fontSize: '16px', color: 'var(--accent-color)', marginBottom: '4px' }}>
                                    {t.cron_expr} <span style={{ fontSize: '14px', color: '#333', marginLeft: '10px' }}>{getCharName(t.character_id)}</span>
                                </div>
                                <div style={{ fontSize: '13px', color: '#666' }}>
                                    <span style={{ display: 'inline-block', padding: '2px 6px', backgroundColor: '#eee', borderRadius: '4px', marginRight: '8px', fontSize: '11px' }}>
                                        {t.action_type}
                                    </span>
                                    {t.task_prompt}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={t.is_enabled === 1}
                                        onChange={() => toggleEnable(t)}
                                        style={{ accentColor: 'var(--accent-color)', width: '16px', height: '16px' }}
                                    />
                                </label>
                                <button
                                    onClick={() => openEdit(t)}
                                    style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', padding: '5px' }} title="Edit">
                                    <Edit3 size={18} />
                                </button>
                                <button
                                    onClick={() => handleDelete(t.id)}
                                    style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '5px' }} title="Delete">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
