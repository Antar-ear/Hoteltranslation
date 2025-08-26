// server.js
// Env: PORT, SARVAM_KEY
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
const io = socketIo(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

const storage = multer.memoryStorage();
const upload = multer({ storage });

/* ----------------------------- Helper Utils ------------------------------ */
const toSarvamLang = (code = 'en-IN') => (String(code).split('-')[0] || 'en').toLowerCase();
const safeJson = (x) => { try { return JSON.stringify(x); } catch { return String(x); } };

const languageNames = {
  'hi-IN': 'Hindi', 'bn-IN': 'Bengali', 'ta-IN': 'Tamil', 'te-IN': 'Telugu',
  'mr-IN': 'Marathi', 'gu-IN': 'Gujarati', 'kn-IN': 'Kannada', 'ml-IN': 'Malayalam',
  'pa-IN': 'Punjabi', 'or-IN': 'Odia', 'en-IN': 'English'
};

/* ---------------------------- Sarvam Clients ----------------------------- */
class SarvamAIClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.sarvam.ai';
    this.jsonHeaders = { 'api-subscription-key': apiKey, 'Content-Type': 'application/json' };
    this.http = axios.create({ baseURL: this.baseUrl, timeout: 30000 });
  }

  async transcribe(audioBuffer, languageCode) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
    form.append('language_code', toSarvamLang(languageCode));
    form.append('model', 'saarika:v2.5'); // valid models: v1|v2|v2.5|flash

    try {
      const res = await this.http.post('/speech-to-text', form, {
        headers: { 'api-subscription-key': this.apiKey, ...form.getHeaders() }
      });
      const t = res.data?.transcript || '';
      return {
        transcript: t,
        confidence: res.data?.confidence ?? 0.95,
        language_code: res.data?.language_code || toSarvamLang(languageCode),
        diarized_transcript: res.data?.diarized_transcript || {
          entries: [{ transcript: t, speaker_id: 'speaker_1', start_time_seconds: 0, end_time_seconds: 0 }]
        }
      };
    } catch (err) {
      const apiErr = err.response?.data || err.message;
      console.error('Sarvam STT error:', apiErr);
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
      const res = await this.http.post('/translate', payload, { headers: this.jsonHeaders });
      return {
        text: res.data?.translated_text || text,
        source_language: sourceLanguage,
        target_language: targetLanguage,
        confidence: res.data?.confidence ?? 0.95
      };
    } catch (err) {
      const apiErr = err.response?.data || err.message;
      console.error('Sarvam Translate error:', apiErr);
      throw new Error(`Failed to translate text: ${safeJson(apiErr)}`);
    }
  }

  async healthCheck() {
    try { await this.translate('Hello', 'en-IN', 'hi-IN'); return true; }
    catch (e) { console.error('Sarvam health check failed:', e.message); return false; }
  }
}

/* --------------------------- Sarvam TTS (bulbul) -------------------------- */
/**
 * Uses Sarvam text-to-speech (model: bulbul:v2).
 * The API commonly accepts a JSON payload and returns audio bytes.
 * We request arraybuffer and stream back to the client as audio/mpeg.
 */
class SarvamTTS {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.http = axios.create({
      baseURL: 'https://api.sarvam.ai',
      timeout: 30000,
      headers: { 'api-subscription-key': apiKey, 'Content-Type': 'application/json' }
    });
    // sensible defaults; tweak per your needs
    this.defaultSampleRate = 22050;
    this.defaultSpeakerByLang = {
      'hi-IN': 'anushka',
      'en-IN': 'meera'
      // add more language->speaker defaults if needed
    };
  }

  async generateSpeech(text, language = 'hi-IN', opts = {}) {
    const speaker = opts.speaker || this.defaultSpeakerByLang[language] || 'anushka';
    const payload = {
      text: String(text || ''),
      target_language_code: language,           // Sarvam TTS accepts regioned codes (e.g., hi-IN)
      speaker,
      pitch: opts.pitch ?? 0,
      pace: opts.pace ?? 1,
      loudness: opts.loudness ?? 1,
      speech_sample_rate: opts.sampleRate ?? this.defaultSampleRate,
      enable_preprocessing: opts.enablePreprocessing ?? true,
      model: opts.model || 'bulbul:v2'
    };

    try {
      // Many TTS APIs return raw audio when asked. Request arraybuffer and pass content-type through.
      const res = await this.http.post('/text-to-speech', payload, { responseType: 'arraybuffer' });
      const contentType = res.headers['content-type'] || 'audio/mpeg';
      return { audio: Buffer.from(res.data), contentType };
    } catch (err) {
      // If API returns JSON (e.g., base64), handle gracefully
      const data = err.response?.data;
      if (data && data.audio) {
        const buf = Buffer.from(data.audio, 'base64');
        return { audio: buf, contentType: 'audio/mpeg' };
      }
      console.error('Sarvam TTS error:', data || err.message);
      throw new Error(`TTS generation failed: ${safeJson(data || err.message)}`);
    }
  }

  // simple placeholder list; replace with real voice list if Sarvam exposes one
  async getVoices() {
    return [
      { language: 'hi-IN', speaker: 'anushka' },
      { language: 'en-IN', speaker: 'meera' }
    ];
  }
}

/* ---------------------------- Init API Clients --------------------------- */
if (!process.env.SARVAM_KEY) console.warn('⚠️  SARVAM_KEY not set – Sarvam STT/Translate/TTS will fail.');
const sarvamClient = new SarvamAIClient(process.env.SARVAM_KEY || '');
const sarvamTTS = new SarvamTTS(process.env.SARVAM_KEY || '');

/* ---------------------- In-memory Room/User Tracking --------------------- */
const activeRooms = new Map(); // roomId -> { hotelName, createdAt, users:Set }
const userRoles  = new Map();  // socketId -> { room, role, language }

/* -------------------------------- Routes --------------------------------- */
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/health', async (_req, res) => {
  const sarvamOk = await sarvamClient.healthCheck();
  res.json({ status: 'ok', sarvamOk, time: new Date().toISOString() });
});

// TTS via Sarvam
app.post('/api/tts', async (req, res) => {
  try {
    const { text, language = 'hi-IN', speaker, pitch, pace, loudness, sampleRate, enablePreprocessing, model } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Text is required' });

    const audio = await sarvamTTS.generateSpeech(text, language, { speaker, pitch, pace, loudness, sampleRate, enablePreprocessing, model });
    res.set({ 'Content-Type': audio.contentType, 'Content-Length': audio.audio.length, 'Cache-Control': 'public, max-age=3600' });
    res.send(audio.audio);
  } catch (e) {
    console.error('TTS endpoint error:', e.message);
    res.status(500).json({ error: 'TTS generation failed' });
  }
});

app.get('/api/tts/voices', async (_req, res) => {
  try { res.json(await sarvamTTS.getVoices()); }
  catch { res.status(500).json({ error: 'Failed to fetch voices' }); }
});

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
    if (!room || !role) return socket.emit('error', { message: 'room and role are required' });

    const prev = userRoles.get(socket.id)?.room;
    if (prev) {
      socket.leave(prev);
      const r = activeRooms.get(prev);
      if (r) r.users.delete(socket.id);
    }

    socket.join(room);
    userRoles.set(socket.id, { room, role, language });

    if (!activeRooms.has(room)) activeRooms.set(room, { hotelName: 'Unknown Hotel', createdAt: new Date(), users: new Set() });
    activeRooms.get(room).users.add(socket.id);

    socket.emit('room_joined', { room, role, language: languageNames[language] || language });
    socket.to(room).emit('user_joined', { role, language: languageNames[language] || language, userId: socket.id });

    const info = activeRooms.get(room);
    io.to(room).emit('room_stats', { userCount: info.users.size, hotelName: info.hotelName });
  });

  const resolveTargetLanguage = (role, socketId, explicitTarget) => {
    if (explicitTarget) return explicitTarget;
    if (role === 'guest') return 'en-IN';
    return userRoles.get(socketId)?.language || 'hi-IN';
  };

  socket.on('audio_message', async (data = {}) => {
    try {
      const { room, role, language = 'hi-IN', targetLanguage: explicitTarget } = data;

      const userInfo = userRoles.get(socket.id);
      if (!userInfo || userInfo.room !== room) return socket.emit('error', { message: 'Not authorized for this room' });

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
        room, speaker: role,
        original: { text: stt.transcript, language: srcLangUI, languageName: languageNames[srcLangUI] || srcLangUI },
        translated: { text: tr.text, language: tgtLangUI, languageName: languageNames[tgtLangUI] || tgtLangUI },
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
      if (!userInfo || userInfo.room !== room) return socket.emit('error', { message: 'Not authorized for this room' });

      io.to(room).emit('processing_status', { status: 'translating', speaker: role });

      const srcLangUI = language || (role === 'guest' ? userInfo.language : 'en-IN');
      const tgtLangUI = resolveTargetLanguage(role, socket.id, explicitTarget);

      const tr = await sarvamClient.translate(String(text || ''), srcLangUI, tgtLangUI);

      const messageData = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        room, speaker: role,
        original: { text: String(text || ''), language: srcLangUI, languageName: languageNames[srcLangUI] || srcLangUI },
        translated: { text: tr.text, language: tgtLangUI, languageName: languageNames[tgtLangUI] || tgtLangUI },
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
    if (info) socket.emit('room_info', { hotelName: info.hotelName, userCount: info.users.size, createdAt: info.createdAt });
  });

  socket.on('disconnect', () => {
    const info = userRoles.get(socket.id);
    if (!info) return;
    const { room, role } = info;
    const r = activeRooms.get(room);
    if (r) {
      r.users.delete(socket.id);
      socket.to(room).emit('user_left', { role, userId: socket.id });
      io.to(room).emit('room_stats', { userCount: r.users.size, hotelName: r.hotelName });

      if (r.users.size === 0) {
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
  });

  socket.on('error', (e) => console.error('Socket error:', e));
});

/* --------------------------- Error Middleware ---------------------------- */
app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ------------------------------ Boot Server ------------------------------ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏨 Hotel Translation Server listening on :${PORT}`);
  console.log(`📱 Open http://localhost:${PORT}`);
  console.log(process.env.SARVAM_KEY ? '🔧 Sarvam API ready' : '⚠️  SARVAM_KEY missing');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => { console.log('Server closed'); process.exit(0); });
});

module.exports = { app, server, io };
