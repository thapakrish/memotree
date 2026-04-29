# MemoTree

MemoTree is a branching chat interface for LLM conversations. Instead of losing alternate lines of thought in one linear thread, it lets you jump to an earlier checkpoint, continue from there, and inspect the result in a graph.

## MVP Scope
Enabled by default:
- branching chat + graph navigation
- session persistence and resume
- markdown rendering
- image attachments
- reasoning/tool trace display
- lightweight context inspector

Hidden behind feature flags:
- merge / compare / grouping
- transcript and shared-link import flows
- PDF / audio attachments
- context compaction
- command palette

## Local Development
```bash
npm install
npm run dev
```

For the shared-import backend:
```bash
npm run dev:api
```

Other useful commands:
- `npm run build` checks TypeScript and builds the app
- `npm run lint` runs ESLint
- `npm run test` runs the Vitest unit suite
- `npm run test:visual` runs the Playwright visual inspection spec against a running dev server
- `npm run preview` serves the production build locally

## Documentation
- [`docs/subsystems.md`](docs/subsystems.md) maps the runtime shell, graph store, chat, canvas, provider, memory, artifact, import, and session subsystems.
- [`docs/product-next-level.md`](docs/product-next-level.md) captures the visual inspection findings, competitor signals, and roadmap for making the canvas a primary work surface.

## Feature Flags
Advanced features are disabled by default for MVP. Re-enable them with Vite env vars:

```bash
VITE_ENABLE_ADVANCED_GRAPH_TOOLS=true
VITE_ENABLE_EXPERIMENTAL_IMPORTS=true
VITE_ENABLE_IMPORT_INFERENCE=true
VITE_ENABLE_SHARED_URL_IMPORT=true
VITE_ENABLE_RICH_FILE_ATTACHMENTS=true
VITE_ENABLE_CONTEXT_COMPACTION=true
VITE_ENABLE_KEYBOARD_POWER_TOOLS=true
VITE_ENABLE_IMPORT_PROVENANCE_WARNINGS=true
```

## Project Structure
- `src/components/` UI for chat, graph, sessions, imports, and modals
- `src/store/` Zustand graph/session state
- `src/lib/` providers, memory reconstruction, import parsing, merge helpers
- `backend/app/` FastAPI shared-link import service

## Notes
- Local API keys belong in `.env`, never in git.
- The current provider implementation is Gemini-first through the provider adapter layer.
- `dist/` is generated output and should not be edited manually.
