import type { ImageArtifactMimeType } from '../store/types';

const IMAGE_EXTENSION_BY_MIME: Record<ImageArtifactMimeType, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

function sanitizeFileStem(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

export function getImageFileExtension(mimeType: ImageArtifactMimeType): string {
    return IMAGE_EXTENSION_BY_MIME[mimeType] ?? 'png';
}

export function buildImageArtifactFileName(
    artifactId: string,
    mimeType: ImageArtifactMimeType,
    labelOrName?: string,
): string {
    const extension = getImageFileExtension(mimeType);
    const rawStem = labelOrName?.replace(/\.[a-z0-9]+$/i, '') ?? `image-${artifactId.slice(0, 8)}`;
    const stem = sanitizeFileStem(rawStem) || `image-${artifactId.slice(0, 8)}`;
    return `${stem}.${extension}`;
}

export function buildImageArtifactPath(artifactId: string, fileName: string): string {
    return `/artifacts/images/${artifactId}/${fileName}`;
}
