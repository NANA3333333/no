import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { Shield, Users, Key, Copy, CheckCircle, RefreshCw, Trash2, Megaphone, Send } from 'lucide-react';

function AdminDashboard({ apiUrl }) {
    const { user, token } = useAuth();
    const [users, setUsers] = useState([]);
    const [inviteCodes, setInviteCodes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copiedCode, setCopiedCode] = useState('');
    const [announcementMsg, setAnnouncementMsg] = useState('');

    const cleanApiUrl = apiUrl.replace(/\/api\/?$/, '');

    const fetchUsers = useCallback(async () => {
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/users`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                setUsers(data.users);
            } else {
                setError(data.error);
            }
        } catch (e) {
            setError('Failed to load users');
        }
    }, [cleanApiUrl, token]);

    const fetchInvites = useCallback(async () => {
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/invites/all`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                setInviteCodes(data.codes);
            }
        } catch (e) {
            console.error('Failed to load invite codes', e);
        }
    }, [cleanApiUrl, token]);

    useEffect(() => {
        if (user?.username === 'Nana') {
            fetchUsers();
            fetchInvites();
        }
    }, [user, fetchUsers, fetchInvites]);

    const handleGenerateInvite = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/invites`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                setInviteCodes(prev => [{ code: data.code, used_by: null, created_at: Date.now() }, ...prev]);
            } else {
                setError(data.error);
            }
        } catch (e) {
            setError('Failed to generate invite code');
        } finally {
            setLoading(false);
        }
    };

    const handleRevokeInvite = async (code) => {
        if (!window.confirm('Are you sure you want to revoke this unused invite code?')) return;
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/invites/${code}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                setInviteCodes(prev => prev.filter(c => c.code !== code));
            } else {
                setError(data.error);
            }
        } catch (e) {
            setError('Failed to revoke invite code');
        }
    };

    const handleDeleteUser = async (id, username) => {
        if (!window.confirm(`DANGER: Are you sure you want to completely DELETE the account [${username}] and wipe all their data? This cannot be undone.`)) return;
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/users/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                setUsers(prev => prev.filter(u => u.id !== id));
            } else {
                setError(data.error);
            }
        } catch (e) {
            setError('Failed to delete user');
        }
    };

    const handlePostAnnouncement = async () => {
        if (!announcementMsg.trim()) return;
        setLoading(true);
        try {
            const res = await fetch(`${cleanApiUrl}/api/admin/announcement`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: announcementMsg })
            });
            const data = await res.json();
            if (data.success) {
                setAnnouncementMsg('');
                window.alert('Global announcement broadcasted successfully!');
            } else {
                setError(data.error);
            }
        } catch (e) {
            setError('Failed to post announcement');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setCopiedCode(text);
        setTimeout(() => setCopiedCode(''), 2000);
    };

    if (user?.username !== 'Nana') {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--danger)' }}>
                <h2>⛔ Access Denied. Admin level restricted.</h2>
            </div>
        );
    }

    const timeAgo = (timestamp) => {
        if (!timestamp) return 'Never';
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    };

    return (
        <div style={{ padding: '30px', maxWidth: '800px', margin: '0 auto', overflowY: 'auto', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '30px', color: 'var(--text-primary)' }}>
                <Shield size={32} color="var(--primary)" />
                <h1 style={{ margin: 0 }}>Root Admin Dashboard</h1>
            </div>

            {error && <div style={{ padding: '15px', background: '#ffebeb', color: 'var(--danger)', borderRadius: '8px', marginBottom: '20px' }}>{error}</div>}

            {/* Announcements Panel */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '12px', padding: '24px', marginBottom: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', color: 'var(--text-primary)' }}>
                        <Megaphone size={20} /> System Announcement
                    </h2>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                        type="text"
                        value={announcementMsg}
                        onChange={e => setAnnouncementMsg(e.target.value)}
                        placeholder="Broadcast a global message to all users..."
                        style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    />
                    <button
                        onClick={handlePostAnnouncement}
                        disabled={loading || !announcementMsg.trim()}
                        style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '0 20px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500' }}
                    >
                        <Send size={16} /> Publish
                    </button>
                </div>
            </div>

            {/* Invite Codes Panel */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '12px', padding: '24px', marginBottom: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', color: 'var(--text-primary)' }}>
                        <Key size={20} /> Invite Codes
                    </h2>
                    <button
                        onClick={handleGenerateInvite}
                        disabled={loading}
                        style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500' }}
                    >
                        {loading ? <RefreshCw size={16} className="fa-spin" /> : <Shield size={16} />}
                        Generate New Code
                    </button>
                </div>

                <div style={{ display: 'grid', gap: '10px', maxHeight: '300px', overflowY: 'auto', paddingRight: '5px' }}>
                    {inviteCodes.map(invite => (
                        <div key={invite.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: invite.used_by ? 'var(--bg-secondary)' : 'rgba(0,0,0,0.02)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '2px', color: invite.used_by ? 'var(--text-muted)' : 'var(--accent-color)' }}>
                                    {invite.code}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    {invite.used_by ? `Used by: ${invite.used_by}` : `Created: ${new Date(invite.created_at).toLocaleDateString()}`}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                {!invite.used_by && (
                                    <>
                                        <button onClick={() => copyToClipboard(invite.code)} title="Copy Code" style={{ background: 'none', border: 'none', cursor: 'pointer', color: copiedCode === invite.code ? 'var(--success)' : 'var(--text-secondary)' }}>
                                            {copiedCode === invite.code ? <CheckCircle size={20} /> : <Copy size={20} />}
                                        </button>
                                        <button onClick={() => handleRevokeInvite(invite.code)} title="Revoke Code" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}>
                                            <Trash2 size={20} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                    {inviteCodes.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No invites generated yet.</p>}
                </div>
            </div>

            {/* Registered Users Panel */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', color: 'var(--text-primary)' }}>
                        <Users size={20} /> Registered Citizens
                    </h2>
                    <button onClick={fetchUsers} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} title="Refresh Users">
                        <RefreshCw size={18} />
                    </button>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', color: 'var(--text-primary)' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--card-border)' }}>
                                <th style={{ padding: '12px 8px' }}>Username</th>
                                <th style={{ padding: '12px 8px' }}>Joined Date</th>
                                <th style={{ padding: '12px 8px' }}>Last Active</th>
                                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                                    <td style={{ padding: '12px 8px', fontWeight: '500' }}>
                                        {u.username}
                                        {u.username === 'Nana' && <span style={{ marginLeft: '8px', fontSize: '10px', background: 'var(--primary)', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>ROOT</span>}
                                        <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{u.id}</div>
                                    </td>
                                    <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                                    <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        {timeAgo(u.last_active_at)}
                                    </td>
                                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                                        {u.username !== 'Nana' && (
                                            <button
                                                onClick={() => handleDeleteUser(u.id, u.username)}
                                                title="Delete User & Wipe Data"
                                                style={{ background: 'rgba(239, 68, 68, 0.1)', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '6px 10px', borderRadius: '6px' }}>
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {users.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>Loading users...</p>}
                </div>
            </div>
        </div>
    );
}

export default AdminDashboard;
