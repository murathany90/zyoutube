export const getPlayerResponseFromMainWorld = (expectedVideoId: string): Promise<any> => {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'GET_PLAYER_RESPONSE', requestId: Math.random().toString(), expectedVideoId },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('bridge error:', chrome.runtime.lastError.message);
            resolve(null);
          } else if (response && response.success) {
            resolve(response.data);
          } else {
            console.error('bridge response error:', response?.error);
            resolve(null);
          }
        }
      );
    } catch (e) {
      console.error('Failed to send message to background', e);
      resolve(null);
    }
  });
};
