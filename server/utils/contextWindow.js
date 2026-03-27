function getAdaptiveTailWindowSize(contextLimit, availableCount) {
    const safeLimit = Math.max(0, Number(contextLimit) || 0);
    const safeAvailable = Math.max(0, Number(availableCount) || 0);
    if (safeAvailable <= 0) return 0;
    return Math.min(safeAvailable, Math.max(3, Math.min(60, Math.ceil(safeLimit * 0.3))));
}

module.exports = {
    getAdaptiveTailWindowSize
};
