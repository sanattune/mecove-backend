/**
 * Render HTML (full document with inline CSS) to PDF using Puppeteer.
 * This is the only PDF generation method - HTML template is required.
 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  try {
    const puppeteer = await import("puppeteer");
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    const browser = await puppeteer.default.launch({
      executablePath: executablePath || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      headless: true,
    });
    try {
      const page = await browser.newPage();
      // Don't use networkidle0: the template may load Google Fonts; that can hang.
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "16px", right: "16px", bottom: "16px", left: "16px" },
      });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Puppeteer PDF rendering failed: ${errorMsg}`);
  }
}
