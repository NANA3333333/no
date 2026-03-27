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
        characterName: 'Gemini 3 Pro',
        variants: null
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--user') args.user = argv[++i];
        else if (arg === '--group') args.group = argv[++i];
        else if (arg === '--character') args.character = argv[++i];
        else if (arg === '--character-name') args.characterName = argv[++i];
        else if (arg === '--variants') args.variants = String(argv[++i] || '').split(',').map(v => v.trim()).filter(Boolean);
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

function compactPreview(text, maxLength = 24) {
    const cleaned = cleanText(text);
    if (!cleaned) return '';
    if (cleaned.length <= maxLength) return cleaned;
    return `${cleaned.slice(0, Math.max(12, maxLength - 1)).trim()}…`;
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

function splitUniversalContext(preamble) {
    const text = String(preamble || '');
    const markers = [
        { key: 'private', token: '\n====== [PRIVATE SOURCE:' },
        { key: 'group', token: '\n[GROUP SOURCE:' },
        { key: 'city', token: '\n[===== CITY SOURCE:' }
    ];
    const hits = markers
        .map(m => ({ ...m, index: text.indexOf(m.token) }))
        .filter(m => m.index >= 0)
        .sort((a, b) => a.index - b.index);

    const blocks = {
        base: '',
        private: '',
        group: '',
        city: ''
    };

    if (hits.length === 0) {
        blocks.base = text.trim();
        return blocks;
    }

    blocks.base = text.slice(0, hits[0].index).trim();
    for (let i = 0; i < hits.length; i++) {
        const current = hits[i];
        const nextIndex = i + 1 < hits.length ? hits[i + 1].index : text.length;
        blocks[current.key] = text.slice(current.index, nextIndex).trim();
    }
    return blocks;
}

function joinBlocks(parts) {
    return parts.filter(Boolean).join('\n\n');
}

async function buildSnapshot(userId, groupId, characterId, characterName) {
    const db = getUserDb(userId);
    const memory = getMemory(userId);
    const group = groupId ? db.getGroup(groupId) : null;
    let char = characterId ? db.getCharacter(characterId) : null;

    if (!char && characterName) {
        const chars = db.getCharacters();
        char = chars.find(c => c.name === characterName) || null;
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
    const recentGroupMsgs = allRecentGroupMsgs.slice(-liveTailSize);
    const history = buildHistory(db, recentGroupMsgs, char.id, userName);
    const recentInput = history.slice(-2).map(m => m.content).join(' ');
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
    const universal = await buildUniversalContext(engineContextWrapper, char, recentInput, true, activeTargets);
    const universalBlocks = splitUniversalContext(universal.preamble || '');
    const relationSection = buildRelationSection(db, char, resolvedGroup, userName);
    const emotionGuidance = getEmotionBehaviorGuidance(char);
    const mentionableNames = resolvedGroup.members
        .filter(m => m.member_id !== 'user')
        .map(m => db.getCharacter(m.member_id)?.name)
        .filter(Boolean)
        .map(name => '@' + name)
        .join(' / ');
    const stableSystem = [
        '[System Directive: Stay fully in character. No AI/assistant mentions. No disclaimers.]',
        `你是${char.name}，正在群聊“${resolvedGroup.name}”里说话。这里是群聊，不是私聊。`,
        char.persona ? `Persona: ${char.persona}` : '',
        char.world_info ? `World: ${char.world_info}` : '',
        char.system_prompt ? `Extra rules: ${char.system_prompt}` : ''
    ].filter(Boolean).join('\n\n');
    const groupRulesBlock = [
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
    const groupConversationDigest = typeof db.getGroupConversationDigest === 'function'
        ? db.getGroupConversationDigest(resolvedGroup.id, char.id, { trackHit: false })
        : null;
    const digestBlock = typeof memory.formatGroupConversationDigestForPrompt === 'function'
        ? memory.formatGroupConversationDigestForPrompt(groupConversationDigest, { recentMessages: recentGroupMsgs })
        : '';
    const antiRepeat = buildCompactGroupAntiRepeat(char, recentGroupMsgs);
    const emotionAndRelation = [
        `当前主情绪：${emotionGuidance.emotion.label} ${emotionGuidance.emotion.emoji}`,
        `主情绪对群聊发言的影响：${emotionGuidance.groupChat}`,
        relationSection
    ].filter(Boolean).join('\n');

    return {
        db,
        char,
        group: resolvedGroup,
        blocks: {
            stable_system: stableSystem,
            universal_base: universalBlocks.base,
            private_source: universalBlocks.private,
            group_source: universalBlocks.group,
            city_source: universalBlocks.city,
            group_digest: digestBlock,
            emotion_relation: emotionAndRelation,
            anti_repeat: antiRepeat,
            group_rules: groupRulesBlock
        },
        history,
        recentGroupMsgs
    };
}

function buildMessagesFromVariant(snapshot, disabledKeys = []) {
    const disabled = new Set(disabledKeys || []);
    const parts = [];
    const order = [
        'stable_system',
        'universal_base',
        'private_source',
        'group_source',
        'city_source',
        'group_digest',
        'emotion_relation',
        'anti_repeat',
        'group_rules'
    ];
    for (const key of order) {
        if (!disabled.has(key) && snapshot.blocks[key]) parts.push(snapshot.blocks[key]);
    }
    return [{ role: 'system', content: joinBlocks(parts) }, ...snapshot.history];
}

async function runVariant(snapshot, name, disabledKeys = []) {
    const messages = buildMessagesFromVariant(snapshot, disabledKeys);
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
        variant: name,
        disabled_keys: disabledKeys,
        prompt_tokens: result.usage?.prompt_tokens ?? null,
        system_tokens_est: getTokenCount(messages[0]?.content || ''),
        history_count: messages.length - 1,
        reply: result.content
    };
}

function buildBinaryVariants() {
    return [
        { name: 'full', disabled: [] },
        { name: 'drop_context_bundle', disabled: ['universal_base', 'private_source', 'group_source', 'city_source'] },
        { name: 'drop_non_context_bundle', disabled: ['group_digest', 'emotion_relation', 'anti_repeat', 'group_rules'] },
        { name: 'drop_private_plus_city', disabled: ['private_source', 'city_source'] },
        { name: 'drop_base_plus_groupsource', disabled: ['universal_base', 'group_source'] },
        { name: 'drop_private_only', disabled: ['private_source'] },
        { name: 'drop_city_only', disabled: ['city_source'] },
        { name: 'drop_base_only', disabled: ['universal_base'] },
        { name: 'drop_digest_plus_anti', disabled: ['group_digest', 'anti_repeat'] },
        { name: 'drop_emotion_plus_rules', disabled: ['emotion_relation', 'group_rules'] },
        { name: 'drop_digest_only', disabled: ['group_digest'] },
        { name: 'drop_anti_only', disabled: ['anti_repeat'] },
        { name: 'drop_emotion_only', disabled: ['emotion_relation'] },
        { name: 'drop_rules_only', disabled: ['group_rules'] }
    ];
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const snapshot = await buildSnapshot(args.user, args.group, args.character, args.characterName);
    const variants = buildBinaryVariants();
    const selected = args.variants
        ? variants.filter(v => args.variants.includes(v.name))
        : variants;

    const results = [];
    for (const variant of selected) {
        results.push(await runVariant(snapshot, variant.name, variant.disabled));
    }

    console.log(JSON.stringify({
        user_id: args.user,
        group_id: snapshot.group.id,
        group_name: snapshot.group.name,
        character_id: snapshot.char.id,
        character_name: snapshot.char.name,
        tail_count: snapshot.history.length,
        block_tokens_est: Object.fromEntries(Object.entries(snapshot.blocks).map(([key, value]) => [key, getTokenCount(value || '')])),
        results
    }, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
