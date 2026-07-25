import { useState, useEffect } from 'react';
import { SummaryResult, AITaskStatus, SummaryRequest } from '../../ai/types';
import { YouTubeTranscriptProvider } from '../../transcript/youtube-provider';
import { AISettingsService } from '../../settings/ai-settings';

export const SummaryTab = ({ videoId, title, url }: { videoId: string, title: string, url: string }) => {
  const [status, setStatus] = useState<AITaskStatus>('queued');
  const [progressMessage, setProgressMessage] = useState<string>('Başlatılıyor...');
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);

  useEffect(() => {
    // Dinleyici kaydet (Background üzerinden gelen ilerleme ve sonuç mesajlarını yakalamak için)
    const listener = (message: any) => {
      if (message.taskId !== taskId) return;
      
      if (message.type === 'SUMMARY_PROGRESS') {
        setStatus(message.status);
        if (message.message) setProgressMessage(message.message);
      } else if (message.type === 'SUMMARY_COMPLETED') {
        setResult(message.result);
        setStatus('completed');
        setIsProcessing(false);
      } else if (message.type === 'SUMMARY_FAILED') {
        setError(message.error.userMessage);
        setStatus('failed');
        setIsProcessing(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [taskId]);

  const startSummary = async () => {
    try {
      setIsProcessing(true);
      setError(null);
      setStatus('preparing');
      setProgressMessage('Transkript çekiliyor...');

      const provider = new YouTubeTranscriptProvider();
      const settings = await AISettingsService.getSettings();
      const tracks = await provider.getAvailableTracks(videoId);
      if (tracks.length === 0) throw new Error('Transkript bulunamadı.');
      const track = tracks.find(t => t.languageCode === settings.defaultLanguage) || tracks[0];
      const transcriptResult = await provider.fetchTranscript(videoId, track);

      const request: SummaryRequest = {
        taskId: `task_${Date.now()}`,
        video: { videoId, title, url },
        transcript: {
          languageCode: track.languageCode,
          sourceType: track.sourceType || 'unknown',
          qualityLevel: transcriptResult.quality?.level || 'medium',
          qualityReasons: transcriptResult.quality?.reasons || [],
          segments: transcriptResult.segments
        },
        options: {
          length: settings.defaultLength,
          outputLanguage: settings.defaultLanguage,
          includeKeyIdeas: true,
          includeSections: true,
          includeActionItems: true
        }
      };

      setTaskId(request.taskId);

      setProgressMessage('AI Provider aranıyor...');
      
      chrome.runtime.sendMessage({
        type: 'START_SUMMARY',
        request
      });
      
    } catch (e: any) {
      setError(e.message || 'Transkript çekilemedi.');
      setIsProcessing(false);
      setStatus('failed');
    }
  };

  const cancelSummary = () => {
    if (taskId) {
      chrome.runtime.sendMessage({ type: 'CANCEL_SUMMARY', taskId });
      setIsProcessing(false);
      setStatus('cancelled');
      setProgressMessage('İptal edildi.');
    }
  };

  if (!isProcessing && !result && status !== 'cancelled' && status !== 'failed') {
    return (
      <div className="text-sm flex flex-col items-start gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
        <p className="text-gray-700 dark:text-gray-300">Bu video için henüz bir özet oluşturulmadı.</p>
        <button 
          onClick={startSummary}
          className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-full transition shadow-sm"
        >
          Şimdi Özetle
        </button>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-4 border-red-200 border-t-red-600 rounded-full animate-spin"></div>
        <div className="text-center">
          <h3 className="font-bold text-gray-800 dark:text-gray-200">İşleniyor</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{progressMessage}</p>
        </div>
        <button 
          onClick={cancelSummary}
          className="mt-2 px-4 py-1 text-sm text-gray-600 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition"
        >
          İptal Et
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
        <p className="font-bold mb-2">Özetleme Başarısız</p>
        <p>{error}</p>
        <button 
          onClick={startSummary}
          className="mt-4 px-4 py-1.5 bg-red-100 hover:bg-red-200 dark:bg-red-800 dark:hover:bg-red-700 rounded font-medium transition"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="p-4 border border-gray-200 rounded-lg text-sm text-gray-600 dark:text-gray-400">
        <p>İşlem kullanıcı tarafından iptal edildi.</p>
        <button 
          onClick={startSummary}
          className="mt-4 px-4 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded font-medium transition"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  if (result) {
    const isTurkish = result.outputLanguage.includes('tr');
    
    return (
      <div className="space-y-6 animate-fade-in">
        {/* Main Summary */}
        <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <h3 className="font-bold text-lg mb-2 text-gray-900 dark:text-gray-100">Özet</h3>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            {isTurkish ? result.summary.tr : result.summary.en}
          </p>
        </div>

        {/* Key Ideas */}
        {result.keyIdeas && result.keyIdeas.length > 0 && (
          <div>
            <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded flex items-center justify-center text-xs">💡</span>
              Ana Fikirler
            </h3>
            <ul className="space-y-3">
              {result.keyIdeas.map((ki, idx) => (
                <li key={idx} className="flex gap-3 items-start p-3 bg-white dark:bg-[#1a1a1a] border border-gray-100 dark:border-gray-700/50 rounded-lg shadow-sm">
                  {ki.startTimeMs !== null && ki.startTimeMs !== undefined && (
                    <button className="text-xs bg-gray-100 dark:bg-gray-800 hover:bg-red-50 hover:text-red-600 dark:hover:text-red-400 px-2 py-1 rounded text-gray-600 transition shrink-0">
                      {formatTime(ki.startTimeMs)}
                    </button>
                  )}
                  <div>
                    <h4 className="font-bold text-gray-800 dark:text-gray-200">
                      {isTurkish ? ki.title?.tr : ki.title?.en}
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {isTurkish ? ki.description?.tr : ki.description?.en}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Sections */}
        {result.sections && result.sections.length > 0 && (
          <div>
             <h3 className="font-bold text-lg mb-3">Bölümler</h3>
             <div className="space-y-4 border-l-2 border-gray-200 dark:border-gray-700 pl-4">
               {result.sections.map((sec, idx) => (
                 <div key={idx} className="relative">
                   <div className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-red-400 border-[3px] border-white dark:border-[#272727] box-content"></div>
                   <h4 className="font-bold text-gray-800 dark:text-gray-200">
                     {isTurkish ? sec.title?.tr : sec.title?.en}
                     {sec.startTimeMs !== null && sec.startTimeMs !== undefined && (
                       <span className="ml-2 text-xs font-normal text-gray-500">[{formatTime(sec.startTimeMs)}]</span>
                     )}
                   </h4>
                   <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                     {isTurkish ? sec.summary?.tr : sec.summary?.en}
                   </p>
                 </div>
               ))}
             </div>
          </div>
        )}

        <div className="text-xs text-gray-400 dark:text-gray-500 flex justify-between border-t border-gray-200 dark:border-gray-700 pt-3">
          <span>Sağlayıcı: {result.providerId} ({result.model})</span>
          {result.usage && (
            <span>Tokens: In {result.usage.inputTokens} | Out {result.usage.outputTokens}</span>
          )}
        </div>
      </div>
    );
  }

  return null;
};

// Helper for formatting ms to mm:ss
function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
