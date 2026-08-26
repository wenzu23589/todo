// Lightweight stand-in for the real pdfjs-dist CDN bundle, used only in tests (see
// fake-tesseract.js for why). Verifies the app calls the real, documented pdfjs-dist
// API correctly (getDocument({data}).promise -> pdf.numPages / pdf.getPage(n) ->
// page.getTextContent() for the fast text-layer path, or page.getViewport()+
// page.render({canvasContext,viewport}) for the OCR-fallback render-to-canvas path).
//
// Rather than parsing real PDF bytes, this fake reads a small JSON payload from the
// "PDF" file's own bytes — {"pages": ["page 1 text", "page 2 text", ...]} — so test
// fixtures can be tiny, deterministic, and don't require a real PDF encoder. An empty
// string for a page means "no text layer on this page", exercising the OCR fallback.
export const GlobalWorkerOptions = {};

export function getDocument(opts) {
  window.__fakePdfjsGetDocumentCalls = (window.__fakePdfjsGetDocumentCalls || 0) + 1;
  var buf = opts && opts.data;
  var text = new TextDecoder().decode(buf);
  var payload;
  try { payload = JSON.parse(text); } catch (e) { payload = { pages: [""] }; }
  var pages = payload.pages || [""];
  var pdfProxy = {
    numPages: pages.length,
    getPage: function (n) {
      var pageText = pages[n - 1] || "";
      return Promise.resolve({
        getTextContent: function () {
          return Promise.resolve({ items: pageText ? [{ str: pageText }] : [] });
        },
        getViewport: function () { return { width: 20, height: 20 }; },
        render: function () { return { promise: Promise.resolve() }; }
      });
    }
  };
  return { promise: Promise.resolve(pdfProxy) };
}
