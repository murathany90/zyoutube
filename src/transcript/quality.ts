import { TranscriptSegment, TranscriptQuality, CaptionTrack } from './types';
import { isSoundTag } from './cleaner';

export const evaluateQuality = (
  segments: TranscriptSegment[], 
  track: CaptionTrack,
  videoDurationMs: number
): TranscriptQuality => {
  if (segments.length === 0) {
    return {
      level: 'low',
      internalScore: 0,
      reasons: ['Transkript boş.'],
      metrics: {
        coverageRatio: videoDurationMs > 0 ? 0 : null,
        duplicateRatio: 0,
        emptyRatio: 1,
        invalidSegmentCount: 0,
        invalidSegmentRatio: 0,
        longGapCount: 0,
        longGapsPerHour: null,
        soundTagRatio: 0
      }
    };
  }

  const isAutomatic = track.sourceType === 'automatic';
  
  let invalidSegmentCount = 0;
  let longGapCount = 0;
  let soundTagCount = 0;
  
  let coveredDurationMs = 0;
  let previousEndMs = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    
    // Safety check for duration
    const dur = seg.endTimeMs - seg.startTimeMs;
    if (dur < 0 || isNaN(dur)) {
      invalidSegmentCount++;
      continue;
    }
    
    coveredDurationMs += dur;
    
    if (isSoundTag(seg.cleanText)) {
      soundTagCount++;
    }

    if (i > 0) {
      const gap = seg.startTimeMs - previousEndMs;
      if (gap > 10000) { // 10 seconds gap
        longGapCount++;
      }
    }
    
    previousEndMs = Math.max(previousEndMs, seg.endTimeMs);
  }

  const hasDuration = videoDurationMs > 0;
  const coverageRatio = hasDuration ? Math.min(1, coveredDurationMs / videoDurationMs) : null;
  const emptyRatio = 0; // Handled by cleaner
  const duplicateRatio = 0; // Handled by cleaner
  const invalidSegmentRatio = invalidSegmentCount / segments.length;
  const soundTagRatio = soundTagCount / segments.length;
  
  const longGapsPerHour = hasDuration ? (longGapCount / (videoDurationMs / 3600000)) : null;

  const reasons: string[] = [];
  let level: 'high' | 'medium' | 'low' = 'high';
  let internalScore = 100;

  if (isAutomatic) {
    reasons.push('Otomatik oluşturulmuş altyazı kullanıldı.');
    level = 'medium';
    internalScore -= 20;
  }

  if (soundTagRatio > 0.3) {
    reasons.push('Yüksek oranda ses efekti etiketi tespit edildi.');
    internalScore -= 10;
  }

  if (longGapsPerHour !== null && longGapsPerHour > 30) { // e.g. more than 30 long gaps per hour
    reasons.push('Çok sayıda uzun konuşma boşluğu tespit edildi.');
    level = level === 'high' ? 'medium' : 'low';
    internalScore -= 30;
  }
  
  if (coverageRatio !== null && coverageRatio < 0.5) {
    reasons.push('Transkript video süresinin büyük bir kısmını kapsamıyor.');
    level = 'low';
    internalScore -= 40;
  }
  
  if (invalidSegmentRatio > 0.1) {
    reasons.push('Çok sayıda hatalı zaman damgası tespit edildi.');
    level = 'low';
    internalScore -= 20;
  }

  // Normalize score
  internalScore = Math.max(0, Math.min(100, internalScore));
  
  // Strict low forcing
  if (internalScore < 40) {
    level = 'low';
  }

  return {
    level,
    internalScore,
    reasons,
    metrics: {
      coverageRatio,
      duplicateRatio,
      emptyRatio,
      invalidSegmentCount,
      invalidSegmentRatio,
      longGapCount,
      longGapsPerHour,
      soundTagRatio
    }
  };
};
