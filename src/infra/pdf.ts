function escapePdfText(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "")
    .replace(/\n/g, " ");
}

/**
 * Wrap text to fit within PDF page width.
 * Page width: 595 points, margins: 40 left + 40 right = 80, usable width: ~515 points
 * Font size: 10pt Helvetica, approximate char width: ~6 points
 * Max characters per line: ~85, using 80 for safety
 */
function wrapText(text: string, maxWidth: number = 80): string[] {
  if (text.length <= maxWidth) {
    return [text];
  }

  const words = text.split(/\s+/);
  const wrapped: string[] = [];
  let currentLine = "";

  for (const word of words) {
    // If word itself is longer than maxWidth, break it
    if (word.length > maxWidth) {
      if (currentLine) {
        wrapped.push(currentLine.trim());
        currentLine = "";
      }
      // Break long word into chunks
      for (let i = 0; i < word.length; i += maxWidth) {
        wrapped.push(word.slice(i, i + maxWidth));
      }
      continue;
    }

    // Check if adding this word would exceed maxWidth
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        wrapped.push(currentLine.trim());
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    wrapped.push(currentLine.trim());
  }

  return wrapped.length > 0 ? wrapped : [text];
}

function buildPdfContentLines(lines: string[]): string {
  let y = 790;
  const content: string[] = ["BT", "/F1 10 Tf"];

  for (const line of lines) {
    if (y < 40) {
      break; // keep single-page for MVP
    }
    
    // Wrap long lines to fit page width
    const wrapped = wrapText(line);
    
    for (const wrappedLine of wrapped) {
      if (y < 40) {
        break;
      }
      const safe = escapePdfText(wrappedLine);
      content.push(`1 0 0 1 40 ${y} Tm (${safe}) Tj`);
      y -= 14;
    }
  }

  content.push("ET");
  return content.join("\n");
}

function pushObject(chunks: string[], offsets: number[], objNo: number, body: string): void {
  offsets[objNo] = chunks.join("").length;
  chunks.push(`${objNo} 0 obj\n${body}\nendobj\n`);
}

export function buildSummaryPdf(lines: string[]): Buffer {
  const pdfChunks: string[] = [];
  const offsets: number[] = [];
  pdfChunks.push("%PDF-1.4\n");

  pushObject(pdfChunks, offsets, 1, "<< /Type /Catalog /Pages 2 0 R >>");
  pushObject(pdfChunks, offsets, 2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  pushObject(
    pdfChunks,
    offsets,
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
  );
  pushObject(pdfChunks, offsets, 4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const stream = buildPdfContentLines(lines);
  pushObject(pdfChunks, offsets, 5, `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);

  const xrefStart = pdfChunks.join("").length;
  pdfChunks.push("xref\n0 6\n0000000000 65535 f \n");
  for (let i = 1; i <= 5; i++) {
    const off = offsets[i] ?? 0;
    pdfChunks.push(`${String(off).padStart(10, "0")} 00000 n \n`);
  }
  pdfChunks.push("trailer\n<< /Size 6 /Root 1 0 R >>\n");
  pdfChunks.push(`startxref\n${xrefStart}\n%%EOF\n`);

  return Buffer.from(pdfChunks.join(""), "utf8");
}
