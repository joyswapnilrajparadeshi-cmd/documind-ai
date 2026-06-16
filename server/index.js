import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import mammoth from 'mammoth';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const app = express();
const PORT = Number(process.env.PORT || 8787);
const MAX_DOCUMENT_CHARS = Number(process.env.MAX_DOCUMENT_CHARS || 18000);
const WORKSPACES_TABLE = process.env.SUPABASE_WORKSPACES_TABLE || 'doc_workspaces';

app.use(cors({ origin: true }));
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024
  }
});

const aiClient = process.env.GROQ_API_KEY
  ? new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1'
    })
  : null;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAuth = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

function cleanText(value = '') {
  return String(value)
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function limitText(value = '', max = MAX_DOCUMENT_CHARS) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[Document truncated for AI context. Use smaller sections for deeper analysis.]`;
}

function getWordCount(text = '') {
  return cleanText(text).split(/\s+/).filter(Boolean).length;
}

function explainExternalError(error, service = 'external service') {
  const message = String(error?.message || error || 'Unknown error');
  const lower = message.toLowerCase();
  if (lower.includes('fetch failed') || lower.includes('failed to fetch') || lower.includes('network')) {
    return `Could not reach ${service}. Check your .env values, internet connection, and whether the project URL/key belong to the same Supabase project.`;
  }
  if (lower.includes('jwt') || lower.includes('invalid api key')) {
    return `${service} rejected the credentials. Check or rotate the related key in .env.`;
  }
  return message;
}

function detectDocumentType(text = '', fileName = '') {
  const lower = `${fileName} ${text}`.toLowerCase();
  const patterns = [
    ['Resume / CV', ['resume', 'curriculum vitae', 'education', 'skills', 'projects', 'experience']],
    ['Agreement / Contract', ['agreement', 'contract', 'party', 'clause', 'terms', 'termination']],
    ['Policy / Compliance Document', ['policy', 'compliance', 'procedure', 'guideline', 'privacy', 'security']],
    ['Invoice / Bill', ['invoice', 'bill', 'amount', 'subtotal', 'tax', 'payment due']],
    ['Research / Study Material', ['abstract', 'introduction', 'methodology', 'references', 'chapter', 'lecture']],
    ['Meeting Notes', ['meeting', 'agenda', 'minutes', 'attendees', 'action items']],
    ['Business Report', ['executive summary', 'report', 'analysis', 'findings', 'recommendations']]
  ];

  let best = ['General Document', 0];
  for (const [name, keywords] of patterns) {
    const score = keywords.reduce((total, keyword) => total + (lower.includes(keyword) ? 1 : 0), 0);
    if (score > best[1]) best = [name, score];
  }
  return best[0];
}

function extensionFromName(fileName = '') {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

async function extractTextFromFile(file) {
  const fileName = file.originalname || 'uploaded-document';
  const ext = extensionFromName(fileName);
  const mime = file.mimetype || '';
  const buffer = file.buffer;

  if (ext === 'pdf' || mime.includes('pdf')) {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return cleanText(parsed?.text || '');
    } finally {
      if (typeof parser.destroy === 'function') await parser.destroy();
    }
  }

  if (ext === 'docx' || mime.includes('wordprocessingml')) {
    const parsed = await mammoth.extractRawText({ buffer });
    return cleanText(parsed?.value || '');
  }

  if (ext === 'txt' || mime.startsWith('text/')) {
    return cleanText(buffer.toString('utf8'));
  }

  throw new Error('Unsupported file type. Please upload a PDF, DOCX, or TXT file.');
}

function splitSentences(text = '') {
  return cleanText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 40);
}

function pickImportantSentences(text = '', count = 6) {
  const sentences = splitSentences(text);
  const keywords = ['deadline', 'must', 'should', 'important', 'risk', 'required', 'payment', 'date', 'action', 'project', 'result', 'summary', 'goal', 'issue'];
  return sentences
    .map((sentence, index) => {
      const lower = sentence.toLowerCase();
      const score = keywords.reduce((sum, word) => sum + (lower.includes(word) ? 2 : 0), 0) + Math.max(0, 5 - index * 0.25);
      return { sentence, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((item) => item.sentence);
}

function localSummary(text, documentName) {
  const wordCount = getWordCount(text);
  const documentType = detectDocumentType(text, documentName);
  const points = pickImportantSentences(text, 7);
  const shortSummary = points.slice(0, 3).join(' ');
  return [
    `# Document Summary`,
    `Document type: ${documentType}`,
    `Estimated length: ${wordCount} words`,
    '',
    `## Quick summary`,
    shortSummary || 'The document is readable and ready for AI analysis. Add more text for a deeper summary.',
    '',
    `## Key points`,
    ...(points.length ? points.map((point) => `- ${point}`) : ['- No strong key points were detected from the current text.']),
    '',
    `## Recommended next step`,
    `Ask a specific question or run the tasks, notes, risk, or report generator for a more focused result.`
  ].join('\n');
}

function localTasks(text) {
  const sentences = splitSentences(text);
  const taskSignals = ['must', 'should', 'need to', 'required', 'action', 'follow up', 'deadline', 'submit', 'pay', 'complete', 'prepare', 'review', 'send', 'update'];
  const dateRegex = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|january|february|march|april|may|june|july|august|september|october|november|december|today|tomorrow|week|month)\b/i;
  const tasks = sentences
    .filter((sentence) => taskSignals.some((signal) => sentence.toLowerCase().includes(signal)) || dateRegex.test(sentence))
    .slice(0, 10);

  if (!tasks.length) {
    return [
      `# Action Checklist`,
      `- Review the document manually and mark any commitments, dates, or responsibilities.`,
      `- Ask DocuMind AI a targeted question such as: What actions are required from this document?`,
      `- Save the workspace after generating your final summary.`
    ].join('\n');
  }

  return [
    `# Action Checklist`,
    ...tasks.map((task, index) => `${index + 1}. ${task}`),
    '',
    `## Follow-up recommendation`,
    `Confirm every date, name, amount, and responsibility before acting on the checklist.`
  ].join('\n');
}

function localNotes(text, documentName) {
  const points = pickImportantSentences(text, 10);
  return [
    `# Smart Notes`,
    `Source: ${documentName || 'Uploaded document'}`,
    '',
    `## Revision notes`,
    ...(points.length ? points.map((point) => `- ${point}`) : ['- Add more document text to generate richer notes.']),
    '',
    `## Flashcard prompts`,
    `- What is the main purpose of this document?`,
    `- Which terms, dates, or responsibilities are most important?`,
    `- What should be checked before taking action?`,
    '',
    `## Quick review method`,
    `Read the summary, verify the checklist, then ask three specific questions about unclear parts.`
  ].join('\n');
}

function localRisks(text) {
  const sentences = splitSentences(text);
  const riskSignals = ['penalty', 'termination', 'liability', 'risk', 'confidential', 'non-refundable', 'late fee', 'breach', 'must', 'required', 'personal data', 'payment', 'deadline'];
  const risks = sentences
    .filter((sentence) => riskSignals.some((signal) => sentence.toLowerCase().includes(signal)))
    .slice(0, 8);

  return [
    `# Important Points and Risk Review`,
    `This is document guidance only, not legal, financial, or professional advice. Verify critical items with a qualified person.`,
    '',
    `## Items to check`,
    ...(risks.length ? risks.map((risk) => `- ${risk}`) : ['- No obvious risk-heavy language was detected, but you should still verify names, dates, payment terms, obligations, and exclusions.']),
    '',
    `## Verification checklist`,
    `- Are all names, dates, amounts, and responsibilities correct?`,
    `- Are there penalties, cancellation rules, or deadlines?`,
    `- Is anything missing, vague, or one-sided?`,
    `- Do you need expert review before signing, submitting, or acting?`
  ].join('\n');
}

function localReport(text, documentName) {
  return [
    `# DocuMind AI Report`,
    `Document: ${documentName || 'Uploaded document'}`,
    `Document type: ${detectDocumentType(text, documentName)}`,
    `Word count: ${getWordCount(text)}`,
    '',
    localSummary(text, documentName),
    '',
    localTasks(text),
    '',
    localRisks(text)
  ].join('\n');
}

function localQuestionAnswer(text, question = '') {
  const points = pickImportantSentences(text, 8);
  const lowerQuestion = question.toLowerCase();
  const filtered = splitSentences(text)
    .filter((sentence) => lowerQuestion.split(/\W+/).filter((w) => w.length > 4).some((word) => sentence.toLowerCase().includes(word)))
    .slice(0, 6);
  const evidence = filtered.length ? filtered : points;

  return [
    `# Answer`,
    `Based on the uploaded document, the most relevant information is:`,
    '',
    ...(evidence.length ? evidence.map((point) => `- ${point}`) : ['- The current document text does not contain enough directly matching context. Try asking a more specific question.']),
    '',
    `## Confidence note`,
    `This answer is grounded in the extracted text available to the app. Verify the original document for final decisions.`
  ].join('\n');
}

function getModeInstructions(mode) {
  const base = `You are DocuMind AI, a professional document intelligence assistant. Ground your answer only in the document content. Be clear, structured, practical, and concise. If information is missing, say what is missing. Avoid pretending to know facts not in the document.`;
  const instructions = {
    summary: `${base}\nCreate a professional document summary with: document type, executive summary, key points, important entities/dates, and recommended next actions.`,
    tasks: `${base}\nExtract action items, deadlines, responsibilities, follow-ups, and a prioritized checklist. Use tables or bullets where useful.`,
    notes: `${base}\nCreate smart notes for learning or review. Include section notes, key concepts, flashcard prompts, and a quick revision checklist.`,
    risks: `${base}\nIdentify important clauses, risks, obligations, missing details, and verification questions. Include a safety note that this is not legal/financial advice.`,
    report: `${base}\nGenerate a polished export-ready report with summary, key points, tasks, risks, questions to verify, and action checklist.`,
    ask: `${base}\nAnswer the user's question using only the document. Include evidence from the document and a confidence note.`
  };
  return instructions[mode] || instructions.summary;
}

async function callAi({ mode, documentText, documentName, question }) {
  if (!aiClient) return null;
  const model = process.env.AI_MODEL || 'llama-3.1-8b-instant';
  const content = limitText(documentText);
  const userPrompt = [
    `Document name: ${documentName || 'Untitled document'}`,
    `Document type estimate: ${detectDocumentType(content, documentName)}`,
    question ? `User question: ${question}` : '',
    '',
    `Document content:`,
    content
  ].filter(Boolean).join('\n');

  const completion = await aiClient.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: getModeInstructions(mode) },
      { role: 'user', content: userPrompt }
    ]
  });

  return completion.choices?.[0]?.message?.content?.trim() || null;
}

function localIntelligence({ mode, documentText, documentName, question }) {
  if (mode === 'tasks') return localTasks(documentText);
  if (mode === 'notes') return localNotes(documentText, documentName);
  if (mode === 'risks') return localRisks(documentText);
  if (mode === 'report') return localReport(documentText, documentName);
  if (mode === 'ask') return localQuestionAnswer(documentText, question);
  return localSummary(documentText, documentName);
}

async function getUserFromRequest(req) {
  if (!supabaseAuth) return null;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch (error) {
    throw new Error(explainExternalError(error, 'Supabase Auth'));
  }
}

function requireSupabase(res) {
  if (!supabaseAuth || !supabaseAdmin) {
    res.status(503).json({
      ok: false,
      error: 'Supabase is not configured. Add SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.'
    });
    return false;
  }
  return true;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'DocuMind AI',
    aiConfigured: Boolean(aiClient),
    aiProvider: process.env.AI_PROVIDER || (aiClient ? 'Groq' : 'Local fallback'),
    databaseEnabled: Boolean(supabaseAdmin),
    authEnabled: Boolean(supabaseAuth),
    workspacesTable: WORKSPACES_TABLE,
    maxDocumentChars: MAX_DOCUMENT_CHARS,
    runtime: process.version,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/extract', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Please upload a PDF, DOCX, or TXT file.' });
    }

    const text = await extractTextFromFile(req.file);
    if (!text) {
      return res.status(422).json({ ok: false, error: 'No readable text was found. Try another file or paste text manually.' });
    }

    res.json({
      ok: true,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      wordCount: getWordCount(text),
      charCount: text.length,
      documentType: detectDocumentType(text, req.file.originalname),
      text
    });
  } catch (error) {
    console.error('Extract error:', error);
    res.status(500).json({ ok: false, error: error.message || 'Failed to extract document text.' });
  }
});

app.post('/api/intelligence', async (req, res) => {
  try {
    const { mode = 'summary', documentText = '', documentName = '', question = '' } = req.body || {};
    const cleaned = cleanText(documentText);

    if (!cleaned || cleaned.length < 20) {
      return res.status(400).json({ ok: false, error: 'Add or upload document text before running DocuMind AI.' });
    }

    if (mode === 'ask' && !question.trim()) {
      return res.status(400).json({ ok: false, error: 'Type a question before asking the document.' });
    }

    let result = null;
    let source = 'local';

    try {
      result = await callAi({ mode, documentText: cleaned, documentName, question });
      if (result) source = process.env.AI_PROVIDER || 'AI';
    } catch (aiError) {
      console.error('AI error, using local fallback:', aiError.message);
    }

    if (!result) {
      result = localIntelligence({ mode, documentText: cleaned, documentName, question });
    }

    res.json({
      ok: true,
      mode,
      result,
      source,
      documentType: detectDocumentType(cleaned, documentName),
      wordCount: getWordCount(cleaned),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Intelligence error:', error);
    res.status(500).json({ ok: false, error: error.message || 'Failed to generate document intelligence.' });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password are required.' });

    const { data, error } = await supabaseAuth.auth.signUp({
      email,
      password,
      options: { data: { name: name || email.split('@')[0] } }
    });

    if (error) return res.status(400).json({ ok: false, error: error.message });
    res.json({ ok: true, user: data.user, session: data.session, needsEmailConfirmation: !data.session });
  } catch (error) {
    res.status(500).json({ ok: false, error: explainExternalError(error, 'Supabase Auth') || 'Signup failed.' });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password are required.' });

    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ ok: false, error: error.message });
    res.json({ ok: true, user: data.user, session: data.session });
  } catch (error) {
    res.status(500).json({ ok: false, error: explainExternalError(error, 'Supabase Auth') || 'Sign in failed.' });
  }
});

app.get('/api/me', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Not signed in.' });
  res.json({ ok: true, user });
});

app.get('/api/workspaces', async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Sign in to view saved workspaces.' });

    const { data, error } = await supabaseAdmin
      .from(WORKSPACES_TABLE)
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) return res.status(400).json({ ok: false, error: error.message });
    res.json({ ok: true, workspaces: data || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: explainExternalError(error, 'Supabase workspaces') || 'Failed to load workspaces.' });
  }
});

app.post('/api/workspaces', async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Sign in to save workspaces.' });

    const payload = req.body || {};
    const documentText = cleanText(payload.document_text || '');
    if (documentText.length < 20) {
      return res.status(400).json({ ok: false, error: 'Upload or paste a readable document before saving.' });
    }
    const title = cleanText(payload.title || payload.document_name || 'Untitled Workspace').slice(0, 140);

    const row = {
      user_id: user.id,
      title,
      document_name: payload.document_name || 'Untitled document',
      document_type: payload.document_type || detectDocumentType(payload.document_text || '', payload.document_name || ''),
      document_text: documentText,
      summary: payload.summary || '',
      insights: payload.insights || {},
      tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
      notes: payload.notes || '',
      risk_analysis: payload.risk_analysis || '',
      report: payload.report || '',
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from(WORKSPACES_TABLE)
      .insert(row)
      .select('*')
      .single();

    if (error) return res.status(400).json({ ok: false, error: error.message });
    res.json({ ok: true, workspace: data });
  } catch (error) {
    res.status(500).json({ ok: false, error: explainExternalError(error, 'Supabase workspaces') || 'Failed to save workspace.' });
  }
});

app.delete('/api/workspaces/:id', async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Sign in to delete workspaces.' });

    const { error } = await supabaseAdmin
      .from(WORKSPACES_TABLE)
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', user.id);

    if (error) return res.status(400).json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: explainExternalError(error, 'Supabase workspaces') || 'Failed to delete workspace.' });
  }
});


app.use((error, req, res, next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: 'File is too large. Upload a PDF, DOCX, or TXT under 12 MB.' });
  }
  if (error) {
    console.error('Unhandled server error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Unexpected server error.' });
  }
  return next();
});

app.use(express.static(distDir));

app.get(/.*/, (req, res) => {
  const indexFile = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    return res.status(404).send('DocuMind frontend build not found. Run npm run build before starting the production server.');
  }
  res.sendFile(indexFile);
});

app.listen(PORT, () => {
  console.log(`DocuMind AI server running on port ${PORT}`);
});
