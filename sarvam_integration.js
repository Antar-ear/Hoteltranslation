// sarvam_integration.js
// Real Sarvam API integration (Node 18+)
// Requires: npm i undici
const { FormData, File, fetch } = require('undici');

class SarvamClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai';
    this.headersJson = {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json'
    };
    this.sttModel = process.env.SARVAM_STT_MODEL || 'saaras:v1';
    this.speakerGender = process.env.SARVAM_SPEAKER_GENDER || 'Male'; // or 'Female'
    this.toneMode = process.env.SARVAM_TONE || 'formal';              // or 'informal'
  }

  /**
   * Speech-to-text
   * @param {Buffer} audioBuffer
   * @param {string} languageCode e.g. 'hi-IN'
   * @param {string} mimeType e.g. 'audio/webm', 'audio/ogg', 'audio/wav'
   */
  async transcribe(audioBuffer, languageCode = 'hi-IN', mimeType = 'audio/webm') {
    try {
      const fileName =
        mimeType.includes('wav') ? 'audio.wav' :
        mimeType.includes('ogg') ? 'audio.ogg' : 'audio.webm';

      const formData = new FormData();
      // Important: let undici set the multipart boundary; don't set Content-Type yourself.
      formData.append('file', new File([audioBuffer], fileName, { type: mimeType }));
      formData.append('language_code', languageCode);
      formData.append('model', this.sttModel);

      const res = await fetch(`${this.baseUrl}/speech-to-text`, {
        method: 'POST',
        headers: { 'api-subscription-key': this.apiKey },
        body: formData
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Sarvam STT ${res.status} ${res.statusText} ${body}`);
      }

      const result = await res.json();
      const transcript = result.transcript || '';

      return {
        transcript,
        confidence: result.confidence ?? 0.95,
        language_code: result.language_code || languageCode,
        diarized_transcript: result.diarized_transcript || {
          entries: [{ speaker_id: 'speaker_1', text: transcript }]
        }
      };
    } catch (err) {
      console.error('Transcription error:', err);
      throw new Error(`Failed to transcribe audio: ${err.message}`);
    }
  }

  /**
   * Text translation
   */
  async translate(text, sourceLanguage, targetLanguage) {
    try {
      const payload = {
        input: text,
        source_language_code: sourceLanguage,
        target_language_code: targetLanguage,
        speaker_gender: this.speakerGender,
        mode: this.toneMode
      };

      const res = await fetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: this.headersJson,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Sarvam Translate ${res.status} ${res.statusText} ${body}`);
      }

      const result = await res.json();
      return {
        text: result.translated_text || text,
        source_language: sourceLanguage,
        target_language: targetLanguage,
        confidence: result.confidence ?? 0.95
      };
    } catch (err) {
      console.error('Translation error:', err);
      throw new Error(`Failed to translate text: ${err.message}`);
    }
  }

  async getSupportedLanguages() {
    try {
      const res = await fetch(`${this.baseUrl}/translate/supported-languages`, {
        headers: { 'api-subscription-key': this.apiKey }
      });
      if (!res.ok) throw new Error(`Sarvam languages ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      console.error('Error fetching supported languages:', err);
      return this.getDefaultLanguages();
    }
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
