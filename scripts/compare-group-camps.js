const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { getUserDb } = require('../server/db');
const { getMemory } = require('../server/memory');
const { callLLM } = require('../server/llm');
const { buildUniversalContext } = require('../server/contextBuilder');
const { getAdaptiveTailWindowSize } = require('../server/utils/contextWindow');
const { getEmotionBehaviorGuidance } = require('../server/emotion');
const { getTokenCount } = require('../server/utils/tokenizer');

function parseArgs(argv) {
    const args = {
        user: 'fuwbbtcqmm8osf5g',
        group: null,
        character: null,
        characterName: 'Gemini 3 Pro'
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--user') args.user = argv[++i];
        else if (arg === '--group') args.group = argv[++i];
        else if (arg === '--character') args.character = argv[++i];
        else if (arg === '--character-name') args.characterName = argv[++i];
    }
    return args;
}

function cleanText(text) {
    return String(text || '')
        .replace(/\[[A-Z_]+:[^\]]*?\]/g, '')
        .replace(/\[[A-Z_]+\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function compactPreview(text, maxLength = 20) {
    const cleaned = cleanText(text);
    if (!cleaned) return '';
    if (cleaned.length <= maxLength) return cleaned;
    return `${cleaned.slice(0, Math.max(12, maxLength - 1)).trim()}…`;
}

function buildLongAntiRepeat(character, recentGroupMsgs) {
    const charOwnRecent = recentGroupMsgs
        .filter(m => m.sender_id === character.id)
        .slice(-3)
        .map(m => `"${m.content}"`)
        .join(', ');
    return charOwnRecent
        ? `\nIMPORTANT: You recently said: ${charOwnRecent}. Do NOT repeat or paraphrase these.Say something new.`
        : '';
}

function buildCompactGroupAntiRepeat(character, messages) {
    const recentAssistantMsgs = (Array.isArray(messages) ? messages : [])
        .filter(m => m.sender_id === character.id)
        .slice(-5);
    if (recentAssistantMsgs.length === 0) return '';
    const recentTopics = [];
    for (const msg of recentAssistantMsgs) {
        const preview = compactPreview(msg.content, 20);
        if (!preview) continue;
        if (!recentTopics.includes(preview)) recentTopics.push(preview);
        if (recentTopics.length >= 2) break;
    }
    if (recentTopics.length === 0) return '';
    return `\n[Anti-Repeat]\nRecent topics: ${recentTopics.join(' | ')}\nAvoid same jab, same defense, or same emotional line.`;
}

function buildHistory(db, recentGroupMsgs, charId, userName) {
    return recentGroupMsgs.map(m => {
        const senderName = m.sender_id === 'user'
            ? userName
            : (db.getCharacter(m.sender_id)?.name || m.sender_name || 'Unknown');
        return {
            role: m.sender_id === charId ? 'assistant' : 'user',
            content: `[${senderName}]: ${m.content} `
        };
    });
}

function buildRelationSection(db, char, group, userName) {
    const otherMembers = group.members.filter(m => m.member_id !== char.id);
    const knownMembers = [];
    const unknownMembers = [];
    for (const m of otherMembers) {
        if (m.member_id === 'user') {
            const userRel = db.getCharRelationship(char.id, 'user');
            knownMembers.push(`- ${userName} (id: user, affinity ${userRel?.affinity ?? char.affinity ?? 50})`);
            continue;
        }
        const otherChar = db.getCharacter(m.member_id);
        if (!otherChar) continue;
        const rel = db.getCharRelationship(char.id, otherChar.id);
        if (rel && rel.isAcquainted) {
            knownMembers.push(`- ${otherChar.name} (id: ${otherChar.id}, affinity ${rel.affinity}, impression: "${rel.impression}")`);
        } else {
            unknownMembers.push(`- ${otherChar.name} (id: ${otherChar.id}, not acquainted yet)`);
        }
    }
    let relationSection = '';
    if (knownMembers.length > 0) relationSection += `\nKnown members:\n${knownMembers.join('\n')}`;
    if (unknownMembers.length > 0) relationSection += `\nUnknown members:\n${unknownMembers.join('\n')}`;
    return relationSection;
}

function getCachedGroupPromptBlock(db, characterId, blockType, sourcePayload, buildFn) {
    const crypto = require('crypto');
    const sourceHash = crypto.createHash('sha256')
        .update(JSON.stringify(sourcePayload || {}))
        .digest('hex');
    const cached = typeof db?.getPromptBlockCache === 'function'
        ? db.getPromptBlockCache(characterId, blockType, sourceHash)
        : null;
    if (cached?.compiled_text) return cached.compiled_text;
    return String(buildFn?.() || '');
}

function loadLegacyBuildUniversalContext() {
    const serverRoot = path.resolve(__dirname, '..', 'server');
    let legacySource = execSync('git show HEAD~1:server/contextBuilder.js', { encoding: 'utf8' });
    legacySource = legacySource
        .replace("require('./utils/tokenizer')", `require(${JSON.stringify(path.join(serverRoot, 'utils', 'tokenizer.js'))})`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-context-'));
    const legacyFile = path.join(tmpDir, 'contextBuilder.js');
    fs.writeFileSync(legacyFile, legacySource, 'utf8');
    const legacyModule = require(legacyFile);
    if (!legacyModule || typeof legacyModule.buildUniversalContext !== 'function') {
        throw new Error('Failed to load legacy buildUniversalContext.');
    }
    return legacyModule.buildUniversalContext;
}

async function buildSnapshot(userId, groupId, characterId, characterName) {
    const db = getUserDb(userId);
    const memory = getMemory(userId);
    const group = groupId ? db.getGroup(groupId) : null;
    let char = characterId ? db.getCharacter(characterId) : null;
    if (!char && characterName) {
        char = db.getCharacters().find(c => c.name === characterName) || null;
    }
    if (!char) throw new Error('Character not found.');

    let resolvedGroup = group;
    if (!resolvedGroup) {
        const raw = db.getRawDb();
        const latest = raw.prepare(`
            SELECT meta
            FROM llm_debug_logs
            WHERE context_type='group_chat' AND direction='input' AND character_id = ?
            ORDER BY id DESC
            LIMIT 1
        `).get(char.id);
        const latestMeta = latest?.meta ? JSON.parse(latest.meta) : null;
        if (latestMeta?.group_id) resolvedGroup = db.getGroup(latestMeta.group_id);
    }
    if (!resolvedGroup) throw new Error('Group not found.');

    const userProfile = db.getUserProfile?.() || { name: 'User' };
    const userName = userProfile.name || 'User';
    const memberEntry = resolvedGroup.members.find(m => m.member_id === char.id);
    const joinedAt = memberEntry?.joined_at || 0;
    const groupMsgLimit = resolvedGroup.context_msg_limit || 60;
    const allRecentGroupMsgs = db.getVisibleGroupMessages(resolvedGroup.id, groupMsgLimit, joinedAt);
    const liveTailSize = getAdaptiveTailWindowSize(groupMsgLimit, allRecentGroupMsgs.length);
    const compressedRecentGroupMsgs = allRecentGroupMsgs.slice(-liveTailSize);
    const compressedHistory = buildHistory(db, compressedRecentGroupMsgs, char.id, userName);
    const baselineHistory = buildHistory(db, allRecentGroupMsgs, char.id, userName);
    const compressedRecentInput = compressedHistory.slice(-2).map(m => m.content).join(' ');
    const baselineRecentInput = baselineHistory.slice(-2).map(m => m.content).join(' ');
    const otherMembers = resolvedGroup.members.filter(m => m.member_id !== char.id);
    const activeTargets = otherMembers
        .filter(m => m.member_id !== 'user')
        .map(m => db.getCharacter(m.member_id))
        .filter(c => c && !c.is_blocked);
    const engineContextWrapper = {
        getUserDb: () => db,
        getMemory: () => memory,
        userId
    };
    const legacyBuildUniversalContext = loadLegacyBuildUniversalContext();
    const compressedUniversal = await buildUniversalContext(engineContextWrapper, char, compressedRecentInput, true, activeTargets);
    const legacyUniversal = await legacyBuildUniversalContext(engineContextWrapper, char, baselineRecentInput, true, activeTargets);
    const relationSection = buildRelationSection(db, char, resolvedGroup, userName);
    const emotionGuidance = getEmotionBehaviorGuidance(char);
    const mentionableNames = resolvedGroup.members
        .filter(m => m.member_id !== 'user')
        .map(m => db.getCharacter(m.member_id)?.name)
        .filter(Boolean)
        .map(name => '@' + name)
        .join(' / ');
    const stableGroupPrompt = getCachedGroupPromptBlock(
        db,
        char.id,
        'group_stable_prompt_v1',
        {
            groupName: resolvedGroup.name || '',
            persona: char.persona || '',
            worldInfo: char.world_info || '',
            systemPrompt: char.system_prompt || ''
        },
        () => {
            const parts = [
                '[System Directive: Stay fully in character. No AI/assistant mentions. No disclaimers.]',
                `你是${char.name}，正在群聊“${resolvedGroup.name}”里说话。这里是群聊，不是私聊。`,
                char.persona ? `Persona: ${char.persona}` : '',
                char.world_info ? `World: ${char.world_info}` : '',
                char.system_prompt ? `Extra rules: ${char.system_prompt}` : ''
            ].filter(Boolean);
            return parts.join('\n\n');
        }
    );
    const compactRules = [
        'Group rules:',
        '1. Keep replies short and natural, usually 1-2 sentences.',
        '2. React to the latest group flow; do not force a turn.',
        '3. Output reply text only. Do not prefix your own name.',
        `4. Use @Name only if you want an immediate reply. Mentionable: @${userName}${mentionableNames ? ' / ' + mentionableNames : ''}`,
        '5. Red packet reactions stay in role.',
        '6. Source boundaries matter: [PRIVATE SOURCE] can shape your feelings but is not public chat; [GROUP SOURCE] is public chat and can be replied to directly; [CITY SOURCE] is real-life experience, not a chat line.',
        '7. Never mistake private/city snippets for someone literally speaking in this group right now. Do not invent message duplication, impersonation, or fake send errors unless the group history itself shows that.',
        '8. Optional hidden tags: [CHAR_AFFINITY:id:+3], [REDPACKET_SEND:lucky|50|5|新年快乐], [MOMENT:内容], [MOMENT_LIKE:MomentID], [MOMENT_COMMENT:MomentID:评论内容]'
    ].join('\n');
    const legacyRules = [
        'Guidelines:',
        '1. Stay in character. Be casual and conversational.',
        '2. You are chatting in a group. Keep messages short (1-2 sentences).',
        '3. React naturally to the conversation. Do not force responses.',
        '4. Do not prefix your message with your name or brackets.',
        '5. Output only your reply text. Do not repeat what you just said.',
        `6. Only use @Name when you explicitly want that specific person to reply right now. Mentionable names: @${userName}${mentionableNames ? ' / ' + mentionableNames : ''}`,
        '7. Optional hidden tags may be used when needed.'
    ].join('\n');
    const groupConversationDigest = typeof db.getGroupConversationDigest === 'function'
        ? db.getGroupConversationDigest(resolvedGroup.id, char.id, { trackHit: false })
        : null;
    const digestBlock = typeof memory.formatGroupConversationDigestForPrompt === 'function'
        ? memory.formatGroupConversationDigestForPrompt(groupConversationDigest, { recentMessages: compressedRecentGroupMsgs })
        : '';
    const compactCamp = {
        digest: digestBlock,
        anti: buildCompactGroupAntiRepeat(char, compressedRecentGroupMsgs),
        emotionRelation: `当前主情绪：${emotionGuidance.emotion.label} ${emotionGuidance.emotion.emoji}\n主情绪对群聊发言的影响：${emotionGuidance.groupChat}\n${relationSection}`,
        rules: compactRules
    };
    const legacyCamp = {
        digest: '',
        anti: buildLongAntiRepeat(char, allRecentGroupMsgs),
        emotionRelation: relationSection ? `Persona: ${char.persona || 'No specific persona.'}\n${relationSection}` : `Persona: ${char.persona || 'No specific persona.'}`,
        rules: legacyRules
    };

    return {
        db,
        char,
        group: resolvedGroup,
        stableGroupPrompt,
        compressedUniversal: compressedUniversal.preamble || '',
        legacyUniversal: legacyUniversal.preamble || '',
        compactCamp,
        legacyCamp,
        compressedHistory,
        baselineHistory
    };
}

function composeMessages(snapshot, mode) {
    let universal;
    let camp;
    let history;
    if (mode === 'all_compressed') {
        universal = snapshot.compressedUniversal;
        camp = snapshot.compactCamp;
        history = snapshot.compressedHistory;
    } else if (mode === 'all_legacy') {
        universal = snapshot.legacyUniversal;
        camp = snapshot.legacyCamp;
        history = snapshot.baselineHistory;
    } else if (mode === 'compressed_camp_legacy_universal') {
        universal = snapshot.legacyUniversal;
        camp = snapshot.compactCamp;
        history = snapshot.compressedHistory;
    } else if (mode === 'compressed_universal_legacy_camp') {
        universal = snapshot.compressedUniversal;
        camp = snapshot.legacyCamp;
        history = snapshot.baselineHistory;
    } else {
        throw new Error(`Unknown mode: ${mode}`);
    }

    const system = [
        snapshot.stableGroupPrompt,
        universal,
        camp.digest,
        camp.emotionRelation,
        camp.anti,
        camp.rules
    ].filter(Boolean).join('\n\n');

    return [{ role: 'system', content: system }, ...history];
}

async function runMode(snapshot, mode) {
    const messages = composeMessages(snapshot, mode);
    const result = await callLLM({
        endpoint: snapshot.char.api_endpoint,
        key: snapshot.char.api_key,
        model: snapshot.char.model_name,
        messages,
        maxTokens: Math.min(snapshot.char.max_tokens || 500, 220),
        temperature: 0.2,
        returnUsage: true
    });
    return {
        mode,
        prompt_tokens: result.usage?.prompt_tokens ?? null,
        system_tokens_est: getTokenCount(messages[0]?.content || ''),
        history_count: messages.length - 1,
        reply: result.content
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const snapshot = await buildSnapshot(args.user, args.group, args.character, args.characterName);
    const modes = [
        'all_legacy',
        'all_compressed',
        'compressed_camp_legacy_universal',
        'compressed_universal_legacy_camp'
    ];
    const results = [];
    for (const mode of modes) {
        results.push(await runMode(snapshot, mode));
    }
    console.log(JSON.stringify({
        user_id: args.user,
        group_id: snapshot.group.id,
        group_name: snapshot.group.name,
        character_id: snapshot.char.id,
        character_name: snapshot.char.name,
        results
    }, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
