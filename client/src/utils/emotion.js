export function deriveEmotion(contact = {}) {
    if (contact.emotion_state && contact.emotion_label && contact.emotion_emoji) {
        return {
            key: contact.emotion_state,
            label: contact.emotion_label,
            emoji: contact.emotion_emoji,
            color: contact.emotion_color || '#1e88e5'
        };
    }

    const mood = Number(contact.mood ?? 50);
    const stress = Number(contact.stress ?? 20);
    const sleepDebt = Number(contact.sleep_debt ?? 0);
    const health = Number(contact.health ?? 100);
    const socialNeed = Number(contact.social_need ?? 50);
    const stomachLoad = Number(contact.stomach_load ?? 0);
    const pressure = Number(contact.pressure_level ?? 0);
    const jealousy = Number(contact.jealousy_level ?? 0);
    const replyPending = Number(contact.city_reply_pending ?? 0) > 0;
    const ignoreStreak = Number(contact.city_ignore_streak ?? 0);
    const jealousyTarget = String(contact.jealousy_target || '').trim();

    if (health <= 35 || stomachLoad >= 82) return { key: 'unwell', label: '难受', emoji: '🤒', color: '#8e24aa' };
    if (sleepDebt >= 82) return { key: 'sleepy', label: '困倦', emoji: '😪', color: '#3949ab' };
    if (pressure >= 3 || (replyPending && ignoreStreak >= 2)) return { key: 'hurt', label: '委屈', emoji: '🥺', color: '#fb8c00' };
    if (stress >= 78 && mood <= 42) return { key: 'angry', label: '生气', emoji: '😤', color: '#e53935' };
    if (jealousy >= 7 && jealousyTarget) return { key: 'jealous', label: '吃醋', emoji: '😾', color: '#d81b60' };
    if (socialNeed >= 78 && mood <= 48) return { key: 'lonely', label: '寂寞', emoji: '🫥', color: '#00897b' };
    if (mood >= 76 && stress <= 35) return { key: 'happy', label: '开心', emoji: '😄', color: '#43a047' };
    if (mood <= 30) return { key: 'sad', label: '伤心', emoji: '😞', color: '#546e7a' };
    if (stress >= 62) return { key: 'tense', label: '烦躁', emoji: '😣', color: '#f4511e' };
    return { key: 'calm', label: '平静', emoji: '🙂', color: '#1e88e5' };
}
