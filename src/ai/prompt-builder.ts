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
5. Zaman damgalarını yalnızca transkriptte verilen HH:MM:SS veya MM:SS biçiminde kullan. Milisaniye, ham sayı veya yeni zaman damgası üretme.
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

  static buildApiRequestBody(request: SummaryRequest, config: any, customContent?: string): any {
    const model = config.model || 'gpt-3.5-turbo';
    const systemPrompt = this.buildSystemPrompt(request, undefined);
    const userPrompt = this.buildUserPrompt(request, undefined, customContent);

    const body: any = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: config.temperature ?? 0.7
    };

    const tokenParam = config.summaryTokenParam === 'max_completion_tokens'
      ? 'max_completion_tokens'
      : 'max_tokens';
    body[tokenParam] = config.maxTokens ?? 4000;

    if (config.summaryStreaming === true) {
      body.stream = true;
      if (config.summaryStreamOptions === true) {
        body.stream_options = { include_usage: true };
      }
    }
    
    if (config.enableReasoning === true) {
      body.chat_template_kwargs = { thinking: true, reasoning_effort: "high" };
    }

    if (
      config.summaryJsonMode === true ||
      (
        config.summaryJsonMode === undefined &&
        config.responseMode === 'json'
      )
    ) {
      body.response_format = { type: 'json_object' };
    }

    return body;
  }

  private static formatTranscript(request: SummaryRequest): string {
    return request.transcript.segments
      .map(s => `[${this.formatTimestampMs(s.startTimeMs)}] ${s.cleanText || s.text}`)
      .join('\n');
  }

  public static formatTimestampMs(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return [
        hours,
        minutes.toString().padStart(2, "0"),
        seconds.toString().padStart(2, "0")
      ].join(":");
    }

    return [
      minutes,
      seconds.toString().padStart(2, "0")
    ].join(":");
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
