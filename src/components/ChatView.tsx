import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { Send, CornerDownRight, Cpu, User, KeyRound, Loader2, BrainCircuit, Wrench, CheckCircle2, CircleAlert, FolderOpen, GitBranch, Undo2, Eye, Copy, Check, Square, Paperclip, X, ImageIcon, FileText, Music, ScanText, ArrowRight, Sparkles, RotateCcw, Pencil, Images } from 'lucide-react';
import { useGraphStore } from '../store/useGraphStore';
import type { AssistantResponseMode, AttachmentMimeType, AttachmentPart, ChatEvent, CompactionBlock, ImageArtifact, ImageFileArtifact, MessageNode } from '../store/types';
import { getAssistantText, interceptMemoryTool } from '../lib/geminiEngine';
import type { IProvider, ProviderFunctionCall, StreamDelta } from '../lib/providers';
import { createProvider } from '../lib/providers';
import { appendEvent, getFinalAnswerText, getImageArtifacts, getNodeSummary, mergeEvents } from '../lib/chatEvents';
import { reconstructMemory } from '../lib/memoryEngine';
import { SessionsModal } from './SessionsModal';
import { ImportSuggestionsModal } from './ImportSuggestionsModal';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ContextInspector } from './ContextInspector';
import { featureFlags, isImageOnlyAttachmentMode } from '../config/featureFlags';
import { buildImageArtifactFileName, buildImageArtifactPath } from '../lib/artifactFiles';
import logoMark from '../assets/logo-mark.svg';

function getTextSummary(text: string): string {
    return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}

function roughTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function estimateImageTokens(base64: string): number {
    const rawBytes = base64.length * 0.75;
    const estimatedTiles = Math.ceil(rawBytes / (768 * 768 * 3));
    return Math.max(258, estimatedTiles * 258);
}

function formatBytes(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeAttachment(attachment: AttachmentPart): string {
    const label = attachment.name || attachment.kind.toUpperCase();
    const size = formatBytes(attachment.sizeBytes);
    return size ? `${label} (${attachment.mimeType}, ${size})` : `${label} (${attachment.mimeType})`;
}

function createAttachmentFromArtifact(artifact: ImageArtifact, use: AttachmentPart['use'] = 'context'): AttachmentPart {
    const artifactId = artifact.artifactId ?? artifact.id;
    const name = buildImageArtifactFileName(artifactId, artifact.mimeType, artifact.label);
    return {
        id: crypto.randomUUID(),
        kind: 'image',
        mimeType: artifact.mimeType,
        data: artifact.data,
        artifactId,
        artifactPath: artifact.artifactPath ?? buildImageArtifactPath(artifactId, name),
        name,
        sizeBytes: Math.floor(artifact.data.length * 0.75),
        sourceType: 'generated',
        use,
    };
}

function createAttachmentFromFileArtifact(artifact: ImageFileArtifact, use: AttachmentPart['use'] = 'context'): AttachmentPart {
    return {
        id: crypto.randomUUID(),
        kind: 'image',
        mimeType: artifact.mimeType,
        data: artifact.data,
        artifactId: artifact.id,
        artifactPath: artifact.path,
        name: artifact.name,
        sizeBytes: artifact.sizeBytes,
        sourceType: artifact.origin === 'generated' ? 'generated' : 'file',
        use,
    };
}

function getImageInputCount(attachments?: AttachmentPart[]): number {
    return (attachments ?? []).filter((attachment) => attachment.kind === 'image').length;
}

function formatImageCountLabel(count: number, noun: 'input' | 'output'): string {
    return `${count} image ${noun}${count === 1 ? '' : 's'}`;
}

function buildBranchMarkdown(path: MessageNode[]): string {
    return path.map((node) => {
        const title = node.role === 'user'
            ? 'User'
            : node.role === 'assistant'
                ? 'Assistant'
                : 'System';
        const body = node.role === 'assistant'
            ? (getFinalAnswerText(node.events ?? []) || node.content).trim()
            : node.content.trim();
        const attachmentLines = (node.attachments ?? []).map((attachment) => `- ${describeAttachment(attachment)}`);
        const generatedImages = getImageArtifacts(node.events).map((artifact, index) =>
            `- ${artifact.label ?? `Generated image ${index + 1}`} (${artifact.mimeType})`,
        );
        const sections = [`## ${title}`];

        if (attachmentLines.length > 0) {
            sections.push('Attachments:');
            sections.push(...attachmentLines);
        }

        if (generatedImages.length > 0) {
            sections.push('Generated images:');
            sections.push(...generatedImages);
        }

        if (body) {
            sections.push(body);
        }

        return sections.join('\n');
    }).join('\n\n');
}

function normalizeToolArgs(args: unknown): Record<string, string> {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return {};
    }

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string') {
            normalized[key] = value;
        }
    }

    return normalized;
}

function unwrapJsonErrorMessage(message: string): string | null {
    try {
        const parsed = JSON.parse(message) as {
            error?: { message?: string; status?: string };
            message?: string;
            status?: string;
        };
        const nested = parsed.error?.message ?? parsed.message;
        if (typeof nested === 'string' && nested !== message) {
            return unwrapJsonErrorMessage(nested) ?? nested;
        }
        return parsed.error?.status ?? parsed.status ?? null;
    } catch {
        return null;
    }
}

function getFriendlyErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
        return 'Request failed. Check your API key or console.';
    }

    return unwrapJsonErrorMessage(error.message) ?? error.message;
}

const SUPPORTED_IMAGE_TYPES: AttachmentMimeType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const SUPPORTED_PDF_TYPES: AttachmentMimeType[] = ['application/pdf'];
const SUPPORTED_AUDIO_TYPES: AttachmentMimeType[] = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/flac'];
const MAX_PDF_BYTES = 20 * 1024 * 1024;  // 20 MB
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_IMAGE_DIM = 2048;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function extractBase64Payload(dataUrl: string): string | null {
    const [, payload] = dataUrl.split(',', 2);
    return payload || null;
}

async function processImageFile(
    file: File,
    sourceType: AttachmentPart['sourceType'],
): Promise<AttachmentPart | null> {
    const mimeType = file.type as AttachmentMimeType;
    if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) return null;

    return new Promise((resolve) => {
        const reader = new FileReader();
        const fail = () => resolve(null);

        reader.onerror = fail;
        reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            if (!dataUrl) {
                fail();
                return;
            }

            const finalize = (base64: string, finalMime: AttachmentMimeType) => {
                resolve({
                    id: crypto.randomUUID(),
                    kind: 'image',
                    mimeType: finalMime,
                    data: base64,
                    name: file.name || undefined,
                    sizeBytes: file.size,
                    sourceType,
                });
            };

            if (file.size <= MAX_IMAGE_BYTES) {
                const base64 = extractBase64Payload(dataUrl);
                if (!base64) {
                    fail();
                    return;
                }
                finalize(base64, mimeType);
                return;
            }

            if (mimeType === 'image/gif') {
                fail();
                return;
            }

            // Resize large images via canvas
            const img = new Image();
            img.onerror = fail;
            img.onload = () => {
                const scale = Math.min(MAX_IMAGE_DIM / img.width, MAX_IMAGE_DIM / img.height, 1);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const context = canvas.getContext('2d');
                if (!context) {
                    fail();
                    return;
                }
                context.drawImage(img, 0, 0, canvas.width, canvas.height);

                const resizedDataUrl = mimeType === 'image/png'
                    ? canvas.toDataURL('image/png')
                    : mimeType === 'image/webp'
                        ? canvas.toDataURL('image/webp', 0.85)
                        : canvas.toDataURL('image/jpeg', 0.85);
                const resizedBase64 = extractBase64Payload(resizedDataUrl);
                if (!resizedBase64) {
                    fail();
                    return;
                }
                finalize(
                    resizedBase64,
                    mimeType === 'image/png' || mimeType === 'image/webp' ? mimeType : 'image/jpeg',
                );
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    });
}

async function processBinaryFile(
    file: File,
    sourceType: AttachmentPart['sourceType'],
): Promise<AttachmentPart | null> {
    const mimeType = file.type as AttachmentMimeType;
    const isPdf = SUPPORTED_PDF_TYPES.includes(mimeType);
    const isAudio = SUPPORTED_AUDIO_TYPES.includes(mimeType);
    if (!isPdf && !isAudio) return null;

    const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_AUDIO_BYTES;
    if (file.size > maxBytes) return null;

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onerror = () => resolve(null);
        reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            const base64 = dataUrl?.split(',', 2)[1];
            if (!base64) { resolve(null); return; }
            resolve({
                id: crypto.randomUUID(),
                kind: isPdf ? 'pdf' : 'audio',
                mimeType,
                data: base64,
                name: file.name || undefined,
                sizeBytes: file.size,
                sourceType,
            });
        };
        reader.readAsDataURL(file);
    });
}

async function processClipboardItems(
    items: DataTransferItemList,
): Promise<AttachmentPart[]> {
    const results: AttachmentPart[] = [];
    for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
                const part = await processImageFile(file, 'clipboard');
                if (part) results.push(part);
            }
        }
    }
    return results;
}

function cloneAttachments(parts: AttachmentPart[]): AttachmentPart[] {
    return parts.map((part) => ({
        ...part,
        id: crypto.randomUUID(),
    }));
}

const MAX_TOOL_ROUNDS = 2;
const RESPONSE_MODE_OPTIONS: Array<{ value: AssistantResponseMode; label: string }> = [
    { value: 'text', label: 'Text' },
    { value: 'image', label: 'Image' },
    { value: 'multimodal', label: 'Mixed' },
];

async function collectProviderStream(
    stream: AsyncGenerator<StreamDelta>,
    setStreamingEvents: (events: ChatEvent[]) => void,
    setThoughtsTokenCount: (count: number) => void,
): Promise<StreamDelta> {
    let lastDelta: StreamDelta = { events: [], thoughtsTokenCount: 0, functionCalls: [] };

    for await (const delta of stream) {
        lastDelta = delta;
        startTransition(() => {
            setStreamingEvents(delta.events);
            setThoughtsTokenCount(delta.thoughtsTokenCount);
        });
    }

    return lastDelta;
}

function CopyMessageButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const [failed, setFailed] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setFailed(false);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setFailed(true);
            setCopied(false);
            setTimeout(() => setFailed(false), 2000);
        }
    };

    return (
        <button
            onClick={handleCopy}
            title="Copy message"
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-slate-700"
        >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : failed ? 'Failed' : 'Copy'}
        </button>
    );
}

function AssistantMessageBody({
    events,
    fallbackText,
    isStreaming,
    onUseImageArtifact,
    onEditImageArtifact,
}: {
    events?: ChatEvent[];
    fallbackText: string;
    isStreaming?: boolean;
    onUseImageArtifact?: (artifact: ImageArtifact) => void;
    onEditImageArtifact?: (artifact: ImageArtifact) => void;
}) {
    const messageEvents = events ?? [];

    if (messageEvents.length === 0) {
        return <MarkdownRenderer text={fallbackText} isStreaming={isStreaming} />;
    }

    const lastTextIndex = messageEvents.reduce((last, event, i) =>
        event.kind === 'text' ? i : last, -1);

    return (
        <div className="space-y-3">
            {messageEvents.map((event, index) => {
                switch (event.kind) {
                    case 'thought':
                        return (
                            <details
                                key={`${event.kind}-${event.signature ?? index}-${index}`}
                                className="group/thought rounded-xl border border-amber-200 bg-amber-50/80"
                            >
                                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 marker:content-none">
                                    <BrainCircuit className="h-3.5 w-3.5" />
                                    <span className="flex-1">
                                        Thinking
                                        {event.tokenCount ? ` · ${event.tokenCount.toLocaleString()} tokens` : ''}
                                    </span>
                                    <span className="text-[10px] normal-case tracking-normal text-amber-600 group-open/thought:hidden">Show</span>
                                    <span className="hidden text-[10px] normal-case tracking-normal text-amber-600 group-open/thought:inline">Hide</span>
                                </summary>
                                <div className="border-t border-amber-200 px-3 py-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                                    {event.text}
                                </div>
                            </details>
                        );
                    case 'tool_call':
                        return (
                            <div key={`${event.kind}-${event.callId ?? index}`} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                                <div className="flex items-center gap-2 font-medium">
                                    <Wrench className="h-3.5 w-3.5" />
                                    <span>{event.toolName}</span>
                                </div>
                                <div className="mt-1 text-xs text-sky-700 whitespace-pre-wrap">
                                    {JSON.stringify(event.args, null, 2)}
                                </div>
                            </div>
                        );
                    case 'tool_result':
                        return (
                            <details key={`${event.kind}-${event.callId ?? index}`} className="group/result rounded-xl border border-emerald-200 bg-emerald-50/80">
                                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 marker:content-none">
                                    {event.status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                                    <span className="flex-1">{event.summary}</span>
                                    <span className="text-[10px] normal-case tracking-normal text-emerald-600 group-open/result:hidden">Show</span>
                                    <span className="hidden text-[10px] normal-case tracking-normal text-emerald-600 group-open/result:inline">Hide</span>
                                </summary>
                                {event.payload !== undefined && (
                                    <pre className="overflow-x-auto border-t border-emerald-200 px-3 py-3 text-xs leading-relaxed text-emerald-900 whitespace-pre-wrap">
                                        {JSON.stringify(event.payload, null, 2)}
                                    </pre>
                                )}
                            </details>
                        );
                    case 'text':
                        return (
                            <MarkdownRenderer
                                key={`${event.kind}-${index}`}
                                text={event.text}
                                isStreaming={isStreaming && index === lastTextIndex}
                            />
                        );
                    case 'image_artifact':
                        return (
                            <div key={`${event.kind}-${event.artifact.id}`} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                                <img
                                    src={`data:${event.artifact.mimeType};base64,${event.artifact.data}`}
                                    alt={event.artifact.label ?? 'generated image'}
                                    className="max-h-[28rem] w-full object-contain bg-white"
                                />
                                <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="truncate text-[11px] font-medium text-slate-700">
                                            {event.artifact.label ?? 'Generated image'}
                                        </div>
                                        <div className="truncate text-[10px] text-slate-400">
                                            {event.artifact.model ?? event.artifact.mimeType}
                                        </div>
                                    </div>
                                    {(onUseImageArtifact || onEditImageArtifact) && (
                                        <div className="flex shrink-0 items-center gap-1">
                                            {onUseImageArtifact && (
                                                <button
                                                    onClick={() => onUseImageArtifact(event.artifact)}
                                                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-700"
                                                    title="Add this image as context"
                                                >
                                                    <ImageIcon className="h-3 w-3" />
                                                    Context
                                                </button>
                                            )}
                                            {onEditImageArtifact && (
                                                <button
                                                    onClick={() => onEditImageArtifact(event.artifact)}
                                                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-700"
                                                    title="Use this image as the edit target"
                                                >
                                                    <Pencil className="h-3 w-3" />
                                                    Edit
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                }
            })}
        </div>
    );
}

export function ChatView() {
    const {
        activeNodeId,
        getPath,
        addNode,
        setActiveNode,
        providerId,
        apiKey,
        setApiKey,
        importEnvelope,
        previewImportEnvelope,
        applyAcceptedImportSuggestions,
        clearImportPreview,
        undoLastImportApply,
        lastImportApplySnapshot,
        compactions,
        addCompaction,
        removeCompaction,
        artifacts,
    } = useGraphStore();
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [streamingEvents, setStreamingEvents] = useState<ChatEvent[]>([]);
    const [thoughtsTokenCount, setThoughtsTokenCount] = useState(0);
    const [isSessionsOpen, setIsSessionsOpen] = useState(false);
    const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
    const [isArtifactPickerOpen, setIsArtifactPickerOpen] = useState(false);
    const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
    const [attachments, setAttachments] = useState<AttachmentPart[]>([]);
    const [responseMode, setResponseMode] = useState<AssistantResponseMode>('text');
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [isInspectorOpen, setIsInspectorOpen] = useState(false);
    const [isCompacting, setIsCompacting] = useState(false);
    const [branchCopied, setBranchCopied] = useState(false);
    const [branchCopyFailed, setBranchCopyFailed] = useState(false);
    const [statusMessage, setStatusMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
    const provider = useMemo<IProvider | null>(
        () => apiKey ? createProvider(providerId, apiKey) : null,
        [apiKey, providerId],
    );
    const scrollRef = useRef<HTMLDivElement>(null);
    const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const addAttachments = (parts: AttachmentPart[]) => {
        setAttachments((prev) => [...prev, ...parts]);
    };

    const showStatus = (tone: 'error' | 'info', text: string) => {
        setStatusMessage({ tone, text });
    };

    const removeAttachment = (id: string) => {
        setAttachments((prev) => prev.filter((a) => a.id !== id));
    };

    const toggleAttachmentUse = (id: string) => {
        setAttachments((prev) => prev.map((attachment) =>
            attachment.id === id && attachment.kind === 'image'
                ? {
                    ...attachment,
                    use: attachment.use === 'edit_target' ? 'context' : 'edit_target',
                }
                : attachment,
        ));
    };

    const handleReuseArtifact = (artifact: ImageArtifact) => {
        addAttachments([createAttachmentFromArtifact(artifact)]);
        showStatus('info', 'Generated image added to the composer.');
    };

    const handleEditArtifact = (artifact: ImageArtifact) => {
        addAttachments([createAttachmentFromArtifact(artifact, 'edit_target')]);
        setResponseMode('multimodal');
        showStatus('info', 'Generated image added as the edit target.');
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const toggleSelectedArtifact = (artifactId: string) => {
        setSelectedArtifactIds((prev) =>
            prev.includes(artifactId)
                ? prev.filter((id) => id !== artifactId)
                : [...prev, artifactId],
        );
    };

    const closeArtifactPicker = () => {
        setSelectedArtifactIds([]);
        setIsArtifactPickerOpen(false);
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (!provider?.capabilities.supportsImages) return;
        const hasImage = Array.from(e.clipboardData.items).some(
            (item) => item.kind === 'file' && item.type.startsWith('image/'),
        );
        if (!hasImage) return;

        e.preventDefault();
        const parts = await processClipboardItems(e.clipboardData.items);
        if (parts.length > 0) {
            addAttachments(parts);
        } else {
            showStatus('error', 'Unable to attach the pasted image.');
        }
    };

    const isAttachableFile = (type: string) =>
        type.startsWith('image/') || (!isImageOnlyAttachmentMode() && (type === 'application/pdf' || type.startsWith('audio/')));

    const processAnyFile = (f: File, src: AttachmentPart['sourceType']) =>
        f.type.startsWith('image/')
            ? processImageFile(f, src)
            : isImageOnlyAttachmentMode()
                ? Promise.resolve(null)
                : processBinaryFile(f, src);

    const handleDragOver = (e: React.DragEvent) => {
        if (!provider?.capabilities.supportsFileAttachments) return;
        if (Array.from(e.dataTransfer.items).some((item) => isAttachableFile(item.type))) {
            e.preventDefault();
            setIsDraggingOver(true);
        }
    };

    const handleDragLeave = () => setIsDraggingOver(false);

    const handleDrop = async (e: React.DragEvent) => {
        if (!provider?.capabilities.supportsFileAttachments) return;
        e.preventDefault();
        setIsDraggingOver(false);
        const files = Array.from(e.dataTransfer.files).filter((f) => isAttachableFile(f.type));
        const parts = await Promise.all(files.map((f) => processAnyFile(f, 'drop')));
        const validParts = parts.filter(Boolean) as AttachmentPart[];
        if (validParts.length > 0) {
            addAttachments(validParts);
        }
        if (files.length > validParts.length) {
            showStatus('error', 'Some dropped files could not be attached. Check file type and size limits.');
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!provider?.capabilities.supportsFileAttachments) return;
        const files = Array.from(e.target.files ?? []);
        const parts = await Promise.all(files.map((f) => processAnyFile(f, 'file')));
        const validParts = parts.filter(Boolean) as AttachmentPart[];
        if (validParts.length > 0) {
            addAttachments(validParts);
        }
        if (files.length > validParts.length) {
            showStatus('error', 'Some selected files could not be attached. Check file type and size limits.');
        }
        e.target.value = '';
    };

    const path = getPath(activeNodeId);
    const branchImageArtifacts = useMemo(() => {
        const pathNodeIds = new Set(path.map((node) => node.id));
        return Object.values(artifacts)
            .filter((artifact) => !artifact.sourceNodeId || pathNodeIds.has(artifact.sourceNodeId))
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }, [artifacts, path]);
    const attachedArtifactIds = useMemo(
        () => new Set(attachments.flatMap((attachment) => attachment.artifactId ? [attachment.artifactId] : [])),
        [attachments],
    );

    const handleAddSelectedArtifacts = () => {
        const parts = selectedArtifactIds
            .filter((artifactId) => !attachedArtifactIds.has(artifactId))
            .map((artifactId) => artifacts[artifactId])
            .filter((artifact): artifact is ImageFileArtifact => Boolean(artifact))
            .map((artifact) => createAttachmentFromFileArtifact(artifact));

        if (parts.length > 0) {
            addAttachments(parts);
            showStatus('info', `${formatImageCountLabel(parts.length, 'input')} added to the composer.`);
        }

        closeArtifactPicker();
    };

    const draftMemoryState = useMemo(() => reconstructMemory(path), [path]);
    const visibleImportEnvelope = previewImportEnvelope ?? importEnvelope;
    const acceptedSuggestionCount = visibleImportEnvelope?.suggestions?.filter((suggestion) => suggestion.status === 'accepted').length ?? 0;
    const pendingSuggestionCount = visibleImportEnvelope?.suggestions?.filter((suggestion) => suggestion.status !== 'accepted' && suggestion.status !== 'rejected').length ?? 0;
    const composerEstimate = useMemo(() => {
        if (!provider || (!input.trim() && attachments.length === 0)) {
            return null;
        }

        const providerEstimate = provider.estimateContext(draftMemoryState, attachments, { responseMode });
        const conversationTokens = path.reduce((sum, node) => {
            const eventTextLength = (node.events ?? []).reduce((eventSum, event) =>
                eventSum + ('text' in event ? event.text.length : 0), 0);
            const priorArtifactTokens = getImageArtifacts(node.events).reduce((artifactSum, artifact) =>
                artifactSum + estimateImageTokens(artifact.data), 0);
            return sum + roughTokens(node.content) + Math.ceil(eventTextLength / 4) + priorArtifactTokens;
        }, 0);
        const draftTokens = input.trim() ? roughTokens(input.trim()) : 0;

        return providerEstimate.cacheableTokens
            + providerEstimate.attachmentTokens
            + conversationTokens
            + draftTokens;
    }, [attachments, draftMemoryState, input, path, provider, responseMode]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [streamingEvents, isTyping, path.length]);

    useEffect(() => {
        if (!activeNodeId || path.length === 0) {
            return;
        }

        const target = messageRefs.current[activeNodeId];
        if (target) {
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }, [activeNodeId, path]);

    useEffect(() => {
        if (!statusMessage) {
            return;
        }

        const timeout = window.setTimeout(() => setStatusMessage(null), 4000);
        return () => window.clearTimeout(timeout);
    }, [statusMessage]);

    // Auto-resize textarea
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }, [input]);

    const handleStop = () => {
        abortControllerRef.current?.abort();
    };

    // Keep the most recent 6 nodes (3 exchanges); compact everything before that boundary.
    const KEEP_RECENT_NODES = 6;
    const getCompactionRange = (): MessageNode[] | null => {
        if (path.length <= KEEP_RECENT_NODES) return null;
        let cutPoint = path.length - KEEP_RECENT_NODES;
        // Snap backward to the start of a user message so we never split an exchange
        while (cutPoint > 0 && path[cutPoint]?.role !== 'user') cutPoint--;
        if (cutPoint <= 0) return null;
        return path.slice(0, cutPoint);
    };

    const handleCompactPath = async () => {
        if (!provider || isCompacting) return;
        const toCompact = getCompactionRange();
        if (!toCompact || toCompact.length === 0) return;
        setIsCompacting(true);
        try {
            const summary = await provider.compactNodes(toCompact);
            if (summary) {
                const block: CompactionBlock = {
                    id: crypto.randomUUID(),
                    nodeIds: toCompact.map((n) => n.id),
                    summary,
                    tokensBefore: Math.ceil(toCompact.reduce((s, n) => s + n.content.length, 0) / 4),
                    createdAt: new Date().toISOString(),
                };
                addCompaction(block);
            }
        } catch (err) {
            console.error('Compaction failed:', err);
            showStatus('error', 'Compaction failed. The conversation context was not changed.');
        } finally {
            setIsCompacting(false);
        }
    };

    const generateAssistantReply = async (userNodeId: string) => {
        if (!provider) return;
        const controller = new AbortController();
        abortControllerRef.current = controller;
        setIsTyping(true);
        setStreamingEvents([]);
        setThoughtsTokenCount(0);

        try {
            const newPath = getPath(userNodeId);
            const memoryState = reconstructMemory(newPath);
            const lastNode = newPath[newPath.length - 1];
            const requestedResponseMode = lastNode?.responseMode ?? 'text';
            const initialDelta = await collectProviderStream(
                provider.stream(newPath, memoryState, compactions, controller.signal, { responseMode: requestedResponseMode }),
                setStreamingEvents,
                setThoughtsTokenCount,
            );

            let events = initialDelta.events;
            let nextMemoryState = memoryState;
            const patches = [];
            let pendingFunctionCalls: ProviderFunctionCall[] = initialDelta.functionCalls;
            let toolRounds = 0;

            while (pendingFunctionCalls.length > 0 && toolRounds < MAX_TOOL_ROUNDS && !controller.signal.aborted) {
                toolRounds += 1;
                const functionResponses: Array<{ id?: string; name: string; response: Record<string, unknown> }> = [];

                for (const call of pendingFunctionCalls) {
                    if (call.name !== 'text_editor') {
                        const toolName = call.name ?? 'unknown_tool';
                        const unsupportedToolEvent: ChatEvent = {
                            kind: 'tool_result',
                            toolName,
                            callId: call.id,
                            status: 'error',
                            summary: `Unsupported tool call: ${toolName}`,
                            payload: call.args,
                        };
                        events = appendEvent(events, unsupportedToolEvent);
                        continue;
                    }

                    const toolArgs = normalizeToolArgs(call.args);
                    const { patch, updatedMemory, validationError } = interceptMemoryTool(
                        toolArgs,
                        nextMemoryState,
                    );
                    if (!validationError) {
                        patches.push(patch);
                        nextMemoryState = updatedMemory;
                    }

                    const toolResultEvent: ChatEvent = validationError ? {
                        kind: 'tool_result',
                        toolName: call.name,
                        callId: call.id,
                        status: 'error',
                        summary: `Memory validation failed: ${validationError}`,
                        payload: { validationError, toolArgs },
                    } : {
                        kind: 'tool_result',
                        toolName: call.name,
                        callId: call.id,
                        status: 'success',
                        summary: `Updated ${toolArgs.path ?? '/memories/facts.json'}`,
                        payload: {
                            path: toolArgs.path ?? '/memories/facts.json',
                            fileText: updatedMemory,
                        },
                    };

                    events = appendEvent(events, toolResultEvent);
                    functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: validationError
                            ? { error: toolResultEvent.summary }
                            : { output: toolResultEvent.summary, fileText: updatedMemory },
                    });
                }

                setStreamingEvents(events);

                if (functionResponses.length === 0) {
                    break;
                }

                const followUpDelta = await collectProviderStream(
                    provider.continueWithToolResults(
                        newPath, compactions, events, pendingFunctionCalls,
                        functionResponses, nextMemoryState, controller.signal, { responseMode: requestedResponseMode },
                    ),
                    setStreamingEvents,
                    setThoughtsTokenCount,
                );

                events = mergeEvents(events, followUpDelta.events);
                pendingFunctionCalls = followUpDelta.functionCalls;
            }

            if (pendingFunctionCalls.length > 0 && !controller.signal.aborted) {
                events = appendEvent(events, {
                    kind: 'tool_result',
                    toolName: 'tool_loop_guard',
                    status: 'error',
                    summary: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds`,
                    payload: {
                        remainingCalls: pendingFunctionCalls.map((call) => ({
                            id: call.id,
                            name: call.name,
                        })),
                    },
                });
            }

            // Only save node if we got something (even if aborted mid-stream)
            if (events.length > 0) {
                const assistantText = getAssistantText(events) || getNodeSummary({ role: 'assistant', events, content: '' });
                addNode({
                    parentId: userNodeId,
                    role: 'assistant',
                    responseMode: requestedResponseMode,
                    content: assistantText,
                    events,
                    memoryPatches: patches,
                    summary: getNodeSummary({ role: 'assistant', events, content: assistantText }),
                });
            }
        } catch (err) {
            console.error(err);
            showStatus('error', getFriendlyErrorMessage(err));
        } finally {
            setIsTyping(false);
            setStreamingEvents([]);
            setThoughtsTokenCount(0);
            abortControllerRef.current = null;
        }
    };

    const handleSend = async () => {
        if ((!input.trim() && attachments.length === 0) || !provider) return;

        const activeNode = path.length > 0 ? path[path.length - 1] : null;
        const parentId = activeNode?.role === 'user' ? activeNode.parentId : activeNodeId;
        const nextInput = input;
        const nextAttachments = attachments;

        const userNodeId = addNode({
            parentId,
            role: 'user',
            content: nextInput,
            responseMode,
            attachments: nextAttachments.length > 0 ? nextAttachments : undefined,
            memoryPatches: [],
            summary: nextInput.trim() ? getTextSummary(nextInput) : `Image request (${responseMode})`,
        });

        setInput('');
        setAttachments([]);
        await generateAssistantReply(userNodeId);
    };

    const handleRegenerate = async (assistantNode: MessageNode) => {
        if (isTyping || !assistantNode.parentId) return;
        setActiveNode(assistantNode.parentId);
        await generateAssistantReply(assistantNode.parentId);
    };

    const handleEditAndResend = (userNode: MessageNode) => {
        setActiveNode(userNode.parentId);
        setInput(userNode.content);
        setResponseMode(userNode.responseMode ?? 'text');
        setAttachments(cloneAttachments(userNode.attachments ?? []));
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const handleCopyBranch = async () => {
        if (path.length === 0) return;

        try {
            await navigator.clipboard.writeText(buildBranchMarkdown(path));
            setBranchCopyFailed(false);
            setBranchCopied(true);
            setTimeout(() => setBranchCopied(false), 2000);
        } catch {
            setBranchCopied(false);
            setBranchCopyFailed(true);
            setTimeout(() => setBranchCopyFailed(false), 2000);
        }
    };

    const handleRewindTurn = () => {
        if (path.length === 0 || isTyping) return;

        const lastNode = path[path.length - 1];
        const previousNode = path[path.length - 2] ?? null;

        if (lastNode.role === 'assistant' && previousNode?.id === lastNode.parentId) {
            setActiveNode(previousNode.parentId);
        } else {
            setActiveNode(lastNode.parentId);
        }

        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const streamingDisplayEvents = streamingEvents.length > 0
        ? streamingEvents.map((event) => (
            event.kind === 'thought' && !event.tokenCount && thoughtsTokenCount
                ? { ...event, tokenCount: thoughtsTokenCount }
                : event
        ))
        : [];

    return (
        <div className="w-full h-full flex flex-col bg-white border-r border-slate-200 shadow-sm z-20">
            <div className="flex h-14 items-center justify-between border-b border-slate-100 bg-white px-4 shadow-sm shrink-0 sm:h-16 sm:px-6">
                <div className="flex items-center gap-3">
                    <img src={logoMark} alt="MemoTree" className="h-7 w-7 shrink-0" />
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-slate-800">MemoTree</h1>
                        <p className="text-xs font-medium text-slate-400">Time-Traveling LLM Interface</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsInspectorOpen((v) => !v)}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors sm:gap-2 sm:px-3 ${
                            isInspectorOpen
                                ? 'border-blue-300 bg-blue-50 text-blue-700'
                                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'
                        }`}
                        title="Toggle context inspector"
                    >
                        <ScanText className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        <span className="hidden sm:inline">Context</span>
                    </button>
                    <button
                        onClick={() => setIsSessionsOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 sm:gap-2 sm:px-3"
                    >
                        <FolderOpen className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        <span className="hidden sm:inline">Sessions</span>
                    </button>
                </div>
            </div>
            {isInspectorOpen && (
                <ContextInspector
                    path={path}
                    pendingInput={input}
                    pendingAttachments={attachments}
                    responseMode={responseMode}
                    provider={provider}
                    importEnvelope={visibleImportEnvelope ?? undefined}
                    compactions={compactions}
                    isCompacting={isCompacting}
                    canCompact={featureFlags.contextCompaction && getCompactionRange() !== null}
                    onCompactPath={handleCompactPath}
                    onRemoveCompaction={removeCompaction}
                    showCompactionControls={featureFlags.contextCompaction}
                    showImportProvenance={featureFlags.importProvenanceWarnings}
                />
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 scroll-smooth">
                {visibleImportEnvelope && (
                    <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                        <div className="font-semibold">
                            Imported from {visibleImportEnvelope.sourcePlatform.charAt(0).toUpperCase() + visibleImportEnvelope.sourcePlatform.slice(1)}
                        </div>
                        <div className="mt-1 text-xs leading-relaxed text-violet-700">
                            {visibleImportEnvelope.messageCount} turns imported. {visibleImportEnvelope.suggestions?.length ?? 0} deterministic structure suggestions detected.
                        </div>
                        {visibleImportEnvelope.parserConfidence && (
                            <div className="mt-1 text-xs leading-relaxed text-violet-700">
                                Parser confidence: {visibleImportEnvelope.parserConfidence}
                                {visibleImportEnvelope.sourceConversationId ? ` · source ${visibleImportEnvelope.sourceConversationId.slice(0, 8)}` : ''}
                            </div>
                        )}
                        {featureFlags.importInference && (
                            <>
                                <div className="mt-3 flex items-center gap-3">
                                    <button
                                        onClick={() => setIsSuggestionsOpen(true)}
                                        className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100"
                                    >
                                        <GitBranch className="h-3.5 w-3.5" />
                                        <span>Review Suggestions</span>
                                    </button>
                                    {previewImportEnvelope ? (
                                        <>
                                            <button
                                                onClick={() => applyAcceptedImportSuggestions()}
                                                disabled={acceptedSuggestionCount === 0}
                                                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                <GitBranch className="h-3.5 w-3.5" />
                                                <span>Apply Preview</span>
                                            </button>
                                            <button
                                                onClick={() => clearImportPreview()}
                                                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
                                            >
                                                <Eye className="h-3.5 w-3.5" />
                                                <span>Exit Preview</span>
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => applyAcceptedImportSuggestions()}
                                            disabled={acceptedSuggestionCount === 0}
                                            className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <GitBranch className="h-3.5 w-3.5" />
                                            <span>Apply Accepted</span>
                                        </button>
                                    )}
                                    <button
                                        onClick={() => undoLastImportApply()}
                                        disabled={!lastImportApplySnapshot}
                                        className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <Undo2 className="h-3.5 w-3.5" />
                                        <span>Undo Apply</span>
                                    </button>
                                    <span className="text-xs text-violet-700">
                                        {acceptedSuggestionCount} accepted, {pendingSuggestionCount} pending
                                    </span>
                                </div>
                                {previewImportEnvelope && (
                                    <div className="mt-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs leading-relaxed text-blue-700">
                                        Previewing inferred graph changes. Apply to commit or exit preview to discard.
                                    </div>
                                )}
                            </>
                        )}
                        {featureFlags.importProvenanceWarnings && visibleImportEnvelope.hiddenContext.notes?.[0] && (
                            <div className="mt-2 text-xs leading-relaxed text-violet-700">
                                {visibleImportEnvelope.hiddenContext.notes[0]}
                            </div>
                        )}
                        {featureFlags.importProvenanceWarnings && (visibleImportEnvelope.importWarnings?.length ?? 0) > 0 && (
                            <div className="mt-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs leading-relaxed text-violet-700">
                                {visibleImportEnvelope.importWarnings?.join(' ')}
                            </div>
                        )}
                    </div>
                )}
                {path.length === 0 ? (
                    <div className="flex min-h-full items-center justify-center py-10">
                        <div className="max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                                    <Sparkles className="h-6 w-6" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-slate-800">Welcome to MemoTree</h2>
                                    <p className="text-sm text-slate-500">Conversations branch into a navigable tree instead of disappearing into one linear thread.</p>
                                </div>
                            </div>

                            <div className="mt-6 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                                <div className="rounded-2xl bg-slate-50 p-4">
                                    <div className="font-semibold text-slate-800">1. Start a trunk</div>
                                    <p className="mt-1 leading-relaxed">Send your first message or import an existing chat to create the initial path.</p>
                                </div>
                                <div className="rounded-2xl bg-slate-50 p-4">
                                    <div className="font-semibold text-slate-800">2. Fork anywhere</div>
                                    <p className="mt-1 leading-relaxed">Jump back to any node and branch from there when you want to explore alternatives.</p>
                                </div>
                                <div className="rounded-2xl bg-slate-50 p-4">
                                    <div className="font-semibold text-slate-800">3. Inspect context</div>
                                    <p className="mt-1 leading-relaxed">Open <span className="font-medium text-slate-700">Context</span> to see what the next model call will include.</p>
                                </div>
                            </div>

                            <div className="mt-6 flex flex-wrap items-center gap-3">
                                <button
                                    onClick={() => textareaRef.current?.focus()}
                                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                                >
                                    <ArrowRight className="h-4 w-4" />
                                    Start typing
                                </button>
                                <button
                                    onClick={() => setIsSessionsOpen(true)}
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                                >
                                    <FolderOpen className="h-4 w-4" />
                                    Open Sessions
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    path.map((msg: MessageNode) => (
                        <div
                            key={msg.id}
                            ref={(element) => {
                                messageRefs.current[msg.id] = element;
                            }}
                            className={`group flex flex-col max-w-[85%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                        >
                            <div className="flex items-center gap-2 mb-1 px-1">
                                {msg.role === 'user' ? (
                                    <>
                                        <span className="text-xs font-semibold text-slate-500">You</span>
                                        <User className="w-3 h-3 text-slate-400" />
                                    </>
                                ) : (
                                    <>
                                        <Cpu className="w-3 h-3 text-purple-500" />
                                        <span className="text-xs font-semibold text-purple-600">Gemini</span>
                                    </>
                                )}
                            </div>
                            <div
                                className={`p-4 rounded-2xl shadow-sm text-[15px] leading-relaxed relative ${msg.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-tr-sm'
                                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                                    }`}
                            >
                                {msg.role === 'assistant' ? (
                                    <AssistantMessageBody
                                        events={msg.events}
                                        fallbackText={msg.content}
                                        onUseImageArtifact={handleReuseArtifact}
                                        onEditImageArtifact={handleEditArtifact}
                                    />
                                ) : (
                                    <div>
                                        {(msg.attachments?.length ?? 0) > 0 && (
                                            <div className="mb-2 flex flex-wrap gap-2">
                                                {msg.attachments!.map((att) => (
                                                    att.kind === 'image' ? (
                                                        <img
                                                            key={att.id}
                                                            src={`data:${att.mimeType};base64,${att.data}`}
                                                            alt={att.name ?? 'attachment'}
                                                            className="max-h-48 max-w-full rounded-lg object-contain"
                                                        />
                                                    ) : (
                                                        <div key={att.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${att.kind === 'pdf' ? 'border-red-200 bg-red-50 text-red-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>
                                                            {att.kind === 'pdf' ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <Music className="h-3.5 w-3.5 shrink-0" />}
                                                            <span className="truncate max-w-[200px]">{att.name ?? att.kind.toUpperCase()}</span>
                                                        </div>
                                                    )
                                                ))}
                                            </div>
                                        )}
                                        {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
                                    </div>
                                )}

                                <button
                                    onClick={() => setActiveNode(msg.id)}
                                    title="Fork conversation from this node"
                                    className={`absolute top-2 ${msg.role === 'user' ? '-left-10 text-slate-400 hover:text-blue-500' : '-right-10 text-slate-400 hover:text-blue-500'} opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-slate-200 rounded-full p-1.5 shadow-sm`}
                                >
                                    <CornerDownRight className="w-4 h-4" />
                                </button>
                            </div>

                            <div className={`mt-1.5 flex flex-wrap items-center gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                {msg.role === 'user' && getImageInputCount(msg.attachments) > 0 && (
                                    <span className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">
                                        {formatImageCountLabel(getImageInputCount(msg.attachments), 'input')}
                                    </span>
                                )}
                                {msg.role === 'assistant' && getImageArtifacts(msg.events).length > 0 && (
                                    <span className="rounded-md border border-purple-100 bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700">
                                        {formatImageCountLabel(getImageArtifacts(msg.events).length, 'output')}
                                    </span>
                                )}
                                <button
                                    onClick={() => setActiveNode(msg.id)}
                                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium shadow-sm transition-colors ${
                                        activeNodeId === msg.id
                                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                                            : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700'
                                    }`}
                                    title="Branch conversation from this node"
                                >
                                    <CornerDownRight className="h-3 w-3" />
                                    <span>{activeNodeId === msg.id ? 'Branching here' : 'Branch here'}</span>
                                </button>
                                {msg.role === 'user' && (
                                    <button
                                        onClick={() => handleEditAndResend(msg)}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700"
                                        title="Edit this prompt and resend from the parent node"
                                    >
                                        <Pencil className="h-3 w-3" />
                                        <span>Edit & resend</span>
                                    </button>
                                )}
                                {msg.role === 'assistant' && msg.parentId && (
                                    <button
                                        onClick={() => handleRegenerate(msg)}
                                        disabled={isTyping}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        title="Generate another response from the same user turn"
                                    >
                                        <RotateCcw className="h-3 w-3" />
                                        <span>Regenerate</span>
                                    </button>
                                )}
                                <CopyMessageButton text={msg.role === 'assistant'
                                    ? (getFinalAnswerText(msg.events ?? []) || msg.content)
                                    : msg.content}
                                />
                            </div>

                            {(msg.memoryPatches?.length ?? 0) > 0 && (
                                <div className="mt-1 text-[11px] font-mono text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 self-start">
                                    + Memory Patched
                                </div>
                            )}
                        </div>
                    ))
                )}
                {isTyping && (
                    <div className="flex flex-col max-w-[85%] mr-auto items-start">
                        <div className="flex items-center gap-2 mb-1 px-1">
                            <Cpu className="w-3 h-3 text-purple-500 animate-pulse" />
                            <span className="text-xs font-semibold text-purple-600">Gemini</span>
                        </div>
                        <div className="p-4 rounded-2xl shadow-sm text-[15px] leading-relaxed relative bg-white border border-slate-200 text-slate-800 rounded-tl-sm w-full">
                            {streamingDisplayEvents.length > 0 ? (
                                <AssistantMessageBody
                                    events={streamingDisplayEvents}
                                    fallbackText={getFinalAnswerText(streamingDisplayEvents)}
                                    isStreaming
                                    onUseImageArtifact={handleReuseArtifact}
                                    onEditImageArtifact={handleEditArtifact}
                                />
                            ) : (
                                <div className="flex items-center gap-2 text-slate-400 h-6">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div
                className={`bg-white border-t border-slate-100 shrink-0 transition-colors p-3 sm:p-4 pb-safe ${isDraggingOver ? 'bg-blue-50 border-blue-300' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {!provider ? (
                    <div className="flex items-center gap-2 bg-amber-50 rounded-xl p-3 border border-amber-200">
                        <KeyRound className="w-4 h-4 text-amber-600" />
                        <input
                            type="password"
                            placeholder="Paste Google Gemini API Key for MVP..."
                            className="flex-1 bg-transparent text-sm outline-none text-slate-700"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') setApiKey(e.currentTarget.value);
                            }}
                        />
                        <button className="text-xs bg-amber-600 text-white px-2 py-1 rounded shadow-sm hover:bg-amber-700" onClick={(e) => setApiKey((e.currentTarget.previousElementSibling as HTMLInputElement).value)}>Save</button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {path.length > 0 && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleRewindTurn}
                                    disabled={isTyping}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    title="Jump back one turn without deleting history"
                                >
                                    <Undo2 className="h-3 w-3" />
                                    Rewind
                                </button>
                                <button
                                    onClick={() => void handleCopyBranch()}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                                    title="Copy the active branch as markdown"
                                >
                                    {branchCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                                    {branchCopied ? 'Copied' : branchCopyFailed ? 'Failed' : 'Copy Branch'}
                                </button>
                            </div>
                        )}
                        {statusMessage && (
                            <div
                                className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                                    statusMessage.tone === 'error'
                                        ? 'border-red-200 bg-red-50 text-red-700'
                                        : 'border-blue-200 bg-blue-50 text-blue-700'
                                }`}
                            >
                                {statusMessage.text}
                            </div>
                        )}
                        {/* Attachment preview chips */}
                        {attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {attachments.map((att) => (
                                    <div key={att.id} className="group/chip relative rounded-lg overflow-hidden border border-slate-200 shadow-sm">
                                        {att.kind === 'image' ? (
                                            <>
                                                <img
                                                    src={`data:${att.mimeType};base64,${att.data}`}
                                                    alt={att.name ?? 'image'}
                                                    className="h-16 w-16 object-cover"
                                                />
                                                <button
                                                    onClick={() => toggleAttachmentUse(att.id)}
                                                    className={`absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[9px] font-semibold shadow-sm ${
                                                        att.use === 'edit_target'
                                                            ? 'bg-amber-100 text-amber-700'
                                                            : 'bg-white/90 text-slate-600'
                                                    }`}
                                                    title={att.use === 'edit_target' ? 'Treat as edit target' : 'Treat as context'}
                                                >
                                                    {att.use === 'edit_target' ? 'Edit' : 'Context'}
                                                </button>
                                            </>
                                        ) : (
                                            <div className={`h-16 w-16 flex flex-col items-center justify-center gap-1 ${att.kind === 'pdf' ? 'bg-red-50' : 'bg-indigo-50'}`}>
                                                {att.kind === 'pdf'
                                                    ? <FileText className="h-6 w-6 text-red-400" />
                                                    : <Music className="h-6 w-6 text-indigo-400" />}
                                                <span className="text-[9px] font-medium text-slate-500 truncate max-w-[56px] px-1">
                                                    {att.name ?? att.kind.toUpperCase()}
                                                </span>
                                            </div>
                                        )}
                                        <button
                                            onClick={() => removeAttachment(att.id)}
                                            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover/chip:opacity-100"
                                            title="Remove"
                                        >
                                            <X className="h-3 w-3 text-white" />
                                        </button>
                                    </div>
                                ))}
                                {isDraggingOver && (
                                    <div className="h-16 w-16 rounded-lg border-2 border-dashed border-blue-400 flex items-center justify-center">
                                        <ImageIcon className="h-5 w-5 text-blue-400" />
                                    </div>
                                )}
                            </div>
                        )}

                        {isDraggingOver && attachments.length === 0 && (
                            <div className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-400 bg-blue-50 py-4 text-sm font-medium text-blue-600">
                                <ImageIcon className="h-4 w-4" />
                                Drop file to attach
                            </div>
                        )}

                        {provider?.capabilities.supportsImageOutput && (
                            <div className="flex flex-wrap items-center gap-2">
                                {RESPONSE_MODE_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => setResponseMode(option.value)}
                                        disabled={isTyping}
                                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                            responseMode === option.value
                                                ? 'border-blue-300 bg-blue-50 text-blue-700'
                                                : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700'
                                        } disabled:cursor-not-allowed disabled:opacity-50`}
                                        title={`Request a ${option.label.toLowerCase()} response`}
                                    >
                                        {option.value === 'text'
                                            ? <ScanText className="h-3.5 w-3.5" />
                                            : option.value === 'image'
                                                ? <ImageIcon className="h-3.5 w-3.5" />
                                                : <Sparkles className="h-3.5 w-3.5" />}
                                        <span>{option.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="flex items-end gap-2">
                            {/* Hidden file input */}
                            {provider?.capabilities.supportsFileAttachments && (
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={isImageOnlyAttachmentMode() ? 'image/jpeg,image/png,image/webp,image/gif' : 'image/jpeg,image/png,image/webp,image/gif,application/pdf,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm,audio/flac'}
                                    multiple
                                    className="hidden"
                                    onChange={handleFileSelect}
                                />
                            )}
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isTyping || !provider?.capabilities.supportsFileAttachments}
                                className="shrink-0 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50 transition-colors"
                                title={provider?.capabilities.supportsFileAttachments ? 'Attach file' : 'Current provider does not support file attachments'}
                            >
                                <Paperclip className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedArtifactIds([]);
                                    setIsArtifactPickerOpen(true);
                                }}
                                disabled={isTyping || branchImageArtifacts.length === 0}
                                className="shrink-0 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50 transition-colors"
                                title={branchImageArtifacts.length > 0 ? 'Select prior images' : 'No prior images on this branch'}
                            >
                                <Images className="w-4 h-4" />
                            </button>

                            <textarea
                                ref={textareaRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                onPaste={handlePaste}
                                disabled={isTyping}
                                placeholder={
                                    isDraggingOver ? 'Drop image here...' :
                                    !activeNodeId ? 'Start a new conversation...' :
                                    path[path.length - 1]?.role === 'user' ? 'Try an alternative prompt...' :
                                    responseMode === 'image'
                                        ? 'Describe the image to generate or edit...'
                                        : responseMode === 'multimodal'
                                            ? 'Ask for text plus generated images...'
                                            :
                                    provider?.capabilities.supportsFileAttachments
                                        ? (isImageOnlyAttachmentMode() ? 'Reply or attach an image...' : 'Reply, paste an image, or attach a file...')
                                        : 'Reply to this message...'
                                }
                                className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 pl-4 py-3.5 pr-4 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 transition-all shadow-inner disabled:opacity-50 overflow-y-auto"
                                rows={1}
                                style={{ maxHeight: '160px' }}
                            />
                            {isTyping ? (
                                <button
                                    onClick={handleStop}
                                    className="shrink-0 p-2.5 rounded-xl bg-slate-700 text-white hover:bg-slate-800 transition-colors shadow-sm"
                                    title="Stop streaming response"
                                >
                                    <Square className="w-4 h-4 fill-current" />
                                </button>
                            ) : (
                                <div className="flex flex-col items-end gap-1">
                                    {composerEstimate !== null && (
                                        <span className="text-[11px] font-medium text-slate-400">
                                            ~{composerEstimate.toLocaleString()} tokens
                                        </span>
                                    )}
                                    <button
                                        onClick={handleSend}
                                        disabled={!input.trim() && attachments.length === 0}
                                        className="shrink-0 p-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors shadow-sm"
                                        title={composerEstimate !== null ? `Estimated next request size: ~${composerEstimate.toLocaleString()} tokens` : 'Send message'}
                                    >
                                        <Send className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                <div className="mt-2 text-center">
                    <span className="text-[11px] font-medium text-slate-400">
                        {activeNodeId ? 'Active Timeline Checkpoint: ' + activeNodeId.slice(0, 8) : 'No Node Selected'}
                    </span>
                </div>
            </div>
            {isArtifactPickerOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 px-3 pb-3 backdrop-blur-sm sm:items-center sm:p-6"
                    onClick={closeArtifactPicker}
                >
                    <div
                        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
                        role="dialog"
                        aria-modal="true"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                            <div>
                                <h2 className="text-sm font-semibold text-slate-800">Branch Images</h2>
                                <p className="text-xs text-slate-400">{branchImageArtifacts.length} available</p>
                            </div>
                            <button
                                onClick={closeArtifactPicker}
                                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                                title="Close"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="grid min-h-0 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
                            {branchImageArtifacts.map((artifact) => {
                                const isAttached = attachedArtifactIds.has(artifact.id);
                                const isSelected = selectedArtifactIds.includes(artifact.id);

                                return (
                                    <button
                                        key={artifact.id}
                                        onClick={() => toggleSelectedArtifact(artifact.id)}
                                        disabled={isAttached}
                                        className={`group overflow-hidden rounded-lg border text-left transition-colors ${
                                            isSelected
                                                ? 'border-blue-400 bg-blue-50'
                                                : 'border-slate-200 bg-white hover:border-blue-300'
                                        } disabled:cursor-not-allowed disabled:opacity-60`}
                                        title={artifact.path}
                                    >
                                        <img
                                            src={`data:${artifact.mimeType};base64,${artifact.data}`}
                                            alt={artifact.label ?? artifact.name}
                                            className="aspect-square w-full bg-slate-50 object-cover"
                                        />
                                        <div className="space-y-1 px-2 py-2">
                                            <div className="truncate text-xs font-medium text-slate-700">{artifact.label ?? artifact.name}</div>
                                            <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                                                <span className="truncate">{artifact.origin}</span>
                                                <span className={isAttached || isSelected ? 'font-medium text-blue-600' : ''}>
                                                    {isAttached ? 'Attached' : isSelected ? 'Selected' : 'Select'}
                                                </span>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                            <span className="text-xs font-medium text-slate-400">
                                {selectedArtifactIds.length > 0 ? `${selectedArtifactIds.length} selected` : 'No selection'}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={closeArtifactPicker}
                                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddSelectedArtifacts}
                                    disabled={selectedArtifactIds.length === 0}
                                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Add
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            <SessionsModal isOpen={isSessionsOpen} onClose={() => setIsSessionsOpen(false)} />
                {featureFlags.importInference && (
                    <ImportSuggestionsModal isOpen={isSuggestionsOpen} onClose={() => setIsSuggestionsOpen(false)} />
                )}
        </div>
    );
}
