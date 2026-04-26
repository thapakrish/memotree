import type { AttachmentPart, ImageArtifact, ImageFileArtifact, ImageArtifactStorageUpdate } from '../store/types';

interface SaveImageArtifactResponse {
    artifactId: string;
    path: string;
    url: string;
    mimeType: ImageFileArtifact['mimeType'];
    sizeBytes: number;
}

export function getImageSource(image: Pick<ImageFileArtifact | ImageArtifact | AttachmentPart, 'mimeType' | 'data' | 'url'>): string {
    if (image.url) {
        return image.url;
    }
    if (image.data) {
        return `data:${image.mimeType};base64,${image.data}`;
    }
    return '';
}

export async function saveImageArtifactFile(
    sessionId: string,
    artifact: ImageFileArtifact,
): Promise<ImageArtifactStorageUpdate | null> {
    if (!artifact.data) {
        return null;
    }

    const response = await fetch('/api/artifacts/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId,
            artifactId: artifact.id,
            fileName: artifact.name,
            mimeType: artifact.mimeType,
            data: artifact.data,
        }),
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to save image artifact.');
    }

    const saved = await response.json() as SaveImageArtifactResponse;
    return {
        artifactId: saved.artifactId,
        path: saved.path,
        url: saved.url,
        sizeBytes: saved.sizeBytes,
    };
}

export async function readImageUrlAsBase64(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Unable to load image artifact from filesystem storage.');
    }

    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Unable to read image artifact bytes.'));
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const payload = result.split(',', 2)[1];
            if (!payload) {
                reject(new Error('Image artifact data URL was empty.'));
                return;
            }
            resolve(payload);
        };
        reader.readAsDataURL(blob);
    });
}
