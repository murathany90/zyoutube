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
4. Çıktı formatı olarak AŞAĞIDAKİ ŞABLONA KESİNLİKLE UY. Herhangi bir kod bloğu, JSON, HTML veya ek açıklama üretme.
${langInstructions}
${lengthInstructions}
5. Zaman damgalarını şu biçimde ekle: ▶ \`[ZAMAN]\` AÇIKLAMA.

ÇIKTI ŞABLONU:
📝 Genel Özet
[Tek paragraf özet]

⏱️ Zaman Damgalı Detaylı Özet
▶ \`[KAYNAKTAKİ ZAMAN]\` [Bu zamanda anlatılan önemli konu]
▶ \`[KAYNAKTAKİ ZAMAN]\` [Bu zamanda anlatılan önemli konu]

🎯 Sonuç
[Tek bir toparlayıcı paragraf]

💡 Çıkarımlar
[Birinci çıkarım]
[İkinci çıkarım]
[Üçüncü çıkarım]

🔍 Araştır
[Birinci araştırma konusu]
[İkinci araştırma konusu]
[Üçüncü araştırma konusu]`;
  }

  static buildUserPrompt(request: SummaryRequest, type: PromptType = 'single', customContent?: string): string {
    const content = customContent ? customContent : this.formatTranscript(request);
    
    let instructions = `Lütfen bu transkripte dayanarak sonucu belirtilen Markdown şablonu formatında üret.`;
    if (type === 'chunk') instructions = `Lütfen transkriptin BU PARÇASINA dayanarak ara özetini Markdown olarak üret.`;
    else if (type === 'merge') instructions = `Lütfen bu ARA ÖZETLERİ birleştirerek NİHAİ sonucu Markdown formatında üret.`;

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
