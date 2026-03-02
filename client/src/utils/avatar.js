export const resolveAvatarUrl = (url, apiUrl) => {
    if (!url) return '';
    const cleanApiUrl = apiUrl.replace(/\/api$/, '');

    // Coerce any legacy absolute uploaded paths (e.g. http://...:8001/uploads/...) into relative
    if (url.includes('/uploads/')) {
        const pathPart = url.substring(url.indexOf('/uploads/'));
        return cleanApiUrl + pathPart;
    }

    return url;
};
