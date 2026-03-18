const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getMemory, clearMemoryCache } = require('../../memory');
const { userDbCache } = require('../../db');

module.exports = function initAdminDashboard(app, context) {
    const { authMiddleware, authDb, wss, getWsClients } = context;

    const disconnectUserSessions = (userId) => {
        const clients = getWsClients(userId);
        if (clients && clients.size > 0) {
            clients.forEach(c => c.close());
        }
    };

    const getDirectorySize = (dirPath) => {
        if (!dirPath || !fs.existsSync(dirPath)) return 0;
        let total = 0;
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
            const fullPath = path.join(dirPath, entry.name);
            try {
                if (entry.isDirectory()) {
                    total += getDirectorySize(fullPath);
                } else if (entry.isFile()) {
                    total += fs.statSync(fullPath).size;
                }
            } catch (e) { }
        }
        return total;
    };

    const toUploadRelativePath = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const marker = '/uploads/';
        const markerIdx = raw.indexOf(marker);
        if (markerIdx >= 0) {
            return raw.slice(markerIdx + 1).replaceAll('/', path.sep);
        }
        if (raw.startsWith('uploads/')) {
            return raw.replaceAll('/', path.sep);
        }
        return null;
    };

    const collectUploadReferences = (userDb, sql, mapper = (row) => Object.values(row || {})) => {
        const refs = new Set();
        try {
            const rows = userDb.prepare(sql).all();
            for (const row of rows) {
                for (const value of mapper(row)) {
                    const relPath = toUploadRelativePath(value);
                    if (relPath) refs.add(relPath);
                }
            }
        } catch (e) { }
        return refs;
    };

    const getUserStats = (user) => {
        const dbPath = path.join(__dirname, '..', '..', 'data', `chatpulse_user_${user.id}.db`);
        const vectorDir = path.join(__dirname, '..', '..', 'data', 'vectors', String(user.id));
        const uploadsRoot = path.join(__dirname, '..', '..', 'public');
        const stats = {
            db_size_bytes: 0,
            vector_size_bytes: 0,
            upload_size_bytes: 0,
            total_storage_bytes: 0,
            characters_count: 0,
            messages_count: 0,
            memories_count: 0,
            moments_count: 0,
            diaries_count: 0,
            token_total: 0,
            account_age_ms: Math.max(0, Date.now() - Number(user.created_at || Date.now()))
        };
        if (!fs.existsSync(dbPath)) {
            return stats;
        }
        try {
            stats.db_size_bytes = fs.statSync(dbPath).size;
        } catch (e) { }
        try {
            stats.vector_size_bytes = getDirectorySize(vectorDir);
        } catch (e) { }
        let userDb;
        try {
            userDb = new Database(dbPath, { readonly: true, fileMustExist: true });
            const count = (table) => userDb.prepare(`SELECT COUNT(*) as c FROM ${table}`).get()?.c || 0;
            stats.characters_count = count('characters');
            stats.messages_count = count('messages');
            stats.memories_count = count('memories');
            stats.moments_count = count('moments');
            stats.diaries_count = count('diaries');
            stats.token_total = userDb.prepare('SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) as total FROM token_usage').get()?.total || 0;

            const uploadRefs = new Set([
                ...collectUploadReferences(userDb, 'SELECT avatar, banner FROM user_profile'),
                ...collectUploadReferences(userDb, 'SELECT avatar FROM characters'),
                ...collectUploadReferences(userDb, 'SELECT avatar FROM group_chats'),
                ...collectUploadReferences(userDb, 'SELECT image_url FROM moments'),
            ]);
            for (const relPath of uploadRefs) {
                const fullPath = path.join(uploadsRoot, relPath);
                try {
                    if (fs.existsSync(fullPath)) {
                        stats.upload_size_bytes += fs.statSync(fullPath).size;
                    }
                } catch (e) { }
            }
        } catch (e) {
            stats.read_error = e.message;
        } finally {
            try { userDb?.close(); } catch (e) { }
        }
        stats.total_storage_bytes = stats.db_size_bytes + stats.vector_size_bytes + stats.upload_size_bytes;
        return stats;
    };

    const adminMiddleware = (req, res, next) => {
        if (!req.user || !authDb.isAdminRole(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden. Admin level restricted.' });
        }
        next();
    };

    app.get('/api/admin/invites', authMiddleware, adminMiddleware, (req, res) => {
        try {
            const code = authDb.generateInviteCode({
                maxUses: req.query.maxUses,
                expiresAt: req.query.expiresAt,
                note: req.query.note,
                createdBy: req.user.username
            });
            res.json({ success: true, code });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
        try {
            const users = authDb.getAllUsers().map(user => ({
                ...user,
                stats: getUserStats(user)
            }));
            res.json({ success: true, users });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/admin/invites/all', authMiddleware, adminMiddleware, (req, res) => {
        try {
            const codes = authDb.getInviteCodes();
            res.json({ success: true, codes });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/admin/invites/:code', authMiddleware, adminMiddleware, (req, res) => {
        try {
            authDb.deleteInviteCode(req.params.code);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/admin/invites/:code', authMiddleware, adminMiddleware, (req, res) => {
        try {
            authDb.updateInviteCode(req.params.code, {
                status: req.body?.status,
                note: req.body?.note,
                maxUses: req.body?.maxUses,
                expiresAt: req.body?.expiresAt
            });
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const targetId = req.params.id;
            if (targetId === req.user.id) return res.status(400).json({ error: "Cannot delete yourself" });

            // 1. Force disconnect websocket
            disconnectUserSessions(targetId);

            // 2. Shut down engine memory and close DB
            const db = userDbCache.get(targetId);
            if (db) {
                db.close();
                userDbCache.delete(targetId);
            }
            clearMemoryCache(targetId);

            // Delete memory index
            try {
                const memory = getMemory(targetId);
                const chars = db ? db.getCharacters() : [];
                for (const c of chars) {
                    await memory.wipeIndex(c.id);
                }
            } catch (e) { }

            // 3. Delete db file
            const dbPath = path.join(__dirname, '..', '..', 'data', `chatpulse_user_${targetId}.db`);
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

            // 4. Delete from authDb
            authDb.deleteUser(targetId);

            res.json({ success: true });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/users/:id/ban', authMiddleware, adminMiddleware, (req, res) => {
        try {
            const targetId = req.params.id;
            if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot ban yourself' });
            const banned = !!req.body?.banned;
            authDb.setUserStatus(targetId, banned ? 'banned' : 'active');
            authDb.bumpTokenVersion(targetId);
            disconnectUserSessions(targetId);
            res.json({ success: true, status: banned ? 'banned' : 'active' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/users/:id/role', authMiddleware, adminMiddleware, (req, res) => {
        try {
            if (req.user.role !== 'root') {
                return res.status(403).json({ error: 'Only root can change roles' });
            }
            const targetId = req.params.id;
            const nextRole = String(req.body?.role || '').trim();
            if (!['user', 'admin'].includes(nextRole)) {
                return res.status(400).json({ error: 'Invalid role' });
            }
            const allUsers = authDb.getAllUsers();
            const targetUser = allUsers.find(u => String(u.id) === String(targetId));
            if (!targetUser) return res.status(404).json({ error: 'User not found' });
            if (targetUser.role === 'root') {
                return res.status(400).json({ error: 'Cannot change root role' });
            }
            authDb.setUserRole(targetId, nextRole);
            authDb.bumpTokenVersion(targetId);
            disconnectUserSessions(targetId);
            res.json({ success: true, role: nextRole });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/users/:id/reset-password', authMiddleware, adminMiddleware, (req, res) => {
        try {
            const targetId = req.params.id;
            const newPassword = String(req.body?.password || '');
            if (newPassword.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters long' });
            }
            authDb.resetPassword(targetId, newPassword);
            disconnectUserSessions(targetId);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/users/:id/force-logout', authMiddleware, adminMiddleware, (req, res) => {
        try {
            const targetId = req.params.id;
            authDb.bumpTokenVersion(targetId);
            disconnectUserSessions(targetId);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/announcement', authMiddleware, adminMiddleware, (req, res) => {
        try {
            const { content } = req.body;
            authDb.setAnnouncement(content);

            // Broadcast over WS to all active users
            const messageStr = JSON.stringify({ type: 'announcement', content });
            wss.clients.forEach(client => {
                if (client.readyState === 1 && client.userId) {
                    client.send(messageStr);
                }
            });
            res.json({ success: true, announcement: { content } });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
};
