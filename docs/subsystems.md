# MemoTree Subsystems

Last reviewed: 2026-04-29

MemoTree is a Vite + React + TypeScript client with a small FastAPI service for shared-link import and disk-backed image artifacts. The product is currently two coupled workspaces: a branch-aware chat surface and an image/graph canvas.

## Runtime Shell

**Purpose:** bootstraps hydration, keyboard navigation, responsive layout, and lazy canvas loading.

**Key files**
- `src/App.tsx`
- `src/config/featureFlags.ts`
- `src/index.css`

**Responsibilities**
- Hydrate the last persisted session before rendering.
- Split desktop into fixed chat rail plus canvas; switch mobile between chat and canvas tabs.
- Route the canvas surface to `ImageCanvas` by default or `GraphView` when `VITE_ENABLE_ADVANCED_GRAPH_TOOLS=true`.
- Own global branch-navigation shortcuts.

**Product notes**
- Desktop first-run now shows a canvas-side starter board instead of a blank surface.
- Mobile has usable chat/canvas tabs; the timeline view recenters the active node after the canvas tab becomes visible.

## Conversation Graph Store

**Purpose:** source of truth for sessions, DAG nodes, image artifacts, context groups, UI positions, import preview state, and persistence status.

**Key files**
- `src/store/types.ts`
- `src/store/useGraphStore.ts`
- `src/store/useGraphStore.test.ts`

**Core model**
- `MessageNode`: chat turn, generated response, imported turn, or merge node.
- `ConversationGraph`: node map, artifact map, groups, saved positions, root/active node, provider/model/session settings.
- `ImageFileArtifact`: canonical record for uploaded/generated images and their lineage.
- `ContextGroup`: user-defined grouping and context inclusion rules.
- `CompactionBlock`: summarized path segment for context reduction.

**Important behavior**
- `getPath(activeNodeId)` performs backward parent traversal to produce the active branch context.
- `addNode` attaches image artifacts from user attachments and assistant image events.
- `markImageArtifactsStored` removes inline image bytes after backend filesystem persistence succeeds.
- Import suggestions can be previewed, applied, and undone without mutating the committed graph until applied.
- Zustand subscription auto-saves hydrated graph snapshots to IndexedDB.

**Risks**
- `getPath` follows only `parentId`, so merge nodes with `parentIds` are represented as a primary path plus merge metadata rather than a full multi-parent traversal.
- Large sessions are stored and rendered as full object maps; there is no viewport virtualization or indexed graph query layer yet.
- Autosave is global and immediate; tests or tools that mutate IndexedDB externally need to wait for the initial autosave to finish.

## Chat Surface

**Purpose:** primary authoring surface for text, image generation, image editing, variants, context inspection, branch copy, and turn-level branching.

**Key file**
- `src/components/ChatView.tsx`

**Responsibilities**
- Render active branch messages from `getPath`.
- Add user turns and stream assistant turns through the provider adapter.
- Handle attachments from file picker, paste, drag/drop, generated artifacts, and canvas selections.
- Manage session intent: `ask`, `image_generate`, `image_edit`, `style_fit`, `variants`.
- Surface model selection, output count, token estimate, status, source-image requirement, and style presets.
- Provide branch actions: branch here, edit and resend, regenerate, rewind, copy branch.

**Product notes**
- The composer is powerful but crowded. It currently mixes task choice, model choice, source-image state, style presets, attachment controls, token estimate, and message input in one bottom tray.
- Source image state is draft-centric: an image used in the active branch can still show "Source image required" until selected for the next draft.

## Canvas Surfaces

**Purpose:** visualizes artifacts and graph structure. Today it has two modes: image workspace and timeline graph.

**Key files**
- `src/components/ImageCanvas.tsx`
- `src/components/GraphView.tsx`
- `src/components/CustomNode.tsx`
- `src/lib/layout.ts`

**Image Workspace**
- Card grid of image artifacts.
- Shows generated assets, lineage metadata, model labels, source badges, and actions: Source, Fit Style, Variants, Reference.
- Uses `canvasSelectedArtifactIds` plus `canvasSelectedArtifactUse` to pass selected images back into chat.

**Timeline**
- React Flow graph of image-bearing turns and text turns.
- Supports active path highlighting, selection mode, path/subtree selection, grouping, pruning, preview, and image selection.

**Advanced Graph View**
- Feature-flagged legacy/general graph view for all message nodes.
- Adds compare, merge, and grouping tools for selected nodes.
- Supports imported path grouping when import inference is enabled.

**Risks**
- The default image workspace is still a grid, not a freeform canvas. It competes more with an asset gallery than with Gemini Canvas or Firefly Boards.
- Mobile active-node framing is improved, but larger graphs still need a dedicated mobile navigation model.
- Several icon-only controls rely on `title` but lack `aria-label`.
- Images do not provide explicit width/height attributes, so layout stability relies on fixed containers instead of intrinsic dimensions.

## Provider And Model Layer

**Purpose:** normalizes model streaming, tool calls, image generation, token estimates, and compaction behind a provider interface.

**Key files**
- `src/lib/providers/types.ts`
- `src/lib/providers/index.ts`
- `src/lib/providers/gemini.ts`
- `src/lib/geminiEngine.ts`
- `src/lib/geminiModels.ts`
- `src/lib/geminiEngine.test.ts`

**Responsibilities**
- Expose `IProvider.stream`, `continueWithToolResults`, `countTokens`, `compactNodes`, and `estimateContext`.
- Map MemoTree message paths into Gemini contents.
- Emit normalized `ChatEvent` records: thoughts, tool calls/results, text, image artifacts.
- Route text-to-image-only requests to Imagen when possible.

**Risks**
- Provider abstraction exists, but only Gemini is implemented.
- Image-specific routing and model naming leak into chat and canvas UI.
- Tool continuation currently assumes memory-like `text_editor` behavior.

## Memory Engine

**Purpose:** implements branch-aware simulated memory through patch replay.

**Key files**
- `src/lib/memoryEngine.ts`
- `src/lib/memoryTool.ts`
- `src/lib/geminiEngine.test.ts`

**Responsibilities**
- Validate EASE-compatible memory JSON.
- Convert text-editor memory mutations into diff-match-patch patches.
- Replay memory patches along the active branch path.
- Keep branch memory isolated by storing patches on the nodes where they occurred.

**Risks**
- Memory is represented as one JSON text buffer. It is easy to reason about, but not yet scalable to multi-file memory or collaborative conflict handling.
- Patch replay assumes conflict-free branch-linear history.

## Artifact Storage

**Purpose:** keeps image bytes usable after generation/upload without bloating every persisted session forever.

**Key files**
- `src/lib/artifactStorage.ts`
- `src/lib/artifactFiles.ts`
- `src/lib/hydrateImageData.ts`
- `backend/app/artifacts.py`
- `src/lib/artifactStorage.test.ts`
- `src/lib/hydrateImageData.test.ts`

**Responsibilities**
- Store generated/uploaded images as `ImageFileArtifact` records.
- Save image bytes to FastAPI filesystem endpoints.
- Hydrate images back into model requests/exported sessions when needed.
- Delete artifact directories when sessions are removed.

**Risks**
- Backend artifact root defaults to `artifacts/`; cleanup and quota policy are not productized.
- The client tolerates missing artifact files for history display, but send/export flows can still fail if image bytes are unavailable.

## Import Pipeline

**Purpose:** brings external shared chats and pasted transcripts into MemoTree as linear or inferred graph sessions.

**Key files**
- `src/components/ImportChatModal.tsx`
- `src/components/ImportSuggestionsModal.tsx`
- `src/lib/import/*`
- `backend/app/main.py`
- `backend/app/importers.py`
- `backend/app/adapters.py`
- `backend/app/detectors.py`
- `backend/app/browser_import.py`

**Responsibilities**
- Parse markdown/plain transcripts locally.
- Fetch public ChatGPT, Gemini, and Claude shared URLs through FastAPI.
- Normalize turns, flag hidden-context provenance risk, and infer deterministic structure suggestions.
- Preview/apply accepted suggestions to convert linear imports into branches/resume links.

**Risks**
- Shared-link parsing is provider-page-shape dependent.
- Hidden account/project/retrieval context cannot be reconstructed from visible shared transcripts.
- Import features are disabled by default behind flags.

## Session Management

**Purpose:** local persistence, export/import, rename, delete, and last-session restore.

**Key files**
- `src/components/SessionsModal.tsx`
- `src/lib/sessionPersistence.ts`

**Responsibilities**
- Store sessions in IndexedDB.
- Track last session in a `meta` store.
- Export portable session JSON with embedded image data.
- Import session JSON with a fresh session ID.
- Delete sessions and request backend artifact cleanup.

**Risks**
- IndexedDB is local-only and not collaborative.
- Session validation is intentionally narrow and only accepts Gemini provider IDs.

## Quality Surface

**Current automated checks**
- `npm run test`: Vitest unit tests.
- `npm run lint`: ESLint.
- `npm run build`: TypeScript project checks plus Vite build.
- `npm run test:visual`: Playwright visual smoke inspection, requires `npm run dev` first.

**Visual inspection artifacts**
- `scratchpad/visual-inspection/first-run-desktop-spec.png`
- `scratchpad/visual-inspection/first-run-mobile-spec.png`
- `scratchpad/visual-inspection/seeded-workspace-desktop.png`
- `scratchpad/visual-inspection/seeded-timeline-desktop.png`
- `scratchpad/visual-inspection/seeded-canvas-mobile.png`

**Recommended next tests**
- E2E for first-run onboarding and blank-canvas prevention.
- E2E for image source selection from canvas to composer.
- E2E for mobile graph fit/active-node centering.
- Unit tests for source artifact derivation from active branch workflow.
- Performance test with 100+ nodes and 200+ artifacts.
