import { extractText, getDocumentProxy } from "unpdf";
const MAX_PDF_PAGES = 300;
export async function pdfText(bytes) {
    try {
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const { totalPages, text } = await extractText(pdf, { mergePages: false });
        const pageList = Array.isArray(text) ? text : typeof text === "string" ? [text] : [];
        const total = totalPages || pageList.length || 1;
        const limit = Math.min(pageList.length, MAX_PDF_PAGES);
        const blocks = [];
        for (let i = 0; i < limit; i++) {
            const pageNum = i + 1;
            const raw = pageList[i] ?? "";
            const cleaned = raw
                .split(/\r?\n/)
                .map((line) => line.replace(/\s+/g, " ").trim())
                .join("\n")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
            blocks.push(cleaned ? `[page ${pageNum}]\n${cleaned}` : `[page ${pageNum}]`);
        }
        if (total > MAX_PDF_PAGES) {
            blocks.push(`[stopped after ${MAX_PDF_PAGES} of ${total} pages]`);
        }
        return {
            text: blocks.join("\n\n").trim(),
            pages: total,
        };
    }
    catch {
        return undefined;
    }
}
