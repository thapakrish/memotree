import { test, expect } from '@playwright/test';

const appUrl = 'http://127.0.0.1:5173/';

function svgData(label: string, colors: [string, string]) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="${colors[0]}" offset="0"/>
          <stop stop-color="${colors[1]}" offset="1"/>
        </linearGradient>
      </defs>
      <rect width="640" height="480" fill="url(#g)"/>
      <circle cx="460" cy="150" r="88" fill="rgba(255,255,255,0.28)"/>
      <rect x="72" y="280" width="496" height="86" rx="24" fill="rgba(15,23,42,0.34)"/>
      <text x="320" y="333" text-anchor="middle" fill="white" font-size="36" font-family="Inter, Arial, sans-serif" font-weight="700">${label}</text>
    </svg>`;
  return btoa(svg);
}

async function seedSession(page) {
  await page.evaluate(async ({ artifacts }) => {
    const now = new Date().toISOString();
    const ids = {
      root: 'seed-root-user',
      answer: 'seed-root-assistant',
      branchUser: 'seed-branch-user',
      branchA: 'seed-branch-a',
      branchB: 'seed-branch-b',
      textBranch: 'seed-text-branch',
    };

    const session = {
      id: 'visual-inspection-session',
      createdAt: now,
      updatedAt: now,
      title: 'Brand launch concept board',
      graph: {
        nodes: {
          [ids.root]: {
            id: ids.root,
            parentId: null,
            role: 'user',
            content: 'Create visual directions for a premium learning canvas product.',
            responseMode: 'image',
            sessionIntent: 'image_generate',
            memoryPatches: [],
            timestamp: '2026-04-29T16:00:00.000Z',
            summary: 'Premium learning canvas directions',
          },
          [ids.answer]: {
            id: ids.answer,
            parentId: ids.root,
            role: 'assistant',
            content: 'Three visual territories: calm studio, vivid ideation, and editorial system.',
            responseMode: 'image',
            sessionIntent: 'image_generate',
            memoryPatches: [],
            timestamp: '2026-04-29T16:02:00.000Z',
            summary: 'Three generated territories',
            events: [
              { kind: 'text', text: 'I explored three territories for the launch canvas.' },
              {
                kind: 'image_artifact',
                artifact: {
                  id: 'artifact-calm',
                  artifactId: 'artifact-calm',
                  mimeType: 'image/svg+xml',
                  data: artifacts.calm,
                  label: 'Calm Studio',
                  model: 'imagen-4.0-generate-001',
                },
              },
              {
                kind: 'image_artifact',
                artifact: {
                  id: 'artifact-vivid',
                  artifactId: 'artifact-vivid',
                  mimeType: 'image/svg+xml',
                  data: artifacts.vivid,
                  label: 'Vivid Ideation',
                  model: 'imagen-4.0-generate-001',
                },
              },
            ],
          },
          [ids.branchUser]: {
            id: ids.branchUser,
            parentId: ids.answer,
            role: 'user',
            content: 'Use the vivid direction as a source, but make it more editorial and refined.',
            responseMode: 'image',
            sessionIntent: 'style_fit',
            attachments: [{
              id: 'attachment-vivid',
              kind: 'image',
              mimeType: 'image/svg+xml',
              data: artifacts.vivid,
              artifactId: 'artifact-vivid',
              name: 'vivid-ideation.svg',
              sourceType: 'generated',
              use: 'edit_target',
            }],
            imageWorkflow: {
              intent: 'style_fit',
              prompt: 'Make the vivid direction more editorial and refined.',
              sourceArtifactIds: ['artifact-vivid'],
              stylePresetId: 'editorial-bw',
              styleLabel: 'Editorial B&W',
            },
            memoryPatches: [],
            timestamp: '2026-04-29T16:04:00.000Z',
            summary: 'Fit editorial style to vivid source',
          },
          [ids.branchA]: {
            id: ids.branchA,
            parentId: ids.branchUser,
            role: 'assistant',
            content: 'Refined editorial option with high contrast and crisp surfaces.',
            responseMode: 'image',
            sessionIntent: 'style_fit',
            memoryPatches: [],
            timestamp: '2026-04-29T16:06:00.000Z',
            summary: 'Editorial high-contrast refinement',
            events: [{
              kind: 'image_artifact',
              artifact: {
                id: 'artifact-editorial',
                artifactId: 'artifact-editorial',
                mimeType: 'image/svg+xml',
                data: artifacts.editorial,
                label: 'Editorial Refinement',
                model: 'gemini-3-pro-image-preview',
              },
            }],
          },
          [ids.branchB]: {
            id: ids.branchB,
            parentId: ids.branchUser,
            role: 'assistant',
            content: 'Warmer variant that keeps the source composition but shifts the mood.',
            responseMode: 'image',
            sessionIntent: 'variants',
            memoryPatches: [],
            timestamp: '2026-04-29T16:07:00.000Z',
            summary: 'Warm alternative variant',
            events: [{
              kind: 'image_artifact',
              artifact: {
                id: 'artifact-warm',
                artifactId: 'artifact-warm',
                mimeType: 'image/svg+xml',
                data: artifacts.warm,
                label: 'Warm Variant',
                model: 'gemini-3-pro-image-preview',
              },
            }],
          },
          [ids.textBranch]: {
            id: ids.textBranch,
            parentId: ids.answer,
            role: 'assistant',
            content: 'Positioning: MemoTree is a spatial AI workbench for preserving alternatives without losing context.',
            responseMode: 'text',
            sessionIntent: 'ask',
            memoryPatches: [],
            timestamp: '2026-04-29T16:09:00.000Z',
            summary: 'Positioning statement',
            events: [{ kind: 'text', text: 'Positioning: spatial AI workbench for preserving alternatives.' }],
          },
        },
        artifacts: {
          'artifact-calm': {
            id: 'artifact-calm',
            kind: 'image',
            path: 'visual/calm-studio.svg',
            mimeType: 'image/svg+xml',
            data: artifacts.calm,
            name: 'Calm Studio',
            origin: 'generated',
            createdAt: '2026-04-29T16:02:00.000Z',
            sourceNodeId: ids.answer,
            sourceEventId: 'artifact-calm',
            workflow: { intent: 'image_generate', prompt: 'Premium learning canvas directions' },
            model: 'imagen-4.0-generate-001',
            label: 'Calm Studio',
          },
          'artifact-vivid': {
            id: 'artifact-vivid',
            kind: 'image',
            path: 'visual/vivid-ideation.svg',
            mimeType: 'image/svg+xml',
            data: artifacts.vivid,
            name: 'Vivid Ideation',
            origin: 'generated',
            createdAt: '2026-04-29T16:02:30.000Z',
            sourceNodeId: ids.answer,
            sourceEventId: 'artifact-vivid',
            workflow: { intent: 'image_generate', prompt: 'Premium learning canvas directions' },
            model: 'imagen-4.0-generate-001',
            label: 'Vivid Ideation',
          },
          'artifact-editorial': {
            id: 'artifact-editorial',
            kind: 'image',
            path: 'visual/editorial-refinement.svg',
            mimeType: 'image/svg+xml',
            data: artifacts.editorial,
            name: 'Editorial Refinement',
            origin: 'generated',
            createdAt: '2026-04-29T16:06:00.000Z',
            sourceNodeId: ids.branchA,
            sourceEventId: 'artifact-editorial',
            parentArtifactIds: ['artifact-vivid'],
            workflow: { intent: 'style_fit', prompt: 'Make the vivid direction more editorial and refined.', sourceArtifactIds: ['artifact-vivid'], styleLabel: 'Editorial B&W' },
            model: 'gemini-3-pro-image-preview',
            label: 'Editorial Refinement',
          },
          'artifact-warm': {
            id: 'artifact-warm',
            kind: 'image',
            path: 'visual/warm-variant.svg',
            mimeType: 'image/svg+xml',
            data: artifacts.warm,
            name: 'Warm Variant',
            origin: 'generated',
            createdAt: '2026-04-29T16:07:00.000Z',
            sourceNodeId: ids.branchB,
            sourceEventId: 'artifact-warm',
            parentArtifactIds: ['artifact-vivid'],
            workflow: { intent: 'variants', prompt: 'Warmer variant.', sourceArtifactIds: ['artifact-vivid'] },
            model: 'gemini-3-pro-image-preview',
            label: 'Warm Variant',
          },
        },
        groups: {},
        uiPositions: {},
        canvasPrunedNodeIds: [],
        compactions: {},
        rootId: ids.root,
        activeNodeId: ids.branchA,
        sessionTitle: 'Brand launch concept board',
        sessionIntent: 'style_fit',
        providerId: 'gemini',
        imageModelId: 'gemini-3-pro-image-preview',
        imageOutputCount: 2,
      },
    };

    const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('memotree', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'meta'], 'readwrite');
      tx.objectStore('sessions').put(session);
      tx.objectStore('meta').put(session.id, 'last-session-id');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, {
    artifacts: {
      calm: svgData('Calm Studio', ['#3b82f6', '#14b8a6']),
      vivid: svgData('Vivid Ideation', ['#7c3aed', '#f97316']),
      editorial: svgData('Editorial', ['#111827', '#94a3b8']),
      warm: svgData('Warm Variant', ['#be123c', '#facc15']),
    },
  });
}

test('first-run desktop and mobile', async ({ page }) => {
  await page.goto(appUrl);
  await expect(page.getByRole('heading', { name: 'Start a Session' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New Board' })).toBeVisible();
  await page.screenshot({ path: 'scratchpad/visual-inspection/first-run-desktop-spec.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'scratchpad/visual-inspection/first-run-mobile-spec.png', fullPage: true });
});

test('seeded image workspace and timeline', async ({ page }) => {
  await page.goto(appUrl);
  await expect(page.getByText(/Saved/)).toBeVisible();
  await seedSession(page);
  await page.reload();
  await expect(page.getByText('Editorial Refinement')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.getByRole('heading', { name: 'Image Workspace' })).toBeVisible();
  await page.screenshot({ path: 'scratchpad/visual-inspection/seeded-workspace-desktop.png', fullPage: true });

  await page.getByRole('button', { name: 'Timeline' }).click();
  await page.screenshot({ path: 'scratchpad/visual-inspection/seeded-timeline-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'scratchpad/visual-inspection/seeded-canvas-mobile.png', fullPage: true });
});
