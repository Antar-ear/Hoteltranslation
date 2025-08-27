// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

// Import Sarvam client
const SarvamClient = require('./sarvam_integration');

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

app.get('/health', async (req, res) => {
    const sarvamOk = await sarvamClient.healthCheck();
    res.json({ 
        status: 'ok', 
        sarvamOk,
        timestamp: new Date().toISOString() 
    });
});

// TTS endpoint using Sarvam
app.post('/api/tts', async (req, res) => {
    try {
        const { text, language = 'hi-IN' } = req.body;
        
        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Text is required' });
        }

        console.log('TTS request:', { text: text.substring(0, 50) + '...', language });

        const audioResult = await sarvamClient.generateSpeech(text, language);
        
        res.set({
            'Content-Type': audioResult.contentType,
            'Content-Length': audioResult.audio.length,
            'Cache-Control': 'public, max-age=3600'
        });
        
        res.send(audioResult.audio);
        
    } catch (error) {
        console.error('TTS endpoint error:', error.message);
        res.status(500).json({ error: 'TTS generation failed' });
    }
});

// Get available TTS voices
app.get('/api/tts/voices', async (req, res) => {
    try {
        const voices = [
            { language: 'hi-IN', speaker: 'anushka' },
            { language: 'en-IN', speaker: 'meera' },
            { language: 'bn-IN', speaker: 'anushka' },
            { language: 'ta-IN', speaker: 'anushka' },
            { language: 'te-IN', speaker: 'anushka' }
        ];
        res.json(voices);
    } catch (error) {
        console.error('Error fetching TTS voices:', error);
        res.status(500).json({ error: 'Failed to fetch voices' });
    }
});

// Generate room endpoint
app.post('/api/generate-room', (req, res) => {
    const { hotelName } = req.body;
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    activeRooms.set(roomId, {
        hotelName: hotelName || 'Unknown Hotel',
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
            const roomData = activeRooms.get(prevRoom);
            if (roomData) roomData.users.delete(socket.id);
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
                language: data.language,
                audioDataSize: data.audioData?.length || 0
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
            
            // Step 1: Transcribe audio
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
            const targetLanguage = data.role === 'guest' ? 'en-IN' : userInfo.language || 'hi-IN';
            
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
                ttsAvailable: true
            };
            
            io.to(data.room).emit('translation', messageData);
            io.to(data.room).emit('processing_status', { status: 'complete' });
            
        } catch (error) {
            console.error('Audio processing error:', error.message);
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
                ttsAvailable: true
            };
            
            io.to(data.room).emit('translation', messageData);
            io.to(data.room).emit('processing_status', { status: 'complete' });
            
        } catch (error) {
            console.error('Text processing error:', error.message);
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
    console.log(`Hotel Translation Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to access the app`);
    
    if (process.env.SARVAM_KEY) {
        console.log('Sarvam API initialized');
    } else {
        console.log('Warning: SARVAM_KEY not found - translations will fail');
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
