# MemoTree

MemoTree is a local-first branching chat interface for LLM conversations. It keeps each conversation path separate, reconstructs only the active branch for the next model request, and replays branch-local memory patches so alternate timelines do not pollute each other.

## Why It Exists

Linear chat makes it hard to explore alternatives without dragging failed attempts, tangents, and stale assumptions into later prompts. MemoTree treats a conversation as a tree:

- reply from any earlier message to fork a new branch
- click a graph node to check out that exact path
- inspect what context and memory the model will receive
- export or import local session JSON

The product claim is context control, not magic hallucination prevention: MemoTree helps you see and manage what the model saw.

## Local BYOK Setup

MemoTree is distributed as a frontend-only Vite app. Your chat sessions are stored in your browser's IndexedDB, and your API key is used by the local browser session.

```bash
npm install
npm run dev
```

Open the local Vite URL, paste your Gemini API key when prompted, and start a session.

For private local development you can also set `VITE_GEMINI_API_KEY`, but do not use that for a public/static deployment because Vite embeds client env vars into the built JavaScript bundle.

## Commands

- `npm run dev` starts the local frontend.
- `npm run build` runs TypeScript checks and builds `dist/`.
- `npm run lint` runs ESLint.
- `npm run preview` serves the production build locally.

## Current Scope

Included by default:

- branching chat and graph navigation
- local session persistence
- local JSON session import/export
- pasted transcript import
- Markdown rendering
- image attachment input
- branch-aware memory patch replay
- context inspector
- node selection, grouping, and reversible branch pruning

Feature-flagged experiments:

```bash
VITE_ENABLE_GRAPH_ORGANIZATION_TOOLS=true
VITE_ENABLE_ADVANCED_GRAPH_TOOLS=true
VITE_ENABLE_EXPERIMENTAL_IMPORTS=true
VITE_ENABLE_IMPORT_INFERENCE=true
VITE_ENABLE_RICH_FILE_ATTACHMENTS=true
VITE_ENABLE_CONTEXT_COMPACTION=true
VITE_ENABLE_KEYBOARD_POWER_TOOLS=true
VITE_ENABLE_IMPORT_PROVENANCE_WARNINGS=true
```

Shared-link fetching and server-backed import are intentionally excluded from the default frontend-only distribution.

## Privacy Notes

- Do not commit API keys.
- Browser-entered keys are kept in app state for the local session, not written into exported session JSON.
- Conversation data and memory patches are stored locally in IndexedDB unless you export them.
- Static hosting a BYOK frontend means model requests happen from the user's browser.
