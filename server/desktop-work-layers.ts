import { workspacePreparationDockerfile } from "./container-workspace.ts";
import { skillToolsDockerfile } from "./skill-vm-tools.ts";

const PYTHON_PPTX = {
  pin: "python-pptx==1.0.2",
  sha256: "160838e0b8565a8b1f67947675886e9fea18aa5e795db7ae531606d68e785cba",
} as const;

const HYPERFRAMES_CLI = "hyperframes@0.9.26";

/** Documents, data, OCR (English and Indonesian) and media tools, then the bundled skills' scripts and the workspace.
 * Debian 13 ships no python3-pptx, so its hash-pinned wheel goes to the system dist-packages, where python3 imports it
 * beside the Debian libraries it needs. */
export function desktopWorkLayers(workspace: string): string {
  return `RUN set -eux; \\
    export DEBIAN_FRONTEND=noninteractive; \\
    apt-get update; \\
    apt-get install -y --no-install-recommends \\
      python3-pandas python3-numpy python3-scipy python3-matplotlib python3-seaborn python3-openpyxl python3-xlsxwriter \\
      python3-docx python3-pypdf python3-pil python3-lxml python3-bs4 python3-requests python3-typing-extensions \\
      poppler-utils qpdf tesseract-ocr tesseract-ocr-eng tesseract-ocr-ind pandoc ffmpeg imagemagick \\
      libreoffice-impress-nogui libreoffice-writer-nogui libreoffice-calc-nogui \\
      jq unzip zip ripgrep sqlite3; \\
    rm -rf /var/lib/apt/lists/*; \\
    site="$(python3 -c 'import sys; print(f"/usr/local/lib/python3.{sys.version_info.minor}/dist-packages")')"; \\
    printf '%s\\n' '${PYTHON_PPTX.pin} --hash=sha256:${PYTHON_PPTX.sha256}' > /tmp/pptx.txt; \\
    /opt/venv/bin/python -m pip install --no-cache-dir --no-deps --require-hashes --target "$site" -r /tmp/pptx.txt; \\
    rm -f /tmp/pptx.txt; \\
    python3 -c 'import pandas, numpy, matplotlib, seaborn, openpyxl, docx, pptx, pypdf, PIL'; \\
    npm install -g --no-fund --no-audit ${HYPERFRAMES_CLI}; \\
    su cua -c 'hyperframes telemetry disable && hyperframes browser ensure'; \\
    su cua -c 'hyperframes doctor --json' | jq -e '[.checks[] | select(.name == "FFmpeg" or .name == "FFprobe")] | length == 2 and all(.ok)'; \\
    ffmpeg -version >/dev/null; soffice --version; tesseract --list-langs
${skillToolsDockerfile()}${workspacePreparationDockerfile(workspace)}`;
}
