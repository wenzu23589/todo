// Lightweight stand-in for the real Tesseract.js CDN bundle, used only in tests.
// This sandbox's network egress blocks the real jsdelivr CDN (and Tesseract.js's own
// language-model download from tessdata.projectnaptha.com has no local equivalent to
// substitute), so real OCR accuracy can't be exercised end-to-end here. What this fake
// verifies instead is that the app's integration code calls the real, documented
// Tesseract.js API correctly (Tesseract.createWorker(lang) -> worker.recognize(image)
// -> {data:{text}}) and handles the result/error correctly — the app code itself is
// unaware this isn't the real library.
window.Tesseract = {
  createWorker: function () {
    window.__fakeTesseractCreateWorkerCalls = (window.__fakeTesseractCreateWorkerCalls || 0) + 1;
    return Promise.resolve({
      recognize: function (image) {
        window.__fakeOcrRecognizeCalls = (window.__fakeOcrRecognizeCalls || 0) + 1;
        if (window.__fakeOcrShouldFail) return Promise.reject(new Error("fake OCR failure"));
        var text = typeof window.__fakeOcrText === "function" ? window.__fakeOcrText(image) : (window.__fakeOcrText || "");
        return Promise.resolve({ data: { text: text } });
      },
      terminate: function () { return Promise.resolve(); }
    });
  }
};
