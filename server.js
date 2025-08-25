// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 2 * 1024 * 1024 // ~2MB per WS message
});

// ---------- Middleware ----------
app.use(cors());
app.use(express.json({ limit: '512kb' })); // audio goes via WS, keep HTTP small
app.use(express.static('public'));

// ---------- Sarvam client (real if key present, mock otherwise) ----------
class MockSarvamClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    console.log('Mock Sarvam API initialized');
  }
  async transcribe(_audioBuffer, languageCode /*, mimeType */) {
    const mockTranscriptions = {
      'hi-IN': 'कितना पैसा?',
      'bn-IN': 'কত টাকা?',
      'ta-IN': 'எவ்வளவு பணம்?',
      'te-IN': 'ఎంత డబ్బు?',
      'en-IN': 'How much money?'
    };
    await new Promise(r => setTimeout(r, 400));
    const text = mockTranscriptions[languageCode] || 'Sample text';
    return {
      transcript: text,
      confidence: 0.95,
      diarized_transcript: { entries: [{ speaker_id: 'speaker_1', text }] }
    };
  }
  async translate(text, sourceLanguage, targetLanguage) {
    const translations = {
      'कितना पैसा?': 'How much money?',
      'How much money?': 'कितना पैसा?',
      'Thank you': 'धन्यवाद',
      'धन्यवाद': 'Thank you',
      'Hello': 'नमस्ते',
      'नमस्ते': 'Hello'
    };
    await new Promise(r => setTimeout(r, 300));
    return {
      text: translations[text] || `Translated: ${text}`,
      source_language: sourceLanguage,
      target_language: targetLanguage
    };
  }
}

const useMock = !process.env.SARVAM_KEY;
let sarvamClient;
if (useMock) {
  sarvamClient = new MockSarvamClient('mock');
  console.log('🔧 Mock Sarvam API enabled (set SARVAM_KEY for production)');
} else {
  const SarvamClient = require('./sarvam_integration'); // real client using undici
  sarvamClient = new SarvamClient(process.env.SARVAM_KEY);
  console.log('🔐 Using real Sarvam API');
}

// ---------- In-memory room/user state ----------
const activeRooms = new Map(); // roomId -> { hotelName, createdAt, users:Set<socketId> }
const userRoles = new Map();   // socketId -> { room, role, language }

// Language display names
const languageNames = {
  'hi-IN': 'Hindi','bn-IN':'Bengali','ta-IN':'Tamil','te-IN':'Telugu',
  'mr-IN':'Marathi','gu-IN':'Gujarati','kn-IN':'Kannada','ml-IN':'Malayalam',
  'pa-IN':'Punjabi','or-IN':'Odia','en-IN':'English'
};

// Helpers
const tooBigBase64 = (b64) => {
  if (!b64 || typeof b64 !== 'string') return true;
  const approxBytes = Math.ceil((b64.length * 3) / 4);
  return approxBytes > 2_000_000;
};

// receptionist -> translate to guest's language; guest -> translate to English
function getTargetLanguage(room, speakerRole) {
  if (speakerRole === 'guest') return 'en-IN';
  const users = activeRooms.get(room)?.users || new Set();
  for (const id of users) {
    const u = userRoles.get(id);
    if (u?.role === 'guest') return u.language || 'hi-IN';
  }
  return 'hi-IN';
}

// ---------- Routes ----------
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/generate-room', (req, res) => {
  const { hotelName } = req.body || {};
  const roomId = `room_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

  activeRooms.set(roomId, {
    hotelName: hotelName || 'Unknown Hotel',
    createdAt: new Date(),
    users: new Set()
  });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const guestUrl = `${baseUrl}/?room=${roomId}`;

  res.json({ roomId, guestUrl, qrData: guestUrl });
});

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join_room', (data = {}) => {
    const { room, role, language = 'hi-IN' } = data;
    if (!room || !role) {
      return socket.emit('error', { message: 'room and role are required' });
    }

    // Leave previous room if any
    const prev = userRoles.get(socket.id)?.room;
    if (prev && activeRooms.has(prev)) {
      socket.leave(prev);
      activeRooms.get(prev).users.delete(socket.id);
      io.to(prev).emit('room_stats', {
        userCount: activeRooms.get(prev).users.size,
        hotelName: activeRooms.get(prev).hotelName
      });
    }

    // Join new room
    socket.join(room);
    userRoles.set(socket.id, { room, role, language });

    if (!activeRooms.has(room)) {
      activeRooms.set(room, { hotelName: 'Unknown Hotel', createdAt: new Date(), users: new Set() });
    }
    activeRooms.get(room).users.add(socket.id);

    console.log(`User ${socket.id} joined room ${room} as ${role}`);

    socket.emit('room_joined', { room, role, language: languageNames[language] || language });
    socket.to(room).emit('user_joined', { role, language: languageNames[language] || language, userId: socket.id });

    const roomInfo = activeRooms.get(room);
    io.to(room).emit('room_stats', { userCount: roomInfo.users.size, hotelName: roomInfo.hotelName });
  });

  socket.on('audio_message', async (data = {}) => {
    try {
      const meta = userRoles.get(socket.id);
      if (!meta || meta.room !== data.room) {
        return socket.emit('error', { message: 'Not authorized for this room' });
      }

      if (tooBigBase64(data.audioData)) {
        return socket.emit('error', { message: 'Audio payload too large or missing' });
      }

      const mimeType = data.mimeType || 'audio/webm'; // browser usually sends webm/opus
      io.to(data.room).emit('processing_status', { status: 'transcribing', speaker: meta.role });

      const audioBuffer = Buffer.from(data.audioData, 'base64');

      // Pass mimeType to STT (third param is supported by our sarvam_integration)
      const transcription = await sarvamClient.transcribe(audioBuffer, meta.language, mimeType);

      io.to(data.room).emit('processing_status', { status: 'translating', speaker: meta.role });

      const targetLanguage = getTargetLanguage(data.room, meta.role);
      const translation = await sarvamClient.translate(
        transcription.transcript,
        meta.language,
        targetLanguage
      );

      const messageData = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        room: data.room,
        speaker: meta.role,
        original: {
          text: transcription.transcript,
          language: meta.language,
          languageName: languageNames[meta.language] || meta.language
        },
        translated: {
          text: translation.text,
          language: targetLanguage,
          languageName: languageNames[targetLanguage] || targetLanguage
        },
        confidence: transcription.confidence ?? 0.95,
        speakerId: transcription.diarized_transcript?.entries?.[0]?.speaker_id || socket.id
      };

      io.to(data.room).emit('translation', messageData);
      io.to(data.room).emit('processing_status', { status: 'complete' });
    } catch (error) {
      console.error('Audio processing error:', error);
      socket.emit('error', { message: 'Failed to process audio message', error: error.message });
      io.to(data.room).emit('processing_status', { status: 'error' });
    }
  });

  socket.on('text_message', async (data = {}) => {
    try {
      const meta = userRoles.get(socket.id);
      if (!meta || meta.room !== data.room) {
        return socket.emit('error', { message: 'Not authorized for this room' });
      }

      io.to(data.room).emit('processing_status', { status: 'translating', speaker: meta.role });

      // Language routing: guest -> English, receptionist -> guest's language
      const sourceLanguage = data.language || (meta.role === 'guest' ? meta.language : 'en-IN');
      const targetLanguage = meta.role === 'guest' ? 'en-IN' : getTargetLanguage(data.room, meta.role);

      const translation = await sarvamClient.translate(
        data.text,
        sourceLanguage,
        targetLanguage
      );

      const messageData = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        room: data.room,
        speaker: meta.role,
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
        speakerId: socket.id
      };

      io.to(data.room).emit('translation', messageData);
      io.to(data.room).emit('processing_status', { status: 'complete' });
    } catch (error) {
      console.error('Text processing error:', error);
      socket.emit('error', { message: 'Failed to process text message', error: error.message });
      io.to(data.room).emit('processing_status', { status: 'error' });
    }
  });

  socket.on('disconnect', () => {
    const meta = userRoles.get(socket.id);
    if (!meta) return;

    const { room, role } = meta;
    if (activeRooms.has(room)) {
      activeRooms.get(room).users.delete(socket.id);
      socket.to(room).emit('user_left', { role, userId: socket.id });
      const roomInfo = activeRooms.get(room);
      io.to(room).emit('room_stats', { userCount: roomInfo.users.size, hotelName: roomInfo.hotelName });

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
  });
});

// ---------- Startup ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏨 Hotel Translation Server running on port ${PORT}`);
  console.log(`📱 Open http://localhost:${PORT} to access the app`);
});

// ---------- Graceful shutdown ----------
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Debug connection errors (CORS/handshake etc.)
io.engine.on('connection_error', (err) => {
  console.error('Engine.IO connection error:', {
    code: err.code,
    message: err.message,
    origin: err.req?.headers?.origin,
    host: err.req?.headers?.host
  });
});

module.exports = { app, server, io };
