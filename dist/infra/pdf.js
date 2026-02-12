"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSummaryPdf = buildSummaryPdf;
function escapePdfText(input) {
    return input
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
        .replace(/\r/g, "")
        .replace(/\n/g, " ");
}
function buildPdfContentLines(lines) {
    let y = 790;
    const content = ["BT", "/F1 10 Tf"];
    for (const line of lines) {
        if (y < 40) {
            break; // keep single-page for MVP
        }
        const safe = escapePdfText(line);
        content.push(`1 0 0 1 40 ${y} Tm (${safe}) Tj`);
        y -= 14;
    }
    content.push("ET");
    return content.join("\n");
}
function pushObject(chunks, offsets, objNo, body) {
    offsets[objNo] = chunks.join("").length;
    chunks.push(`${objNo} 0 obj\n${body}\nendobj\n`);
}
function buildSummaryPdf(lines) {
    const pdfChunks = [];
    const offsets = [];
    pdfChunks.push("%PDF-1.4\n");
    pushObject(pdfChunks, offsets, 1, "<< /Type /Catalog /Pages 2 0 R >>");
    pushObject(pdfChunks, offsets, 2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    pushObject(pdfChunks, offsets, 3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>");
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
