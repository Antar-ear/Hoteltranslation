// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs').promises;
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
app.use(express.json());
app.use(express.static('public'));

// Configure multer for audio file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Real Sarvam AI client implementation
class SarvamAIClient {
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
            form.append('language_code', languageCode);
            form.append('model', 'saaras:v1');

            const response = await axios.post(`${this.baseUrl}/speech-to-text`, form, {
                headers: {
                    'api-subscription-key': this.apiKey,
                    ...form.getHeaders()
                }
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
            console.error('Sarvam transcription error:', error.response?.data || error.message);
            throw new Error(`Failed to transcribe audio: ${error.message}`);
        }
    }

    async translate(text, sourceLanguage, targetLanguage) {
        try {
            const payload = {
                input: text,
                source_language_code: sourceLanguage,
                target_language_code: targetLanguage,
                speaker_gender: 'Male',
                mode: 'formal'
            };

            const response = await axios.post(`${this.baseUrl}/translate`, payload, {
                headers: this.headers
            });

            return {
                text: response.data.translated_text || text,
                source_language: sourceLanguage,
                target_language: targetLanguage,
                confidence: response.data.confidence || 0.95
            };

        } catch (error) {
            console.error('Sarvam translation error:', error.response?.data || error.message);
            throw new Error(`Failed to translate text: ${error.message}`);
        }
    }

    async getSupportedLanguages() {
        try {
            const response = await axios.get(`${this.baseUrl}/translate/supported-languages`, {
                headers: this.headers
            });
            return response.data;
        } catch (error) {
            console.error('Error fetching supported languages:', error);
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

    async healthCheck() {
        try {
            await this.translate('Hello', 'en-IN', 'hi-IN');
            return true;
        } catch (error) {
            console.error('Sarvam API health check failed:', error);
            return false;
        }
    }
}

// Speechify TTS integration
class SpeechifyTTS {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.speechify.com/v1';
        this.voiceMap = {
            'hi-IN': 'hi-IN-SwaraNeural',
            'bn-IN': 'bn-IN-BashkarNeural', 
            'ta-IN': 'ta-IN-PallaviNeural',
            'te-IN': 'te-IN-ShrutiNeural',
            'mr-IN': 'mr-IN-ManoharNeural',
            'gu-IN': 'gu-IN-DhwaniNeural',
            'kn-IN': 'kn-IN-SapnaNeural',
            'ml-IN': 'ml-IN-SobhanaNeural',
            'pa-IN': 'pa-IN-GaganNeural',
            'or-IN': 'or-IN-SubhasiniNeural',
            'en-IN': 'en-IN-NeerjaNeural'
        };
    }

    async generateSpeech(text, language = 'en-IN') {
        try {
            const voice = this.voiceMap[language] || 'en-IN-NeerjaNeural';
            
            const response = await axios.post(`${this.baseUrl}/audio/speech`, {
                input: text,
                voice: voice,
                response_format: 'mp3',
                speed: 1.0
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
            });

            return {
                audio: Buffer.from(response.data),
                contentType: 'audio/mpeg'
            };
        } catch (error) {
            console.error('Speechify TTS error:', error.response?.data || error.message);
            throw new Error(`TTS generation failed: ${error.message}`);
        }
    }

    async getVoices() {
        try {
            const response = await axios.get(`${this.baseUrl}/voices`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return response.data;
        } catch (error) {
            console.error('Error fetching voices:', error);
            return Object.keys(this.voiceMap).map(lang => ({
                language: lang,
                voice: this.voiceMap[lang]
            }));
        }
    }
}

// Initialize Speechify TTS
const speechifyTTS = new SpeechifyTTS(process.env.SPEECHIFY_API_KEY || 'MRGSDZNMIHLRc45xijL77miP2DB4AjmYaO3EZ6JyXro=');

// Initialize real Sarvam AI client
const sarvamClient = new SarvamAIClient(process.env.SARVAM_KEY);

// Replace with actual Sarvam client when ready:
/*
const { SarvamAI } = require('sarvamai');
const sarvamClient = new SarvamAI({
    api_subscription_key: process.env.SARVAM_KEY
});
*/

// Store active rooms and users
const activeRooms = new Map();
const userRoles = new Map(); // socketId -> {room, role, language}

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

// TTS endpoint
app.post('/api/tts', async (req, res) => {
    try {
        const { text, language = 'en-IN' } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        const audioResult = await speechifyTTS.generateSpeech(text, language);
        
        res.set({
            'Content-Type': audioResult.contentType,
            'Content-Length': audioResult.audio.length,
            'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
        });
        
        res.send(audioResult.audio);
        
    } catch (error) {
        console.error('TTS endpoint error:', error);
        res.status(500).json({ error: 'TTS generation failed' });
    }
});

// Get available TTS voices
app.get('/api/tts/voices', async (req, res) => {
    try {
        const voices = await speechifyTTS.getVoices();
        res.json(voices);
    } catch (error) {
        console.error('Error fetching TTS voices:', error);
        res.status(500).json({ error: 'Failed to fetch voices' });
    }
});
app.post('/api/generate-room', (req, res) => {
    const { hotelName } = req.body;
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    // Store room info
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
        
        // Leave any previous room
        const prevRoom = userRoles.get(socket.id)?.room;
        if (prevRoom) {
            socket.leave(prevRoom);
            if (activeRooms.has(prevRoom)) {
                activeRooms.get(prevRoom).users.delete(socket.id);
            }
        }
        
        // Join new room
        socket.join(room);
        userRoles.set(socket.id, { room, role, language });
        
        // Update room info
        if (!activeRooms.has(room)) {
            activeRooms.set(room, {
                hotelName: 'Unknown Hotel',
                createdAt: new Date(),
                users: new Set()
            });
        }
        
        activeRooms.get(room).users.add(socket.id);
        
        console.log(`User ${socket.id} joined room ${room} as ${role}`);
        
        // Notify user they joined
        socket.emit('room_joined', { 
            room, 
            role,
            language: languageNames[language] || language
        });
        
        // Notify others in room
        socket.to(room).emit('user_joined', { 
            role,
            language: languageNames[language] || language,
            userId: socket.id
        });
        
        // Send room stats
        const roomInfo = activeRooms.get(room);
        io.to(room).emit('room_stats', {
            userCount: roomInfo.users.size,
            hotelName: roomInfo.hotelName
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
            
            // Emit processing status
            io.to(data.room).emit('processing_status', {
                status: 'transcribing',
                speaker: data.role
            });
            
            // Step 1: Transcribe audio (mock for now)
            const audioBuffer = Buffer.from(data.audioData || [], 'base64');
            const transcription = await sarvamClient.transcribe(audioBuffer, data.language);
            
            console.log('Transcription result:', transcription.transcript);
            
            // Emit transcription status
            io.to(data.room).emit('processing_status', {
                status: 'translating',
                speaker: data.role
            });
            
            // Step 2: Translate text
            const sourceLanguage = data.language;
            const targetLanguage = data.role === 'guest' ? 'en-IN' : data.guestLanguage || 'hi-IN';
            
            const translation = await sarvamClient.translate(
                transcription.transcript,
                sourceLanguage,
                targetLanguage
            );
            
            console.log('Translation result:', translation.text);
            
            // Step 3: Send results to all users in room
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
                speakerId: transcription.diarized_transcript?.entries?.[0]?.speaker_id || socket.id,
                ttsAvailable: true // Indicate TTS is available via API
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
                text: data.text
            });
            
            const userInfo = userRoles.get(socket.id);
            if (!userInfo || userInfo.room !== data.room) {
                socket.emit('error', { message: 'Not authorized for this room' });
                return;
            }
            
            // Emit processing status
            io.to(data.room).emit('processing_status', {
                status: 'translating',
                speaker: data.role
            });
            
            // Translate text
            const sourceLanguage = data.language || (data.role === 'guest' ? userInfo.language : 'en-IN');
            const targetLanguage = data.role === 'guest' ? 'en-IN' : userInfo.language || 'hi-IN';
            
            const translation = await sarvamClient.translate(
                data.text,
                sourceLanguage,
                targetLanguage
            );
            
            console.log('Text translation result:', translation.text);
            
            // Send results to all users in room
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
                confidence: 1.0, // Text input has perfect confidence
                speakerId: socket.id,
                ttsAvailable: true // Indicate TTS is available via API
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
    
    socket.on('get_room_info', (data) => {
        const roomInfo = activeRooms.get(data.room);
        if (roomInfo) {
            socket.emit('room_info', {
                hotelName: roomInfo.hotelName,
                userCount: roomInfo.users.size,
                createdAt: roomInfo.createdAt
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        const userInfo = userRoles.get(socket.id);
        if (userInfo) {
            const { room, role } = userInfo;
            
            // Remove user from room
            if (activeRooms.has(room)) {
                activeRooms.get(room).users.delete(socket.id);
                
                // Notify others
                socket.to(room).emit('user_left', { role, userId: socket.id });
                
                // Send updated room stats
                const roomInfo = activeRooms.get(room);
                io.to(room).emit('room_stats', {
                    userCount: roomInfo.users.size,
                    hotelName: roomInfo.hotelName
                });
                
                // Clean up empty rooms after 5 minutes
                if (roomInfo.users.size === 0) {
                    setTimeout(() => {
                        if (activeRooms.has(room) && activeRooms.get(room).users.size === 0) {
                            activeRooms.delete(room);
                            console.log(`Cleaned up empty room: ${room}`);
                        }
                    }, 5 * 60 * 1000);
                }
            }
            
            userRoles.delete(socket.id);
        }
    });
    
    // Handle errors
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🏨 Hotel Translation Server running on port ${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} to access the app`);
    
    if (process.env.SARVAM_KEY) {
        console.log(`🔧 Real Sarvam API initialized`);
    } else {
        console.log(`⚠️  Warning: SARVAM_KEY not found - translations may not work`);
    }
    
    if (process.env.SPEECHIFY_API_KEY) {
        console.log(`🎤 Speechify TTS initialized`);
    } else {
        console.log(`⚠️  Warning: SPEECHIFY_API_KEY not found - TTS may not work`);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = { app, server, io };
