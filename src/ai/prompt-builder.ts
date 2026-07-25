import { SummaryRequest, PromptType } from './types';

export class PromptBuilder {
  static buildSystemPrompt(request: SummaryRequest, type: PromptType = 'single'): string {
    const langInstructions = this.getLanguageInstructions(request.options.outputLanguage);
    const lengthInstructions = this.getLengthInstructions(request.options.length);

    let role = `Sen uzman bir video analiz asistanısın. Görevin, sana sağlanan video transkriptini temel alarak yapılandırılmış bir özet üretmektir.`;
    if (type === 'chunk') {
       role = `Sen uzman bir video analiz asistanısın. Görevin, sana sağlanan VİDEONUN SADECE BİR KISMINA ait transkripti analiz ederek, bu kısımla ilgili yapılandırılmış bir ara özet (intermediate summary) üretmektir.`;
    } else if (type === 'merge') {
       role = `Sen uzman bir video analiz asistanısın. Görevin, uzun bir videonun çeşitli kısımlarından üretilmiş ARA ÖZETLERİ (JSON dizisi olarak sağlanacaktır) birleştirerek, TEK VE NİHAİ yapılandırılmış bir özet JSON'u oluşturmaktır. Tekrarlanan fikirleri azalt, en önemli 5 ana fikri seç. Zaman damgalarının (timestamps) sınırlarını ve doğruluğunu koru.`;
    }

    return `${role}

KURALLAR:
1. YALNIZCA sağlanan içeriğe dayan. Bulunmayan hiçbir bilgiyi uydurma (halüsinasyon yapma).
2. Transkriptte konuyla ilgili bilgi yoksa, bunu açıkça belirt.
3. Zaman damgalarını (timestamps) YALNIZCA verilen segmentlerden al.
4. Videoda doğrudan belirtilen bilgiler ile kendi çıkarımların/tahminlerin arasına net bir çizgi çek.
5. JSON ŞEMASINA KESİNLİKLE UY. Markdown \`\`\`json bloğu içinde YALNIZCA geçerli bir JSON döndür. JSON haricinde metin yazma.
6. İstenen dil ayarına kesinlikle uy.
${langInstructions}
${lengthInstructions}
7. Zaman damgaları (startTimeMs, endTimeMs vb.) milisaniye (ms) cinsinden bir tam sayı (number) olmalıdır. Eğer uygun bir zaman bulunamıyorsa \`null\` kullanın.
8. "keyIdeas" alanında en fazla 5 ana fikir (veya varsa daha az) bulunmalıdır.`;
  }

  static buildUserPrompt(request: SummaryRequest, type: PromptType = 'single', customContent?: string): string {
    const content = customContent ? customContent : this.formatTranscript(request);
    
    let instructions = `Lütfen bu transkripte dayanarak sonucu belirtilen JSON formatında üret.`;
    if (type === 'chunk') instructions = `Lütfen transkriptin BU PARÇASINA dayanarak ara JSON özetini üret.`;
    else if (type === 'merge') instructions = `Lütfen bu ARA ÖZETLERİ birleştirerek NİHAİ JSON sonucunu üret.`;

    return `Video Bilgileri:
Başlık: ${request.video.title}
Kanal: ${request.video.channelName || 'Bilinmiyor'}

İçerik:
${content}

${instructions}`;
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
