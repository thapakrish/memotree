function envFlag(name: string, fallback = false) {
    const value = import.meta.env[name];
    if (value === '1' || value === 'true') return true;
    if (value === '0' || value === 'false') return false;
    return fallback;
}

export const featureFlags = {
    advancedGraphTools: envFlag('VITE_ENABLE_ADVANCED_GRAPH_TOOLS', false),
    canvasOrganizationTools: envFlag('VITE_ENABLE_CANVAS_ORGANIZATION_TOOLS', true),
    experimentalImports: envFlag('VITE_ENABLE_EXPERIMENTAL_IMPORTS', false),
    importInference: envFlag('VITE_ENABLE_IMPORT_INFERENCE', false),
    sharedUrlImport: envFlag('VITE_ENABLE_SHARED_URL_IMPORT', false),
    richFileAttachments: envFlag('VITE_ENABLE_RICH_FILE_ATTACHMENTS', false),
    contextCompaction: envFlag('VITE_ENABLE_CONTEXT_COMPACTION', false),
    keyboardPowerTools: envFlag('VITE_ENABLE_KEYBOARD_POWER_TOOLS', false),
    importProvenanceWarnings: envFlag('VITE_ENABLE_IMPORT_PROVENANCE_WARNINGS', false),
} as const;

export function isImageOnlyAttachmentMode() {
    return !featureFlags.richFileAttachments;
}
