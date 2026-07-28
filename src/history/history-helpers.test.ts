import { normalizeTurkishSearch, searchInTranscripts } from './history-helpers';
import { describe, it, expect } from 'vitest';

describe('history-helpers', () => {
  describe('normalizeTurkishSearch', () => {
    it('normalizes uppercase i (İ) correctly', () => {
      expect(normalizeTurkishSearch('İzmir')).toBe('izmir');
    });

    it('normalizes lowercase dotless i (ı) correctly', () => {
      expect(normalizeTurkishSearch('Diyarbakır')).toBe('diyarbakır');
    });
    
    it('handles empty strings', () => {
      expect(normalizeTurkishSearch('')).toBe('');
    });
  });

  describe('searchInTranscripts', () => {
    const mockSentences = [
      { id: '1', text: 'Merhaba dünya', secondaryText: 'Hello world' },
      { id: '2', text: 'Diyarbakır güzeldir', secondaryText: 'Diyarbakir is beautiful' },
      { id: '3', text: 'İzmir Ege incisidir', secondaryText: 'Izmir is the pearl of Aegean' }
    ];

    it('finds match in text field', () => {
      const results = searchInTranscripts(mockSentences, 'dünya', ['text']);
      expect(results.length).toBe(1);
      expect(results[0].index).toBe(0);
    });

    it('finds match case insensitive for Turkish', () => {
      const results = searchInTranscripts(mockSentences, 'izmir', ['text']);
      expect(results.length).toBe(1);
      expect(results[0].index).toBe(2);
      
      const results2 = searchInTranscripts(mockSentences, 'DİYARBAKIR', ['text']);
      expect(results2.length).toBe(1);
      expect(results2[0].index).toBe(1);
    });

    it('returns empty array if no match', () => {
      const results = searchInTranscripts(mockSentences, 'Ankara', ['text']);
      expect(results.length).toBe(0);
    });
  });
});
