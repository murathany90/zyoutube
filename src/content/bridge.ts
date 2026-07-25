import { sendRuntimeMessage, RuntimeMessengerError } from './runtime-messenger';

export const getPlayerResponseFromMainWorld = (expectedVideoId: string): Promise<{ success: boolean; data?: any; error?: string }> => {
  return sendRuntimeMessage(
    { type: 'GET_PLAYER_RESPONSE', requestId: Math.random().toString(), expectedVideoId },
    { timeoutMs: 10000 }
  ).then((response: any) => {
    return response || { success: false, error: 'Empty response' };
  }).catch((e: any) => {
    if (e instanceof RuntimeMessengerError && e.code === 'EXTENSION_CONTEXT_INVALIDATED') {
      return { success: false, error: 'Eklenti güncellendi. Lütfen YouTube sayfasını yenileyin (F5).' };
    }
    return { success: false, error: e.message || 'Background ile iletişim kurulamadı.' };
  });
};
