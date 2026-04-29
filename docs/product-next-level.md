# Product And Canvas Next Level Plan

Last reviewed: 2026-04-29

This review combines code inspection, local Playwright visual inspection, and current public competitor references. The short version: MemoTree has a strong technical wedge in branch-aware context and image lineage, but the default canvas still behaves like an artifact gallery plus timeline. To compete with Gemini Canvas, chat workspaces, and Adobe creative products, the canvas needs to become the primary work surface: spatial, editable, lineage-aware, and harmonized with chat instead of sitting beside it.

## Current Baseline

Verified locally:
- `npm run test`: 4 files, 13 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run test:visual`: 2 Playwright visual tests passed.

Visual artifacts:
- `scratchpad/visual-inspection/first-run-desktop-spec.png`
- `scratchpad/visual-inspection/first-run-mobile-spec.png`
- `scratchpad/visual-inspection/seeded-workspace-desktop.png`
- `scratchpad/visual-inspection/seeded-timeline-desktop.png`
- `scratchpad/visual-inspection/seeded-canvas-mobile.png`

## Competitor Signals

Gemini Canvas, per Google's March 18, 2025 launch post, is an interactive Gemini space for documents and code where edits and previews update in real time, users can adjust tone/length/formatting on selected text, export documents to Google Docs, and generate/preview web app prototypes inside the workspace.

Adobe Firefly Boards, per Adobe's 2025-2026 public materials, emphasizes an infinite canvas for inspiration, generation, remixing, variations, multi-model exploration, real-time collaboration, Adobe Stock/assets, video/image workflows, and client-ready presentation/export. Photoshop's current Generative Fill docs, last updated April 28, 2026, highlight non-destructive selected-region editing, model picker control, prompt or promptless fill, and variations in the Properties panel.

Sources:
- https://blog.google/products-and-platforms/products/gemini/gemini-collaboration-features/
- https://blog.adobe.com/en/publish/2025/09/24/firefly-boards-launches-globally-now-with-runway-aleph-moonvalley-marey-models-new-powerful-ideation-features-flexible-offers
- https://blog.adobe.com/en/publish/2025/10/28/explore-new-adobe-firefly-your-all-in-one-home-ai-powered-creativity
- https://helpx.adobe.com/photoshop/desktop/create-open-import-images/create-images/edit-images-with-generative-fill.html
- https://www.adobe.com/products/firefly/features/vision-board.html

## Visual Findings

These findings were captured before the first implementation slice in this branch. The blank desktop canvas, mobile toolbar density, and active-source handoff are now partially addressed, but the deeper product direction still stands.

**First Run**
- Desktop showed a blank right canvas while the onboarding card was confined to the chat rail. The canvas now has a starter board.
- The chat composer is visible before the user has created a session, and it covers part of the onboarding grid on desktop and mobile.
- The canvas starter now introduces the board concept before the user creates content.

**Seeded Image Workspace**
- The asset cards are clean and usable, and lineage metadata is visible enough to understand generated outputs.
- The workspace is a responsive card grid, not a freeform or infinite canvas. It does not yet support spatial grouping, annotations, arrange, zoom, direct manipulation, or presentable moodboard layout.
- Active source state is confusing: the active branch can contain a source image while the composer still warns that a source is required for the next draft.
- Actions are repeated on every card, which is practical, but visually heavy. Selection plus contextual toolbar would scale better.

**Seeded Timeline**
- The branch graph is the most differentiated part of the product. It clearly shows variants and active path lineage.
- Timeline nodes have useful embedded thumbnails and model labels.
- Mobile timeline previously opened with the active node partially offscreen and the header wrapped into a crowded multi-row toolbar. The active node is now centered after tab activation, and mobile toolbar labels collapse to icons.

**Interaction And Accessibility Audit**
- Several controls rely on `title` rather than visible accessible names or `aria-label`; examples include icon-only preview/selection buttons in `ImageCanvas`.
- Many inputs use `outline-none` without consistent `focus-visible` replacement.
- Loading and truncation copy uses `...` instead of `…` in multiple code paths.
- Images are inside stable boxes, but `img` tags do not set intrinsic `width`/`height`.
- The Playwright seed had to wait for autosave because the initial empty session can overwrite external IndexedDB writes. That is fine for product runtime, but it matters for tooling.

Guideline reference used for UI audit:
- https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

## Product North Star

MemoTree should be a **spatial AI workbench for branching thought and creative iteration**.

The product should not ask users to choose between "chat" and "canvas." Chat should be the command stream, while the canvas is the persistent object space where ideas, images, code artifacts, decisions, branches, and memory states live.

## Differentiated Wedge

MemoTree can beat generic canvases by making every object branch-aware:
- Every output knows its prompt path, source assets, model, memory state, and sibling alternatives.
- Users can fork from any object without losing history.
- The model sees only the selected timeline, not the whole messy board.
- Memory changes can be replayed per branch, giving "what-if" work real isolation.

That is stronger than a basic chat canvas or moodboard if it becomes visible and direct-manipulable.

## Priority Roadmap

### Implemented Slice

- Added a canvas-side first-run starter board with branch-like spatial preview.
- Added a canvas-to-chat focus bridge so starter actions select the session intent and return mobile users to the composer.
- Reused active branch source images for source-required image workflows when no explicit draft source is selected.
- Collapsed mobile timeline toolbar labels and centered the active node after canvas tab activation.
- Added repeatable Playwright visual smoke coverage for first-run and seeded canvas states.

### 1. Make The First Screen A Real Canvas

Replace the blank desktop canvas with an empty-state canvas board:
- Centered starter nodes for Ask, Generate Image, Edit Image, Fit Style, Explore Variants.
- A faint root checkpoint and branch preview to teach the mental model.
- Drop zone for images and transcripts.
- Recent sessions as small objects, not a modal-only path.
- The composer should collapse to one prompt row until the user chooses a task.

Success metric: a new user can understand the product promise from the first viewport without reading docs.

### 2. Merge Image Workspace And Timeline Into One Spatial Board

Move from "Images grid" and "Timeline graph" tabs to one infinite board with layers:
- Artifact cards, prompt nodes, branch edges, notes, groups, and source pins on one surface.
- Toggle overlays for lineage, active context path, memory changes, and model metadata.
- Allow arrange, align, cluster, zoom, lasso, and presentation frames.
- Keep a quick "Timeline" mode, but treat it as a view preset, not a separate product.

Success metric: users can build a moodboard/storyboard/reasoning map without leaving the canvas.

### 3. Add Direct Manipulation For Creative Work

Canvas objects need Adobe-like affordances:
- Select an image region and ask for an edit.
- Generate variations from selected object(s).
- Remix multiple selected images.
- Mark images as source/reference/mask/style through a contextual toolbar.
- Preserve non-destructive edit stacks and variants as children.

Success metric: image work feels object-first instead of composer-first.

### 4. Harmonize Chat And Canvas State

The composer should reflect the selected canvas object:
- Selecting an image should set the draft role visibly: source, reference, style, mask.
- Selecting a node should show the exact active context capsule.
- Selecting multiple nodes should expose Compare, Merge, Summarize, Export, and Group.
- Source warnings should consider active branch lineage and selected canvas state, not only draft attachments.

Success metric: there is one visible selection model across chat, canvas, and context.

### 5. Make Branching Legible

Branching is the signature feature, so make it obvious:
- Replace "Branch here" copy with a clearer fork affordance tied to object/node selection.
- Show sibling alternatives as a compact variant strip.
- Give every branch a generated title and optional user label.
- Add breadcrumbs: Root -> Concept Direction -> Editorial Fit -> Variant A.
- Add branch health metadata: token size, memory changes, source assets, model chain.

Success metric: users can navigate variants without reading node IDs.

### 6. Production-Grade Collaboration And Export

To compete with Adobe and Google workspaces:
- Share read-only and editable boards.
- Export board frames to PNG/PDF/Markdown/JSON.
- Export selected branch to Google Docs-style document or web prototype bundle.
- Add comments/annotations on canvas objects.
- Add client presentation mode with hidden prompts if needed.

Success metric: users can present and hand off work from MemoTree directly.

### 7. Scale And Performance

The current object-map architecture is simple and good for MVP. Before larger boards:
- Virtualize large chat histories.
- Add canvas node virtualization or culling for >100 nodes.
- Persist layout/view state per board view.
- Add artifact storage quotas and cleanup UI.
- Add background thumbnail generation.

Success metric: 200 artifacts and 100 nodes remain interactive on laptop and mobile.

## Near-Term Implementation Slices

1. **Canvas Empty State**
   - Files: `src/App.tsx`, `src/components/ImageCanvas.tsx`, maybe new `CanvasEmptyState.tsx`.
   - Replace blank right pane with a real board starter.
   - Add Playwright screenshot assertion for empty canvas text and starter actions.

2. **Unified Selection Toolbar**
   - Files: `src/components/ImageCanvas.tsx`, `src/components/ChatView.tsx`, `src/store/useGraphStore.ts`.
   - Move repeated card actions into a top/bottom contextual toolbar when artifacts are selected.
   - Keep per-card preview/select affordances.

3. **Source State Fix**
   - Files: `src/components/ChatView.tsx`, `src/components/ImageCanvas.tsx`.
   - Compute source candidates from active branch image workflow and canvas selection.
   - Change "Source image required" to either "Using active source" or "Choose Source Image".

4. **Mobile Canvas Fit**
   - Files: `src/components/ImageCanvas.tsx`.
   - Use active-node-aware viewport fitting after graph layout.
   - Collapse mobile canvas tools into segmented view + overflow menu.

5. **Accessibility Pass**
   - Files: `src/components/ChatView.tsx`, `src/components/ImageCanvas.tsx`, modals.
   - Add `aria-label` for icon-only buttons, replace `outline-none` with focus-visible styles, add `aria-live` for statuses, replace `...` with `…`.

6. **Board Frames And Notes**
   - Files: new store types plus `ImageCanvas`.
   - Add lightweight note/text objects and presentation frames before deep image editing. This quickly makes the canvas feel usable for planning and client review.

## Strategic Product Bets

**Bet 1: Branch-aware creative lineage**
Make lineage visible everywhere. Adobe has asset generation breadth; MemoTree can own "why this output exists and what branch it belongs to."

**Bet 2: Context as a selectable object**
Let users see and manipulate what the model will know. This is stronger than chat history and should be a first-class canvas overlay.

**Bet 3: Model-agnostic workbench**
Keep Gemini first for MVP, but design UI labels around capabilities, not provider names. The provider picker should eventually support OpenAI, Anthropic, Gemini, local models, and image/video providers.

**Bet 4: Reviewable AI work**
Add diffable branches, approval checkpoints, and shareable views. For professional users, trust comes from being able to audit the path, not just seeing the final output.
