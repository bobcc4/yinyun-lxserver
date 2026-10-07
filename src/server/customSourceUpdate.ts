const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|\*\/|#)/
const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g

export function normalizeCustomSourceForUpdateComparison(content: string) {
    return content
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => COMMENT_LINE.test(line) ? line.replace(ISO_TIMESTAMP, '<timestamp>') : line)
        .join('\n')
}

export function isCustomSourceUpdateAvailable(
    currentContent: string,
    remoteContent: string,
    currentVersion: string | number,
    remoteVersion?: string | number,
) {
    const contentChanged = normalizeCustomSourceForUpdateComparison(currentContent)
        !== normalizeCustomSourceForUpdateComparison(remoteContent)
    const versionChanged = remoteVersion !== undefined && String(remoteVersion) !== String(currentVersion)
    return contentChanged || versionChanged
}
