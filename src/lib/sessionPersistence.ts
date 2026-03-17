import { openDB } from 'idb';
import type { ConversationGraph } from '../store/types';

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

export async function deleteSession(sessionId: string) {
    const db = await getDb();
    await db.delete(SESSIONS_STORE, sessionId);

    const lastSessionId = await db.get<string>(META_STORE, LAST_SESSION_KEY);
    if (lastSessionId !== sessionId) {
        return;
    }

    const remainingSessions = (await db.getAll(SESSIONS_STORE)) as PersistedSession[];
    const nextLastSession = remainingSessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (nextLastSession) {
        await db.put(META_STORE, nextLastSession.id, LAST_SESSION_KEY);
    } else {
        await db.delete(META_STORE, LAST_SESSION_KEY);
    }
}

export function exportSessionToFile(session: PersistedSession): void {
    const json = JSON.stringify(session, null, 2);
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
