export const PERSON_TOOL_NAMES = new Set(["message_person"]);
export async function callPersonTool(_name, args, context) {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message)
        return { text: "message_person needs message.", isError: true };
    const { ok, body } = await context.client.apiResponse("/api/internal/people/message", { method: "POST", body: JSON.stringify({ message }) });
    return ok ? { text: String(body.text ?? "Passed on.") } : { text: String(body.error ?? "The message could not be passed on. Try again shortly."), isError: true };
}
export const PERSON_TOOL_DEFINITIONS = [
    {
        name: "message_person",
        description: "Write to the person yourself, in your own main chat with them, and notify them: when you are asked to tell, greet or ping the person, or with news they would miss in this conversation. Only what you write goes, under your name.",
        inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                message: { type: "string", maxLength: 2000, description: "Complete on its own." },
            },
            required: ["message"],
        },
    },
];
