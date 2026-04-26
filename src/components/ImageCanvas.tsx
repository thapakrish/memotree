import { Check, ImageIcon, X } from 'lucide-react';
import { useMemo } from 'react';
import { getImageSource } from '../lib/artifactStorage';
import { useGraphStore } from '../store/useGraphStore';

function formatBytes(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageCanvas() {
    const {
        activeNodeId,
        artifacts,
        getPath,
        canvasSelectedArtifactIds,
        toggleCanvasArtifactSelection,
        clearCanvasArtifactSelection,
    } = useGraphStore();

    const path = getPath(activeNodeId);
    const pathNodeIds = useMemo(() => new Set(path.map((node) => node.id)), [path]);
    const branchImages = useMemo(() =>
        Object.values(artifacts)
            .filter((artifact) => !artifact.sourceNodeId || pathNodeIds.has(artifact.sourceNodeId))
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [artifacts, pathNodeIds]);
    const selectedCount = canvasSelectedArtifactIds.filter((id) => artifacts[id]).length;

    return (
        <div className="flex h-full flex-col bg-slate-950 text-slate-100">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950 px-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-blue-300" />
                        <h2 className="truncate text-sm font-semibold">Image Canvas</h2>
                    </div>
                    <p className="truncate text-xs text-slate-400">
                        {branchImages.length} branch image{branchImages.length === 1 ? '' : 's'}
                    </p>
                </div>
                {selectedCount > 0 && (
                    <button
                        onClick={clearCanvasArtifactSelection}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
                        title="Clear canvas selection"
                    >
                        <X className="h-3.5 w-3.5" />
                        {selectedCount} selected
                    </button>
                )}
            </div>

            {branchImages.length === 0 ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-8">
                    <div className="max-w-sm text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-500">
                            <ImageIcon className="h-5 w-5" />
                        </div>
                        <h3 className="mt-4 text-sm font-semibold text-slate-200">No images on this branch</h3>
                        <p className="mt-1 text-sm leading-relaxed text-slate-500">
                            Generated and uploaded images from the active timeline will appear here.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                        {branchImages.map((artifact, index) => {
                            const imageSource = getImageSource(artifact);
                            const isSelected = canvasSelectedArtifactIds.includes(artifact.id);
                            const label = artifact.label ?? artifact.name ?? `Image ${index + 1}`;

                            return (
                                <button
                                    key={artifact.id}
                                    onClick={() => toggleCanvasArtifactSelection(artifact.id)}
                                    className={`group overflow-hidden rounded-lg border text-left transition-colors ${
                                        isSelected
                                            ? 'border-blue-400 bg-blue-500/10 shadow-[0_0_0_1px_rgba(96,165,250,0.45)]'
                                            : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                                    }`}
                                    title={artifact.path}
                                >
                                    <div className="relative aspect-square bg-slate-900">
                                        {imageSource ? (
                                            <img
                                                src={imageSource}
                                                alt={label}
                                                className="h-full w-full object-contain"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center text-slate-600">
                                                <ImageIcon className="h-8 w-8" />
                                            </div>
                                        )}
                                        <div className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border ${
                                            isSelected
                                                ? 'border-blue-300 bg-blue-500 text-white'
                                                : 'border-slate-600 bg-slate-950/80 text-transparent group-hover:text-slate-400'
                                        }`}>
                                            <Check className="h-3.5 w-3.5" />
                                        </div>
                                    </div>
                                    <div className="space-y-1 border-t border-slate-800 px-3 py-2">
                                        <div className="truncate text-xs font-semibold text-slate-100">{label}</div>
                                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                            <span className="truncate">{artifact.origin}</span>
                                            <span>{formatBytes(artifact.sizeBytes) || artifact.mimeType}</span>
                                        </div>
                                        <div className="truncate text-[10px] text-slate-600">{artifact.path}</div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
