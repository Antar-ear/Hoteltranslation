// server.js
// Env needed: PORT, SARVAM_KEY, SPEECHIFY_API_KEY
// Run: node server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const axios = require('axios');

require('dotenv').config();

/* ------------------------- App / Server / Sockets ------------------------- */

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 25000,
  pingTimeout: 60000
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

// Optional: memory upload (kept for future file endpoints)
const storage = multer.memoryStorage();
const upload = multer({ storage });

/* ----------------------------- Helper Utils ------------------------------ */

// Keep UI codes like "hi-IN" for display, but Sarvam expects base ("hi", "en", ...)
const toSarvamLang = (code = 'en-IN') => {
  const base = String(code).split('-')[0].trim().toLowerCase();
  return base || 'en';
};

const safeJson = (obj) => {
  try { return JSON.stringify(obj); } catch { return String(obj); }
};

// Basic language display names for UI
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

/* ---------------------------- Sarvam Client ------------------------------ */

class SarvamAIClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.sarvam.ai';
    this.jsonHeaders = {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json'
    };
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000
    });
  }

  async transcribe(audioBuffer, languageCode) {
    const FormData = require('form-data');
    const form = new FormData();

    // Sarvam accepts multipart with "file", "language_code", "model"
    form.append('file', audioBuffer, {
      filename: 'audio.wav',
      contentType: 'audio/wav'
    });
    form.append('language_code', toSarvamLang(languageCode));
    // IMPORTANT: Correct model name (your logs showed valid values below)
    form.append('model', 'saarika:v2.5'); // 'saarika:v1' | 'saarika:v2' | 'saarika:v2.5' | 'saarika:flash'

    try {
      const res = await this.http.post('/speech-to-text', form, {
        headers: {
          'api-subscription-key': this.apiKey,
          ...form.getHeaders()
        }
      });

      const t = res.data?.transcript || '';
      return {
        transcript: t,
        confidence: res.data?.confidence ?? 0.95,
        language_code: res.data?.language_code || toSarvamLang(languageCode),
        diarized_transcript: res.data?.diarized_transcript || {
          entries: [{
            transcript: t,
            speaker_id: 'speaker_1',
            start_time_seconds: 0,
            end_time_seconds: 0
          }]
        }
      };
    } catch (err) {
      const apiErr = err.response?.data || err.message;
      console.error('Sarvam transcription error:', apiErr);
      throw new Error(`Failed to transcribe audio: ${safeJson(apiErr)}`);
    }
  }

  async translate(text, sourceLanguage, targetLanguage) {
    const payload = {
      input: text,
      source_language_code: toSarvamLang(sourceLanguage),
      target_language_code: toSarvamLang(targetLanguage),
      speaker_gender: 'Male',
      mode: 'formal'
    };

    try {
      const res = await this.http.post('/translate', payload, {
        headers: this.jsonHeaders
      });

      return {
        text: res.data?.translated_text || text,
        source_language: sourceLanguage,
        target_language: targetLanguage,
        confidence: res.data?.confidence ?? 0.95
      };
    } catch (err) {
      const apiErr = err.response?.data || err.message;
      console.error('Sarvam translation error:', apiErr);
      throw new Error(`Failed to translate text: ${safeJson(apiErr)}`);
    }
  }

  async getSupportedLanguages() {
    try {
      const res = await this.http.get('/translate/supported-languages', {
        headers: this.jsonHeaders
      });
      return res.data;
    } catch (err) {
      console.error('Sarvam supported languages error:', err.response?.data || err.message);
      // Fallback to our UI list
      return Object.entries(languageNames).map(([code, name]) => ({ code, name, native: name }));
    }
  }

  async healthCheck() {
    try {
      await this.translate('Hello', 'en-IN', 'hi-IN');
      return true;
    } catch (err) {
      console.error('Sarvam API health check failed:', err.message);
      return false;
    }
  }
}

/* --------------------------- Speechify (TTS) ----------------------------- */

class SpeechifyTTS {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.speechify.com/v1';
    // Map UI language to a reasonable voice
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
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: { Authorization: `Bearer ${apiKey}` }
    });
  }

  async generateSpeech(text, language = 'en-IN') {
    const voice = this.voiceMap[language] || 'en-IN-NeerjaNeural';
    try {
      const res = await this.http.post('/audio/speech', {
        input: text,
        voice,
        response_format: 'mp3',
        speed: 1.0
      }, { responseType: 'arraybuffer' });

      return { audio: Buffer.from(res.data), contentType: 'audio/mpeg' };
    } catch (err) {
      const apiErr = err.response?.data || err.message;
      console.error('Speechify TTS error:', apiErr);
      throw new Error(`TTS generation failed: ${safeJson(apiErr)}`);
    }
  }

  async getVoices() {
    try {
      const res = await this.http.get('/voices');
      return res.data;
    } catch (err) {
      console.error('Speechify voices error:', err.response?.data || err.message);
      return Object.keys(this.voiceMap).map((lang) => ({ language: lang, voice: this.voiceMap[lang] }));
    }
  }
}

/* ----------------------- Init API Clients (env vars) --------------------- */

if (!process.env.SARVAM_KEY) {
  console.warn('⚠️  SARVAM_KEY not set – STT/Translate will fail.');
}
if (!process.env.SPEECHIFY_API_KEY) {
  console.warn('⚠️  SPEECHIFY_API_KEY not set – TTS will fail.');
}

const sarvamClient = new SarvamAIClient(process.env.SARVAM_KEY || '');
const speechifyTTS = new SpeechifyTTS(process.env.SPEECHIFY_API_KEY || '');

/* ---------------------- In-memory Room/User Tracking --------------------- */

const activeRooms = new Map();      // roomId -> { hotelName, createdAt, users: Set<socketId> }
const userRoles  = new Map();       // socketId -> { room, role, language }

/* -------------------------------- Routes --------------------------------- */

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', async (_req, res) => {
  const sarvamOk = await sarvamClient.healthCheck();
  res.json({ status: 'ok', sarvamOk, time: new Date().toISOString() });
});

// TTS: POST { text, language? } -> mp3
app.post('/api/tts', async (req, res) => {
  try {
    const { text, language = 'en-IN' } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }
    const audio = await speechifyTTS.generateSpeech(String(text), language);
    res.set({
      'Content-Type': audio.contentType,
      'Content-Length': audio.audio.length,
      'Cache-Control': 'public, max-age=3600'
    });
    res.send(audio.audio);
  } catch (err) {
    console.error('TTS endpoint error:', err.message);
    res.status(500).json({ error: 'TTS generation failed' });
  }
});

app.get('/api/tts/voices', async (_req, res) => {
  try {
    const voices = await speechifyTTS.getVoices();
    res.json(voices);
  } catch (_err) {
    res.status(500).json({ error: 'Failed to fetch voices' });
  }
});

// Create a sharable guest URL for a room
app.post('/api/generate-room', (req, res) => {
  const { hotelName = 'Unknown Hotel' } = req.body || {};
  const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  activeRooms.set(roomId, { hotelName, createdAt: new Date(), users: new Set() });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const guestUrl = `${baseUrl}?room=${roomId}`;
  res.json({ roomId, guestUrl, qrData: guestUrl });
});

/* ------------------------------ Socket.IO -------------------------------- */

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join_room', (data = {}) => {
    const { room, role, language = 'hi-IN' } = data;
    if (!room || !role) {
      socket.emit('error', { message: 'room and role are required' });
      return;
    }

    // Leave previous room
    const prev = userRoles.get(socket.id)?.room;
    if (prev) {
      socket.leave(prev);
      const rinfo = activeRooms.get(prev);
      if (rinfo) rinfo.users.delete(socket.id);
    }

    // Join new room
    socket.join(room);
    userRoles.set(socket.id, { room, role, language });

    if (!activeRooms.has(room)) {
      activeRooms.set(room, { hotelName: 'Unknown Hotel', createdAt: new Date(), users: new Set() });
    }
    activeRooms.get(room).users.add(socket.id);

    // Notify
    socket.emit('room_joined', { room, role, language: languageNames[language] || language });
    socket.to(room).emit('user_joined', { role, language: languageNames[language] || language, userId: socket.id });

    // Stats
    const info = activeRooms.get(room);
    io.to(room).emit('room_stats', { userCount: info.users.size, hotelName: info.hotelName });
  });

  // Helper: pick target language (UI code)
  const resolveTargetLanguage = (role, socketId, explicitTarget) => {
    if (explicitTarget) return explicitTarget;            // respect client-provided target
    if (role === 'guest') return 'en-IN';                 // guest -> receptionist (English UI)
    // receptionist -> guest: default to the receptionist's stored peer language or Hindi
    return userRoles.get(socketId)?.language || 'hi-IN';
  };

  socket.on('audio_message', async (data = {}) => {
    try {
      const { room, role, language = 'hi-IN', targetLanguage: explicitTarget } = data;

      const userInfo = userRoles.get(socket.id);
      if (!userInfo || userInfo.room !== room) {
        socket.emit('error', { message: 'Not authorized for this room' });
        return;
      }

      io.to(room).emit('processing_status', { status: 'transcribing', speaker: role });

      const audioBuffer = Buffer.from(data.audioData || [], 'base64');
      const stt = await sarvamClient.transcribe(audioBuffer, language);

      io.to(room).emit('processing_status', { status: 'translating', speaker: role });

      const srcLangUI = language;
      const tgtLangUI = resolveTargetLanguage(role, socket.id, explicitTarget);

      const tr = await sarvamClient.translate(stt.transcript, srcLangUI, tgtLangUI);

      const messageData = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        room,
        speaker: role,
        original: {
          text: stt.transcript,
          language: srcLangUI,
          languageName: languageNames[srcLangUI] || srcLangUI
        },
        translated: {
          text: tr.text,
          language: tgtLangUI,
          languageName: languageNames[tgtLangUI] || tgtLangUI
        },
        confidence: stt.confidence ?? 0.95,
        speakerId: stt.diarized_transcript?.entries?.[0]?.speaker_id || socket.id,
        ttsAvailable: true
      };

      io.to(room).emit('translation', messageData);
      io.to(room).emit('processing_status', { status: 'complete' });
    } catch (err) {
      console.error('Audio processing error:', err.message);
      socket.emit('error', { message: 'Failed to process audio message', error: err.message });
      io.to(data.room).emit('processing_status', { status: 'error' });
    }
  });

  socket.on('text_message', async (data = {}) => {
    try {
      const { room, role, text, language = 'hi-IN', targetLanguage: explicitTarget } = data;

      const userInfo = userRoles.get(socket.id);
      if (!userInfo || userInfo.room !== room) {
        socket.emit('error', { message: 'Not authorized for this room' });
        return;
      }

      io.to(room).emit('processing_status', { status: 'translating', speaker: role });

      const srcLangUI = language || (role === 'guest' ? userInfo.language : 'en-IN');
      const tgtLangUI = resolveTargetLanguage(role, socket.id, explicitTarget);

      let tr;
      try {
        tr = await sarvamClient.translate(String(text || ''), srcLangUI, tgtLangUI);
      } catch (e) {
        console.error('Translation failed:', e.message);
        socket.emit('error', { message: `Translation failed: ${e.message}` });
        io.to(room).emit('processing_status', { status: 'error' });
        return;
      }

      const messageData = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        room,
        speaker: role,
        original: {
          text: String(text || ''),
          language: srcLangUI,
          languageName: languageNames[srcLangUI] || srcLangUI
        },
        translated: {
          text: tr.text,
          language: tgtLangUI,
          languageName: languageNames[tgtLangUI] || tgtLangUI
        },
        confidence: 1.0,
        speakerId: socket.id,
        ttsAvailable: true
      };

      io.to(room).emit('translation', messageData);
      io.to(room).emit('processing_status', { status: 'complete' });
    } catch (err) {
      console.error('Text processing error:', err.message);
      socket.emit('error', { message: 'Failed to process text message', error: err.message });
      io.to(data.room).emit('processing_status', { status: 'error' });
    }
  });

  socket.on('get_room_info', (data = {}) => {
    const info = activeRooms.get(data.room);
    if (info) {
      socket.emit('room_info', {
        hotelName: info.hotelName,
        userCount: info.users.size,
        createdAt: info.createdAt
      });
    }
  });

  socket.on('disconnect', () => {
    const userInfo = userRoles.get(socket.id);
    if (userInfo) {
      const { room, role } = userInfo;
      const info = activeRooms.get(room);
      if (info) {
        info.users.delete(socket.id);
        socket.to(room).emit('user_left', { role, userId: socket.id });
        io.to(room).emit('room_stats', { userCount: info.users.size, hotelName: info.hotelName });

        if (info.users.size === 0) {
          setTimeout(() => {
            const again = activeRooms.get(room);
            if (again && again.users.size === 0) {
              activeRooms.delete(room);
              console.log(`Cleaned up empty room: ${room}`);
            }
          }, 5 * 60 * 1000);
        }
      }
      userRoles.delete(socket.id);
    }
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

/* --------------------------- Error Middleware ---------------------------- */

app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ------------------------------ Start Up --------------------------------- */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏨 Hotel Translation Server listening on :${PORT}`);
  console.log(`📱 Open http://localhost:${PORT}`);

  if (process.env.SARVAM_KEY) console.log('🔧 Sarvam API ready');
  else console.log('⚠️  SARVAM_KEY missing');

  if (process.env.SPEECHIFY_API_KEY) console.log('🎤 Speechify TTS ready');
  else console.log('⚠️  SPEECHIFY_API_KEY missing');
});

/* --------------------------- Graceful Shutdown --------------------------- */

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, io };
