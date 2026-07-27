import { CorrectionRequest } from './types';
export class CorrectionPromptBuilder {
  static buildSystemPrompt(): string {
    return `Sen uzman bir dilbilimci ve çevirmensin. Görevin, sana sağlanan bölük pörçük YouTube altyazılarını anlam bütünlüğü olan, gramer olarak doğru doğal cümleler halinde gruplandırmak ve çift dilli (Türkçe ve İngilizce) olarak düzeltmektir.

KURALLAR:
1. Altyazı parçalarını (segmentleri) sabit sayılarda DEĞİL, anlam bütünlüğü oluşturan doğal tam cümleler halinde birleştir (bir cümle 1 ila 6 veya daha fazla segment sürebilir).
2. Hiçbir şekilde ÖZETLEME YAPMA. Bilgi ekleme veya çıkarma. Orijinal metnin tam anlamını koru.
3. Her kaynak segment YALNIZCA BİR düzeltilmiş cümlenin 'sourceSegmentIds' dizisine dahil edilmelidir.
4. Segmentlerin orijinal sırasını KESİNLİKLE değiştirme.
5. Hem Türkçe hem de İngilizce çıktının doğal, gramere uygun ve anlamca birbirine tam eşdeğer olduğundan emin ol.
6. Yalnızca tek bir JSON nesnesi döndür.
7. Açıklama, giriş, sonuç, markdown ve kod bloğu ekleme.
8. Yanıt ilk karakter olarak { ile başlamalı, son karakter olarak } ile bitmeli.
9. sentences dışında üst seviye alan ekleme.
10. Girdi segmentleri dizi formatındadır: [index, startTimeMs, endTimeMs, "TR metin", "EN metin"].
11. Çıktıdaki 'from' ve 'to' değerleri kaynak segmentin indeksini ifade eder. İlk cümlenin 'from' değeri 0 olmalı. Ardışık her cümlenin 'from' değeri bir öncekinin 'to' değerinden bir fazla olmalıdır. Son cümlenin 'to' değeri son giriş segmentinin indeksi olmalıdır. Asla atlama veya geriye dönme yapma.

JSON ÇIKTI ŞABLONU:
{
  "sentences": [
    {
      "from": 0,
      "to": 2,
      "tr": "Düzeltilmiş Türkçe cümle.",
      "en": "Corrected English sentence.",
      "confidence": 0.95
    }
  ]
}`;
  }

  static buildUserPrompt(request: CorrectionRequest): string {
    return `Video Başlığı: ${request.video.title}
Kaynak Dil: ${request.transcript.sourceLanguage}

Lütfen aşağıdaki altyazı segmentlerini analiz et, anlam bütünlüğüne göre cümleler halinde grupla ve istenen JSON formatında döndür.

Segmentler:
${JSON.stringify({ sourceLanguage: request.transcript.sourceLanguage, segments: request.transcript.segments.map((s, i) => [i, s.startTimeMs, s.endTimeMs, s.turkish, s.english]) })}`;
  }

  static buildApiRequestBody(request: CorrectionRequest, config: any): any {
    const model = config.model || 'gpt-3.5-turbo';
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(request);

    const body: any = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: config.temperature ?? 0.3,
      max_tokens: config.correctionMaxTokens ?? Math.max(config.maxTokens ?? 4000, 32000),
    };
    
    if (config.correctionEnableReasoning === true) {
      body.chat_template_kwargs = { thinking: true, reasoning_effort: "high" };
    }

    if (config.correctionStreaming !== false) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
    
    // correctionJsonMode varsayılan olarak true kabul edilir
    if (config.correctionJsonMode !== false) {
      body.response_format = { type: 'json_object' };
    }

    return body;
  }
}
