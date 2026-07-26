/**
 * Gemini Gem Prompt Builder
 * Video transkriptini Gemini Gem'e gönderilecek prompt haline dönüştürür.
 */
import { TranscriptSegment } from '../transcript/types';

export interface GemPromptOptions {
  videoTitle: string;
  channelName?: string;
  videoUrl: string;
  languageCode: string;
  sourceType: string;
  summaryLength: 'short' | 'standard' | 'detailed';
  outputLanguage: 'tr' | 'en' | 'tr-en';
}

export class GemPromptBuilder {
  private static readonly MAX_PROMPT_LENGTH = 1000000; // 1M characters

  static buildPrompt(segments: TranscriptSegment[], options: GemPromptOptions): string {
    const lengthMap = {
      short: 'Kısa (3-5 cümle)',
      standard: 'Standart (orta detay)',
      detailed: 'Ayrıntılı (kapsamlı)'
    };

    const langMap = {
      tr: 'Yalnızca Türkçe',
      en: 'Yalnızca İngilizce',
      'tr-en': 'Hem Türkçe hem İngilizce'
    };

    const transcriptText = segments
      .map(s => {
        const timeStr = this.formatTime(s.startTimeMs);
        return `[${timeStr}] ${s.cleanText || s.text}`;
      })
      .join('\n');

    const truncated = transcriptText.length > this.MAX_PROMPT_LENGTH
      ? transcriptText.substring(0, this.MAX_PROMPT_LENGTH) + '\n\n[... transkript kırpıldı ...]'
      : transcriptText;

    return `Aşağıdaki YouTube videosunun transkriptini analiz edip yapılandırılmış bir özet oluştur.

## Video Bilgileri
- Başlık: ${options.videoTitle}
${options.channelName ? `- Kanal: ${options.channelName}` : ''}
- URL: ${options.videoUrl}
- Altyazı Dili: ${options.languageCode}
- Altyazı Türü: ${options.sourceType}

## İstenen Çıktı
- Özet Uzunluğu: ${lengthMap[options.summaryLength]}
- Çıktı Dili: ${langMap[options.outputLanguage]}

## Yapılandırılmış Çıktı Formatı

Lütfen şu bölümleri içeren bir özet oluştur:

1. **Genel Özet**: Videonun ana konusunu özetle.
2. **Ana Fikirler**: En önemli 3-7 fikri madde halinde listele. Her fikrin zaman damgasını belirt.
3. **Bölümler**: Videoyu mantıksal bölümlere ayır. Her bölüm için başlık, özet ve zaman damgası ver.
4. **Önemli Terimler**: Videoda geçen önemli teknik terimleri açıkla.

## Transkript

${truncated}`;
  }

  static formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  static estimatePromptLength(segments: TranscriptSegment[]): number {
    return segments.reduce((sum, s) => sum + (s.cleanText || s.text).length + 10, 0);
  }
}
