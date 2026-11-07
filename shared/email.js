// The Email connector's fixed names, shared by the server (tools, per-bot checks) and the app (bot settings, the card).
// Tool names are upper-snake with the EMAIL_ prefix so the connector grant and scope rules apply unchanged.
/** The connector slug in a bot's connectorScopes.apps and connectorTools. */
export const EMAIL_SLUG = "email";
/** The MCP server name bots see (tools arrive as mcp__email__EMAIL_<ACTION>). */
export const EMAIL_MCP_SERVER = "email";
/** What a bot passes as request_credential's credential_id for the mailbox card. */
export const EMAIL_CREDENTIAL = "email";
export const EMAIL_READ_TOOL_NAMES = ["EMAIL_LIST_MAILBOXES", "EMAIL_LIST_MESSAGES", "EMAIL_SEARCH_MESSAGES", "EMAIL_READ_MESSAGE"];
export const EMAIL_TOOL_NAMES = [...EMAIL_READ_TOOL_NAMES, "EMAIL_SEND_MESSAGE"];
