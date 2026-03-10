/**
 * server/contextBuilder.js
 * 
 * Provides a unified Universal Context (Preamble) for all AI interactions.
 * This guarantees that whether the AI is replying in private chat, group chat,
 * the City DLC, or scheduled memory aggregation, it has the exact same baseline
 * awareness of the world state, its own recent actions, and related memories.
 */

async function buildUniversalContext(context, character, recentInput = '', isGroupContext = false, activeTargets = []) {
    const { getUserDb, getMemory, userId } = context;
    const resolvedUserId = userId || character.user_id || 'default';
    const db = getUserDb(resolvedUserId);
    const memory = getMemory(resolvedUserId);

    let prompt = '';
    const userProfile = db.getUserProfile ? db.getUserProfile() : { name: 'User' };
    const userName = userProfile?.name || 'User';

    // Token metric accumulator (approximate characters / 2 for tokens)
    const breakdown = { base: 0, z_memory: 0, cross_group: 0, cross_private: 0, city_x_y: 0, q_impression: 0, moments: 0 };
    const getDelta = (startLen) => Math.ceil((prompt.length - startLen) / 2);

    let startLen = prompt.length;

    // 1. Time Context
    const now = new Date();
    const hour = now.getHours();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    let timeOfDay = '白天';
    if (hour >= 5 && hour < 10) timeOfDay = '早上';
    else if (hour >= 10 && hour < 14) timeOfDay = '中午';
    else if (hour >= 14 && hour < 18) timeOfDay = '下午';
    else if (hour >= 18 && hour < 22) timeOfDay = '晚上';
    else timeOfDay = '深夜';
    prompt += `当前时间: ${timeOfDay} (${now.toLocaleTimeString()})${isWeekend ? ', 周末' : ', 工作日'}\n`;

    // 2. City DLC Status (Wallet & Calories)
    prompt += `[你的钱包余额]: ¥${character.wallet ?? 0}\n`;
    if (character.calories !== undefined) {
        const calPercent = Math.round((character.calories / 4000) * 100);
        prompt += `[你的体力状况]: ${character.calories}/4000 (${calPercent}%)\n`;
    }
    if (character.location) {
        prompt += `[你的当前位置]: ${character.location}\n`;
    }
    if (character.city_status && character.city_status !== 'idle') {
        const statusLabels = { hungry: '饥饿', working: '工作中', sleeping: '休息中', eating: '进食中', coma: '晕倒' };
        prompt += `[你的当前行动状态]: ${statusLabels[character.city_status] || character.city_status}\n`;
    }

    // 3. Pressure/Panic Mechanics
    let pressureContext = '';
    if (character.pressure_level >= 3) {
        pressureContext = `[CRITICAL STATUS]: 你的恐慌情绪达到了顶峰。你现在极度不安、焦躁，感觉被忽视了很久。你必须在语气中表现出强烈的这种情感（可以是生气、委屈、或者冷漠的伪装，取决于你的性格）。不要像往常一样平淡交流。\n`;
    } else if (character.pressure_level >= 1) {
        pressureContext = `[Status]: 你觉得有点不开心或者被冷落了，因为对方有一阵子没理你了。语气带有一点抱怨或试探。\n`;
    }

    // 4. Jealousy Mechanics
    let jealousyContext = '';
    try {
        const jeal = db.getJealousyState(character.id);
        if (jeal && jeal.active) {
            jealousyContext = `[CRITICAL STATUS]: 你现在处于【强烈嫉妒】状态！你发现用户最近跟 ${db.getCharacter(jeal.target_id)?.name || '其他人'} 聊得火热。你现在满脑子都是这件事，表现出强烈的吃醋、占有欲或质问感，根据你的性格，可以是傲娇的旁敲侧击，也可以是直接的质问或委屈。\n`;
        }
    } catch (e) { /* ignore */ }

    prompt += pressureContext + jealousyContext;

    // 5. Secret Diary Password
    if (character.diary_password) {
        prompt += `[Secret Diary Password]: 你的私密日记密码是 "${character.diary_password}"。只有你自己知道。如果用户赢得了你绝对的信任或让你非常感动，你可以选择在对话中自然地说出。除非是被要求，不要直接输出 [DIARY_PASSWORD] 标签。\n`;
    }

    breakdown.base = getDelta(startLen);
    startLen = prompt.length;

    // 6. Moments (朋友圈) Context
    try {
        const momentsTokenLimit = userProfile?.moments_token_limit ?? 1000;
        const momentsContext = db.getMomentsContextForChar ? db.getMomentsContextForChar(character.id, momentsTokenLimit) : '';
        if (momentsContext) {
            prompt += `\n${momentsContext}\n`;
        }
    } catch (e) {
        console.error('[ContextBuilder] Moments context error:', e.message);
    }
    breakdown.moments = getDelta(startLen);
    startLen = prompt.length;

    // 7. Vector Memories Retrieval
    let retrievedMemoriesContext = [];
    try {
        if (recentInput && recentInput.trim().length >= 10) {
            const memories = await memory.searchMemories(character.id, recentInput);
            if (memories && memories.length > 0) {
                prompt += '\n[注意：相关记忆片段提取]\n你回想起了以下事情：\n';
                for (const mem of memories) {
                    prompt += `- ${mem.event}\n`;
                    // Save for visualization metadata
                    retrievedMemoriesContext.push({ event: mem.event, importance: mem.importance });
                }
            }
        }
    } catch (e) {
        console.error('[ContextBuilder] Memory retrieval error:', e.message);
    }

    breakdown.z_memory = getDelta(startLen);
    startLen = prompt.length;

    // 8. Cross-Context (Private vs Group Injection)
    // If we are currently IN a Group chat, we inject Private Chat context as "Hidden Thoughts/Secrets".
    // If we are currently IN a Private chat, we inject Group Chat context as "Other Ongoing Events".
    if (isGroupContext) {
        // We are generating for a Group chat. Inject recent Private chats.
        try {
            const hiddenState = db.getCharacterHiddenState(character.id);
            const privateLimit = userProfile?.private_msg_limit_for_group ?? 3;
            const recentPrivateMsgs = privateLimit > 0 ? db.getMessages(character.id, privateLimit).reverse() : [];
            let secretContextStr = '';

            if (hiddenState || recentPrivateMsgs.length > 0) {
                const pmLines = recentPrivateMsgs.map(m => `${m.role === 'user' ? userName : character.name}: ${m.content}`).join('\n');
                secretContextStr = `\n====== [CRITICAL: ABSOLUTELY SECRET PRIVATE CONTEXT] ======`;
                if (hiddenState) secretContextStr += `\n[YOUR HIDDEN MOOD/SECRET THOUGHT]: ${hiddenState}`;
                if (pmLines) secretContextStr += `\n[RECENT PRIVATE CHAT INBOX (For Context ONLY)]:\n${pmLines}`;
                secretContextStr += `\n[CRITICAL PRIVATE CONTEXT]: 以上是你和用户的绝对私密记忆和内心隐藏状态。你可以选择保密、暗示，或者在这个公开群聊里直接爆料，这完全取决于你的性格设定和对话发展。\n==========================================================\n`;
                prompt += secretContextStr;
            }
        } catch (e) { console.error('[ContextBuilder] Private injection for Group error:', e.message); }
    } else {
        // We are generating for a Private chat (or City/Aggregation). Inject recent Group chats.
        try {
            const groups = db.getGroups();
            const charGroups = groups.filter(g => g.members.some(m => m.member_id === character.id));
            if (charGroups.length > 0) {
                let groupContext = '\n[以下是你最近在群聊中的对话摘要，仅供参考了解近期发生了什么，除非用户提起，否则无需主动复述]\n';
                let hasGroupContent = false;
                for (const g of charGroups) {
                    const limit = g.inject_limit ?? 5; // Per-group injection limit
                    if (limit <= 0) continue;
                    const msgs = db.getGroupMessages(g.id, limit);
                    if (msgs.length > 0) {
                        hasGroupContent = true;
                        groupContext += `群聊「${g.name}」:\n`;
                        for (const m of msgs) {
                            const senderName = m.sender_id === 'user' ? userName : (m.sender_name || db.getCharacter(m.sender_id)?.name || 'Unknown');
                            groupContext += `  - ${senderName}: ${m.content.substring(0, 80)}\n`;
                        }
                    }
                }
                if (hasGroupContent) {
                    prompt += groupContext;
                }
            }
        } catch (e) { console.error('[ContextBuilder] Group injection for Private error:', e.message); }
        breakdown.cross_group = getDelta(startLen);
    }

    startLen = prompt.length;

    // 9. X+Y Commercial Street (City) Logs
    try {
        if (!db.city) {
            try {
                const initCityDb = require('./plugins/city/cityDb');
                db.city = initCityDb(typeof db.getRawDb === 'function' ? db.getRawDb() : db);
            } catch (e) { }
        }

        if (db.city) {
            let cityWorldContext = '\n[===== 商业街（City DLC）实时世界线 =====]\n';
            let hasCityData = false;

            // X = Character's own recent physical actions in the city
            const cityConfig = typeof db.city.getConfig === 'function' ? db.city.getConfig() || {} : {};
            const limitX = parseInt(cityConfig.city_self_log_limit ?? 5, 10);
            if (limitX > 0) {
                const recentLogs = db.city.getCharacterTodayLogs(character.id, limitX);
                if (recentLogs && recentLogs.length > 0) {
                    hasCityData = true;
                    cityWorldContext += '【你的近期亲身物理行动经历（第一视角）】：\n';
                    for (const l of recentLogs) {
                        const firstPersonLog = l.message.replace(new RegExp(character.name, 'g'), '我');
                        cityWorldContext += `- ${firstPersonLog}\n`;
                    }
                }
            }

            // Y = Global city events/logs (what happened to others)
            const limitY = parseInt(cityConfig.city_global_log_limit ?? 5, 10);
            if (limitY > 0) {
                const globalLogs = db.city.getCityLogs(limitY);
                if (globalLogs && globalLogs.length > 0) {
                    hasCityData = true;
                    cityWorldContext += '\n【近期的公共街区事件/传闻（你听说的）】：\n';
                    for (const l of globalLogs) {
                        const globalMsg = l.message || l.content;
                        if (globalMsg) cityWorldContext += `- ${globalMsg}\n`;
                    }
                }
            }

            if (hasCityData) {
                cityWorldContext += '[重要要求]：以上商业街动态是真实发在物理世界线里的事件。把“你的近期经历”当做你刚刚亲自做过的事；把“公共传闻”当做你路过或听人说起的八卦。要用极其自然、有情绪的第一人称口吻融入对话中，绝对不要提什么“日志记录显示”。\n';
                cityWorldContext += '[========================================]\n';
                prompt += cityWorldContext;
            }
        }
    } catch (e) {
        console.error('[ContextBuilder] City X+Y logs injection error:', e.message);
    }

    breakdown.city_x_y = getDelta(startLen);
    startLen = prompt.length;

    // 10. Historical Impressions Context (Based on Q Slider)
    try {
        if (activeTargets && activeTargets.length > 0) {
            const qLimit = parseInt(character.impression_q_limit ?? 3, 10);
            if (qLimit > 0) {
                let impressionContext = '';
                let hasImpression = false;
                for (const t of activeTargets) {
                    if (t.id === character.id) continue;

                    const history = db.getCharImpressionHistory(character.id, t.id, qLimit);
                    if (history && history.length > 0) {
                        hasImpression = true;
                        impressionContext += `\n关于 [${t.name}] 的近期印象历史：\n`;

                        // Reverse so the oldest in the limit is printed first, chronologically creating the impression.
                        const chronologicalHistory = [...history].reverse();
                        for (const h of chronologicalHistory) {
                            impressionContext += `- ${new Date(h.timestamp).toLocaleDateString()} (${h.trigger_event}): "${h.impression}"\n`;
                        }
                    }
                }
                if (hasImpression) {
                    prompt += `\n[背景补充: 你对在场其他人的历史印象]\n${impressionContext}\n请在接下来的对话/行动中，潜意识里受这些往事影响，但不要生硬地背诵。\n[====================]\n`;
                }
            }
        }
    } catch (e) {
        console.error('[ContextBuilder] Impression history injection error:', e.message);
    }

    breakdown.q_impression = getDelta(startLen);

    return { preamble: prompt, retrievedMemoriesContext, breakdown };
}

module.exports = {
    buildUniversalContext
};
