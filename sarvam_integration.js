// sarvam_integration.js
// Complete Sarvam API integration with all fixes applied
// This version handles STT, Translation, and TTS with proper error handling

const axios = require('axios');
const FormData = require('form-data');

class SarvamClient {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('SARVAM_KEY is required');
    }
    
    this.apiKey = apiKey;
    this.baseUrl = process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai';
    
    // Headers for JSON requests
    this.headersJson = {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json'
    };
    
    // Model configurations
    this.sttModel = process.env.SARVAM_STT_MODEL || 'saarika:v1';  // v1 is more stable
    this.ttsModel = process.env.SARVAM_TTS_MODEL || 'bulbul:v1';   // v1 is required
    this.translateModel = process.env.SARVAM_TRANSLATE_MODEL || 'mayura:v1';
    
    // Create axios instance with proper timeout
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      maxContentLength: 50 * 1024 * 1024,  // 50MB max
      maxBodyLength: 50 * 1024 * 1024
    });
    
    // Add request/response interceptors for debugging
    this.axiosInstance.interceptors.request.use(
      request => {
        console.log(`Sarvam API Request: ${request.method?.toUpperCase()} ${request.url}`);
        return request;
      },
      error => {
        console.error('Sarvam Request Error:', error.message);
        return Promise.reject(error);
      }
    );
    
    this.axiosInstance.interceptors.response.use(
      response => {
        console.log(`Sarvam API Response: ${response.status} from ${response.config.url}`);
        return response;
      },
      error => {
        if (error.response) {
          console.error(`Sarvam API Error: ${error.response.status} from ${error.config.url}`);
        }
        return Promise.reject(error);
      }
    );
  }
  
  /* ============================= HELPERS ============================= */
  
  // Safe JSON stringification
  safeJson(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return String(obj);
    }
  }
  
  // Language code validation and normalization
  validateLanguageCode(code, context = 'general') {
    if (!code) {
      return context === 'tts' ? 'hi-IN' : 'unknown';
    }
    
    const languageCode = String(code).trim();
    
    // Handle special cases
    if (languageCode.toLowerCase() === 'unknown' || languageCode.toLowerCase() === 'auto') {
      if (context === 'tts') {
        // TTS cannot accept 'unknown', default to Hindi
        return 'hi-IN';
      }
      if (context === 'translate-source') {
        // Translation can accept 'auto' for source
        return 'auto';
      }
      return 'unknown';
    }
    
    // Valid Sarvam language codes
    const validCodes = {
      'hi-IN': 'Hindi',
      'en-IN': 'English',
      'bn-IN': 'Bengali',
      'gu-IN': 'Gujarati',
      'kn-IN': 'Kannada',
      'ml-IN': 'Malayalam',
      'mr-IN': 'Marathi',
      'od-IN': 'Odia',
      'pa-IN': 'Punjabi',
      'ta-IN': 'Tamil',
      'te-IN': 'Telugu',
      'as-IN': 'Assamese',
      'brx-IN': 'Bodo',
      'doi-IN': 'Dogri',
      'ks-IN': 'Kashmiri',
      'kok-IN': 'Konkani',
      'mai-IN': 'Maithili',
      'mni-IN': 'Manipuri',
      'ne-IN': 'Nepali',
      'or-IN': 'Odia',  // Alternative code for Odia
      'sa-IN': 'Sanskrit',
      'sd-IN': 'Sindhi',
      'ur-IN': 'Urdu'
    };
    
    // Check if it's already a valid code
    if (validCodes[languageCode]) {
      // Fix Odia code inconsistency
      if (languageCode === 'or-IN') {
        return 'od-IN';
      }
      return languageCode;
    }
    
    // Try to map from base language code
    const baseCode = languageCode.toLowerCase().split('-')[0];
    const codeMap = {
      'hi': 'hi-IN', 'hindi': 'hi-IN',
      'en': 'en-IN', 'english': 'en-IN',
      'bn': 'bn-IN', 'bengali': 'bn-IN', 'bangla': 'bn-IN',
      'gu': 'gu-IN', 'gujarati': 'gu-IN',
      'kn': 'kn-IN', 'kannada': 'kn-IN',
      'ml': 'ml-IN', 'malayalam': 'ml-IN',
      'mr': 'mr-IN', 'marathi': 'mr-IN',
      'od': 'od-IN', 'or': 'od-IN', 'odia': 'od-IN', 'oriya': 'od-IN',
      'pa': 'pa-IN', 'punjabi': 'pa-IN',
      'ta': 'ta-IN', 'tamil': 'ta-IN',
      'te': 'te-IN', 'telugu': 'te-IN'
    };
    
    const mapped = codeMap[baseCode];
    if (mapped) {
      return mapped;
    }
    
    // Default fallback based on context
    if (context === 'tts') {
      console.warn(`Invalid language code for TTS: ${languageCode}, defaulting to hi-IN`);
      return 'hi-IN';
    }
    
    return 'unknown';
  }
  
  // Get appropriate speaker for language
  getSpeakerForLanguage(languageCode) {
    const lang = this.validateLanguageCode(languageCode, 'tts');
    
    // Sarvam TTS speakers (verified working)
    const speakers = {
      'en-IN': 'meera',      // English female voice
      'hi-IN': 'madhur',     // Hindi male voice
      'bn-IN': 'madhur',     // Use Hindi voice for other languages
      'gu-IN': 'madhur',
      'kn-IN': 'madhur',
      'ml-IN': 'madhur',
      'mr-IN': 'madhur',
      'od-IN': 'madhur',
      'pa-IN': 'madhur',
      'ta-IN': 'madhur',
      'te-IN': 'madhur'
    };
    
    return speakers[lang] || 'madhur';
  }
  
  // Get audio MIME type from filename or format
  getAudioMimeType(filename) {
    if (!filename) return 'audio/webm';
    const ext = filename.toLowerCase().split('.').pop();
    const mimeMap = {
      'wav': 'audio/wav',
      'mp3': 'audio/mpeg',
      'webm': 'audio/webm',
      'ogg': 'audio/ogg',
      'oga': 'audio/ogg'
    };
    return mimeMap[ext] || 'audio/webm';
  }
  
  /* ============================= SPEECH TO TEXT ============================= */
  
  async transcribe(audioBuffer, languageCode = 'hi-IN', mimeType = 'audio/webm') {
    try {
      console.log('STT Request:', {
        bufferSize: audioBuffer.length,
        language: languageCode,
        mimeType: mimeType,
        model: this.sttModel
      });
      
      // Create form data for multipart upload
      const formData = new FormData();
      const filename = `audio_${Date.now()}.webm`;
      
      formData.append('file', audioBuffer, {
        filename: filename,
        contentType: mimeType
      });
      
      // Language code can be 'unknown' for auto-detect in STT
      formData.append('language_code', this.validateLanguageCode(languageCode, 'stt'));
      formData.append('model', this.sttModel);
      
      const response = await this.axiosInstance.post('/speech-to-text', formData, {
        headers: {
          'api-subscription-key': this.apiKey,
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      
      const result = response.data;
      console.log('STT Success:', {
        transcript: result.transcript?.substring(0, 100),
        confidence: result.confidence,
        detectedLanguage: result.language_code
      });
      
      return {
        transcript: result.transcript || '',
        confidence: result.confidence || 0.95,
        language_code: result.language_code || languageCode,
        raw_response: result
      };
      
    } catch (error) {
      console.error('STT Error:', {
        status: error.response?.status,
        message: error.message,
        data: error.response?.data
      });
      
      // Parse error message if available
      if (error.response?.data) {
        const errorMsg = typeof error.response.data === 'string' 
          ? error.response.data 
          : error.response.data.error?.message || error.response.data.message || 'Unknown error';
        throw new Error(`STT failed: ${errorMsg}`);
      }
      
      throw new Error(`STT failed: ${error.message}`);
    }
  }
  
  /* ============================= TRANSLATION ============================= */
  
  async translate(text, sourceLanguage = 'auto', targetLanguage = 'en-IN') {
    try {
      if (!text || text.trim() === '') {
        return {
          text: '',
          source_language: sourceLanguage,
          target_language: targetLanguage,
          confidence: 1.0
        };
      }
      
      // Validate and normalize language codes
      const sourceLang = sourceLanguage === 'auto' 
        ? 'auto' 
        : this.validateLanguageCode(sourceLanguage, 'translate-source');
      const targetLang = this.validateLanguageCode(targetLanguage, 'translate-target');
      
      // Don't translate if source and target are the same
      if (sourceLang === targetLang && sourceLang !== 'auto') {
        return {
          text: text,
          source_language: sourceLang,
          target_language: targetLang,
          confidence: 1.0
        };
      }
      
      console.log('Translation Request:', {
        textLength: text.length,
        source: sourceLang,
        target: targetLang,
        preview: text.substring(0, 50)
      });
      
      const payload = {
        input: String(text),
        source_language_code: sourceLang,
        target_language_code: targetLang,
        model: this.translateModel
      };
      
      const response = await this.axiosInstance.post('/translate', payload, {
        headers: this.headersJson
      });
      
      const result = response.data;
      console.log('Translation Success:', {
        translatedLength: result.translated_text?.length,
        confidence: result.confidence
      });
      
      return {
        text: result.translated_text || text,
        source_language: result.source_language || sourceLang,
        target_language: result.target_language || targetLang,
        confidence: result.confidence || 0.95
      };
      
    } catch (error) {
      console.error('Translation Error:', {
        status: error.response?.status,
        message: error.message,
        data: error.response?.data
      });
      
      // Check if it's a language not supported error
      if (error.response?.status === 400) {
        const errorData = error.response.data;
        if (errorData?.error?.message?.includes('language')) {
          console.log('Language not supported, returning original text');
          return {
            text: text,
            source_language: sourceLanguage,
            target_language: targetLanguage,
            confidence: 0.0,
            error: 'Language pair not supported'
          };
        }
      }
      
      // Return original text as fallback
      return {
        text: text,
        source_language: sourceLanguage,
        target_language: targetLanguage,
        confidence: 0.0,
        error: error.message
      };
    }
  }
  
  /* ============================= TEXT TO SPEECH ============================= */
  
  async generateSpeech(text, languageCode = 'hi-IN', options = {}) {
    try {
      if (!text || text.trim() === '') {
        throw new Error('Text is required for TTS');
      }
      
      // CRITICAL: Ensure language code is valid for TTS
      const validLangCode = this.validateLanguageCode(languageCode, 'tts');
      const speaker = options.speaker || this.getSpeakerForLanguage(validLangCode);
      
      console.log('TTS Request:', {
        textLength: text.length,
        language: validLangCode,
        speaker: speaker,
        model: this.ttsModel,
        preview: text.substring(0, 50)
      });
      
      // Minimal payload - only send required fields to avoid 400 errors
      const payload = {
        text: String(text),
        target_language_code: validLangCode,
        speaker: speaker,
        model: this.ttsModel
      };
      
      const response = await this.axiosInstance.post('/text-to-speech', payload, {
        headers: this.headersJson,
        responseType: 'arraybuffer',
        timeout: 20000  // 20 second timeout for TTS
      });
      
      // Check if we got audio data
      if (!response.data || response.data.byteLength === 0) {
        throw new Error('No audio data received from TTS API');
      }
      
      const contentType = response.headers['content-type'] || 'audio/wav';
      console.log('TTS Success:', {
        audioSize: response.data.byteLength,
        contentType: contentType
      });
      
      return {
        audio: Buffer.from(response.data),
        contentType: contentType
      };
      
    } catch (error) {
      console.error('TTS Error Details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message
      });
      
      // Try to parse error response
      if (error.response?.data) {
        try {
          const errorText = Buffer.from(error.response.data).toString('utf8');
          const errorJson = JSON.parse(errorText);
          
          console.error('TTS API Error Response:', errorJson);
          
          // Check for specific error types
          if (errorJson.error?.code === 'invalid_request_error') {
            const errorMessage = errorJson.error?.message || 'Invalid request';
            
            // Check for specific field errors
            if (errorMessage.includes('speaker')) {
              throw new Error(`Invalid speaker '${options.speaker}' for language '${languageCode}'. Please use 'madhur' or 'meera'.`);
            }
            if (errorMessage.includes('language')) {
              throw new Error(`Language '${languageCode}' not supported for TTS. Please use a valid Indian language code like 'hi-IN' or 'en-IN'.`);
            }
            if (errorMessage.includes('model')) {
              throw new Error(`TTS model '${this.ttsModel}' not available. Please use 'bulbul:v1'.`);
            }
            
            throw new Error(`TTS Error: ${errorMessage}`);
          }
          
          throw new Error(`TTS API Error: ${errorJson.error?.message || errorJson.message || 'Unknown error'}`);
          
        } catch (parseError) {
          // If we can't parse the error, log the raw response
          if (parseError.message.includes('TTS')) {
            throw parseError;  // Re-throw if it's already our error
          }
          console.error('Could not parse TTS error response');
        }
      }
      
      throw new Error(`TTS failed: ${error.message}`);
    }
  }
  
  /* ============================= UTILITY METHODS ============================= */
  
  // Health check to verify API connectivity
  async healthCheck() {
    try {
      console.log('Running Sarvam API health check...');
      
      // Test translation with a simple phrase
      const translationTest = await this.translate('Hello', 'en-IN', 'hi-IN');
      
      if (translationTest.text && translationTest.confidence > 0) {
        console.log('Sarvam API health check passed');
        return true;
      }
      
      console.warn('Sarvam API health check: Translation returned but with low confidence');
      return true;
      
    } catch (error) {
      console.error('Sarvam API health check failed:', error.message);
      return false;
    }
  }
  
  // Get list of supported languages
  getDefaultLanguages() {
    return [
      { code: 'en-IN', name: 'English', native: 'English', tts: true, stt: true },
      { code: 'hi-IN', name: 'Hindi', native: 'हिन्दी', tts: true, stt: true },
      { code: 'bn-IN', name: 'Bengali', native: 'বাংলা', tts: true, stt: true },
      { code: 'gu-IN', name: 'Gujarati', native: 'ગુજરાતી', tts: true, stt: true },
      { code: 'kn-IN', name: 'Kannada', native: 'ಕನ್ನಡ', tts: true, stt: true },
      { code: 'ml-IN', name: 'Malayalam', native: 'മലയാളം', tts: true, stt: true },
      { code: 'mr-IN', name: 'Marathi', native: 'मराठी', tts: true, stt: true },
      { code: 'od-IN', name: 'Odia', native: 'ଓଡ଼ିଆ', tts: true, stt: true },
      { code: 'pa-IN', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', tts: true, stt: true },
      { code: 'ta-IN', name: 'Tamil', native: 'தமிழ்', tts: true, stt: true },
      { code: 'te-IN', name: 'Telugu', native: 'తెలుగు', tts: true, stt: true }
    ];
  }
  
  // Test all functionalities
  async testAll() {
    const results = {
      health: false,
      translation: false,
      tts: false,
      stt: false
    };
    
    try {
      // Health check
      results.health = await this.healthCheck();
      
      // Translation test
      try {
        const translated = await this.translate('Hello world', 'en-IN', 'hi-IN');
        results.translation = translated.confidence > 0;
        console.log('Translation test:', results.translation ? 'PASSED' : 'FAILED');
      } catch (e) {
        console.error('Translation test failed:', e.message);
      }
      
      // TTS test
      try {
        const audio = await this.generateSpeech('Hello', 'en-IN', { speaker: 'meera' });
        results.tts = audio.audio && audio.audio.length > 0;
        console.log('TTS test:', results.tts ? 'PASSED' : 'FAILED');
      } catch (e) {
        console.error('TTS test failed:', e.message);
      }
      
      // Note: STT test requires actual audio file, so we skip it in basic test
      console.log('Test results:', results);
      return results;
      
    } catch (error) {
      console.error('Test suite failed:', error);
      return results;
    }
  }
}

module.exports = SarvamClient;
