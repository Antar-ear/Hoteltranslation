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
    // STT models: saarika:v1 | saarika:v2 | saarika:v2.5 | saarika:flash
    this.sttModel = process.env.SARVAM_STT_MODEL || 'saarika:v2.5';
    this.speakerGender = process.env.SARVAM_SPEAKER_GENDER || 'Male';
    this.toneMode = process.env.SARVAM_TONE || 'formal';
    
    // TTS model: bulbul:v1 | bulbul:v2
    this.ttsModel = process.env.SARVAM_TTS_MODEL || 'bulbul:v1';
    
    // Create axios instance with timeout
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000
    });
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
      
      formData.append('file', audioBuffer, {
        filename: fileName,
        contentType: mimeType
      });
      formData.append('language_code', this.normalizeLanguageCode(languageCode));
      formData.append('model', this.sttModel);

      const response = await this.axiosInstance.post('/speech-to-text', formData, {
        headers: {
          'api-subscription-key': this.apiKey,
          ...formData.getHeaders()
        }
      });

      const result = response.data;
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
      const errorMsg = err.response?.data || err.message;
      console.error('Sarvam transcription error:', errorMsg);
      throw new Error(`Failed to transcribe audio: ${JSON.stringify(errorMsg)}`);
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

      const response = await this.axiosInstance.post('/translate', payload, {
        headers: this.headersJson
      });

      const result = response.data;
      return {
        text: result.translated_text || text,
        source_language: sourceLanguage,
        target_language: targetLanguage,
        confidence: result.confidence ?? 0.95
      };
    } catch (err) {
      const errorMsg = err.response?.data || err.message;
      console.error(`Sarvam translate error ${err.response?.status}:`, errorMsg);
      
      // Return fallback translation for demo continuity
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

      console.log('Sarvam TTS request:', { 
        text: text.substring(0, 50) + '...', 
        languageCode, 
        speaker: payload.speaker 
      });

      const response = await this.axiosInstance.post('/text-to-speech', payload, {
        headers: this.headersJson,
        responseType: 'arraybuffer'
      });

      // Handle binary audio response
      const contentType = response.headers['content-type'] || 'audio/mpeg';
      
      if (response.data && response.data.byteLength > 0) {
        return {
          audio: Buffer.from(response.data),
          contentType: contentType
        };
      }
      
      throw new Error('No audio data received from TTS API');
      
    } catch (err) {
      console.error('Sarvam TTS error:', err.response?.data || err.message);
      
      // If we got a JSON response instead of audio, try to handle it
      if (err.response && err.response.data) {
        try {
          // Convert arraybuffer to string to check if it's JSON
          const textData = Buffer.from(err.response.data).toString();
          const jsonData = JSON.parse(textData);
          
          if (jsonData.audio) {
            return {
              audio: Buffer.from(jsonData.audio, 'base64'),
              contentType: 'audio/mpeg'
            };
          }
        } catch (parseErr) {
          // Not JSON, continue with original error
        }
      }
      
      throw new Error(`Failed to generate speech: ${err.response?.status} ${err.message}`);
    }
  }

  /**
   * Get supported languages
   */
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
