// Downloads start here rather than in the popup, which closes as soon as a Save As dialog opens.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'download' || sender.url !== chrome.runtime.getURL('popup.html')) return;
  chrome.downloads.download({url: message.url, filename: message.filename, saveAs: message.saveAs, conflictAction: 'uniquify'})
    .then(id => reply({ok: true, id}), error => reply({ok: false, error: error.message}));
  return true;
});

// Per-site scripts registered by earlier builds are no longer used.
chrome.runtime.onInstalled.addListener(() => chrome.scripting.unregisterContentScripts().catch(() => {}));
