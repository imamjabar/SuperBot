#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <presentation.pptx> [output_directory]" >&2
    exit 1
fi

PPTX_PATH="$1"
if [ ! -f "$PPTX_PATH" ]; then
    echo "Error: file not found: $PPTX_PATH" >&2
    exit 1
fi

BASENAME="$(basename "$PPTX_PATH" .pptx)"
OUTDIR="${2:-${BASENAME}_renders}"
mkdir -p "$OUTDIR"

echo "Converting $PPTX_PATH to PDF via LibreOffice headless..."
soffice --headless --convert-to pdf "$PPTX_PATH" --outdir "$OUTDIR"

PDF_PATH="$OUTDIR/${BASENAME}.pdf"
if [ ! -f "$PDF_PATH" ]; then
    echo "Error: PDF conversion failed; expected $PDF_PATH" >&2
    exit 1
fi

echo "Rendering slides to 1280px PNGs via pdftoppm..."
pdftoppm -png -scale-to-x 1280 -scale-to-y -1 "$PDF_PATH" "$OUTDIR/slide"

PNG_COUNT=$(find "$OUTDIR" -name "slide-*.png" | wc -l | tr -d ' ')
echo "Rendered $PNG_COUNT slide images in $OUTDIR."

if [ "$PNG_COUNT" -gt 0 ]; then
    CONTACT_SHEET="$OUTDIR/contact_sheet.png"
    echo "Creating contact sheet via montage..."
    montage "$OUTDIR"/slide-*.png -tile 3x -geometry +10+10 -background '#202020' "$CONTACT_SHEET"
    echo "Contact sheet ready: $CONTACT_SHEET"
fi

echo "Render complete."
