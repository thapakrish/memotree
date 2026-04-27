export interface GeminiModelOption {
    id: string;
    label: string;
    description: string;
}

export const DEFAULT_GEMINI_TEXT_MODEL_ID = import.meta.env.VITE_GEMINI_TEXT_MODEL?.trim() || 'gemini-2.5-flash';

const configuredImageModel = import.meta.env.VITE_GEMINI_IMAGE_MODEL?.trim();

export const GEMINI_IMAGE_MODEL_OPTIONS: GeminiModelOption[] = [
    {
        id: 'gemini-3.1-flash-image-preview',
        label: '3.1 Flash Preview',
        description: 'Newer Gemini image model for generation and edits.',
    },
    {
        id: 'gemini-2.5-flash-image',
        label: '2.5 Flash',
        description: 'Stable Gemini image generation and editing model.',
    },
    {
        id: 'gemini-3-pro-image-preview',
        label: '3 Pro Preview',
        description: 'Higher-fidelity preview model for more precise image work.',
    },
];

export const DEFAULT_GEMINI_IMAGE_MODEL_ID = configuredImageModel || GEMINI_IMAGE_MODEL_OPTIONS[0].id;

export function getGeminiImageModelOptions(selectedModelId?: string): GeminiModelOption[] {
    if (!selectedModelId || GEMINI_IMAGE_MODEL_OPTIONS.some((option) => option.id === selectedModelId)) {
        return GEMINI_IMAGE_MODEL_OPTIONS;
    }

    return [
        ...GEMINI_IMAGE_MODEL_OPTIONS,
        {
            id: selectedModelId,
            label: selectedModelId,
            description: 'Custom configured Gemini image model.',
        },
    ];
}
