import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import {
    Ban,
    CheckCircle,
    Copy,
    Key,
    Lock,
    LogOut,
    Megaphone,
    RefreshCw,
    Search,
    Send,
    Shield,
    Trash2,
    Users,
} from 'lucide-react';

function badgeStyle(bg, color) {
    return {
        display: 'inline-block',
        padding: '3px 8px',
        borderRadius: '999px',
        background: bg,
        color,
    };
}

function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms) {
    const total = Math.max(0, Number(ms || 0));
    const days = Math.floor(total / 86400000);
    if (days > 0) return `${days}天`;
    const hours = Math.floor(total / 3600000);
    if (hours > 0) return `${hours}小时`;
    return '少于1小时';
}

function formatInviteExpiry(timestamp) {
    if (!timestamp) return '不过期';
    return new Date(timestamp).toLocaleString();
}

function formatRole(role) {
    if (role === 'root') return '根管理员';
    if (role === 'admin') return '管理员';
    return '普通用户';
}

function formatStatus(status) {
    return status === 'banned' ? '已封禁' : '正常';
}

function timeAgo(timestamp) {
    if (!timestamp) return '从未';
    const seconds = Math.floor((Date.now() - Number(timestamp)) / 1000);
    if (seconds < 60) return `${seconds}秒前`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
    return `${Math.floor(seconds / 86400)}天前`;
}

function cardStyle(extra = {}) {
    return {
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
        ...extra,
    };
}

function actionButtonStyle(background, color) {
    return {
        background,
        border: 'none',
        cursor: 'pointer',
        color,
        padding: '6px 10px',
        borderRadius: '6px',
    };
}

function AdminDashboard({ apiUrl }) {
    const { user, token } = useAuth();
    const [users, setUsers] = useState([]);
    const [inviteCodes, setInviteCodes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copiedCode, setCopiedCode] = useState('');
    const [announcementMsg, setAnnouncementMsg] = useState('');
    const [userQuery, setUserQuery] = useState('');
    const [inviteNote, setInviteNote] = useState('');
    const [inviteMaxUses, setInviteMaxUses] = useState(1);
    const [inviteExpiresAt, setInviteExpiresAt] = useState('');

    const cleanApiUrl = apiUrl.replace(/\/api\/?$/, '');
    const isAdmin = user?.role === 'root' || user?.role === 'admin';
    const isRoot = user?.role === 'root';

    const fetchUsers = useCallback(async () => {
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/users`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) {
                setUsers(data.users || []);
            } else {
                setError(data.error || '加载用户列表失败');
            }
        } catch (e) {
            setError('加载用户列表失败');
        }
    }, [cleanApiUrl, token]);

    const fetchInvites = useCallback(async () => {
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/invites/all`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) {
                setInviteCodes(data.codes || []);
            } else {
                setError(data.error || '加载邀请码失败');
            }
        } catch (e) {
            setError('加载邀请码失败');
        }
    }, [cleanApiUrl, token]);

    useEffect(() => {
        if (!isAdmin) return;
        fetchUsers();
        fetchInvites();
    }, [isAdmin, fetchUsers, fetchInvites]);

    const filteredUsers = useMemo(() => {
        const q = userQuery.trim().toLowerCase();
        if (!q) return users;
        return users.filter((u) =>
            String(u.username || '').toLowerCase().includes(q) ||
            String(u.id || '').toLowerCase().includes(q) ||
            String(u.role || '').toLowerCase().includes(q) ||
            String(u.status || '').toLowerCase().includes(q)
        );
    }, [users, userQuery]);

    const handleGenerateInvite = async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams();
            params.set('maxUses', String(Math.max(1, Number(inviteMaxUses || 1))));
            if (inviteNote.trim()) params.set('note', inviteNote.trim());
            if (inviteExpiresAt) {
                const ts = new Date(inviteExpiresAt).getTime();
                if (!Number.isNaN(ts) && ts > 0) params.set('expiresAt', String(ts));
            }
            const res = await fetch(`${cleanApiUrl}/api/admin/invites?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || '生成邀请码失败');
                return;
            }
            setInviteCodes((prev) => [
                {
                    code: data.code,
                    used_by: null,
                    created_at: Date.now(),
                    max_uses: Math.max(1, Number(inviteMaxUses || 1)),
                    use_count: 0,
                    expires_at: inviteExpiresAt ? new Date(inviteExpiresAt).getTime() : 0,
                    note: inviteNote.trim(),
                    created_by: user?.username || '',
                    status: 'active',
                },
                ...prev,
            ]);
            setInviteNote('');
            setInviteMaxUses(1);
            setInviteExpiresAt('');
        } catch (e) {
            setError('生成邀请码失败');
        } finally {
            setLoading(false);
        }
    };

    const handleToggleInviteStatus = async (invite) => {
        const nextStatus = invite.status === 'disabled' ? 'active' : 'disabled';
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/invites/${invite.code}`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: nextStatus }),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || '更新邀请码状态失败');
                return;
            }
            setInviteCodes((prev) =>
                prev.map((item) => (item.code === invite.code ? { ...item, status: nextStatus } : item))
            );
        } catch (e) {
            setError('更新邀请码状态失败');
        }
    };

    const handleRevokeInvite = async (code) => {
        if (!window.confirm('确定要撤销这条邀请码吗？')) return;
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/invites/${code}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || '撤销邀请码失败');
                return;
            }
            setInviteCodes((prev) => prev.filter((item) => item.code !== code));
        } catch (e) {
            setError('撤销邀请码失败');
        }
    };

    const handleDeleteUser = async (target) => {
        if (!window.confirm(`危险操作：确定删除账号【${target.username}】并清空其全部数据吗？此操作不可恢复。`)) return;
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/users/${target.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || '删除用户失败');
                return;
            }
            setUsers((prev) => prev.filter((item) => item.id !== target.id));
        } catch (e) {
            setError('删除用户失败');
        }
    };

    const handleToggleBan = async (target) => {
        const nextBanned = target.status !== 'banned';
        const label = nextBanned ? '封禁' : '解封';
        if (!window.confirm(`确定要${label}【${target.username}】吗？`)) return;
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/users/${target.id}/ban`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ banned: nextBanned }),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || '更新用户状态失败');
                return;
            }
            setUsers((prev) => prev.map((item) => (item.id === target.id ? { ...item, status: data.status } : item)));
        } catch (e) {
            setError('更新用户状态失败');
        }
    };

    const handleResetPassword = async (target) => {
        const password = window.prompt(`请输入【${target.username}】的新密码`, '');
        if (!password) return;
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/users/${target.id}/reset-password`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ password }),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || '重置密码失败');
                return;
            }
            window.alert(`已重置 ${target.username} 的密码。`);
            fetchUsers();
        } catch (e) {
            setError('重置密码失败');
        }
    };

    const handleForceLogout = async (target) => {
        if (!window.confirm(`确定要强制【${target.username}】的所有在线会话下线吗？`)) return;
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/users/${target.id}/force-logout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || '强制下线失败');
            }
        } catch (e) {
            setError('强制下线失败');
        }
    };

    const handleRoleChange = async (target, role) => {
        if (target.role === role) return;
        const roleLabel = role === 'admin' ? '管理员' : '普通用户';
        if (!window.confirm(`确定把【${target.username}】调整为【${roleLabel}】吗？此操作会让该用户重新登录。`)) return;
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/users/${target.id}/role`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ role }),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || '修改用户角色失败');
                return;
            }
            setUsers((prev) => prev.map((item) => (item.id === target.id ? { ...item, role: data.role } : item)));
        } catch (e) {
            setError('修改用户角色失败');
        }
    };

    const handlePostAnnouncement = async () => {
        if (!announcementMsg.trim()) return;
        setLoading(true);
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/announcement`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: announcementMsg }),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || '发送公告失败');
                return;
            }
            setAnnouncementMsg('');
            window.alert('全站公告已发送。');
        } catch (e) {
            setError('发送公告失败');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setCopiedCode(text);
        setTimeout(() => setCopiedCode(''), 2000);
    };

    if (!isAdmin) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--danger)' }}>
                <h2>无权访问管理员后台。</h2>
            </div>
        );
    }

    return (
        <div style={{ padding: '30px', maxWidth: '1150px', margin: '0 auto', overflowY: 'auto', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '30px', color: 'var(--text-primary)' }}>
                <Shield size={32} color="var(--primary)" />
                <h1 style={{ margin: 0 }}>{isRoot ? '根管理员后台' : '管理员后台'}</h1>
            </div>

            {error && (
                <div style={{ padding: '15px', background: '#ffebeb', color: 'var(--danger)', borderRadius: '8px', marginBottom: '20px' }}>
                    {error}
                </div>
            )}

            <div style={cardStyle({ marginBottom: '30px' })}>
                <h2 style={{ marginTop: 0, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', color: 'var(--text-primary)' }}>
                    <Megaphone size={20} /> 全站公告
                </h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                        type="text"
                        value={announcementMsg}
                        onChange={(e) => setAnnouncementMsg(e.target.value)}
                        placeholder="向所有用户发送一条全站公告..."
                        style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    />
                    <button
                        onClick={handlePostAnnouncement}
                        disabled={loading || !announcementMsg.trim()}
                        style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '0 20px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500' }}
                    >
                        <Send size={16} /> 发布
                    </button>
                </div>
            </div>

            <div style={cardStyle({ marginBottom: '30px' })}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', color: 'var(--text-primary)' }}>
                        <Key size={20} /> 邀请码管理
                    </h2>
                    <button
                        onClick={handleGenerateInvite}
                        disabled={loading}
                        style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500' }}
                    >
                        {loading ? <RefreshCw size={16} className="fa-spin" /> : <Shield size={16} />}
                        生成邀请码
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 120px 220px', gap: '10px', marginBottom: '16px' }}>
                    <input
                        value={inviteNote}
                        onChange={(e) => setInviteNote(e.target.value)}
                        placeholder="备注 / 用途"
                        style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    />
                    <input
                        type="number"
                        min="1"
                        value={inviteMaxUses}
                        onChange={(e) => setInviteMaxUses(Math.max(1, Number(e.target.value || 1)))}
                        style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    />
                    <input
                        type="datetime-local"
                        value={inviteExpiresAt}
                        onChange={(e) => setInviteExpiresAt(e.target.value)}
                        style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    />
                </div>

                <div style={{ display: 'grid', gap: '10px', maxHeight: '300px', overflowY: 'auto', paddingRight: '5px' }}>
                    {inviteCodes.map((invite) => (
                        <div key={invite.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: invite.used_by ? 'var(--bg-secondary)' : 'rgba(0,0,0,0.02)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '2px', color: invite.used_by ? 'var(--text-muted)' : 'var(--accent-color)' }}>
                                    {invite.code}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    {invite.used_by ? `已使用者：${invite.used_by}` : `创建时间：${new Date(invite.created_at).toLocaleDateString()}`}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    已用次数：{invite.use_count || 0} / {invite.max_uses || 1} ｜ 状态：{invite.status === 'active' ? '启用' : invite.status === 'disabled' ? '停用' : '已用完'}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    过期时间：{formatInviteExpiry(invite.expires_at)}
                                </div>
                                {!!invite.note && (
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        备注：{invite.note}
                                    </div>
                                )}
                                {!!invite.created_by && (
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        创建人：{invite.created_by}
                                    </div>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                {invite.status !== 'used' && (
                                    <>
                                        <button onClick={() => copyToClipboard(invite.code)} title="复制邀请码" style={{ background: 'none', border: 'none', cursor: 'pointer', color: copiedCode === invite.code ? 'var(--success)' : 'var(--text-secondary)' }}>
                                            {copiedCode === invite.code ? <CheckCircle size={20} /> : <Copy size={20} />}
                                        </button>
                                        <button onClick={() => handleToggleInviteStatus(invite)} title={invite.status === 'disabled' ? '启用邀请码' : '停用邀请码'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: invite.status === 'disabled' ? '#2563eb' : '#d97706' }}>
                                            <Ban size={20} />
                                        </button>
                                        <button onClick={() => handleRevokeInvite(invite.code)} title="撤销邀请码" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}>
                                            <Trash2 size={20} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                    {inviteCodes.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>还没有生成邀请码。</p>}
                </div>
            </div>

            <div style={cardStyle()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', color: 'var(--text-primary)' }}>
                        <Users size={20} /> 用户管理
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--card-border)', background: 'var(--bg-secondary)' }}>
                            <Search size={16} color="var(--text-secondary)" />
                            <input
                                value={userQuery}
                                onChange={(e) => setUserQuery(e.target.value)}
                                placeholder="搜索用户名 / ID / 角色 / 状态"
                                style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-primary)', width: '260px' }}
                            />
                        </div>
                        <button onClick={fetchUsers} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} title="刷新用户列表">
                            <RefreshCw size={18} />
                        </button>
                    </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', color: 'var(--text-primary)' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--card-border)' }}>
                                <th style={{ padding: '12px 8px' }}>用户名</th>
                                <th style={{ padding: '12px 8px' }}>角色</th>
                                <th style={{ padding: '12px 8px' }}>状态</th>
                                <th style={{ padding: '12px 8px' }}>空间占用</th>
                                <th style={{ padding: '12px 8px' }}>使用时长</th>
                                <th style={{ padding: '12px 8px' }}>注册时间</th>
                                <th style={{ padding: '12px 8px' }}>最近活跃</th>
                                <th style={{ padding: '12px 8px', textAlign: 'right' }}>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map((u) => (
                                <tr key={u.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                                    <td style={{ padding: '12px 8px', fontWeight: '500' }}>
                                        {u.username}
                                        {u.role === 'root' && <span style={{ marginLeft: '8px', fontSize: '10px', background: 'var(--primary)', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>根管理员</span>}
                                        {u.role === 'admin' && <span style={{ marginLeft: '8px', fontSize: '10px', background: '#2563eb', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>管理员</span>}
                                        <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{u.id}</div>
                                    </td>
                                    <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        {isRoot && u.role !== 'root' ? (
                                            <select
                                                value={u.role || 'user'}
                                                onChange={(e) => handleRoleChange(u, e.target.value)}
                                                style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                                            >
                                                <option value="user">普通用户</option>
                                                <option value="admin">管理员</option>
                                            </select>
                                        ) : (
                                            formatRole(u.role)
                                        )}
                                    </td>
                                    <td style={{ padding: '12px 8px', fontSize: '13px' }}>
                                        <span style={u.status === 'banned' ? badgeStyle('rgba(239, 68, 68, 0.12)', 'var(--danger)') : badgeStyle('rgba(34, 197, 94, 0.12)', 'var(--success)')}>
                                            {formatStatus(u.status)}
                                        </span>
                                    </td>
                                    <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        <div>{formatBytes(u.stats?.total_storage_bytes)}</div>
                                        <div style={{ fontSize: '11px' }}>
                                            库 {formatBytes(u.stats?.db_size_bytes)} ｜ 向量 {formatBytes(u.stats?.vector_size_bytes)} ｜ 上传 {formatBytes(u.stats?.upload_size_bytes)}
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        <div>{formatDuration(u.stats?.account_age_ms)}</div>
                                        <div style={{ fontSize: '11px' }}>
                                            消息 {u.stats?.messages_count || 0} ｜ 记忆 {u.stats?.memories_count || 0} ｜ Token {Number(u.stats?.token_total || 0).toLocaleString()}
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        {new Date(u.created_at).toLocaleDateString()}
                                    </td>
                                    <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        {timeAgo(u.last_active_at)}
                                    </td>
                                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                                            {u.role !== 'root' && (
                                                <>
                                                    <button onClick={() => handleToggleBan(u)} title={u.status === 'banned' ? '解封用户' : '封禁用户'} style={actionButtonStyle('rgba(245, 158, 11, 0.12)', '#d97706')}>
                                                        <Ban size={16} />
                                                    </button>
                                                    <button onClick={() => handleResetPassword(u)} title="重置密码" style={actionButtonStyle('rgba(37, 99, 235, 0.12)', '#2563eb')}>
                                                        <Lock size={16} />
                                                    </button>
                                                    <button onClick={() => handleForceLogout(u)} title="强制下线" style={actionButtonStyle('rgba(107, 114, 128, 0.12)', '#4b5563')}>
                                                        <LogOut size={16} />
                                                    </button>
                                                    <button onClick={() => handleDeleteUser(u)} title="删除用户并清空数据" style={actionButtonStyle('rgba(239, 68, 68, 0.1)', 'var(--danger)')}>
                                                        <Trash2 size={16} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredUsers.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>没有匹配当前筛选条件的用户。</p>}
                </div>
            </div>
        </div>
    );
}

export default AdminDashboard;
