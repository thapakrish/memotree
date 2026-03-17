import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check } from 'lucide-react';
import type { Components } from 'react-markdown';

function CopyButton({ text }: { text: string }) {
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
            className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-slate-600 hover:text-white"
            title="Copy code"
        >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : failed ? 'Failed' : 'Copy'}
        </button>
    );
}

const markdownComponents: Components = {
    h1: ({ children }) => <h1 className="mt-4 mb-2 text-xl font-bold text-slate-900">{children}</h1>,
    h2: ({ children }) => <h2 className="mt-4 mb-2 text-lg font-bold text-slate-900">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-base font-bold text-slate-900">{children}</h3>,
    h4: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-bold text-slate-800">{children}</h4>,
    p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="mb-3 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-3 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    blockquote: ({ children }) => (
        <blockquote className="my-3 border-l-4 border-slate-300 pl-4 text-slate-600 italic">
            {children}
        </blockquote>
    ),
    hr: () => <hr className="my-4 border-slate-200" />,
    a: ({ href, children }) => (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
        >
            {children}
        </a>
    ),
    strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    code: ({ className, children, ...props }) => {
        const rawText = extractTextContent(children);
        const isInline = !className && !rawText.includes('\n');
        if (isInline) {
            return (
                <code
                    className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800 border border-slate-200"
                    {...props}
                >
                    {children}
                </code>
            );
        }
        return (
            <code className={`${className ?? ''} text-[13px] leading-relaxed`} {...props}>
                {children}
            </code>
        );
    },
    pre: ({ children }) => {
        // Extract raw text from the code element for copy button
        const codeEl = children as React.ReactElement<{ children?: React.ReactNode }>;
        const rawText = extractTextContent(codeEl?.props?.children);

        return (
            <div className="group relative my-3">
                <CopyButton text={rawText} />
                <pre className="overflow-x-auto rounded-xl bg-slate-900 px-4 py-4 text-[13px] leading-relaxed text-slate-100">
                    {children}
                </pre>
            </div>
        );
    },
    table: ({ children }) => (
        <div className="my-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">{children}</table>
        </div>
    ),
    thead: ({ children }) => <thead className="bg-slate-100">{children}</thead>,
    tr: ({ children }) => <tr className="border-b border-slate-200">{children}</tr>,
    th: ({ children }) => (
        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            {children}
        </th>
    ),
    td: ({ children }) => <td className="px-3 py-2 text-slate-700">{children}</td>,
};

function extractTextContent(node: React.ReactNode): string {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(extractTextContent).join('');
    if (node && typeof node === 'object' && 'props' in (node as object)) {
        const el = node as React.ReactElement<{ children?: React.ReactNode }>;
        return extractTextContent(el.props?.children);
    }
    return '';
}

interface MarkdownRendererProps {
    text: string;
    isStreaming?: boolean;
}

export function MarkdownRenderer({ text, isStreaming }: MarkdownRendererProps) {
    return (
        <div className="markdown-body min-w-0">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={markdownComponents}
            >
                {text}
            </ReactMarkdown>
            {isStreaming && (
                <span className="inline-block h-4 w-0.5 animate-pulse bg-slate-500 align-text-bottom" />
            )}
        </div>
    );
}
