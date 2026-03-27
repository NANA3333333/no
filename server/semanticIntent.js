let pipeline = null;
let embeddingDisabled = false;
const LOCAL_EMBEDDING_MODEL = process.env.LOCAL_EMBEDDING_MODEL || 'Xenova/bge-m3';

async function getExtractor() {
    if (embeddingDisabled) return null;
    if (!pipeline) {
        try {
            const transformers = await import('@xenova/transformers');
            pipeline = await transformers.pipeline('feature-extraction', LOCAL_EMBEDDING_MODEL);
        } catch (e) {
            console.error('[SemanticIntent] Xenova/ONNX initialization failed. Disabling semantic intent detection. Error:', e.message);
            embeddingDisabled = true;
            return null;
        }
    }
    return pipeline;
}

async function getEmbedding(text) {
    const extractor = await getExtractor();
    if (!extractor) return null;
    const output = await extractor(String(text || ''), { pooling: 'mean', normalize: true });
    return Array.from(output.data || []);
}

function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i += 1) {
        const av = Number(a[i]) || 0;
        const bv = Number(b[i]) || 0;
        dot += av * bv;
        magA += av * av;
        magB += bv * bv;
    }
    if (magA <= 0 || magB <= 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

const prototypeCache = new Map();

async function getPrototypeEmbedding(text) {
    if (prototypeCache.has(text)) return prototypeCache.get(text);
    const embedding = await getEmbedding(text);
    prototypeCache.set(text, embedding);
    return embedding;
}

async function maxSimilarity(text, prototypes) {
    const queryEmbedding = await getEmbedding(text);
    if (!queryEmbedding) return 0;

    let best = 0;
    for (const sample of prototypes) {
        const sampleEmbedding = await getPrototypeEmbedding(sample);
        const score = cosineSimilarity(queryEmbedding, sampleEmbedding);
        if (score > best) best = score;
    }
    return best;
}

async function classifyCityIntentSemantic(text) {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return {
            decision: 'no',
            cityScore: 0,
            nonCityScore: 0
        };
    }

    const cityScore = await maxSimilarity(normalized, CITY_PROTOTYPES);
    const nonCityScore = await maxSimilarity(normalized, NON_CITY_PROTOTYPES);
    const margin = cityScore - nonCityScore;

    if (cityScore >= 0.52 && margin >= 0.08) {
        return { decision: 'yes', cityScore, nonCityScore, margin };
    }

    if (cityScore <= 0.36 || cityScore < nonCityScore) {
        return { decision: 'no', cityScore, nonCityScore, margin };
    }

    return { decision: 'ambiguous', cityScore, nonCityScore, margin };
}

const CITY_PROTOTYPES = [
    '你今天在商业街做了什么',
    '你最近去了哪里，吃了什么，花了多少钱',
    '你今天有没有出门，有没有去工厂餐馆便利店',
    '你最近的活动记录是什么，去了哪些地方',
    '你今天在外面过得怎么样，有什么真实经历',
    '你最近有没有打工、吃饭、逛街、去公园或学校'
];

const NON_CITY_PROTOTYPES = [
    '哄哄你，抱抱你，别生气',
    '你是不是吃醋了，别委屈了',
    '我喜欢你，你别多想',
    '你今天想让我怎么安慰你',
    '你胃还难受吗，你现在还饿吗',
    '你现在心情怎么样，还想继续睡吗'
];

async function didUserAskAboutCitySemantic(text) {
    const normalized = String(text || '').trim();
    if (!normalized) return false;

    const explicitCityRegex = /(商业街|活动记录|打工|工厂|餐馆|便利店|公园|学校|街道|今天去哪了|去哪了|出门|上班|下班|工作地点|逛街)/;
    if (explicitCityRegex.test(normalized)) return true;

    const result = await classifyCityIntentSemantic(normalized);
    return result.decision === 'yes';
}

module.exports = {
    didUserAskAboutCitySemantic,
    classifyCityIntentSemantic
};
