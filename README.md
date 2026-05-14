# MemoTree

MemoTree is a local-first branching chat interface for LLM conversations. Instead of treating a conversation as one linear transcript, MemoTree keeps alternate paths visible as a tree, reconstructs only the active branch for the next model request, and keeps branch-local memory separate.

![MemoTree branching conversation map](docs/assets/memotree-branching-demo.png)

## Quick Start

MemoTree is a frontend-only Vite app. There is no backend service to start, no database to provision, and no hosted account required. Sessions are stored in your browser's IndexedDB.

```bash
npm install
npm run dev
```

Open the local Vite URL, paste your Gemini API key when prompted, and start a session:

```text
http://localhost:5173/
```

You can also create a local `.env` from `.env.example`, but do not use `VITE_GEMINI_API_KEY` for a public/static deployment because Vite embeds client env vars into the built JavaScript bundle.

## Why MemoTree

Linear chat makes it hard to explore alternatives without dragging failed attempts, tangents, and stale assumptions into later prompts. MemoTree treats conversation history as a tree:

- reply from any earlier message to fork a new branch
- click a graph node to check out that exact path
- inspect what context and memory the model will receive
- prune or group branches when the map gets busy
- export or import local session JSON

The product claim is context control, not magic hallucination prevention: MemoTree helps you see and manage what the model saw, so stale context from one branch does not silently leak into another.

## Inspiration

MemoTree is inspired in part by Toby Cubitt's Emacs [`undo-tree`](https://elpa.gnu.org/packages/undo-tree.html) package, which makes editing history explicit as a branching tree instead of treating undo and redo as a single linear stack. MemoTree applies that interaction idea to LLM conversations: alternate directions, failed attempts, and exploratory branches stay navigable instead of collapsing into one prompt history.

## Current Features

- branching chat and graph navigation
- local session persistence with IndexedDB
- local JSON session import/export
- pasted transcript import
- Markdown rendering
- image attachment input
- branch-local memory state
- context inspector
- node selection, grouping, and reversible branch pruning

Gemini is the currently wired model provider. Model requests happen directly from your browser using your own API key.

## Development

- `npm run dev` starts the local frontend.
- `npm run build` runs TypeScript checks and builds `dist/`.
- `npm run lint` runs ESLint.
- `npm run preview` serves the production build locally.

Advanced experiments are disabled by default and controlled through `src/config/featureFlags.ts`.

Shared-link fetching and server-backed import are intentionally excluded from this frontend-only distribution. Importing a pasted visible transcript is supported locally.

## Privacy Notes

- Do not commit API keys.
- Browser-entered keys are kept in app state for the local session, not written into exported session JSON.
- Conversation data and memory patches are stored locally in IndexedDB unless you export them.
- Static hosting a bring-your-own-key frontend means model requests happen from the user's browser.

## License

MIT
