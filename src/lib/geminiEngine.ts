import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { FunctionDeclaration } from "@google/generative-ai";
import type { MessageNode, MemoryPatch } from '../store/types';
import { computePatch } from './memoryEngine';

// For the MVP, we use the browser with BYOK (Bring Your Own Key)
let geminiClient: GoogleGenerativeAI | null = null;

export const initGemini = (apiKey: string) => {
    geminiClient = new GoogleGenerativeAI(apiKey);
    return geminiClient;
};

// Official-like schema for editing the simulated memory system using Gemini Function Calling
export const TEXT_EDITOR_TOOL: FunctionDeclaration = {
    name: "text_editor",
    description: "Edit the /memories filesystem to store persistent facts across conversations. NEVER use JSON arrays, only Key-Value dictionaries (EASE protocol).",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            command: {
                type: SchemaType.STRING,
                description: "The edit operation to perform. Must be strictly 'create' or 'str_replace'"
            },
            path: {
                type: SchemaType.STRING,
                description: "Absolute path in the /memories/ directory, e.g. /memories/facts.json"
            },
            file_text: {
                type: SchemaType.STRING,
                description: "Complete text content when using the 'create' command."
            },
            old_str: {
                type: SchemaType.STRING,
                description: "Exact exact string to replace when using 'str_replace' command."
            },
            new_str: {
                type: SchemaType.STRING,
                description: "New text to insert in place of old_str."
            }
        },
        required: ["command", "path"]
    }
};

// Emulates the file edit and generates a JSON Patch
export function interceptMemoryTool(
    toolArgs: any,
    currentMemoryState: string
): { updatedMemory: string; patch: MemoryPatch } {
    let newText = currentMemoryState;

    if (toolArgs.command === 'create') {
        newText = toolArgs.file_text || "{}";
    } else if (toolArgs.command === 'str_replace') {
        newText = currentMemoryState.replace(toolArgs.old_str, toolArgs.new_str);
    }

    const diffText = computePatch(currentMemoryState, newText);
    return {
        updatedMemory: newText,
        patch: { diffText }
    };
}

export async function generateGeminiResponse(
    chatPath: MessageNode[],
    memoryState: string,
    apiKey: string
) {
    if (!geminiClient) initGemini(apiKey);

    const model = geminiClient!.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: `You are MemoTree AI.
You have access to a text_editor tool to save long-term facts in /memories/.
<memory_files>
/memories/facts.json:
${memoryState}
</memory_files>
CRITICAL: EASE Protocol active. No JSON arrays allowed in memory files. Use key-value only.`,
        tools: [{
            functionDeclarations: [TEXT_EDITOR_TOOL]
        }]
    });

    const contents = chatPath.map(node => ({
        role: node.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: node.content }],
    }));

    const response = await model.generateContent({
        contents
    });

    return response;
}
