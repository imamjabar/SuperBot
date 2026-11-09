export const READ_FILE_TOOL_DEFINITION = {
  name: "read_file",
  description:
    "Get the text of a file the person attached or a file in your workspace: pass the path from an <attached-file> tag. PDF, Word (.docx), PowerPoint (.pptx), text, Markdown, HTML, JSON and code files. Up to 12,000 characters per call; pass offset to continue, or find to get only the passages around some words (' | ' for alternatives). Spreadsheets (.xlsx, .csv): use data_load for cells and tables. to_computer: true also copies the file into your Local VM workspace (/home/cua/workspace/uploads/<name>) for Python or shell work. Attached images you already see.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        minLength: 1,
        maxLength: 2048,
        description: "File path from an <attached-file> tag or a file in your workspace roots.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        description: "Character offset to continue from (the previous call's next offset).",
      },
      find: {
        type: "string",
        minLength: 2,
        maxLength: 200,
        description: "Words to search for; returns only the passages around them. Separate alternatives with ' | '.",
      },
      to_computer: {
        type: "boolean",
        description: "Also copy the file into your Local VM workspace (/home/cua/workspace/uploads/<name>) for Python or shell work.",
      },
    },
    required: ["path"],
  },
};
