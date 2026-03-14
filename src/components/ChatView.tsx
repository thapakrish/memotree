import { useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { Send, CornerDownRight, Cpu, User, KeyRound, Loader2 } from 'lucide-react';
import type { MessageNode } from '../store/types';
import { generateGeminiResponse, interceptMemoryTool } from '../lib/geminiEngine';
import { reconstructMemory } from '../lib/memoryEngine';

export function ChatView() {
    const { activeNodeId, getPath, addNode, setActiveNode, apiKey, setApiKey } = useGraphStore();
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);

    const path = getPath(activeNodeId);

    const handleSend = async () => {
        if (!input.trim() || !apiKey) return;

        // 1. Determine parent for the new user message
        // If the active node is already a user message, we fork from its parent (creating a sibling)
        // to prevent deep chains of user messages without assistant responses.
        const activeNode = path.length > 0 ? path[path.length - 1] : null;
        const parentId = activeNode?.role === 'user' ? activeNode.parentId : activeNodeId;

        // 2. Create User Node
        const userNodeId = addNode({
            parentId: parentId,
            role: 'user',
            content: input,
            memoryPatches: [],
            summary: input.slice(0, 40) + (input.length > 40 ? '...' : ''),
        });

        setInput('');
        setIsTyping(true);

        try {
            // 3. Compute timeline context
            const newPath = getPath(userNodeId);
            const memoryState = reconstructMemory(newPath);

            // 4. Call Gemini
            const response = await generateGeminiResponse(newPath, memoryState, apiKey);

            // Handle text response
            const textContent = response.response.text() || "Processed tool call.";

            // 4. Handle Tool Calls
            const functionCalls = response.response.functionCalls() || [];
            const patches = [];

            for (const call of functionCalls) {
                if (call.name === 'text_editor') {
                    const { patch } = interceptMemoryTool(call.args, memoryState);
                    patches.push(patch);
                }
            }

            // 5. Create Assistant Node
            addNode({
                parentId: userNodeId,
                role: 'assistant',
                content: textContent,
                memoryPatches: patches,
                summary: textContent.slice(0, 40) + '...',
            });

        } catch (err) {
            console.error(err);
            alert("API request failed. Check API Key or console.");
        } finally {
            setIsTyping(false);
        }
    };

    return (
        <div className="w-full h-full flex flex-col bg-white border-r border-slate-200 shadow-sm z-20">
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-6 border-b border-slate-100 bg-white shadow-sm shrink-0">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-800">MemoTree</h1>
                    <p className="text-xs font-medium text-slate-400">Time-Traveling LLM Interface</p>
                </div>
            </div>

            {/* Messages Array */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
                {path.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                        <Cpu className="w-12 h-12 opacity-20" />
                        <p>Send a message to start the trunk of the tree.</p>
                    </div>
                ) : (
                    path.map((msg: MessageNode) => (
                        <div
                            key={msg.id}
                            className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
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
                                className={`p-4 rounded-2xl shadow-sm text-[15px] leading-relaxed relative group ${msg.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-tr-sm'
                                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                                    }`}
                            >
                                {msg.content}

                                {/* Branch Trigger Button */}
                                <button
                                    onClick={() => setActiveNode(msg.id)}
                                    title="Fork conversation from this node"
                                    className={`absolute top-2 ${msg.role === 'user' ? '-left-10 text-slate-400 hover:text-blue-500' : '-right-10 text-slate-400 hover:text-blue-500'} opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-slate-200 rounded-full p-1.5 shadow-sm`}
                                >
                                    <CornerDownRight className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Memory Marker */}
                            {msg.memoryPatches.length > 0 && (
                                <div className="mt-2 text-[11px] font-mono text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 self-start">
                                    + Memory Patched
                                </div>
                            )}
                        </div>
                    ))
                )}
                {isTyping && (
                    <div className="flex items-center gap-2 text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs">Claude is thinking...</span>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-slate-100 shrink-0">
                {!apiKey ? (
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
                    <div className="relative flex items-center">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            disabled={isTyping}
                            placeholder={
                                !activeNodeId ? "Start a new conversation..." :
                                path[path.length - 1]?.role === 'user' ? "Try an alternative prompt..." :
                                "Reply to this message..."
                            }
                            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 pl-4 py-3.5 pr-12 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 transition-all shadow-inner disabled:opacity-50"
                            rows={1}
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isTyping}
                            className="absolute right-2 p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors shadow-sm"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </div>
                )}
                <div className="mt-2 text-center">
                    <span className="text-[11px] font-medium text-slate-400">
                        {activeNodeId ? 'Active Timeline Checkpoint: ' + activeNodeId.slice(0, 8) : 'No Node Selected'}
                    </span>
                </div>
            </div>
        </div>
    );
}
