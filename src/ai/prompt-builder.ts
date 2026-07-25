import { SummaryRequest } from './types';

export class PromptBuilder {
  static buildSystemPrompt(request: SummaryRequest): string {
    const langInstructions = this.getLanguageInstructions(request.options.outputLanguage);
    const lengthInstructions = this.getLengthInstructions(request.options.length);

    return `Sen uzman bir video analiz asistanısın. Görevin, sana sağlanan video transkriptini temel alarak yapılandırılmış bir özet üretmektir.

KURALLAR:
1. YALNIZCA sağlanan transkript içeriğine dayan. Transkriptte bulunmayan hiçbir bilgiyi uydurma (halüsinasyon yapma).
2. Transkriptte konuyla ilgili bilgi yoksa, bunu açıkça belirt ("Bu konu hakkında bilgi verilmemiştir" vb.).
3. Zaman damgalarını (timestamps) YALNIZCA verilen segmentlerden al.
4. Videoda doğrudan belirtilen bilgiler ile kendi çıkarımların/tahminlerin arasına net bir çizgi çek.
5. Otomatik oluşturulmuş altyazı hatalarını veya anlamsız kelimeleri düzeltmeye çalış, ancak kesin gerçek gibi sunma. Teknik terimleri koru.
6. JSON ŞEMASINA KESİNLİKLE UY. Markdown \`\`\`json bloğu içinde YALNIZCA geçerli bir JSON döndür. JSON haricinde hiçbir ekstra açıklama, metin veya selamlama yazma.
7. İstenen dil ayarına kesinlikle uy.
${langInstructions}
${lengthInstructions}
8. Zaman damgaları (startTimeMs, endTimeMs vb.) milisaniye (ms) cinsinden bir tam sayı (number) olmalıdır. Eğer uygun bir zaman bulunamıyorsa \`null\` kullanın.
9. "keyIdeas" alanında en fazla 5 ana fikir (veya varsa daha az) bulunmalıdır.`;
  }

  static buildUserPrompt(request: SummaryRequest): string {
    const transcriptText = this.formatTranscript(request);
    
    return `Video Bilgileri:
Başlık: ${request.video.title}
Kanal: ${request.video.channelName || 'Bilinmiyor'}

Transkript Parçası:
${transcriptText}

Lütfen bu transkripte dayanarak sonucu belirtilen JSON formatında üret.`;
  }

  private static formatTranscript(request: SummaryRequest): string {
    // Basic chunking string format
    return request.transcript.segments
      .map(s => `[${s.startTimeMs}] ${s.cleanText || s.text}`)
      .join('\n');
  }

  private static getLanguageInstructions(lang: 'tr' | 'en' | 'tr-en'): string {
    switch (lang) {
      case 'tr':
        return `ÇIKTI DİLİ: Yalnızca Türkçe (LocalizeText objelerindeki 'tr' alanını kullan, 'en' alanını boş bırak).`;
      case 'en':
        return `ÇIKTI DİLİ: Yalnızca İngilizce (LocalizeText objelerindeki 'en' alanını kullan, 'tr' alanını boş bırak).`;
      case 'tr-en':
        return `ÇIKTI DİLİ: Çift dilli. LocalizeText objelerinde hem 'tr' hem 'en' alanlarını doldur.`;
    }
  }

  private static getLengthInstructions(length: 'short' | 'standard' | 'detailed'): string {
    switch (length) {
      case 'short':
        return `ÖZET UZUNLUĞU: Kısa (3-5 cümle). Sadece videonun amacını ve temel sonucunu ver. Bölüm listesi (sections) eklemek zorunlu değildir. En fazla 5 ana fikir (key ideas) ver.`;
      case 'standard':
        return `ÖZET UZUNLUĞU: Standart. Genel bir özet, en fazla 5 ana fikir, temel bölümler (sections) ve varsa eylem maddeleri (action items) ekle.`;
      case 'detailed':
        return `ÖZET UZUNLUĞU: Ayrıntılı. Geniş çaplı bir özet, detaylı bölüm açıklamaları, tüm temel kavramlar (important terms), eylem maddeleri (action items) ve belirsizlikler/uyarılar.`;
    }
  }
}
