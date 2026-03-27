const fs = require('fs');
const path = require('path');

const authDb = require('../server/authDb');
const { getUserDb } = require('../server/db');
const { getMemory } = require('../server/memory');
const qdrant = require('../server/qdrant');

const CITY_MEMORY_LOCATIONS = new Set([
    'park', 'restaurant', 'home', 'factory', 'convenience_store', 'school', 'street',
    'mall', 'cafe', 'office', 'hospital'
]);

function parseArgs(argv) {
    const args = {
        user: '',
        character: '',
        dryRun: false
    };
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '--user' && argv[i + 1]) {
            args.user = String(argv[++i]).trim();
        } else if (token === '--character' && argv[i + 1]) {
            args.character = String(argv[++i]).trim();
        } else if (token === '--dry-run') {
            args.dryRun = true;
        }
    }
    return args;
}

function discoverUserIds() {
    authDb.initAuthDb();
    const fromAuth = (authDb.getAllUsers() || [])
        .map(user => String(user.id || '').trim())
        .filter(Boolean);
    if (fromAuth.length > 0) {
        return Array.from(new Set(fromAuth));
    }

    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) return [];
    return fs.readdirSync(dataDir)
        .map(name => {
            const match = name.match(/^chatpulse_user_(.+)\.db$/);
            return match ? match[1] : '';
        })
        .filter(Boolean);
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
        } catch (e) { }
        return trimmed.split(/[,，。\n]/).map(v => v.trim()).filter(Boolean);
    }
    return [];
}

function normalizeRelationshipArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === 'object') return [value];
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.filter(Boolean);
            if (parsed && typeof parsed === 'object') return [parsed];
        } catch (e) { }
        return [{ summary: trimmed }];
    }
    return [];
}

function looksLikeCityMemory(memory = {}) {
    const type = String(memory.memory_type || '').toLowerCase();
    const location = String(memory.location || '').trim().toLowerCase();
    const text = [
        memory.summary,
        memory.content,
        memory.event
    ].filter(Boolean).join(' ').toLowerCase();
    if (type.startsWith('city')) return true;
    if (CITY_MEMORY_LOCATIONS.has(location)) return true;
    return /(city activity|公园|餐厅|便利店|商业街|工厂|街上|回到家|在家|长椅|吃饭|散步|发呆|路灯|晚风|路边)/i.test(text);
}

function hasHighValueMemorySignals(memory = {}) {
    const type = String(memory.memory_type || '').toLowerCase();
    const people = normalizeStringArray(memory.people_json ?? memory.people);
    const relationships = normalizeRelationshipArray(memory.relationship_json ?? memory.relationships);
    const emotion = String(memory.emotion || '').trim();
    const text = [
        memory.summary,
        memory.content,
        memory.event
    ].filter(Boolean).join(' ');
    if (['relationship', 'plan', 'preference', 'emotion'].includes(type)) return true;
    if (Number(memory.importance || 0) >= 7) return true;
    if (people.length > 0 || relationships.length > 0) return true;
    if (emotion && emotion.length >= 2) return true;
    return /(用户|nana|user|告白|承诺|约定|吵架|冲突|和好|吃醋|嫉妒|委屈|喜欢|讨厌|秘密|密码|没钱|只剩|崩溃|住院|受伤)/i.test(text);
}

function isRoutineCityMemory(memory = {}) {
    if (!looksLikeCityMemory(memory)) return false;
    if (hasHighValueMemorySignals(memory)) return false;
    const type = String(memory.memory_type || '').toLowerCase();
    return !type || ['event', 'fact', 'city_event', 'city_log'].includes(type);
}

function cleanupPatch(memory) {
    return {
        memory_type: 'city_log',
        importance: Math.min(Number(memory.importance || 3), 3),
        is_archived: 1,
        updated_at: Date.now()
    };
}

async function cleanupUser(userId, options = {}) {
    const db = getUserDb(userId);
    const memory = getMemory(userId);
    const characters = options.character
        ? db.getCharacters().filter(char => String(char.id) === String(options.character))
        : db.getCharacters();

    let touchedCharacters = 0;
    let archivedMemories = 0;

    for (const char of characters) {
        const memories = db.getMemories(char.id) || [];
        const routineCityMemories = memories.filter(isRoutineCityMemory);
        if (routineCityMemories.length === 0) continue;

        console.log(`[City Memory Cleanup] ${userId}/${char.id} (${char.name}) -> ${routineCityMemories.length} routine city memories`);
        if (!options.dryRun) {
            for (const mem of routineCityMemories) {
                db.updateMemory(mem.id, cleanupPatch(mem));
            }
            await memory.rebuildIndex(char.id);
        }
        touchedCharacters += 1;
        archivedMemories += routineCityMemories.length;
    }

    return { touchedCharacters, archivedMemories };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const userIds = args.user ? [args.user] : discoverUserIds();
    if (userIds.length === 0) {
        console.log('[City Memory Cleanup] No users found.');
        return;
    }

    const qdrantReachable = await qdrant.healthcheck();
    console.log(`[City Memory Cleanup] Qdrant reachable: ${qdrantReachable ? 'yes' : 'no'}; dry run: ${args.dryRun ? 'yes' : 'no'}`);

    let totalCharacters = 0;
    let totalArchived = 0;
    for (const userId of userIds) {
        try {
            const result = await cleanupUser(userId, args);
            totalCharacters += result.touchedCharacters;
            totalArchived += result.archivedMemories;
        } catch (e) {
            console.error(`[City Memory Cleanup] Failed for user ${userId}:`, e.message);
            process.exitCode = 1;
        }
    }

    console.log(`[City Memory Cleanup] Done. Updated ${totalCharacters} character(s), archived ${totalArchived} routine city memory item(s).`);
}

main().catch((e) => {
    console.error('[City Memory Cleanup] Fatal error:', e);
    process.exitCode = 1;
});
