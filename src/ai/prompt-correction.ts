import { TranscriptSegment } from '../transcript/types';

export interface CorrectionRequest {
  taskId: string;
  video: {
    videoId: string;
    title: string;
  };
  transcript: {
    languageCode: string;
    segments: TranscriptSegment[];
  };
}

export class CorrectionPromptBuilder {
  static buildSystemPrompt(): string {
    return `Sen uzman bir dilbilimci ve çevirmensin. Görevin, sana sağlanan bölük pörçük YouTube altyazılarını anlam bütünlüğü olan, gramer olarak doğru doğal cümleler halinde gruplandırmak ve çift dilli (Türkçe ve İngilizce) olarak düzeltmektir.

KURALLAR:
1. Altyazı parçalarını (segmentleri) sabit sayılarda DEĞİL, anlam bütünlüğü oluşturan doğal tam cümleler halinde birleştir (bir cümle 1 ila 6 veya daha fazla segment sürebilir).
2. Hiçbir şekilde ÖZETLEME YAPMA. Bilgi ekleme veya çıkarma. Orijinal metnin tam anlamını koru.
3. Her kaynak segment YALNIZCA BİR düzeltilmiş cümlenin 'sourceSegmentIds' dizisine dahil edilmelidir.
4. Segmentlerin orijinal sırasını KESİNLİKLE değiştirme.
5. Hem Türkçe hem de İngilizce çıktının doğal, gramere uygun ve anlamca birbirine tam eşdeğer olduğundan emin ol.
6. Çıktı KESİNLİKLE aşağıdaki JSON şablonunda olmalıdır. Herhangi bir kod bloğu (markdown) ekleme, SADECE JSON çıktısı üret.

JSON ÇIKTI ŞABLONU:
{
  "sentences": [
    {
      "sourceSegmentIds": ["segment-1", "segment-2", "segment-3"],
      "correctedTurkish": "Bence bu, sistemin en önemli bölümlerinden biridir.",
      "correctedEnglish": "I think this is one of the most important parts of the system.",
      "confidence": 0.95
    }
  ]
}`;
  }

  static buildUserPrompt(request: CorrectionRequest): string {
    const isTurkishSource = request.transcript.languageCode.startsWith('tr');
    
    const formattedSegments = request.transcript.segments.map(s => {
      const trText = isTurkishSource ? s.cleanText : s.secondaryText || '';
      const enText = isTurkishSource ? s.secondaryText || '' : s.cleanText;
      return {
        id: s.id,
        startTimeMs: s.startTimeMs,
        endTimeMs: s.endTimeMs,
        turkish: trText,
        english: enText
      };
    });

    return `Video Başlığı: ${request.video.title}
Kaynak Dil: ${request.transcript.languageCode}

Lütfen aşağıdaki altyazı segmentlerini analiz et, anlam bütünlüğüne göre cümleler halinde grupla ve istenen JSON formatında döndür.

Segmentler:
${JSON.stringify({ sourceLanguage: request.transcript.languageCode, segments: formattedSegments }, null, 2)}`;
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
      max_tokens: config.maxTokens,
    };
    
    if (config.enableReasoning === true) {
      body.chat_template_kwargs = { thinking: true, reasoning_effort: "high" };
    } else if (config.responseMode === 'json') {
      body.response_format = { type: 'json_object' };
    }

    return body;
  }
}
