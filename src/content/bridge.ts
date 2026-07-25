export const getPlayerResponseFromMainWorld = (expectedVideoId: string): Promise<{ success: boolean; data?: any; error?: string }> => {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'GET_PLAYER_RESPONSE', requestId: Math.random().toString(), expectedVideoId },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('bridge error:', chrome.runtime.lastError.message);
            if (chrome.runtime.lastError.message?.includes('invalidated')) {
              resolve({ success: false, error: 'Eklenti güncellendi. Lütfen YouTube sayfasını yenileyin (F5).' });
            } else {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            }
          } else {
            // Background script now returns { success, data, error }
            // data contains diagnostics even if success is false
            resolve(response || { success: false, error: 'Empty response' });
          }
        }
      );
    } catch (e: any) {
      console.error('Failed to send message to background', e);
      if (e.message && e.message.includes('Extension context invalidated')) {
        resolve({ success: false, error: 'Eklenti güncellendi. Lütfen YouTube sayfasını yenileyin (F5).' });
      } else {
        resolve({ success: false, error: e.message });
      }
    }
  });
};
