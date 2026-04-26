import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { HttpsProxyAgent } from 'https-proxy-agent'; 
import 'dotenv/config';

const app = express();

// --- تعديل الـ CORS لضمان قبول الطلبات من Netlify ---
app.use(cors({
  origin: '*', // يسمح لأي موقع بالاتصال (حل مثالي للمرحلة الحالية)
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// --- 1. إعداد السايفون (لـ Gemini فقط في الجهاز المحلي) ---
const isLocal = process.env.NODE_ENV !== 'production';
const proxy = 'http://127.0.0.1:1080'; 
const geminiAgent = isLocal ? new HttpsProxyAgent(proxy) : null;

// --- 2. إعداد Gemini ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- 3. الاتصال بـ MongoDB ---
const MONGO_URI = process.env.MONGO_URI;
mongoose.set('strictQuery', true);

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Successfully'))
  .catch(err => {
    console.error('❌ MongoDB Error:', err.message);
  });

// --- Models ---
const chatSchema = new mongoose.Schema({
  prompt: String,
  response: String,
  date: { type: Date, default: Date.now }
});
const Chat = mongoose.model('Chat', chatSchema);

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// --- 4. Routes ---

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    let user = await User.findOne({ email });
    
    // لو المستخدم مش موجود.. انشئه فوراً (Registration & Login in one)
    if (!user) {
      user = new User({ email, password });
      await user.save();
      return res.json({ success: true, message: "تم إنشاء حساب جديد بنجاح", user });
    }

    // لو موجود.. اتأكد من الباسورد
    if (user.password !== password) {
      return res.status(401).json({ success: false, message: "كلمة المرور التي أدخلتها غير صحيحة" });
    }

    res.json({ success: true, message: "تم تسجيل الدخول بنجاح", user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "لا توجد رسالة" });

    let model;
    if (geminiAgent) {
      model = genAI.getGenerativeModel(
        { model: "gemini-1.5-flash" },
        { apiVersion: 'v1beta', requestOptions: { agent: geminiAgent } } 
      );
    } else {
      model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    }
    
    const result = await model.generateContent(message);
    const aiResponse = result.response.text();

    const newChat = new Chat({ prompt: message, response: aiResponse });
    await newChat.save();

    res.json({ reply: aiResponse });
  } catch (error) {
    console.error("❌ Gemini Error:", error);
    res.status(500).json({ error: "فشل الاتصال بـ AI", details: error.message });
  }
});

// --- 5. تشغيل السيرفر ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});