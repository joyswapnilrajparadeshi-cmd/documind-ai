# DocuMind AI

**AI Document Intelligence Workspace**

DocuMind AI is a professional AI app that turns uploaded documents into summaries, answers, tasks, risks, notes, saved workspaces, and export-ready reports.

## Features

- PDF, DOCX, and TXT document upload
- Automatic text extraction
- Groq AI document intelligence through OpenAI-compatible API
- Local fallback intelligence when AI key is missing
- Executive summary generator
- Ask questions from document content
- Task and deadline extractor
- Smart notes and flashcard prompts
- Risk and important-point reviewer
- Export-ready full report
- Print/PDF export
- Supabase login/signup
- Supabase saved document workspaces
- Load and delete saved workspaces
- Professional responsive dashboard
- Installable PWA app experience
- Render-ready Express + Vite deployment

## Tech Stack

- React + Vite
- Express.js
- Groq AI API via `openai` SDK
- Supabase Auth and Postgres
- `pdf-parse` for PDF extraction
- `mammoth` for DOCX extraction
- PWA manifest + service worker

## Local Setup on Windows

Open Command Prompt or VS Code terminal inside the project folder.

```bash
npm install
```

Create `.env` from the example file:

```bash
copy .env.example .env
```

Edit `.env` and add your keys:

```env
PORT=8787
GROQ_API_KEY=your_groq_key_here
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.1-8b-instant
AI_PROVIDER=Groq
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_WORKSPACES_TABLE=doc_workspaces
MAX_DOCUMENT_CHARS=18000
```

Start local development:

```bash
npm run dev
```

Open:

```txt
http://localhost:5173
```

Backend health check:

```txt
http://localhost:8787/api/health
```

## Supabase Setup

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Paste and run `supabase_schema.sql`.
4. Go to **Project Settings → API** and copy:
   - Project URL
   - anon public key
   - service role key
5. Add those values to `.env`.

For faster testing, you can disable email confirmation in Supabase Auth settings. For production, configure email confirmation properly.

## Groq Setup

1. Create a Groq API key.
2. Add it to `.env` as `GROQ_API_KEY`.
3. Keep this model unless you want to change it:

```env
AI_MODEL=llama-3.1-8b-instant
```

Never commit `.env` to GitHub.

## Production Build

```bash
npm run build
npm run start
```

The Express server serves the Vite `dist` folder in production.

## Render Deployment Settings

Use a Web Service.

```txt
Build Command:
npm install && npm run build
```

```txt
Start Command:
node server/index.js
```

Add environment variables in Render, not in GitHub.

```env
PORT=10000
GROQ_API_KEY=your_groq_key_here
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.1-8b-instant
AI_PROVIDER=Groq
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_WORKSPACES_TABLE=doc_workspaces
MAX_DOCUMENT_CHARS=18000
```

## Important Security Notes

- Do not paste real API keys into chat or screenshots.
- Do not upload `.env` to GitHub.
- Rotate keys immediately if they are exposed.
- The Supabase service role key is server-only and very sensitive.

## App Positioning

DocuMind AI helps students, professionals, teams, and freelancers understand and act on documents faster. It is useful for notes, reports, policies, resumes, agreements, bills, and project documents.
