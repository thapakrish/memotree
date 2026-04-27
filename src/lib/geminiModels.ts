export type ImageModelEngine = 'gemini' | 'imagen';

export interface ImageModelOption {
    id: string;
    label: string;
    description: string;
    engine: ImageModelEngine;
}

export const DEFAULT_GEMINI_TEXT_MODEL_ID = import.meta.env.VITE_GEMINI_TEXT_MODEL?.trim() || 'gemini-2.5-flash';
export const DEFAULT_GEMINI_IMAGE_MODEL_ID = 'gemini-3.1-flash-image-preview';
export const DEFAULT_IMAGEN_OUTPUT_COUNT = 4;

const configuredImageModel = import.meta.env.VITE_GEMINI_IMAGE_MODEL?.trim();

export const GEMINI_IMAGE_MODEL_OPTIONS: ImageModelOption[] = [
    {
        id: 'gemini-3.1-flash-image-preview',
        label: '3.1 Flash Preview',
        description: 'Newer Gemini image model for generation and edits.',
        engine: 'gemini',
    },
    {
        id: 'gemini-2.5-flash-image',
        label: '2.5 Flash',
        description: 'Stable Gemini image generation and editing model.',
        engine: 'gemini',
    },
    {
        id: 'gemini-3-pro-image-preview',
        label: '3 Pro Preview',
        description: 'Higher-fidelity preview model for more precise image work.',
        engine: 'gemini',
    },
];

export const IMAGEN_MODEL_OPTIONS: ImageModelOption[] = [
    {
        id: 'imagen-4.0-fast-generate-001',
        label: 'Imagen 4 Fast',
        description: 'Fast text-to-image variant generation with reliable output count.',
        engine: 'imagen',
    },
    {
        id: 'imagen-4.0-generate-001',
        label: 'Imagen 4',
        description: 'High-fidelity text-to-image generation with reliable output count.',
        engine: 'imagen',
    },
    {
        id: 'imagen-4.0-ultra-generate-001',
        label: 'Imagen 4 Ultra',
        description: 'Highest-quality Imagen text-to-image generation.',
        engine: 'imagen',
    },
];

export const IMAGE_MODEL_OPTIONS = [
    ...GEMINI_IMAGE_MODEL_OPTIONS,
    ...IMAGEN_MODEL_OPTIONS,
];

export const DEFAULT_IMAGE_MODEL_ID = configuredImageModel || DEFAULT_GEMINI_IMAGE_MODEL_ID;

export function isImagenModelId(modelId?: string): modelId is string {
    return Boolean(modelId?.startsWith('imagen-'));
}

function normalizeModelId(modelId?: string): string {
    return modelId?.trim().replace(/^models\//, '') ?? '';
}

export function getImageModelDisplayName(modelId?: string): string | null {
    const normalized = normalizeModelId(modelId);
    if (!normalized) {
        return null;
    }

    const option = IMAGE_MODEL_OPTIONS.find((candidate) => {
        const candidateId = normalizeModelId(candidate.id);
        return normalized === candidateId || normalized.includes(candidateId);
    });

    if (option) {
        return option.engine === 'imagen' ? option.label : `Gemini ${option.label}`;
    }

    if (/^imagen-/.test(normalized)) {
        return 'Imagen';
    }

    if (/^gemini-/.test(normalized)) {
        return 'Gemini';
    }

    return normalized;
}

export function getImageModelOptions(selectedModelId?: string): ImageModelOption[] {
    if (!selectedModelId || IMAGE_MODEL_OPTIONS.some((option) => option.id === selectedModelId)) {
        return IMAGE_MODEL_OPTIONS;
    }

    return [
        ...IMAGE_MODEL_OPTIONS,
        {
            id: selectedModelId,
            label: selectedModelId,
            description: isImagenModelId(selectedModelId)
                ? 'Custom configured Imagen text-to-image model.'
                : 'Custom configured Gemini image model.',
            engine: isImagenModelId(selectedModelId) ? 'imagen' : 'gemini',
        },
    ];
}
