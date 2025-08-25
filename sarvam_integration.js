// sarvam-client.js
// Real Sarvam API integration
const { FormData, File, fetch } = require('undici');

class SarvamClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.sarvam.ai';
        this.headers = {
            'api-subscription-key': apiKey,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Transcribe audio to text using Sarvam Speech-to-Text API
     * @param {Buffer} audioBuffer - Audio file buffer
     * @param {string} languageCode - Language code (e.g., 'hi-IN')
     * @returns {Promise<Object>} Transcription result
     */
    async transcribe(audioBuffer, languageCode = 'hi-IN') {
        try {
            const formData = new FormData();
            formData.append('file', new File([audioBuffer], 'audio.wav', { type: 'audio/wav' }));
            formData.append('language_code', languageCode);
            formData.append('model', 'saaras:v1');

            const response = await fetch(`${this.baseUrl}/speech-to-text`, {
                method: 'POST',
                headers: { 'api-subscription-key': this.apiKey },
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Sarvam API error: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            
            return {
                transcript: result.transcript || '',
                confidence: result.confidence || 0.95,
                language_code: result.language_code || languageCode,
                diarized_transcript: result.diarized_transcript || {
                    entries: [{
                        speaker_id: 'speaker_1',
                        text: result.transcript || ''
                    }]
                }
            };

        } catch (error) {
            console.error('Transcription error:', error);
            throw new Error(`Failed to transcribe audio: ${error.message}`);
        }
    }

    /**
     * Translate text using Sarvam Translation API
     * @param {string} text - Text to translate
     * @param {string} sourceLanguage - Source language code
     * @param {string} targetLanguage - Target language code
     * @returns {Promise<Object>} Translation result
     */
    async translate(text, sourceLanguage, targetLanguage) {
        try {
            const payload = {
                input: text,
                source_language_code: sourceLanguage,
                target_language_code: targetLanguage,
                speaker_gender: 'Male', // or 'Female'
                mode: 'formal' // or 'informal'
            };

            const response = await fetch(`${this.baseUrl}/translate`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Sarvam API error: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            
            return {
                text: result.translated_text || text,
                source_language: sourceLanguage,
                target_language: targetLanguage,
                confidence: result.confidence || 0.95
            };

        } catch (error) {
            console.error('Translation error:', error);
            throw new Error(`Failed to translate text: ${error.message}`);
        }
    }

    /**
     * Get supported languages
     * @returns {Promise<Array>} List of supported languages
     */
    async getSupportedLanguages() {
        try {
            const response = await fetch(`${this.baseUrl}/translate/supported-languages`, {
                headers: this.headers
            });

            if (!response.ok) {
                throw new Error(`Sarvam API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error fetching supported languages:', error);
            return this.getDefaultLanguages();
        }
    }

    /**
     * Get default supported languages (fallback)
     * @returns {Array} Default language list
     */
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

    /**
     * Health check for Sarvam API
     * @returns {Promise<boolean>} API health status
     */
    async healthCheck() {
        try {
            // Test with a simple translation
            await this.translate('Hello', 'en-IN', 'hi-IN');
            return true;
        } catch (error) {
            console.error('Sarvam API health check failed:', error);
            return false;
        }
    }

    /**
     * Get API usage statistics (if available)
     * @returns {Promise<Object>} Usage statistics
     */
    async getUsageStats() {
        try {
            const response = await fetch(`${this.baseUrl}/usage`, {
                headers: this.headers
            });

            if (!response.ok) {
                throw new Error(`Sarvam API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error fetching usage stats:', error);
            return { error: error.message };
        }
    }
}

module.exports = SarvamClient;
