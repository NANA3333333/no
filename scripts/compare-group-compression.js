const crypto = require('crypto');
const { getUserDb } = require('../server/db');
const { getMemory } = require('../server/memory');
const { callLLM } = require('../server/llm');
const { buildUniversalContext } = require('../server/contextBuilder');
const { getTokenCount } = require('../server/utils/tokenizer');
const { getAdaptiveTailWindowSize } = require('../server/utils/contextWindow');
const { getEmotionBehaviorGuidance } = require('../server/emotion');

function parseArgs(argv) {
    const args = { user: null, group: null, character: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--user') args.user = argv[++i];
        else if (arg === '--group') args.group = argv[++i];
        else if (arg === '--character') args.character = argv[++i];
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
    const sourceHash = crypto.createHash('sha256')
        .update(JSON.stringify(sourcePayload || {}))
        .digest('hex');
    const cached = typeof db?.getPromptBlockCache === 'function'
        ? db.getPromptBlockCache(characterId, blockType, sourceHash)
        : null;
    if (cached?.compiled_text) return cached.compiled_text;
    return String(buildFn?.() || '');
}

async function buildPromptPair({ db, userId, group, char }) {
    const memory = getMemory(userId);
    const userProfile = db.getUserProfile?.() || { name: 'User' };
    const userName = userProfile.name || 'User';
    const memberEntry = group.members.find(m => m.member_id === char.id);
    const joinedAt = memberEntry?.joined_at || 0;
    const groupMsgLimit = group.context_msg_limit || 60;
    const allRecentGroupMsgs = db.getVisibleGroupMessages(group.id, groupMsgLimit, joinedAt);
    const liveTailSize = getAdaptiveTailWindowSize(groupMsgLimit, allRecentGroupMsgs.length);
    const compressedRecentGroupMsgs = allRecentGroupMsgs.slice(-liveTailSize);

    const compressedHistory = buildHistory(db, compressedRecentGroupMsgs, char.id, userName);
    const baselineHistory = buildHistory(db, allRecentGroupMsgs, char.id, userName);

    const compressedRecentInput = compressedHistory.slice(-2).map(m => m.content).join(' ');
    const baselineRecentInput = baselineHistory.slice(-2).map(m => m.content).join(' ');
    const otherMembers = group.members.filter(m => m.member_id !== char.id);
    const activeTargets = otherMembers
        .filter(m => m.member_id !== 'user')
        .map(m => db.getCharacter(m.member_id))
        .filter(c => c && !c.is_blocked);

    const engineContextWrapper = {
        getUserDb: () => db,
        getMemory: () => memory,
        userId
    };

    const compressedUniversal = await buildUniversalContext(engineContextWrapper, char, compressedRecentInput, true, activeTargets);
    const baselineUniversal = await buildUniversalContext(engineContextWrapper, char, baselineRecentInput, true, activeTargets);
    const relationSection = buildRelationSection(db, char, group, userName);
    const emotionGuidance = getEmotionBehaviorGuidance(char);
    const mentionableNames = group.members
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
            groupName: group.name || '',
            persona: char.persona || '',
            worldInfo: char.world_info || '',
            systemPrompt: char.system_prompt || ''
        },
        () => {
            const parts = [
                '[System Directive: Stay fully in character. No AI/assistant mentions. No disclaimers.]',
                `你是${char.name}，正在群聊“${group.name}”里说话。这里是群聊，不是私聊。`,
                char.persona ? `Persona: ${char.persona}` : '',
                char.world_info ? `World: ${char.world_info}` : '',
                char.system_prompt ? `Extra rules: ${char.system_prompt}` : ''
            ].filter(Boolean);
            return parts.join('\n\n');
        }
    );

    const groupRulesBlock = [
        'Group rules:',
        '1. Keep replies short and natural, usually 1-2 sentences.',
        '2. React to the latest group flow; do not force a turn.',
        '3. Output reply text only. Do not prefix your own name.',
        `4. Use @Name only if you want an immediate reply. Mentionable: @${userName}${mentionableNames ? ' / ' + mentionableNames : ''}`,
        '5. Red packet reactions stay in role.',
        '6. Optional hidden tags: [CHAR_AFFINITY:id:+3], [REDPACKET_SEND:lucky|50|5|新年快乐], [MOMENT:内容], [MOMENT_LIKE:MomentID], [MOMENT_COMMENT:MomentID:评论内容]'
    ].join('\n');

    const groupConversationDigest = typeof db.getGroupConversationDigest === 'function'
        ? db.getGroupConversationDigest(group.id, char.id, { trackHit: false })
        : null;
    const digestBlock = typeof memory.formatGroupConversationDigestForPrompt === 'function'
        ? memory.formatGroupConversationDigestForPrompt(groupConversationDigest)
        : '';

    const compressedSystem =
        stableGroupPrompt + '\n\n' +
        (compressedUniversal.preamble || '') + '\n\n' +
        (digestBlock ? `${digestBlock}\n\n` : '') +
        `当前主情绪：${emotionGuidance.emotion.label} ${emotionGuidance.emotion.emoji}\n` +
        `主情绪对群聊发言的影响：${emotionGuidance.groupChat}\n` +
        relationSection + '\n' +
        buildCompactGroupAntiRepeat(char, compressedRecentGroupMsgs) + '\n\n' +
        groupRulesBlock;

    const baselineSystem =
        '[System Directive: You must completely embody your persona. Do not mention you are an AI or an assistant. No warnings or disclaimers.]\n\n' +
        `你是${char.name}，正在一个叫“${group.name}”的群聊里聊天。\n注意：这是群聊，不是私聊。\n\n` +
        (baselineUniversal.preamble || '') + '\n\n' +
        `Persona: ${char.persona || 'No specific persona.'}\n` +
        relationSection + '\n' +
        buildLongAntiRepeat(char, allRecentGroupMsgs) + '\n\n' +
        'Guidelines:\n' +
        '1. Stay in character. Be casual and conversational.\n' +
        '2. You are chatting in a group. Keep messages short (1-2 sentences).\n' +
        '3. React naturally to the conversation. Do not force responses.\n' +
        '4. Do not prefix your message with your name or brackets.\n' +
        '5. Output only your reply text. Do not repeat what you just said.\n' +
        `6. Only use @Name when you explicitly want that specific person to reply right now. Mentionable names: @${userName}${mentionableNames ? ' / ' + mentionableNames : ''}\n` +
        '7. Optional hidden tags may be used when needed.';

    return {
        compressedMessages: [{ role: 'system', content: compressedSystem }, ...compressedHistory],
        baselineMessages: [{ role: 'system', content: baselineSystem }, ...baselineHistory]
    };
}

async function judgeOutputs(judgeConfig, payload) {
    if (!judgeConfig.endpoint || !judgeConfig.key || !judgeConfig.model) return null;
    const prompt = `Compare two roleplay replies to the same frozen group-chat snapshot. Output one-line JSON only with keys semantic_equivalent (bool), persona_drift_risk (0-10), reason (short).\nCompressed: ${payload.compressed}\nBaseline: ${payload.baseline}`;
    const { content } = await callLLM({
        endpoint: judgeConfig.endpoint,
        key: judgeConfig.key,
        model: judgeConfig.model,
        messages: [
            { role: 'system', content: 'You are a strict evaluator. Output JSON only.' },
            { role: 'user', content: prompt }
        ],
        maxTokens: 120,
        temperature: 0.1,
        returnUsage: true
    });
    const start = String(content || '').indexOf('{');
    const end = String(content || '').lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return { raw: content };
    return JSON.parse(String(content).slice(start, end + 1));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const userId = args.user || 'fuwbbtcqmm8osf5g';
    const db = getUserDb(userId);
    const raw = db.getRawDb();
    const latest = raw.prepare(`
        SELECT id, character_id, meta
        FROM llm_debug_logs
        WHERE context_type='group_chat' AND direction='input'
        ORDER BY id DESC
        LIMIT 1
    `).get();
    if (!latest) throw new Error('No group_chat input debug row found.');

    const meta = JSON.parse(latest.meta || '{}');
    const characterId = args.character || latest.character_id;
    const groupId = args.group || meta.group_id;
    const char = db.getCharacter(characterId);
    const group = db.getGroup(groupId);
    if (!char || !group) throw new Error('Character or group not found.');

    const { compressedMessages, baselineMessages } = await buildPromptPair({ db, userId, group, char });

    const compressedCall = await callLLM({
        endpoint: char.api_endpoint,
        key: char.api_key,
        model: char.model_name,
        messages: compressedMessages,
        maxTokens: Math.min(char.max_tokens || 500, 220),
        temperature: 0.2,
        returnUsage: true
    });
    const baselineCall = await callLLM({
        endpoint: char.api_endpoint,
        key: char.api_key,
        model: char.model_name,
        messages: baselineMessages,
        maxTokens: Math.min(char.max_tokens || 500, 220),
        temperature: 0.2,
        returnUsage: true
    });

    const judge = await judgeOutputs({
        endpoint: char.memory_api_endpoint || char.api_endpoint,
        key: char.memory_api_key || char.api_key,
        model: char.memory_model_name || char.model_name
    }, {
        compressed: compressedCall.content,
        baseline: baselineCall.content
    });

    console.log(JSON.stringify({
        user_id: userId,
        group_id: groupId,
        group_name: group.name,
        character_id: characterId,
        character_name: char.name,
        compressed_prompt_tokens: compressedCall.usage?.prompt_tokens ?? null,
        baseline_prompt_tokens: baselineCall.usage?.prompt_tokens ?? null,
        compressed_system_tokens_est: getTokenCount(compressedMessages.find(m => m.role === 'system')?.content || ''),
        baseline_system_tokens_est: getTokenCount(baselineMessages.find(m => m.role === 'system')?.content || ''),
        compressed_history_count: compressedMessages.filter(m => m.role !== 'system').length,
        baseline_history_count: baselineMessages.filter(m => m.role !== 'system').length,
        compressed_reply: compressedCall.content,
        baseline_reply: baselineCall.content,
        judge
    }, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
