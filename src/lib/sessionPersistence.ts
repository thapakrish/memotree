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
