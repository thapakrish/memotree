import type { AttachmentPart, ChatEvent, ImageArtifact, ImageFileArtifact, MessageNode } from '../store/types';

interface HydrateImageDataOptions {
    artifacts: Record<string, ImageFileArtifact>;
    readImageUrlAsBase64: (url: string) => Promise<string>;
}

export async function hydrateAttachmentImageData(
    attachment: AttachmentPart,
    options: HydrateImageDataOptions,
): Promise<AttachmentPart> {
    if (attachment.kind !== 'image' || attachment.data) {
        return attachment;
    }

    const artifactUrl = attachment.url ?? (attachment.artifactId ? options.artifacts[attachment.artifactId]?.url : undefined);
    if (!artifactUrl) {
        return attachment;
    }

    return {
        ...attachment,
        data: await options.readImageUrlAsBase64(artifactUrl),
    };
}

export async function hydrateImageArtifactData(
    artifact: ImageArtifact,
    options: HydrateImageDataOptions,
): Promise<ImageArtifact> {
    const artifactId = artifact.artifactId ?? artifact.id;
    const storedArtifact = options.artifacts[artifactId];
    const artifactPath = artifact.artifactPath ?? storedArtifact?.path;
    const url = artifact.url ?? storedArtifact?.url;

    if (artifact.data) {
        return {
            ...artifact,
            artifactId,
            artifactPath,
            url,
        };
    }

    if (storedArtifact?.data) {
        return {
            ...artifact,
            artifactId,
            artifactPath,
            url,
            data: storedArtifact.data,
        };
    }

    if (!url) {
        return {
            ...artifact,
            artifactId,
            artifactPath,
            url,
        };
    }

    try {
        return {
            ...artifact,
            artifactId,
            artifactPath,
            url,
            data: await options.readImageUrlAsBase64(url),
        };
    } catch {
        return {
            ...artifact,
            artifactId,
            artifactPath,
            url,
        };
    }
}

export async function hydrateMessagePathImageData(
    nodes: MessageNode[],
    options: HydrateImageDataOptions,
): Promise<MessageNode[]> {
    return Promise.all(nodes.map(async (node) => {
        const hasAttachments = (node.attachments?.length ?? 0) > 0;
        const hasImageEvents = (node.events ?? []).some((event) => event.kind === 'image_artifact');

        if (!hasAttachments && !hasImageEvents) {
            return node;
        }

        const attachments = hasAttachments
            ? await Promise.all(node.attachments!.map((attachment) => hydrateAttachmentImageData(attachment, options)))
            : node.attachments;
        const events = hasImageEvents
            ? await Promise.all((node.events ?? []).map(async (event): Promise<ChatEvent> => {
                if (event.kind !== 'image_artifact') {
                    return event;
                }

                return {
                    ...event,
                    artifact: await hydrateImageArtifactData(event.artifact, options),
                };
            }))
            : node.events;

        return { ...node, attachments, events };
    }));
}
