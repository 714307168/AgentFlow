(function initClientCapabilities(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ClientCapabilities = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createClientCapabilities() {
  const desktopCapabilities = Object.freeze({
    localCommandGateway: true,
    diagnosticsBundle: true,
    messageAttachmentImages: true,
    messageAttachmentFiles: true,
    clipboardImagePaste: true,
    inlineAttachmentPreview: true,
    providerRuntimeStatus: true,
  });

  function getDesktopCapabilities() {
    return { ...desktopCapabilities };
  }

  function supportsDesktopCapability(key) {
    return desktopCapabilities[key] === true;
  }

  return {
    getDesktopCapabilities,
    supportsDesktopCapability,
  };
});
