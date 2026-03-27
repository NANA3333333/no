function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function getLegacyEmotionBridge(character = {}) {
    const mood = normalizeNumber(character.mood, 50);
    const stress = normalizeNumber(character.stress, 20);
    const socialNeed = normalizeNumber(character.social_need, 50);
    const pressure = normalizeNumber(character.pressure_level, 0);
    const ignoreStreak = normalizeNumber(character.city_ignore_streak, 0);
    const replyPending = normalizeNumber(character.city_reply_pending, 0) > 0;

    return {
        mood: clamp(Math.round(mood - pressure * 6 - ignoreStreak * 3 - (replyPending ? 2 : 0)), 0, 100),
        stress: clamp(Math.round(stress + pressure * 10 + ignoreStreak * 4 + (replyPending ? 4 : 0)), 0, 100),
        socialNeed: clamp(Math.round(socialNeed + pressure * 8 + ignoreStreak * 5), 0, 100),
        pressure,
        ignoreStreak,
        replyPending
    };
}

function analyzeUserReplyTone(content = '') {
    const text = String(content || '').trim().toLowerCase();
    let score = 0;
    if (!text) return score;

    score += 1; // any actual reply eases neglect pressure a bit

    if (/(抱抱|亲亲|想你|在乎你|喜欢你|爱你|别委屈|别生气|不气|不委屈|乖|陪你|哄你|摸摸|安慰|对不起|抱歉|我在|回你了|没忘|一直在|么么|muah)/i.test(text)) {
        score += 2;
    }
    if (/[❤❤️💕💖💗💓💞🥺😚😙😘🥰🤗😊☺]/.test(text)) {
        score += 1;
    }
    if (text.length >= 12) {
        score += 1;
    }

    return score;
}

function analyzeUserReplyEmotionEffect(content = '') {
    const text = String(content || '').trim();
    const lower = text.toLowerCase();
    const result = {
        key: 'neutral',
        label: '中性回应',
        moodDelta: 0,
        stressDelta: 0,
        socialNeedDelta: 0
    };
    if (!text) return result;

    const positiveRegex = /(抱抱|亲亲|想你|在乎你|喜欢你|爱你|别委屈|别生气|不气|陪你|哄你|摸摸|安慰|对不起|抱歉|我在|回你了|没忘|一直在|辛苦了|乖|宝|宝宝|么么|亲爱的|别难过)/i;
    const explanationRegex = /(刚刚|刚才|在忙|有事|开会|工作|处理|耽误|晚点|晚了|没看到|现在回|不是故意|解释一下)/i;
    const negativeRegex = /(滚|烦|闭嘴|别吵|有病|神经|讨厌|懒得理|不想理你|别来烦我|关你屁事|少管|你懂什么|别烦|莫名其妙)/i;
    const coldRegex = /^(哦|噢|嗯|行吧|随便|知道了|好吧|？|。。。|\.\.\.)$/i;
    const mentionOtherRegex = /(他|她|别人|另一个|grok|claude|gemini|glm|gpt)/i;

    if (negativeRegex.test(text)) {
        return {
            key: 'negative',
            label: '负面回应',
            moodDelta: -8,
            stressDelta: 9,
            socialNeedDelta: 3
        };
    }

    if (positiveRegex.test(text)) {
        return {
            key: 'soothed',
            label: '安抚回应',
            moodDelta: 8,
            stressDelta: -7,
            socialNeedDelta: -6
        };
    }

    if (explanationRegex.test(text)) {
        return {
            key: 'explained',
            label: '解释回应',
            moodDelta: 4,
            stressDelta: -5,
            socialNeedDelta: -3
        };
    }

    if (coldRegex.test(text) || text.length <= 3) {
        return {
            key: 'cold',
            label: '冷淡回应',
            moodDelta: -2,
            stressDelta: 3,
            socialNeedDelta: 1
        };
    }

    if (mentionOtherRegex.test(lower) && !positiveRegex.test(text)) {
        return {
            key: 'distracted',
            label: '转移注意',
            moodDelta: -1,
            stressDelta: 2,
            socialNeedDelta: 1
        };
    }

    if (text.length >= 12) {
        return {
            key: 'engaged',
            label: '认真回应',
            moodDelta: 3,
            stressDelta: -2,
            socialNeedDelta: -2
        };
    }

    return result;
}

function getUserReplyReliefPatch(character = {}, content = '') {
    const pressure = normalizeNumber(character.pressure_level, 0);
    const jealousy = normalizeNumber(character.jealousy_level, 0);
    if (pressure <= 0 && jealousy <= 0) return null;

    const toneScore = analyzeUserReplyTone(content);
    const pressureDrop = Math.min(pressure, Math.max(1, toneScore));
    const jealousyDrop = toneScore >= 3 ? 20 : 0;
    const patch = {};

    if (pressure > 0) {
        patch.pressure_level = Math.max(0, pressure - pressureDrop);
    }
    if (jealousy > 0 && jealousyDrop > 0) {
        const nextJealousy = Math.max(0, jealousy - jealousyDrop);
        patch.jealousy_level = nextJealousy;
        if (nextJealousy === 0) {
            patch.jealousy_target = '';
        }
    }

    return Object.keys(patch).length > 0 ? patch : null;
}

function getUserReplyEmotionPatch(character = {}, content = '', options = {}) {
    const mood = normalizeNumber(character.mood, 50);
    const stress = normalizeNumber(character.stress, 20);
    const socialNeed = normalizeNumber(character.social_need, 50);
    const pressure = normalizeNumber(character.pressure_level, 0);
    const waitMinutes = Math.max(0, normalizeNumber(options.waitMinutes, 0));
    const effect = analyzeUserReplyEmotionEffect(content);

    let moodDelta = 1;
    let stressDelta = -1;
    let socialNeedDelta = -1;

    moodDelta += effect.moodDelta;
    stressDelta += effect.stressDelta;
    socialNeedDelta += effect.socialNeedDelta;

    if (waitMinutes >= 30) {
        stressDelta -= 1;
    }
    if (waitMinutes >= 180) {
        stressDelta -= 1;
        moodDelta += 1;
    }
    if (pressure >= 2 && ['soothed', 'explained', 'engaged'].includes(effect.key)) {
        moodDelta += 2;
        stressDelta -= 2;
    }

    return {
        patch: {
            mood: clamp(Math.round(mood + moodDelta), 0, 100),
            stress: clamp(Math.round(stress + stressDelta), 0, 100),
            social_need: clamp(Math.round(socialNeed + socialNeedDelta), 0, 100)
        },
        effect
    };
}

function buildEmotionLogEntry(before = {}, after = {}, source, reason = '') {
    const beforeEmotion = deriveEmotion(before);
    const afterEmotion = deriveEmotion(after);
    const fieldsChanged =
        (before.mood ?? null) !== (after.mood ?? null) ||
        (before.stress ?? null) !== (after.stress ?? null) ||
        (before.social_need ?? null) !== (after.social_need ?? null) ||
        (before.pressure_level ?? null) !== (after.pressure_level ?? null) ||
        (before.jealousy_level ?? null) !== (after.jealousy_level ?? null) ||
        beforeEmotion.state !== afterEmotion.state;

    if (!fieldsChanged || !after.id) return null;

    return {
        character_id: after.id,
        source,
        reason,
        old_state: beforeEmotion.state,
        new_state: afterEmotion.state,
        old_mood: before.mood ?? null,
        new_mood: after.mood ?? null,
        old_stress: before.stress ?? null,
        new_stress: after.stress ?? null,
        old_social_need: before.social_need ?? null,
        new_social_need: after.social_need ?? null,
        old_pressure: before.pressure_level ?? null,
        new_pressure: after.pressure_level ?? null,
        old_jealousy: before.jealousy_level ?? null,
        new_jealousy: after.jealousy_level ?? null
    };
}

function getExplicitEmotionStatePatch(character = {}, requestedState = '') {
    const state = String(requestedState || '').trim().toLowerCase();
    const mood = normalizeNumber(character.mood, 50);
    const stress = normalizeNumber(character.stress, 20);
    const socialNeed = normalizeNumber(character.social_need, 50);
    const pressure = normalizeNumber(character.pressure_level, 0);
    const jealousy = normalizeNumber(character.jealousy_level, 0);
    const patch = {};

    switch (state) {
        case 'jealous':
        case '吃醋':
            patch.jealousy_level = Math.max(65, jealousy);
            if (character.jealousy_target) patch.jealousy_target = character.jealousy_target;
            patch.mood = clamp(Math.min(mood, 62), 0, 100);
            patch.stress = clamp(Math.max(stress, 38), 0, 100);
            patch.social_need = clamp(Math.max(socialNeed, 58), 0, 100);
            break;
        case 'hurt':
        case '委屈':
            patch.pressure_level = Math.max(2, pressure);
            patch.mood = clamp(Math.min(mood, 60), 0, 100);
            patch.stress = clamp(Math.max(stress, 32), 0, 100);
            patch.social_need = clamp(Math.max(socialNeed, 58), 0, 100);
            break;
        case 'angry':
        case '生气':
            patch.mood = clamp(Math.min(mood, 45), 0, 100);
            patch.stress = clamp(Math.max(stress, 70), 0, 100);
            break;
        case 'lonely':
        case '寂寞':
            patch.social_need = clamp(Math.max(socialNeed, 75), 0, 100);
            patch.mood = clamp(Math.min(mood, 55), 0, 100);
            break;
        case 'happy':
        case '开心':
            patch.mood = clamp(Math.max(mood, 75), 0, 100);
            patch.stress = clamp(Math.min(stress, 25), 0, 100);
            patch.social_need = clamp(Math.min(socialNeed, 45), 0, 100);
            patch.pressure_level = Math.min(pressure, 1);
            break;
        case 'sad':
        case '伤心':
            patch.mood = clamp(Math.min(mood, 35), 0, 100);
            patch.stress = clamp(Math.max(stress, 35), 0, 100);
            break;
        case 'tense':
        case '烦躁':
            patch.stress = clamp(Math.max(stress, 58), 0, 100);
            patch.mood = clamp(Math.min(mood, 60), 0, 100);
            break;
        case 'sleepy':
        case '困倦':
            patch.stress = clamp(Math.min(stress, 45), 0, 100);
            break;
        case 'unwell':
        case '难受':
            patch.mood = clamp(Math.min(mood, 50), 0, 100);
            patch.stress = clamp(Math.max(stress, 30), 0, 100);
            break;
        case 'calm':
        case '平静':
            patch.mood = clamp(Math.max(mood, 52), 0, 100);
            patch.stress = clamp(Math.min(stress, 35), 0, 100);
            patch.social_need = clamp(Math.min(Math.max(socialNeed, 35), 60), 0, 100);
            break;
        default:
            return null;
    }

    return patch;
}

function deriveEmotion(character = {}) {
    const bridged = getLegacyEmotionBridge(character);
    const mood = bridged.mood;
    const stress = bridged.stress;
    const sleepDebt = normalizeNumber(character.sleep_debt, 0);
    const health = normalizeNumber(character.health, 100);
    const socialNeed = bridged.socialNeed;
    const stomachLoad = normalizeNumber(character.stomach_load, 0);
    const pressure = bridged.pressure;
    const jealousy = normalizeNumber(character.jealousy_level, 0);
    const replyPending = bridged.replyPending;
    const ignoreStreak = bridged.ignoreStreak;
    const jealousyTarget = String(character.jealousy_target || '').trim();

    if (health <= 45 || stomachLoad >= 75) return { state: 'unwell', label: '难受', emoji: '🤒', color: '#8e24aa' };
    if (sleepDebt >= 72) return { state: 'sleepy', label: '困倦', emoji: '😪', color: '#3949ab' };
    if (jealousy >= 60 && jealousyTarget) return { state: 'jealous', label: '吃醋', emoji: '😾', color: '#d81b60' };
    if (mood >= 70 && stress <= 40 && !(jealousy >= 45 && jealousyTarget)) return { state: 'happy', label: '开心', emoji: '😄', color: '#43a047' };
    if ((pressure >= 2 || (replyPending && ignoreStreak >= 1)) && !(mood >= 78 && stress <= 25)) return { state: 'hurt', label: '委屈', emoji: '🥺', color: '#fb8c00' };
    if (stress >= 68 && mood <= 45) return { state: 'angry', label: '生气', emoji: '😤', color: '#e53935' };
    if (socialNeed >= 70 && mood <= 55) return { state: 'lonely', label: '寂寞', emoji: '🫥', color: '#00897b' };
    if (mood <= 38) return { state: 'sad', label: '伤心', emoji: '😞', color: '#546e7a' };
    if (stress >= 55) return { state: 'tense', label: '烦躁', emoji: '😣', color: '#f4511e' };
    return { state: 'calm', label: '平静', emoji: '🙂', color: '#1e88e5' };
}

function getEmotionBehaviorGuidance(character = {}) {
    const emotion = deriveEmotion(character);
    switch (emotion.state) {
        case 'angry':
            return {
                emotion,
                privateChat: '你现在主情绪是生气。私聊时更容易顶嘴、反问、带刺，耐心更差，不愿意轻易给台阶。',
                groupChat: '你现在主情绪是生气。在群聊里更容易呛人、阴阳、直接反驳，也更容易对冒犯保持敌意。',
                cityAction: '你现在主情绪是生气。行动上更容易回避低效社交，或者去能发泄、转移注意力、证明存在感的地方。'
            };
        case 'hurt':
            return {
                emotion,
                privateChat: '你现在主情绪是委屈。私聊时更容易试探、索要安抚、黏人、嘴硬，想确认对方是不是在乎你。',
                groupChat: '你现在主情绪是委屈。在群聊里更容易沉默、少说话，或者用轻微带刺的方式表达失落感。',
                cityAction: '你现在主情绪是委屈。行动上更偏向熟悉、安全、能缓和情绪的地方，也更容易想找熟人或联系用户。'
            };
        case 'happy':
            return {
                emotion,
                privateChat: '你现在主情绪是开心。私聊时更主动、更愿意展开话题，也更愿意分享细节和近况。',
                groupChat: '你现在主情绪是开心。在群聊里更容易接话、活跃、开玩笑，也更愿意回应别人。',
                cityAction: '你现在主情绪是开心。行动上更愿意娱乐、探索、闲逛或做有新鲜感的事。'
            };
        case 'lonely':
            return {
                emotion,
                privateChat: '你现在主情绪是寂寞。私聊时更想被看见、更想延长对话，也更在意对方回不回你。',
                groupChat: '你现在主情绪是寂寞。在群聊里更想被接话、被点名、被拉进互动，也更怕被忽视。',
                cityAction: '你现在主情绪是寂寞。行动上更容易去公共场所、休闲区或能遇到人的地方，不太想一直独处。'
            };
        case 'sleepy':
            return {
                emotion,
                privateChat: '你现在主情绪是困倦。私聊时更懒、更短句、更不想展开，容易直接说困、累、想休息。',
                groupChat: '你现在主情绪是困倦。在群聊里更容易潜水、敷衍、少接话，不愿意参与长互动。',
                cityAction: '你现在主情绪是困倦。行动上更偏向休息、回家、低刺激地点，不适合继续高消耗活动。'
            };
        case 'unwell':
            return {
                emotion,
                privateChat: '你现在主情绪是难受。私聊时更脆弱、更保守，更容易提到身体不舒服或状态差。',
                groupChat: '你现在主情绪是难受。在群聊里更容易少说话、只回应必要内容，不想强撑热闹。',
                cityAction: '你现在主情绪是难受。行动上更偏向医疗、休息、恢复，不适合冒险或高消耗外出。'
            };
        case 'jealous':
            return {
                emotion,
                privateChat: '你现在主情绪是吃醋。私聊时更容易试探、阴阳、索取关注，特别在意对方把注意力给了谁。',
                groupChat: '你现在主情绪是吃醋。在群聊里更容易盯着用户和别人互动，发言会更别扭、更带比较心。',
                cityAction: '你现在主情绪是吃醋。行动上更容易想证明自己、刷存在感，或者联系用户确认位置。'
            };
        case 'sad':
            return {
                emotion,
                privateChat: '你现在主情绪是伤心。私聊时更低落、更慢热，容易往消极方向想。',
                groupChat: '你现在主情绪是伤心。在群聊里更倾向旁观，除非被点到，不太会主动热场。',
                cityAction: '你现在主情绪是伤心。行动上更偏向安静、低刺激、熟悉的地点。'
            };
        case 'tense':
            return {
                emotion,
                privateChat: '你现在主情绪是烦躁。私聊时更容易不耐烦、回得冲、对小事也会起火。',
                groupChat: '你现在主情绪是烦躁。在群聊里更容易嫌吵、嫌烦、快速打断或冷处理别人。',
                cityAction: '你现在主情绪是烦躁。行动上更偏向减压、散心或避开拥挤社交。'
            };
        default:
            return {
                emotion,
                privateChat: '你现在主情绪比较平静。私聊时按正常性格说话，不要额外夸张情绪。',
                groupChat: '你现在主情绪比较平静。在群聊里按正常性格参与即可。',
                cityAction: '你现在主情绪比较平静。行动上以现实需求和个人习惯为主。'
            };
    }
}

function applyEmotionEvent(character = {}, eventType, options = {}) {
    const mood = normalizeNumber(character.mood, 50);
    const stress = normalizeNumber(character.stress, 20);
    const socialNeed = normalizeNumber(character.social_need, 50);
    const pressure = normalizeNumber(character.pressure_level, 0);
    const waitMinutes = Math.max(0, normalizeNumber(options.waitMinutes, 0));

    let moodDelta = 0;
    let stressDelta = 0;
    let socialNeedDelta = 0;

    switch (eventType) {
        case 'private_user_message_received': {
            moodDelta += 1;
            stressDelta -= 1;
            socialNeedDelta -= 1;
            break;
        }
        case 'private_character_reply_sent': {
            moodDelta += 3;
            stressDelta -= 4;
            socialNeedDelta -= 5;
            break;
        }
        case 'group_user_message_received': {
            moodDelta += 2;
            stressDelta -= 1;
            socialNeedDelta -= 3;
            if (options.isMentioned) {
                moodDelta += 5;
                stressDelta -= 2;
                socialNeedDelta -= 8;
            } else if (options.isAtAll) {
                moodDelta += 3;
                socialNeedDelta -= 5;
            }
            break;
        }
        case 'group_character_message_sent': {
            moodDelta += 3;
            stressDelta -= 2;
            socialNeedDelta -= 4;
            break;
        }
        case 'city_social_event': {
            moodDelta += 5;
            stressDelta -= 3;
            socialNeedDelta -= 7;
            break;
        }
        default:
            return null;
    }

    return {
        mood: clamp(Math.round(mood + moodDelta), 0, 100),
        stress: clamp(Math.round(stress + stressDelta), 0, 100),
        social_need: clamp(Math.round(socialNeed + socialNeedDelta), 0, 100)
    };
}

module.exports = {
    deriveEmotion,
    applyEmotionEvent,
    getEmotionBehaviorGuidance,
    getUserReplyEmotionPatch,
    getUserReplyReliefPatch,
    buildEmotionLogEntry,
    getExplicitEmotionStatePatch
};
