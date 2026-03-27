const fs = require('fs');
const path = require('path');

const authDb = require('../server/authDb');
const { getUserDb } = require('../server/db');
const { getMemory } = require('../server/memory');
const qdrant = require('../server/qdrant');

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

async function migrateUser(userId, options = {}) {
    const db = getUserDb(userId);
    const memory = getMemory(userId);
    const allCharacters = db.getCharacters();
    const characters = options.character
        ? allCharacters.filter(char => String(char.id) === String(options.character))
        : allCharacters;

    let rebuiltCharacters = 0;
    let rebuiltMemories = 0;

    for (const char of characters) {
        const memories = db.getMemories(char.id);
        if (!memories || memories.length === 0) {
            console.log(`[Qdrant Migration] Skipping ${userId}/${char.id} (${char.name}) - no memories.`);
            continue;
        }

        console.log(`[Qdrant Migration] Rebuilding ${userId}/${char.id} (${char.name}) with ${memories.length} memories...`);
        if (!options.dryRun) {
            await memory.rebuildIndex(char.id);
        }
        rebuiltCharacters += 1;
        rebuiltMemories += memories.length;
    }

    return { rebuiltCharacters, rebuiltMemories };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const reachable = await qdrant.healthcheck();
    if (!reachable) {
        console.error('[Qdrant Migration] Qdrant is not reachable. Start Qdrant first or check QDRANT_URL/QDRANT_API_KEY.');
        process.exitCode = 1;
        return;
    }

    const userIds = args.user ? [args.user] : discoverUserIds();
    if (userIds.length === 0) {
        console.log('[Qdrant Migration] No users found. Nothing to migrate.');
        return;
    }

    console.log(`[Qdrant Migration] Starting migration for ${userIds.length} user(s). Dry run: ${args.dryRun ? 'yes' : 'no'}`);
    let totalCharacters = 0;
    let totalMemories = 0;

    for (const userId of userIds) {
        try {
            const result = await migrateUser(userId, args);
            totalCharacters += result.rebuiltCharacters;
            totalMemories += result.rebuiltMemories;
        } catch (e) {
            console.error(`[Qdrant Migration] Failed for user ${userId}:`, e.message);
            process.exitCode = 1;
        }
    }

    console.log(`[Qdrant Migration] Done. Rebuilt ${totalCharacters} character index(es), ${totalMemories} memory point(s).`);
}

main().catch((e) => {
    console.error('[Qdrant Migration] Fatal error:', e);
    process.exitCode = 1;
});
