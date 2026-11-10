// Finder may supply file URLs, not bitmap bytes; Chromium decodes, and nothing here reads files or sends clipboard data.
// Electron 47 names a platform's raw clipboard format as `electron application/osclipboard;format="…"`.
const ATTACHMENT_TYPES = [
  "image/png",
  "text/uri-list",
  ...["public.file-url", "NSFilenamesPboardType"].map((format) => `electron application/osclipboard;format="${format}"`),
];

export async function pasteMenuItem(params, clipboard, webContents) {
  let attachment = false;
  if (params.isEditable && !params.editFlags.canPaste) {
    try {
      attachment = (await Promise.all(ATTACHMENT_TYPES.map((type) => clipboard.has(type)))).some(Boolean);
    } catch {}
  }
  return {
    label: "Paste",
    enabled: params.isEditable && (params.editFlags.canPaste || attachment),
    // macOS controls enabled state for native roles, so only the attachment fallback invokes paste explicitly.
    ...(attachment ? { click: () => webContents.paste() } : { role: "paste" }),
  };
}
