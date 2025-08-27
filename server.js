// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Configure multer for audio file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Sarvam API Client
class SarvamClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.sarvam.ai';
        this.headers = {
            'api-subscription-key': apiKey,
            'Content-Type': 'application/json'
        };
    }

    async transcribe(audioBuffer, languageCode) {
        try {
            const FormData = require('form-data');
            const form = new FormData();
            
            form.append('file', audioBuffer, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
            form.append('language_code', this.normalizeLanguageCode(languageCode));
            form.append('model', 'saarika:v1');

            const response = await axios.post(`${this.baseUrl}/speech-to-text`, form, {
                headers: {
                    'api-subscription-key': this.apiKey,
                    ...form.getHeaders()
                },
                timeout: 30000
            });

            return {
                transcript: response.data.transcript || '',
                confidence: response.data.confidence || 0.95,
                language_code: response.data.language_code || languageCode,
                diarized_transcript: response.data.diarized_transcript || {
                    entries: [{
                        transcript: response.data.transcript || '',
                        speaker_id: 'speaker_1',
                        start_time_seconds: 0,
                        end_time_seconds: 0
                    }]
                }
            };

        } catch (error) {
            console.error('Sarvam STT error:', {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });
            throw new Error(`STT failed: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    async translate(text, sourceLanguage, targetLanguage) {
        try {
            const payload = {
                input: text,
                source_language_code: this.getLanguageCode(sourceLanguage),
                target_language_code: this.getLanguageCode(targetLanguage),
                speaker_gender: 'Male',
                mode: 'formal'
            };

            const response = await axios.post(`${this.baseUrl}/translate`, payload, {
                headers: this.headers,
                timeout: 15000
            });

            return {
                text: response.data.translated_text || text,
                source_language: sourceLanguage,
                target_language: targetLanguage,
                confidence: response.data.confidence || 0.95
            };

        } catch (error) {
            console.error('Sarvam translate error:', {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });
            
            // Fallback translations for demo
            const fallbackTranslations = {
                'Hello': 'नमस्ते',
                'Thank you': 'धन्यवाद',
                'How much?': 'कितना?',
                'कितना पैसा?': 'How much money?',
                'Rs 3000': 'Rs 3000',
                'Good morning': 'सुप्रभात',
                'नमस्ते': 'Hello',
                'धन्यवाद': 'Thank you'
            };
            
            return {
                text: fallbackTranslations[text] || `[Translation unavailable: ${text}]`,
                source_language: sourceLanguage,
                target_language: targetLanguage,
                confidence: 0.5
            };
        }
    }

    async generateSpeech(text, languageCode = 'hi-IN') {
        try {
            const payload = {
                text: text,
                target_language_code: this.normalizeLanguageCode(languageCode),
                speaker: this.getSpeakerForLanguage(languageCode),
                pitch: 0,
                pace: 1.0,
                loudness: 1.0,
                speech_sample_rate: 22050,
                enable_preprocessing: true,
                model: 'bulbul:v1'
            };

            console.log('Sarvam TTS request:', payload);

            const response = await axios.post(`${this.baseUrl}/text-to-speech`, payload, {
                headers: this.headers,
                responseType: 'arraybuffer',
                timeout: 30000
            });

            return {
                audio: Buffer.from(response.data),
                contentType: 'audio/mpeg'
            };

        } catch (error) {
            console.error('Sarvam TTS error:', {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });
            throw new Error(`TTS failed: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    // Helper methods
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
        return codeMap[code] || 'hi-IN';
    }

    getLanguageCode(code) {
        // For translation, use base language codes
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
        return baseMap[code] || code.split('-')[0] || 'hi';
    }

    getSpeakerForLanguage(languageCode) {
        const speakerMap = {
            'hi-IN': 'anushka',
            'bn-IN': 'anushka',
            'ta-IN': 'anushka',
            'te-IN': 'anushka',
            'mr-IN': 'anushka',
            'gu-IN': 'anushka',
            'kn-IN': 'anushka',
            'ml-IN': 'anushka',
            'pa-IN': 'anushka',
            'od-IN': 'anushka',
            'en-IN': 'meera'
        };
        return speakerMap[this.normalizeLanguageCode(languageCode)] || 'anushka';
    }
}

// Initialize Sarvam client
const sarvamClient = new SarvamClient(process.env.SARVAM_KEY);

// Store active rooms and users
const activeRooms = new Map();
const userRoles = new Map();

// Language mappings
const languageNames = {
    'hi-IN': 'Hindi',
    'bn-IN': 'Bengali', 
    'ta-IN': 'Tamil',
    'te-IN': 'Telugu',
    'mr-IN': 'Marathi',
    'gu-IN': 'Gujarati',
    'kn-IN': 'Kannada',
    'ml-IN': 'Malayalam',
    'pa-IN': 'Punjabi',
    'or-IN': 'Odia',
    'en-IN': 'English'
};

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// TTS endpoint using Sarvam
app.post('/api/tts', async (req, res) => {
    try {
        const { text, language = 'hi-IN' } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        const audioResult = await sarvamClient.generateSpeech(text, language);
        
        res.set({
            'Content-Type': audioResult.contentType,
            'Content-Length': audioResult.audio.length,
            'Cache-Control': 'public, max-age=3600'
        });
        
        res.send(audioResult.audio);
        
    } catch (error) {
        console.error('TTS endpoint error:', error);
        res.status(500).json({ error: 'TTS generation failed' });
    }
});

// Generate room endpoint
app.post('/api/generate-room', (req, res) => {
    const { hotelName } = req.body;
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    activeRooms.set(roomId, {
        hotelName,
        createdAt: new Date(),
        users: new Set()
    });
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const guestUrl = `${baseUrl}?room=${roomId}`;
    
    res.json({
        roomId,
        guestUrl,
        qrData: guestUrl
    });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    socket.on('join_room', (data) => {
        const { room, role, language = 'hi-IN' } = data;
        
        socket.join(room);
        userRoles.set(socket.id, { room, role, language });
        
        if (!activeRooms.has(room)) {
            activeRooms.set(room, {
                hotelName: 'Unknown Hotel',
                createdAt: new Date(),
                users: new Set()
            });
        }
        
        activeRooms.get(room).users.add(socket.id);
        
        console.log(`User ${socket.id} joined room ${room} as ${role}`);
        
        socket.emit('room_joined', { 
            room, 
            role,
            language: languageNames[language] || language
        });
        
        socket.to(room).emit('user_joined', { 
            role,
            language: languageNames[language] || language,
            userId: socket.id
        });
    });
    
    socket.on('audio_message', async (data) => {
        try {
            console.log('Processing audio message:', {
                room: data.room,
                role: data.role,
                language: data.language
            });
            
            const userInfo = userRoles.get(socket.id);
            if (!userInfo || userInfo.room !== data.room) {
                socket.emit('error', { message: 'Not authorized for this room' });
                return;
            }
            
            io.to(data.room).emit('processing_status', {
                status: 'transcribing',
                speaker: data.role
            });
            
            const audioBuffer = Buffer.from(data.audioData || [], 'base64');
            const transcription = await sarvamClient.transcribe(audioBuffer, data.language);
            
            io.to(data.room).emit('processing_status', {
                status: 'translating',
                speaker: data.role
            });
            
            const sourceLanguage = data.language;
            const targetLanguage = data.role === 'guest' ? 'en-IN' : userInfo.language || 'hi-IN';
            
            const translation = await sarvamClient.translate(
                transcription.transcript,
                sourceLanguage,
                targetLanguage
            );
            
            const messageData = {
                id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                timestamp: new Date().toISOString(),
                room: data.room,
                speaker: data.role,
                original: {
                    text: transcription.transcript,
                    language: sourceLanguage,
                    languageName: languageNames[sourceLanguage] || sourceLanguage
                },
                translated: {
                    text: translation.text,
                    language: targetLanguage,
                    languageName: languageNames[targetLanguage] || targetLanguage
                },
                confidence: transcription.confidence || 0.95,
                speakerId: socket.id,
                ttsAvailable: true
            };
            
            io.to(data.room).emit('translation', messageData);
            io.to(data.room).emit('processing_status', { status: 'complete' });
            
        } catch (error) {
            console.error('Audio processing error:', error);
            socket.emit('error', { 
                message: 'Failed to process audio message',
                error: error.message 
            });
            io.to(data.room).emit('processing_status', { status: 'error' });
        }
    });
    
    socket.on('text_message', async (data) => {
        try {
            console.log('Processing text message:', {
                room: data.room,
                role: data.role,
                text: data.text,
                language: data.language
            });
            
            const userInfo = userRoles.get(socket.id);
            if (!userInfo || userInfo.room !== data.room) {
                socket.emit('error', { message: 'Not authorized for this room' });
                return;
            }
            
            io.to(data.room).emit('processing_status', {
                status: 'translating',
                speaker: data.role
            });
            
            const sourceLanguage = data.language || (data.role === 'guest' ? userInfo.language : 'en-IN');
            const targetLanguage = data.role === 'guest' ? 'en-IN' : userInfo.language || 'hi-IN';
            
            const translation = await sarvamClient.translate(
                data.text,
                sourceLanguage,
                targetLanguage
            );
            
            const messageData = {
                id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                timestamp: new Date().toISOString(),
                room: data.room,
                speaker: data.role,
                original: {
                    text: data.text,
                    language: sourceLanguage,
                    languageName: languageNames[sourceLanguage] || sourceLanguage
                },
                translated: {
                    text: translation.text,
                    language: targetLanguage,
                    languageName: languageNames[targetLanguage] || targetLanguage
                },
                confidence: 1.0,
                speakerId: socket.id,
                ttsAvailable: true
            };
            
            io.to(data.room).emit('translation', messageData);
            io.to(data.room).emit('processing_status', { status: 'complete' });
            
        } catch (error) {
            console.error('Text processing error:', error);
            socket.emit('error', { 
                message: 'Failed to process text message',
                error: error.message 
            });
            io.to(data.room).emit('processing_status', { status: 'error' });
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        const userInfo = userRoles.get(socket.id);
        if (userInfo) {
            const { room, role } = userInfo;
            
            if (activeRooms.has(room)) {
                activeRooms.get(room).users.delete(socket.id);
                socket.to(room).emit('user_left', { role, userId: socket.id });
            }
            
            userRoles.delete(socket.id);
        }
    });
});

// Updated package.json dependencies needed
app.get('/api/package-deps', (req, res) => {
    res.json({
        "dependencies": {
            "express": "^4.18.2",
            "socket.io": "^4.7.2",
            "cors": "^2.8.5",
            "multer": "^1.4.5-lts.1",
            "dotenv": "^16.3.1",
            "axios": "^1.5.0",
            "form-data": "^4.0.0"
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Hotel Translation Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to access the app`);
    
    if (process.env.SARVAM_KEY) {
        console.log('Sarvam API initialized');
    } else {
        console.log('Warning: SARVAM_KEY not found');
    }
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = { app, server, io };
