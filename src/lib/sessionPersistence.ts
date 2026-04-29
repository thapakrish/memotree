import { openDB } from 'idb';
import type { AttachmentPart, ChatEvent, ConversationGraph, ImageArtifact, ImageFileArtifact, MessageNode } from '../store/types';
import { deleteImageArtifactFiles, readImageUrlAsBase64 } from './artifactStorage';

const VALID_SESSION_INTENTS = new Set(['ask', 'image_generate', 'image_edit', 'style_fit', 'variants']);

const DB_NAME = 'memotree';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const META_STORE = 'meta';
const LAST_SESSION_KEY = 'last-session-id';

export interface PersistedSession {
    id: string;
    createdAt: string;
    updatedAt: string;
    title: string;
    graph: Omit<ConversationGraph, 'apiKey'>;
}

export interface DeleteSessionResult {
    artifactCleanupError?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isValidNodeRecord(value: unknown): boolean {
    if (!isObject(value)) {
        return false;
    }

    return Object.values(value).every((node) =>
        isObject(node) &&
        typeof node.id === 'string' &&
        typeof node.role === 'string' &&
        typeof node.content === 'string' &&
        Array.isArray(node.memoryPatches) &&
        typeof node.timestamp === 'string' &&
        (node.parentId === null || typeof node.parentId === 'string'),
    );
}

function collectSessionArtifactIds(session: PersistedSession): string[] {
    const artifactIds = new Set(Object.keys(session.graph.artifacts ?? {}));

    for (const node of Object.values(session.graph.nodes)) {
        for (const attachment of node.attachments ?? []) {
            if (attachment.kind === 'image' && attachment.artifactId) {
                artifactIds.add(attachment.artifactId);
            }
        }

        for (const event of node.events ?? []) {
            if (event.kind === 'image_artifact') {
                artifactIds.add(event.artifact.artifactId ?? event.artifact.id);
            }
        }
    }

    return [...artifactIds];
}

async function readArtifactData(url: string, label: string): Promise<string> {
    try {
        return await readImageUrlAsBase64(url);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        throw new Error(`Unable to embed image artifact "${label}" in the exported session: ${message}`);
    }
}

async function resolveImageData(
    image: Pick<ImageFileArtifact | ImageArtifact | AttachmentPart, 'data' | 'url'>,
    artifacts: Record<string, ImageFileArtifact>,
    dataByArtifactId: Map<string, string>,
    artifactId?: string,
    label = artifactId ?? 'image',
): Promise<string | undefined> {
    if (artifactId && dataByArtifactId.has(artifactId)) {
        return dataByArtifactId.get(artifactId);
    }

    const storedArtifact = artifactId ? artifacts[artifactId] : undefined;
    const data = image.data ?? storedArtifact?.data;
    if (data) {
        if (artifactId) {
            dataByArtifactId.set(artifactId, data);
        }
        return data;
    }

    const url = image.url ?? storedArtifact?.url;
    if (!url) {
        return undefined;
    }

    const fetchedData = await readArtifactData(url, label);
    if (artifactId) {
        dataByArtifactId.set(artifactId, fetchedData);
    }
    return fetchedData;
}

async function hydrateAttachmentForExport(
    attachment: AttachmentPart,
    artifacts: Record<string, ImageFileArtifact>,
    dataByArtifactId: Map<string, string>,
): Promise<AttachmentPart> {
    if (attachment.kind !== 'image' || attachment.data) {
        return attachment;
    }

    const data = await resolveImageData(
        attachment,
        artifacts,
        dataByArtifactId,
        attachment.artifactId,
        attachment.name ?? attachment.artifactId ?? attachment.id,
    );
    if (!data) {
        throw new Error(`Image attachment "${attachment.name ?? attachment.artifactId ?? attachment.id}" is missing inline data and a readable file URL.`);
    }

    return { ...attachment, data };
}

async function hydrateEventForExport(
    event: ChatEvent,
    artifacts: Record<string, ImageFileArtifact>,
    dataByArtifactId: Map<string, string>,
): Promise<ChatEvent> {
    if (event.kind !== 'image_artifact' || event.artifact.data) {
        return event;
    }

    const artifactId = event.artifact.artifactId ?? event.artifact.id;
    const data = await resolveImageData(
        event.artifact,
        artifacts,
        dataByArtifactId,
        artifactId,
        event.artifact.label ?? artifactId,
    );

    if (!data) {
        throw new Error(`Image artifact "${event.artifact.label ?? artifactId}" is missing inline data and a readable file URL.`);
    }

    return {
        ...event,
        artifact: {
            ...event.artifact,
            data,
        },
    };
}

async function hydrateNodeForExport(
    node: MessageNode,
    artifacts: Record<string, ImageFileArtifact>,
    dataByArtifactId: Map<string, string>,
): Promise<MessageNode> {
    const attachments = node.attachments
        ? await Promise.all(node.attachments.map((attachment) =>
            hydrateAttachmentForExport(attachment, artifacts, dataByArtifactId),
        ))
        : node.attachments;
    const events = node.events
        ? await Promise.all(node.events.map((event) =>
            hydrateEventForExport(event, artifacts, dataByArtifactId),
        ))
        : node.events;

    return { ...node, attachments, events };
}

async function buildPortableSession(session: PersistedSession): Promise<PersistedSession> {
    const graphArtifacts = session.graph.artifacts ?? {};
    const dataByArtifactId = new Map<string, string>();
    const artifacts = Object.fromEntries(
        await Promise.all(Object.entries(graphArtifacts).map(async ([artifactId, artifact]) => {
            const data = await resolveImageData(
                artifact,
                graphArtifacts,
                dataByArtifactId,
                artifactId,
                artifact.name ?? artifactId,
            );

            if (!data) {
                throw new Error(`Image artifact "${artifact.name ?? artifactId}" is missing inline data and a readable file URL.`);
            }

            return [artifactId, { ...artifact, data }];
        })),
    ) as Record<string, ImageFileArtifact>;

    const nodes = Object.fromEntries(
        await Promise.all(Object.entries(session.graph.nodes).map(async ([nodeId, node]) => [
            nodeId,
            await hydrateNodeForExport(node, artifacts, dataByArtifactId),
        ])),
    );

    return {
        ...session,
        graph: {
            ...session.graph,
            artifacts,
            nodes,
        },
    };
}

export function validatePersistedSession(data: unknown): PersistedSession {
    if (!isObject(data)) {
        throw new Error('Invalid MemoTree session file.');
    }

    const { id, createdAt, updatedAt, title, graph } = data;
    if (
        typeof id !== 'string' ||
        typeof createdAt !== 'string' ||
        typeof updatedAt !== 'string' ||
        typeof title !== 'string' ||
        !isObject(graph)
    ) {
        throw new Error('Invalid MemoTree session file.');
    }

    if (!isObject(graph.nodes) || !isObject(graph.groups) || !isObject(graph.uiPositions)) {
        throw new Error('Session graph is missing required object stores.');
    }

    if (!isValidNodeRecord(graph.nodes)) {
        throw new Error('Session graph contains invalid nodes.');
    }

    if ('artifacts' in graph && !isObject(graph.artifacts)) {
        throw new Error('Session artifacts must be an object map.');
    }

    if ('compactions' in graph && !isObject(graph.compactions)) {
        throw new Error('Session compactions must be an object map.');
    }

    if ('rootId' in graph && graph.rootId !== null && typeof graph.rootId !== 'string') {
        throw new Error('Session rootId must be a string or null.');
    }

    if ('activeNodeId' in graph && graph.activeNodeId !== null && typeof graph.activeNodeId !== 'string') {
        throw new Error('Session activeNodeId must be a string or null.');
    }

    if ('sessionTitle' in graph && graph.sessionTitle !== undefined && typeof graph.sessionTitle !== 'string') {
        throw new Error('Session title must be a string when provided.');
    }

    if ('sessionIntent' in graph && graph.sessionIntent !== undefined && !VALID_SESSION_INTENTS.has(String(graph.sessionIntent))) {
        throw new Error('Session intent is invalid.');
    }

    if ('providerId' in graph && graph.providerId !== 'gemini') {
        throw new Error(`Unsupported provider in session file: ${String(graph.providerId)}`);
    }

    return data as unknown as PersistedSession;
}

async function getDb() {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
                db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
            }

            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE);
            }
        },
    });
}

export async function saveSession(session: PersistedSession) {
    const db = await getDb();
    await db.put(SESSIONS_STORE, session);
    await db.put(META_STORE, session.id, LAST_SESSION_KEY);
}

export async function renameSessionTitle(sessionId: string, title: string) {
    const db = await getDb();
    const session = (await db.get(SESSIONS_STORE, sessionId)) as PersistedSession | undefined;
    if (!session) {
        throw new Error('Session not found.');
    }

    const nextTitle = title.trim();
    const resolvedTitle = nextTitle || session.title;
    await db.put(SESSIONS_STORE, {
        ...session,
        title: resolvedTitle,
        updatedAt: new Date().toISOString(),
        graph: {
            ...session.graph,
            sessionTitle: resolvedTitle,
        },
    });
}

export async function markLastSession(sessionId: string) {
    const db = await getDb();
    await db.put(META_STORE, sessionId, LAST_SESSION_KEY);
}

export async function loadSession(sessionId: string) {
    const db = await getDb();
    return (await db.get(SESSIONS_STORE, sessionId)) as PersistedSession | undefined;
}

export async function loadLastSession() {
    const db = await getDb();
    const lastSessionId = await db.get<string>(META_STORE, LAST_SESSION_KEY);
    if (!lastSessionId) {
        return null;
    }

    return loadSession(lastSessionId);
}

export async function listSessions() {
    const db = await getDb();
    const sessions = (await db.getAll(SESSIONS_STORE)) as PersistedSession[];
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteSession(sessionId: string): Promise<DeleteSessionResult> {
    const db = await getDb();
    const session = (await db.get(SESSIONS_STORE, sessionId)) as PersistedSession | undefined;
    const artifactIds = session ? collectSessionArtifactIds(session) : [];
    await db.delete(SESSIONS_STORE, sessionId);

    const lastSessionId = await db.get<string>(META_STORE, LAST_SESSION_KEY);
    if (lastSessionId === sessionId) {
        const remainingSessions = (await db.getAll(SESSIONS_STORE)) as PersistedSession[];
        const nextLastSession = remainingSessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        if (nextLastSession) {
            await db.put(META_STORE, nextLastSession.id, LAST_SESSION_KEY);
        } else {
            await db.delete(META_STORE, LAST_SESSION_KEY);
        }
    }

    try {
        await deleteImageArtifactFiles(artifactIds);
        return {};
    } catch (error) {
        console.warn('Image artifact cleanup failed:', error);
        return {
            artifactCleanupError: error instanceof Error ? error.message : 'Image artifact cleanup failed.',
        };
    }
}

export async function exportSessionToFile(session: PersistedSession): Promise<void> {
    const portableSession = await buildPortableSession(session);
    const json = JSON.stringify(portableSession, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = session.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
    a.href = url;
    a.download = `memotree-${safeName}-${session.id.slice(0, 8)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function importSessionFromJson(file: File): Promise<PersistedSession> {
    const text = await file.text();
    const session = validatePersistedSession(JSON.parse(text) as unknown);
    // Assign a fresh ID to avoid collisions with existing sessions
    const imported: PersistedSession = {
        ...session,
        id: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
        title: `${session.title} (imported)`,
    };

    await saveSession(imported);
    return imported;
}

export function deriveSessionTitle(graph: Omit<ConversationGraph, 'apiKey'>): string {
    const nodes = Object.values(graph.nodes);
    const firstUserNode = nodes.find((node) => node.role === 'user');
    if (!firstUserNode?.content) {
        return 'Untitled Session';
    }

    return firstUserNode.content.length > 60
        ? `${firstUserNode.content.slice(0, 60)}...`
        : firstUserNode.content;
}
