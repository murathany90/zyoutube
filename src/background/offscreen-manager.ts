let creatingPromise: Promise<void> | null = null;
const OFFSCREEN_DOCUMENT_PATH = '/src/offscreen/api-worker.html';

export async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creatingPromise) {
    await creatingPromise;
    return;
  }

  creatingPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.DOM_SCRAPING] as any, // Using DOM_SCRAPING or WORKERS since fetch doesn't have a specific offscreen reason in older typings
    justification: 'Running background API fetch to bypass service worker 5 minute inactivity limit.'
  });

  try {
    await creatingPromise;
  } finally {
    creatingPromise = null;
  }
}

export async function closeOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (existingContexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}
