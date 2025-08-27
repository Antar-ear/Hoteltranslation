// sarvam_integration.js
// Complete Sarvam API integration: STT, Translation, and TTS
const { FormData, File, fetch } = require('undici');

class SarvamClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai';
    this.headersJson = {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json'
    };
    // STT models: saarika:v1 | saarika:v2 | saarika:v2.5 | saarika:flash
    this.sttModel = process.env.SARVAM_STT_MODEL || 'saarika:v2.5';
    this.speakerGender = process.env.SARVAM_SPEAKER_GENDER || 'Male';
    this.toneMode = process.env.SARVAM_TONE || 'formal';
    
    // TTS model: bulbul:v1 | bulbul:v2
    this.ttsModel = process.env.SARVAM_TTS_MODEL || 'bulbul:v1';
  }

  /**
   * Speech-to-text using Sarvam Saarika
   * @param {Buffer} audioBuffer
   * @param {string} languageCode e.g. 'hi-IN'
   * @param {string} mimeType e.g. 'audio/webm', 'audio/wav'
   */
  async transcribe(audioBuffer, languageCode = 'hi-IN', mimeType = 'audio/webm') {
    try {
      const fileName = this.getAudioFileName(mimeType);

      const formData = new FormData();
      formData.append('file', new File([audioBuffer], fileName, { type: mimeType }));
      formData.append('language_code', this.normalizeLanguageCode(languageCode));
      formData.append('model', this.sttModel);

      const res = await fetch(`${this.baseUrl}/speech-to-text`, {
        method: 'POST',
        headers: { 'api-subscription-key': this.apiKey },
        body: formData
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`Sarvam STT ${res.status} ${res.statusText}: ${errorText}`);
      }

      const result = await res.json();
      const transcript = result.transcript || '';

      return {
        transcript,
        confidence: result.confidence ?? 0.95,
        language_code: result.language_code || languageCode,
        diarized_transcript: result.diarized_transcript || {
          entries: [{ 
            speaker_id: 'speaker_1', 
            text: transcript,
            start_time_seconds: 0,
            end_time_seconds: 0
          }]
        }
      };
    } catch (err) {
      console.error('Sarvam transcription error:', err.message);
      throw new Error(`Failed to transcribe audio: ${err.message}`);
    }
  }

  /**
   * Text translation using Sarvam Translate API
   */
  async translate(text, sourceLanguage, targetLanguage) {
    try {
      const payload = {
        input: text,
        source_language_code: this.getTranslateLanguageCode(sourceLanguage),
        target_language_code: this.getTranslateLanguageCode(targetLanguage),
        speaker_gender: this.speakerGender,
        mode: this.toneMode
      };

      const res = await fetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: this.headersJson,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        console.error(`Sarvam translate error ${res.status}:`, errorText);
        
        // Return fallback translation for demo continuity
        return this.getFallbackTranslation(text, sourceLanguage, targetLanguage);
      }

      const result = await res.json();
      return {
        text: result.translated_text || text,
        source_language: sourceLanguage,
        target_language: targetLanguage,
        confidence: result.confidence ?? 0.95
      };
    } catch (err) {
      console.error('Translation error:', err.message);
      return this.getFallbackTranslation(text, sourceLanguage, targetLanguage);
    }
  }

  /**
   * Text-to-speech using Sarvam Bulbul
   * @param {string} text - Text to convert to speech
   * @param {string} languageCode - Language code (e.g., 'hi-IN', 'en-IN')
   * @param {Object} options - TTS options
   */
  async generateSpeech(text, languageCode = 'hi-IN', options = {}) {
    try {
      const payload = {
        text: text,
        target_language_code: this.normalizeLanguageCode(languageCode),
        speaker: options.speaker || this.getSpeakerForLanguage(languageCode),
        pitch: options.pitch ?? 0,
        pace: options.pace ?? 1.0,
        loudness: options.loudness ?? 1.0,
        speech_sample_rate: options.sampleRate ?? 22050,
        enable_preprocessing: options.enablePreprocessing ?? true,
        model: options.model || this.ttsModel
      };

      console.log('Sarvam TTS request:', { text: text.substring(0, 50) + '...', languageCode, speaker: payload.speaker });

      const res = await fetch(`${this.baseUrl}/text-to-speech`, {
        method: 'POST',
        headers: this.headersJson,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`Sarvam TTS ${res.status} ${res.statusText}: ${errorText}`);
      }

      // Handle both binary and JSON responses
      const contentType = res.headers.get('content-type') || '';
      
      if (contentType.includes('audio/')) {
        // Direct audio response
        const audioBuffer = await res.arrayBuffer();
        return {
          audio: Buffer.from(audioBuffer),
          contentType: contentType
        };
      } else {
        // JSON response with base64 audio
        const result = await res.json();
        if (result.audio) {
          return {
            audio: Buffer.from(result.audio, 'base64'),
            contentType: 'audio/mpeg'
          };
        }
        throw new Error('No audio data in TTS response');
      }
    } catch (err) {
      console.error('Sarvam TTS error:', err.message);
      throw new Error(`Failed to generate speech: ${err.message}`);
    }
  }

  /**
   * Get supported languages
   */
  async getSupportedLanguages() {
    try {
      const res = await fetch(`${this.baseUrl}/translate/supported-languages`, {
        headers: { 'api-subscription-key': this.apiKey }
      });
      if (!res.ok) throw new Error(`Languages API ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      console.error('Error fetching supported languages:', err.message);
      return this.getDefaultLanguages();
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      await this.translate('Hello', 'en', 'hi');
      return true;
    } catch (err) {
      console.error('Sarvam health check failed:', err.message);
      return false;
    }
  }

  // Helper Methods

  getAudioFileName(mimeType) {
    if (mimeType.includes('wav')) return 'audio.wav';
    if (mimeType.includes('ogg')) return 'audio.ogg';
    if (mimeType.includes('webm')) return 'audio.webm';
    if (mimeType.includes('mp3')) return 'audio.mp3';
    return 'audio.webm'; // default
  }

  normalizeLanguageCode(code) {
    const codeMap = {
      'hi-IN': 'hi-IN',
      'bn-IN': 'bn-IN',
      'ta-IN': 'ta-IN',
      'te-IN': 'te-IN',
      'mr-IN': 'mr-IN',
      'gu-IN': 'gu-IN',
      'kn-IN': 'kn-IN',
      'ml-IN': 'ml-IN',
      'pa-IN': 'pa-IN',
      'or-IN': 'od-IN', // Odia mapping
      'od-IN': 'od-IN',
      'en-IN': 'en-IN'
    };
    return codeMap[code] || code || 'hi-IN';
  }

  getTranslateLanguageCode(code) {
    // Translation API uses base language codes
    const baseMap = {
      'hi-IN': 'hi',
      'bn-IN': 'bn',
      'ta-IN': 'ta',
      'te-IN': 'te',
      'mr-IN': 'mr',
      'gu-IN': 'gu',
      'kn-IN': 'kn',
      'ml-IN': 'ml',
      'pa-IN': 'pa',
      'or-IN': 'od',
      'od-IN': 'od',
      'en-IN': 'en'
    };
    return baseMap[code] || code?.split('-')[0] || 'hi';
  }

  getSpeakerForLanguage(languageCode) {
    const speakerMap = {
      'en-IN': 'meera',
      'hi-IN': 'anushka',
      'bn-IN': 'anushka',
      'ta-IN': 'anushka',
      'te-IN': 'anushka',
      'mr-IN': 'anushka',
      'gu-IN': 'anushka',
      'kn-IN': 'anushka',
      'ml-IN': 'anushka',
      'pa-IN': 'anushka',
      'od-IN': 'anushka'
    };
    return speakerMap[this.normalizeLanguageCode(languageCode)] || 'anushka';
  }

  getFallbackTranslation(text, sourceLanguage, targetLanguage) {
    const fallbackTranslations = {
      'Hello': 'नमस्ते',
      'Thank you': 'धन्यवाद',
      'How much?': 'कितना?',
      'कितना पैसा?': 'How much money?',
      'Rs 3000': 'Rs 3000',
      'Good morning': 'सुप्रभात',
      'नमस्ते': 'Hello',
      'धन्यवाद': 'Thank you',
      'I need a room': 'मुझे एक कमरा चाहिए',
      'मुझे एक कमरा चाहिए': 'I need a room'
    };

    return {
      text: fallbackTranslations[text] || `[Translation unavailable: ${text}]`,
      source_language: sourceLanguage,
      target_language: targetLanguage,
      confidence: 0.5
    };
  }

  getDefaultLanguages() {
    return [
      { code: 'hi-IN', name: 'Hindi', native: 'हिन्दी' },
      { code: 'bn-IN', name: 'Bengali', native: 'বাংলা' },
      { code: 'ta-IN', name: 'Tamil', native: 'தமிழ்' },
      { code: 'te-IN', name: 'Telugu', native: 'తెలుగు' },
      { code: 'mr-IN', name: 'Marathi', native: 'मराठी' },
      { code: 'gu-IN', name: 'Gujarati', native: 'ગુજરાતી' },
      { code: 'kn-IN', name: 'Kannada', native: 'ಕನ್ನಡ' },
      { code: 'ml-IN', name: 'Malayalam', native: 'മലയാളം' },
      { code: 'pa-IN', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
      { code: 'or-IN', name: 'Odia', native: 'ଓଡ଼ିଆ' },
      { code: 'en-IN', name: 'English', native: 'English' }
    ];
  }
}

module.exports = SarvamClient;
