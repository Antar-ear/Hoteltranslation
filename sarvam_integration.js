// sarvam_integration.js
// Complete Sarvam API integration: STT, Translation, and TTS using axios

const axios = require('axios');
const FormData = require('form-data');

class SarvamClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai';

    this.headersJson = {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json'
    };

    // STT models: 'saarika:v1' | 'saarika:v2' | 'saarika:v2.5' | 'saarika:flash'
    this.sttModel = process.env.SARVAM_STT_MODEL || 'saarika:v2.5';

    this.speakerGender = process.env.SARVAM_SPEAKER_GENDER || 'Male';
    this.toneMode = process.env.SARVAM_TONE || 'formal';

    // TTS model: 'bulbul:v1' | 'bulbul:v2'
    this.ttsModel = process.env.SARVAM_TTS_MODEL || 'bulbul:v2';

    // Create axios instance with timeout
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000
    });
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  safeJson(x) {
    try { return JSON.stringify(x); } catch { return String(x); }
  }

  /** Region code for STT/TTS. Allows 'unknown' (auto-detect for STT). */
  ensureRegionCode(code) {
    if (!code) return 'unknown';
    const raw = String(code);
    const lc = raw.toLowerCase();
    if (lc === 'auto' || lc === 'unknown') return 'unknown';

    const allowed = new Set([
      'unknown','hi-IN','bn-IN','kn-IN','ml-IN','mr-IN','od-IN','pa-IN','ta-IN','te-IN','en-IN','gu-IN'
    ]);
    if (allowed.has(raw)) return raw;

    const base = lc.split('-')[0];
    const map = {
      hi: 'hi-IN', en: 'en-IN', bn: 'bn-IN', kn: 'kn-IN', ml: 'ml-IN',
      mr: 'mr-IN', pa: 'pa-IN', ta: 'ta-IN', te: 'te-IN', gu: 'gu-IN',
      // Odia normalization
      od: 'od-IN', or: 'od-IN'
    };
    return map[base] || 'unknown';
  }

  /** Translate requires region codes too; source can be 'auto'. */
  toTranslateSource(code) {
    if (!code) return 'auto';
    const norm = this.ensureRegionCode(code);
    const allowed = this.allowedTranslateSet();
    return allowed.has(norm) ? norm : 'auto';
  }

  toTranslateTarget(code) {
    const norm = this.ensureRegionCode(code);
    const allowed = this.allowedTranslateSet();
    // Default target to English-India if unrecognized
    return allowed.has(norm) ? norm : 'en-IN';
  }

  allowedTranslateSet() {
    // From Sarvam error message list (expanded)
    return new Set([
      'bn-IN','en-IN','gu-IN','hi-IN','kn-IN','ml-IN','mr-IN','od-IN','pa-IN','ta-IN','te-IN',
      'as-IN','brx-IN','doi-IN','kok-IN','ks-IN','mai-IN','mni-IN','ne-IN','sa-IN','sat-IN','sd-IN','ur-IN'
    ]);
  }

  getAudioFileName(mimeType) {
    if (!mimeType) return 'audio.webm';
    const mt = mimeType.toLowerCase();
    if (mt.includes('wav')) return 'audio.wav';
    if (mt.includes('ogg')) return 'audio.ogg';
    if (mt.includes('webm')) return 'audio.webm';
    if (mt.includes('mp3')) return 'audio.mp3';
    return 'audio.webm';
  }

  /** For UI display + TTS speaker selection, keep region code normalized. */
  normalizeLanguageCode(code) {
    const map = {
      'hi-IN': 'hi-IN', 'bn-IN': 'bn-IN', 'ta-IN': 'ta-IN', 'te-IN': 'te-IN',
      'mr-IN': 'mr-IN', 'gu-IN': 'gu-IN', 'kn-IN': 'kn-IN', 'ml-IN': 'ml-IN',
      'pa-IN': 'pa-IN', 'or-IN': 'od-IN', 'od-IN': 'od-IN', 'en-IN': 'en-IN'
    };
    // If unknown or empty, keep 'hi-IN' for TTS default
    return map[code] || this.ensureRegionCode(code).replace('unknown', 'hi-IN');
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

  /* ------------------------------------------------------------------ *
   * Speech-to-Text (Saarika)
   * ------------------------------------------------------------------ */
  /**
   * @param {Buffer} audioBuffer
   * @param {string} languageCode e.g. 'hi-IN' or 'unknown'
   * @param {string} mimeType e.g. 'audio/webm', 'audio/wav'
   */
  async transcribe(audioBuffer, languageCode = 'hi-IN', mimeType = 'audio/webm') {
    try {
      const fileName = this.getAudioFileName(mimeType);
      const formData = new FormData();

      formData.append('file', audioBuffer, { filename: fileName, contentType: mimeType });
      formData.append('language_code', this.ensureRegionCode(languageCode)); // STT must be region or 'unknown'
      formData.append('model', this.sttModel);

      const response = await this.axiosInstance.post('/speech-to-text', formData, {
        headers: { 'api-subscription-key': this.apiKey, ...formData.getHeaders() }
      });

      const result = response.data || {};
      const transcript = result.transcript || '';

      return {
        transcript,
        confidence: result.confidence ?? 0.95,
        language_code: result.language_code || this.ensureRegionCode(languageCode),
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
      const e = { status: err.response?.status, data: err.response?.data, msg: err.message };
      console.error('Sarvam transcription error:', e);
      throw new Error(`Failed to transcribe audio: ${this.safeJson(e)}`);
    }
  }

  /* ------------------------------------------------------------------ *
   * Translate (Text)
   * ------------------------------------------------------------------ */
  async translate(text, sourceLanguage, targetLanguage) {
    const src = this.toTranslateSource(sourceLanguage); // 'auto' allowed
    const tgt = this.toTranslateTarget(targetLanguage); // must be recognized region

    // Primary payload (common in Sarvam)
    const payloadV1 = {
      input: String(text ?? ''),
      source_language_code: src,
      target_language_code: tgt,
      speaker_gender: this.speakerGender,
      mode: this.toneMode,
      model: 'mayura:v1' // frequently required; harmless if ignored
    };

    try {
      const res = await this.axiosInstance.post('/translate', payloadV1, { headers: this.headersJson });
      const result = res.data || {};
      return {
        text: result.translated_text || String(text ?? ''),
        source_language: src,
        target_language: tgt,
        confidence: result.confidence ?? 0.95
      };
    } catch (err1) {
      // Deep logging (what you asked for)
      console.error(`Sarvam translate error ${err1.response?.status}:`, err1.response?.data || err1.message);
      console.error('Failed request details:', {
        url: `${this.baseUrl}/translate`,
        payload: payloadV1,
        headers: this.headersJson,
        status: err1.response?.status,
        statusText: err1.response?.statusText,
        responseData: err1.response?.data
      });

      // Fallback payload (alternate field names some variants use)
      const payloadV2 = {
        text: String(text ?? ''),
        source_language: src,
        target_language: tgt,
        speaker_gender: this.speakerGender,
        mode: this.toneMode,
        model: 'mayura:v1'
      };

      try {
        const res2 = await this.axiosInstance.post('/translate', payloadV2, { headers: this.headersJson });
        const result2 = res2.data || {};
        return {
          text: result2.translated_text || result2.text || String(text ?? ''),
          source_language: src,
          target_language: tgt,
          confidence: result2.confidence ?? 0.95
        };
      } catch (err2) {
        console.error(`Sarvam translate error (fallback) ${err2.response?.status}:`, err2.response?.data || err2.message);
        console.error('Failed request details (fallback):', {
          url: `${this.baseUrl}/translate`,
          payload: payloadV2,
          headers: this.headersJson,
          status: err2.response?.status,
          statusText: err2.response?.statusText,
          responseData: err2.response?.data
        });

        // Keep UI running with a friendly fallback
        return this.getFallbackTranslation(text, sourceLanguage, targetLanguage);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Text-to-Speech (Bulbul)
   * ------------------------------------------------------------------ */
  /**
   * @param {string} text
   * @param {string} languageCode e.g. 'hi-IN', 'en-IN'
   * @param {Object} options
   */
  async generateSpeech(text, languageCode = 'hi-IN', options = {}) {
    try {
      const payload = {
        text: String(text || ''),
        target_language_code: this.ensureRegionCode(languageCode), // region code
        speaker: options.speaker || this.getSpeakerForLanguage(languageCode),
        pitch: options.pitch ?? 0,
        pace: options.pace ?? 1.0,
        loudness: options.loudness ?? 1.0,
        speech_sample_rate: options.sampleRate ?? 22050,
        enable_preprocessing: options.enablePreprocessing ?? true,
        model: options.model || this.ttsModel
      };

      // Small, safe preview in logs (first 50 chars)
      console.log('Sarvam TTS request:', {
        textPreview: String(text || '').slice(0, 50) + (String(text || '').length > 50 ? '…' : ''),
        languageCode: payload.target_language_code,
        speaker: payload.speaker
      });

      const response = await this.axiosInstance.post('/text-to-speech', payload, {
        headers: this.headersJson,
        responseType: 'arraybuffer'
      });

      const contentType = response.headers['content-type'] || 'audio/mpeg';
      if (response.data && response.data.byteLength > 0) {
        return { audio: Buffer.from(response.data), contentType };
      }
      throw new Error('No audio data received from TTS API');
    } catch (err) {
      console.error('Sarvam TTS error:', err.response?.data || err.message);

      // If server sent JSON (base64) instead of bytes
      if (err.response?.data) {
        try {
          const asText = Buffer.from(err.response.data).toString('utf8');
          const json = JSON.parse(asText);
          if (json.audio) {
            return { audio: Buffer.from(json.audio, 'base64'), contentType: 'audio/mpeg' };
          }
        } catch { /* not JSON, ignore */ }
      }
      throw new Error(`Failed to generate speech: ${err.response?.status} ${err.message}`);
    }
  }

  /* ------------------------------------------------------------------ *
   * Misc endpoints
   * ------------------------------------------------------------------ */
  async getSupportedLanguages() {
    try {
      const response = await this.axiosInstance.get('/translate/supported-languages', {
        headers: { 'api-subscription-key': this.apiKey }
      });
      return response.data;
    } catch (err) {
      console.error('Error fetching supported languages:', err.message);
      return this.getDefaultLanguages();
    }
  }

  async healthCheck() {
    try {
      await this.translate('Hello', 'en-IN', 'hi-IN');
      return true;
    } catch (err) {
      console.error('Sarvam health check failed:', err.message);
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Fallbacks
   * ------------------------------------------------------------------ */
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
      confidence: 0.0
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
      { code: 'od-IN', name: 'Odia', native: 'ଓଡ଼ିଆ' },  // fixed to od-IN
      { code: 'en-IN', name: 'English', native: 'English' }
    ];
  }
}

module.exports = SarvamClient;
