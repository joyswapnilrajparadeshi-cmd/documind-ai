import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const SESSION_KEY = 'documind.session.v1';

const BROWSER_SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '')
  .replace(/\/rest\/v1\/?$/, '')
  .replace(/\/$/, '');
const BROWSER_SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '');
const BROWSER_WORKSPACES_TABLE = import.meta.env.VITE_SUPABASE_WORKSPACES_TABLE || 'doc_workspaces';

const browserSupabase = BROWSER_SUPABASE_URL && BROWSER_SUPABASE_ANON_KEY
  ? createClient(BROWSER_SUPABASE_URL, BROWSER_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

function toAppSession(supabaseSession) {
  if (!supabaseSession?.access_token || !supabaseSession?.user) return null;
  return { token: supabaseSession.access_token, user: supabaseSession.user };
}

const demoText = `This sample product policy describes the launch of an AI document workspace. The team must finalize the onboarding checklist before June 30 and review privacy language before public release. The product supports PDF, DOCX, and TXT uploads, document summaries, question answering, task extraction, smart notes, risk review, saved workspaces, and export-ready reports. The main risks are unclear ownership of uploaded data, incomplete deadline tracking, and missing user confirmation before sharing sensitive documents. The next release should include role-based access, stronger audit logging, and improved mobile app installation instructions.`;

const intelligenceModes = [
  { id: 'summary', label: 'Executive Summary', description: 'Document type, key points, entities, and next actions.' },
  { id: 'tasks', label: 'Tasks & Deadlines', description: 'Action items, responsibilities, dates, and follow-ups.' },
  { id: 'notes', label: 'Smart Notes', description: 'Study notes, flashcard prompts, and revision checklist.' },
  { id: 'risks', label: 'Risk Review', description: 'Important clauses, obligations, missing details, and checks.' },
  { id: 'report', label: 'Full Report', description: 'Export-ready document intelligence report.' }
];

const modeOrder = intelligenceModes.map((mode) => mode.id);

function cx(...items) {
  return items.filter(Boolean).join(' ');
}

function getFriendlyError(error) {
  const raw = String(error?.message || error || 'Something went wrong.');
  const lower = raw.toLowerCase();

  if (lower.includes('failed to fetch') || lower === 'fetch failed' || lower.includes('networkerror')) {
    return 'Could not reach the DocuMind server or Supabase. Check that npm run dev is still running, your .env values are saved, and your internet connection is active.';
  }
  if (lower.includes('invalid login credentials')) {
    return 'Invalid email or password. If this is your first time, switch to Sign up and create an account first.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Email confirmation is enabled in Supabase. Confirm the email or disable email confirmation for local testing.';
  }
  if (lower.includes('vite_supabase') || lower.includes('browser supabase')) {
    return 'Browser Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart npm run dev.';
  }
  return raw;
}

async function api(path, options = {}, token = '') {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
    const isNativeApp = window.location.protocol === 'capacitor:';
    const apiPath = path.startsWith('/api')
      ? `${apiBaseUrl || (isNativeApp ? 'https://documind-ai-knq5.onrender.com' : '')}${path}`
      : path;

    response = await fetch(apiPath, { ...options, headers });
  } catch (error) {
    throw new Error(getFriendlyError(error));
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(getFriendlyError(data.error || `Request failed with status ${response.status}`));
  }
  return data;
}

function renderInline(text) {
  return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function renderText(text) {
  if (!text) return <p className="muted">No output yet.</p>;
  return String(text).split('\n').map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return <br key={index} />;
    if (trimmed.startsWith('# ')) return <h3 key={index}>{renderInline(trimmed.replace(/^# /, ''))}</h3>;
    if (trimmed.startsWith('## ')) return <h4 key={index}>{renderInline(trimmed.replace(/^## /, ''))}</h4>;
    if (/^[-*]\s/.test(trimmed)) return <p key={index} className="bullet">{renderInline(trimmed.replace(/^[-*]\s/, ''))}</p>;
    if (/^\d+[.)]\s/.test(trimmed)) return <p key={index} className="numbered">{renderInline(trimmed)}</p>;
    return <p key={index}>{renderInline(trimmed)}</p>;
  });
}

function AuthPanel({ browserSupabase, session, setSession, setMessage, onSignedIn }) {
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  function storeSession(supabaseSession) {
    const nextSession = toAppSession(supabaseSession);
    if (!nextSession) return null;
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    onSignedIn?.(nextSession);
    return nextSession;
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      if (!browserSupabase) {
        throw new Error('Browser Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      }

      const cleanEmail = email.trim();
      const cleanName = name.trim() || cleanEmail.split('@')[0];

      if (mode === 'signup') {
        const { data, error } = await browserSupabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { name: cleanName },
            emailRedirectTo: window.location.origin
          }
        });

        if (error) throw error;
        const nextSession = storeSession(data.session);
        if (nextSession) {
          setMessage({ type: 'success', text: 'Account created and signed in. Saved workspaces are now enabled.' });
        } else {
          setMessage({ type: 'info', text: 'Account created. Supabase email confirmation is enabled, so confirm your email before signing in.' });
        }
      } else {
        const { data, error } = await browserSupabase.auth.signInWithPassword({
          email: cleanEmail,
          password
        });

        if (error) throw error;
        const nextSession = storeSession(data.session);
        if (!nextSession) throw new Error('Sign in succeeded, but Supabase did not return a browser session.');
        setMessage({ type: 'success', text: 'Signed in successfully. Saved workspaces are now enabled.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: getFriendlyError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await browserSupabase?.auth.signOut();
    } catch {
      // Local sign-out should still work even if Supabase is temporarily unreachable.
    }
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setMessage({ type: 'info', text: 'Signed out. Local analysis still works; saving is disabled until you sign in again.' });
  }

  if (session?.user) {
    return (
      <div className="auth-card signed-in">
        <span className="status-dot" />
        <div>
          <strong>{session.user.email}</strong>
          <p>Saved workspaces enabled.</p>
        </div>
        <button className="ghost small" onClick={signOut}>Sign out</button>
      </div>
    );
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-switch">
        <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
        <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Sign up</button>
      </div>
      {mode === 'signup' && (
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" autoComplete="name" />
      )}
      <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" autoComplete="email" required />
      <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" minLength="6" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required />
      <button className={busy ? 'busy-button' : ''} disabled={busy || !browserSupabase}>{busy ? 'Please wait...' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      <p className="helper-text">{browserSupabase ? 'Auth runs through the browser Supabase client. Use Sign up first for a fresh local test user.' : 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart npm run dev.'}</p>
    </form>
  );
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [message, setMessage] = useState({ type: 'info', text: 'Upload a document, paste text, or click Load sample to begin.' });
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  });
  const [installPrompt, setInstallPrompt] = useState(null);

  const [documentName, setDocumentName] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [documentType, setDocumentType] = useState('No document loaded');
  const [question, setQuestion] = useState('');
  const [activeMode, setActiveMode] = useState('summary');
  const [outputs, setOutputs] = useState({});
  const [activeOutput, setActiveOutput] = useState('summary');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);


  const stats = useMemo(() => {
    const chars = documentText.length;
    const words = documentText.trim() ? documentText.trim().split(/\s+/).length : 0;
    return { chars, words };
  }, [documentText]);

  const outputCount = Object.values(outputs).filter((item) => item?.result).length;
  const hasDocument = stats.words > 0 && documentText.trim().length >= 20;
  const hasOutput = outputCount > 0;
  const isBusy = Boolean(busy);
  const analysisDepth = stats.words ? Math.min(99, Math.max(10, Math.round((stats.words / 12) + 60))) : 0;
  const browserDatabaseReady = Boolean(browserSupabase);

  useEffect(() => {
    api('/api/health')
      .then(setHealth)
      .catch((error) => setMessage({ type: 'error', text: getFriendlyError(error) }));

    let authSubscription;
    if (browserSupabase) {
      browserSupabase.auth.getSession()
        .then(({ data }) => {
          const nextSession = toAppSession(data.session);
          if (nextSession) {
            localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
            setSession(nextSession);
            loadWorkspaces(nextSession, { silent: true });
          }
        })
        .catch((error) => setMessage({ type: 'error', text: getFriendlyError(error) }));

      const { data } = browserSupabase.auth.onAuthStateChange((event, supabaseSession) => {
        if (event === 'SIGNED_OUT') {
          localStorage.removeItem(SESSION_KEY);
          setSession(null);
          setWorkspaces([]);
          return;
        }

        const nextSession = toAppSession(supabaseSession);
        if (nextSession) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
          setSession(nextSession);
        }
      });
      authSubscription = data?.subscription;
    }

    function onBeforeInstallPrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      authSubscription?.unsubscribe();
    };
  }, []);

  async function installApp() {
    if (!installPrompt) {
      setMessage({ type: 'info', text: 'Install option appears after the app is served by the browser as an installable PWA. Try Chrome/Edge and reload once.' });
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function resetOutputs() {
    setOutputs({});
    setActiveOutput('summary');
  }

  function handleDocumentTextChange(value) {
    setDocumentText(value);
    resetOutputs();
    if (!value.trim()) {
      setDocumentType('No document loaded');
      setMessage({ type: 'info', text: 'Upload a document, paste text, or click Load sample to begin.' });
    } else if (documentType === 'No document loaded') {
      setDocumentType('Manual document text');
    }
  }

  async function uploadDocument(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy('extract');
    setProgress({ current: 0, total: 1, label: 'Extracting document text' });
    try {
      const form = new FormData();
      form.append('document', file);
      const data = await api('/api/extract', { method: 'POST', body: form });
      setDocumentName(data.fileName);
      setDocumentText(data.text);
      setDocumentType(data.documentType);
      resetOutputs();
      setMessage({ type: 'success', text: `Extracted ${data.wordCount} words from ${data.fileName}. Choose Run all for a complete report.` });
    } catch (error) {
      setMessage({ type: 'error', text: getFriendlyError(error) });
    } finally {
      setBusy('');
      setProgress(null);
      event.target.value = '';
    }
  }

  function loadSample() {
    setDocumentName('sample-policy.txt');
    setDocumentText(demoText);
    setDocumentType('Product Policy / Launch Notes');
    resetOutputs();
    setQuestion('What are the most important actions, deadlines, and risks?');
    setMessage({ type: 'info', text: 'Sample document loaded. Click Run all to test full intelligence.' });
  }

  function clearWorkspace() {
    setDocumentName('');
    setDocumentText('');
    setDocumentType('No document loaded');
    setQuestion('');
    setOutputs({});
    setActiveMode('summary');
    setActiveOutput('summary');
    setProgress(null);
    setMessage({ type: 'info', text: 'Workspace cleared. Upload, paste, or load a sample to begin.' });
  }

  function validateDocument() {
    if (!hasDocument) {
      setMessage({ type: 'error', text: 'Upload or paste at least 20 characters of document text before running AI.' });
      return false;
    }
    return true;
  }

  async function requestIntelligence(mode) {
    const data = await api('/api/intelligence', {
      method: 'POST',
      body: JSON.stringify({ mode, documentText, documentName, question })
    });

    setOutputs((previous) => ({
      ...previous,
      [mode]: {
        result: data.result,
        source: data.source,
        generatedAt: data.generatedAt,
        documentType: data.documentType
      }
    }));
    setDocumentType(data.documentType || documentType);
    setActiveOutput(mode);
    return data;
  }

  async function runIntelligence(mode = activeMode) {
    if (!validateDocument()) return;
    if (mode === 'ask' && !question.trim()) {
      setMessage({ type: 'error', text: 'Type a question before asking the document.' });
      return;
    }

    setBusy(mode);
    setProgress({ current: 1, total: 1, label: intelligenceModes.find((item) => item.id === mode)?.label || 'Q&A' });
    try {
      const data = await requestIntelligence(mode);
      setMessage({ type: 'success', text: `${data.source} generated ${mode === 'ask' ? 'document Q&A' : `${data.mode} intelligence`}.` });
    } catch (error) {
      setMessage({ type: 'error', text: getFriendlyError(error) });
    } finally {
      setBusy('');
      setProgress(null);
    }
  }

  async function askDocument() {
    await runIntelligence('ask');
  }

  async function runAll() {
    if (!validateDocument()) return;
    setBusy('runAll');
    setProgress({ current: 0, total: modeOrder.length, label: 'Starting full intelligence' });
    try {
      let lastSource = 'AI';
      for (let index = 0; index < modeOrder.length; index += 1) {
        const mode = modeOrder[index];
        const label = intelligenceModes.find((item) => item.id === mode)?.label || mode;
        setProgress({ current: index + 1, total: modeOrder.length, label });
        const data = await requestIntelligence(mode);
        lastSource = data.source;
      }
      setActiveOutput('report');
      setMessage({ type: 'success', text: `${lastSource} completed full document intelligence: summary, tasks, notes, risks, and report.` });
    } catch (error) {
      setMessage({ type: 'error', text: getFriendlyError(error) });
    } finally {
      setBusy('');
      setProgress(null);
    }
  }

  async function saveWorkspace() {
    if (!browserSupabase) {
      setMessage({ type: 'error', text: 'Browser Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart.' });
      return;
    }
    if (!session?.user?.id) {
      setMessage({ type: 'error', text: 'Sign in or create an account before saving a workspace.' });
      return;
    }
    if (!hasDocument) {
      setMessage({ type: 'error', text: 'Upload or paste a document before saving.' });
      return;
    }
    if (!hasOutput) {
      setMessage({ type: 'error', text: 'Generate at least one AI output before saving.' });
      return;
    }

    setBusy('save');
    try {
      const row = {
        user_id: session.user.id,
        title: `${documentName || 'Document'} - DocuMind Workspace`,
        document_name: documentName || 'Untitled document',
        document_type: documentType,
        document_text: documentText,
        summary: outputs.summary?.result || '',
        insights: outputs,
        tasks: outputs.tasks ? [outputs.tasks.result] : [],
        notes: outputs.notes?.result || '',
        risk_analysis: outputs.risks?.result || '',
        report: outputs.report?.result || '',
        updated_at: new Date().toISOString()
      };

      const { data, error } = await browserSupabase
        .from(BROWSER_WORKSPACES_TABLE)
        .insert(row)
        .select('*')
        .single();

      if (error) throw error;
      setWorkspaces((previous) => [data, ...previous.filter((item) => item.id !== data.id)]);
      setMessage({ type: 'success', text: 'Workspace saved to Supabase.' });
    } catch (error) {
      setMessage({ type: 'error', text: getFriendlyError(error) });
    } finally {
      setBusy('');
    }
  }

  async function loadWorkspaces(nextSession = session, options = {}) {
    const nextUser = nextSession?.user || session?.user;
    if (!browserSupabase) {
      if (!options.silent) setMessage({ type: 'error', text: 'Browser Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart.' });
      return;
    }
    if (!nextUser?.id) {
      if (!options.silent) setMessage({ type: 'error', text: 'Sign in to load saved workspaces.' });
      return;
    }

    setBusy('load');
    try {
      const { data, error } = await browserSupabase
        .from(BROWSER_WORKSPACES_TABLE)
        .select('*')
        .eq('user_id', nextUser.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setWorkspaces(data || []);
      if (!options.silent) setMessage({ type: 'success', text: `Loaded ${data?.length || 0} workspace(s).` });
    } catch (error) {
      if (!options.silent) setMessage({ type: 'error', text: getFriendlyError(error) });
    } finally {
      setBusy('');
    }
  }

  function openWorkspace(workspace) {
    const insights = workspace.insights && typeof workspace.insights === 'object' ? workspace.insights : {};
    setDocumentName(workspace.document_name || workspace.title);
    setDocumentText(workspace.document_text || '');
    setDocumentType(workspace.document_type || 'Saved document');
    setOutputs(insights);
    setActiveOutput(insights.report ? 'report' : Object.keys(insights)[0] || 'summary');
    setMessage({ type: 'info', text: `Loaded workspace: ${workspace.title}` });
    document.getElementById('ask')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function deleteWorkspace(id) {
    if (!browserSupabase || !session?.user?.id) {
      setMessage({ type: 'error', text: 'Sign in to delete saved workspaces.' });
      return;
    }
    const ok = window.confirm('Delete this saved workspace? This cannot be undone.');
    if (!ok) return;
    setBusy(`delete-${id}`);
    try {
      const { error } = await browserSupabase
        .from(BROWSER_WORKSPACES_TABLE)
        .delete()
        .eq('id', id)
        .eq('user_id', session.user.id);

      if (error) throw error;
      setWorkspaces((previous) => previous.filter((item) => item.id !== id));
      setMessage({ type: 'success', text: 'Workspace deleted.' });
    } catch (error) {
      setMessage({ type: 'error', text: getFriendlyError(error) });
    } finally {
      setBusy('');
    }
  }

  function exportPdf() {
    if (!hasOutput) {
      setMessage({ type: 'error', text: 'Generate an output before exporting a PDF report.' });
      return;
    }
    window.print();
  }

  const currentOutput = outputs[activeOutput]?.result;
  const outputTitle = activeOutput === 'ask' ? 'Document Q&A' : intelligenceModes.find((mode) => mode.id === activeOutput)?.label || 'AI Output';
  const activeModeLabel = intelligenceModes.find((mode) => mode.id === activeMode)?.label || 'AI Output';

  return (
    <div className="app-shell">
      <header className="topbar no-print">
        <div className="brand">
          <div className="logo">DM</div>
          <div>
            <strong>DocuMind AI</strong>
            <span>AI Document Intelligence Workspace</span>
          </div>
        </div>
        <nav>
          <a href="#upload">Upload</a>
          <a href="#ask">Ask AI</a>
          <a href="#workspaces">Workspaces</a>
          <a href="#status">Status</a>
        </nav>
        <button className="ghost" onClick={installApp}>Install App</button>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Professional AI document workspace</span>
            <h1>Turn documents into summaries, answers, tasks, risks, notes, and export-ready reports.</h1>
            <p>Upload PDF, DOCX, or TXT files. DocuMind extracts document text, analyzes it with AI, saves your workspaces, and helps you act on important information faster.</p>
            <div className="hero-actions no-print">
              <a className="primary" href="#upload">Start analysis</a>
              <button className={cx('secondary', busy === 'runAll' && 'busy-button')} onClick={runAll} disabled={isBusy || !hasDocument}>
                {busy === 'runAll' ? 'Running full intelligence...' : 'Run full intelligence'}
              </button>
              <button className="ghost" onClick={clearWorkspace} disabled={isBusy && busy !== 'extract'}>Clear workspace</button>
            </div>
          </div>
          <div className="hero-panel">
            <div className="panel-title">
              <span>Live document twin</span>
              <strong>{documentType}</strong>
            </div>
            <div className="score-ring">
              <span>{analysisDepth}</span>
              <small>analysis depth</small>
            </div>
            <div className="metric-grid">
              <div><strong>{stats.words}</strong><span>words</span></div>
              <div><strong>{outputCount}</strong><span>AI outputs</span></div>
              <div><strong>{health?.aiConfigured ? 'Groq' : 'Local'}</strong><span>engine</span></div>
              <div><strong>{browserDatabaseReady || health?.databaseEnabled ? 'Ready' : 'Off'}</strong><span>database</span></div>
            </div>
          </div>
        </section>

        <div className={cx('message no-print', message.type)} role="status">{message.text}</div>
        {progress && (
          <div className="progress-card no-print">
            <div>
              <strong>{progress.label}</strong>
              <span>{progress.current} of {progress.total}</span>
            </div>
            <div className="progress-track"><span style={{ width: `${Math.max(8, (progress.current / progress.total) * 100)}%` }} /></div>
          </div>
        )}

        <section className="grid two-col">
          <div className="card" id="upload">
            <div className="section-heading">
              <span>Document intake</span>
              <h2>Upload and extract</h2>
              <p>Upload PDF, DOCX, or TXT. You can also paste text manually and edit the extracted content.</p>
            </div>

            <div className="upload-box no-print">
              <input id="document-upload" type="file" accept=".pdf,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={uploadDocument} disabled={isBusy} />
              <label htmlFor="document-upload" className={busy === 'extract' ? 'busy-button' : ''}>{busy === 'extract' ? 'Extracting...' : 'Choose document'}</label>
              <button className="ghost" onClick={loadSample} disabled={isBusy}>Load sample</button>
              <button className="ghost" onClick={clearWorkspace} disabled={isBusy}>Clear</button>
            </div>
            <p className="helper-text no-print">Tip: start with a small PDF/DOCX/TXT. Scanned image PDFs may not extract text.</p>

            <div className="form-row">
              <label>Document name</label>
              <input value={documentName} onChange={(event) => setDocumentName(event.target.value)} placeholder="e.g. project-report.pdf" />
            </div>
            <div className="form-row">
              <label>Extracted or pasted text</label>
              <textarea rows="14" value={documentText} onChange={(event) => handleDocumentTextChange(event.target.value)} placeholder="Upload a document or paste text here..." />
            </div>
          </div>

          <div className="card" id="ask">
            <div className="section-heading">
              <span>AI command center</span>
              <h2>Generate intelligence</h2>
              <p>Choose a mode, run AI, ask questions, and save the best output as a workspace.</p>
            </div>

            <div className="mode-grid no-print">
              {intelligenceModes.map((mode) => (
                <button key={mode.id} className={cx('mode-card', activeMode === mode.id && 'active', outputs[mode.id]?.result && 'ready')} onClick={() => setActiveMode(mode.id)} disabled={isBusy}>
                  <strong>{mode.label}</strong>
                  <span>{mode.description}</span>
                </button>
              ))}
            </div>

            <div className="action-row no-print">
              <button className={cx('primary', busy === activeMode && 'busy-button')} disabled={isBusy || !hasDocument} onClick={() => runIntelligence(activeMode)}>
                {busy === activeMode ? 'Generating...' : `Generate ${activeModeLabel}`}
              </button>
              <button className={cx('secondary', busy === 'runAll' && 'busy-button')} disabled={isBusy || !hasDocument} onClick={runAll}>
                {busy === 'runAll' ? 'Running all...' : 'Run all'}
              </button>
            </div>

            <div className="question-box no-print">
              <label>Ask a question from this document</label>
              <textarea rows="4" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Example: What are the key risks, deadlines, and next actions?" />
              <button className={busy === 'ask' ? 'busy-button' : ''} disabled={isBusy || !hasDocument || !question.trim()} onClick={askDocument}>{busy === 'ask' ? 'Answering...' : 'Ask document'}</button>
            </div>

            <div className="output-tabs no-print">
              {[...modeOrder, 'ask'].map((key) => (
                <button key={key} className={cx(activeOutput === key && 'active', outputs[key]?.result && 'tab-ready')} onClick={() => setActiveOutput(key)}>
                  {key === 'ask' ? 'Q&A' : intelligenceModes.find((mode) => mode.id === key)?.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="card report-card printable-report">
          <div className="report-header">
            <div>
              <span className="eyebrow">DocuMind output</span>
              <h2>{outputTitle}</h2>
              <p>{documentName || 'Untitled document'} · {documentType} · {stats.words} words</p>
            </div>
            <div className="report-actions no-print">
              <button className="ghost" onClick={saveWorkspace} disabled={busy === 'save' || !hasOutput}>{busy === 'save' ? 'Saving...' : 'Save workspace'}</button>
              <button className="primary" onClick={exportPdf} disabled={!hasOutput}>Export PDF</button>
            </div>
          </div>
          <article className="output-content">
            {hasOutput ? renderText(currentOutput || outputs.summary?.result) : (
              <div className="empty-report">
                <strong>Ready for document intelligence</strong>
                <p>Upload or paste a document, choose an AI mode, then generate a professional output. Saving and exporting unlock after at least one output is created.</p>
              </div>
            )}
          </article>
        </section>

        <section className="grid two-col" id="workspaces">
          <div className="card">
            <div className="section-heading">
              <span>Secure workspace</span>
              <h2>Sign in and save</h2>
              <p>Supabase authentication enables saved document workspaces and persistent intelligence history.</p>
            </div>
            <AuthPanel browserSupabase={browserSupabase} session={session} setSession={setSession} setMessage={setMessage} onSignedIn={loadWorkspaces} />
          </div>

          <div className="card">
            <div className="section-heading row-heading">
              <div>
                <span>Saved intelligence</span>
                <h2>Document archive</h2>
                <p>Load, review, or delete previous document workspaces.</p>
              </div>
              <button className="ghost no-print" onClick={() => loadWorkspaces()} disabled={busy === 'load' || !session?.user}>{busy === 'load' ? 'Refreshing...' : 'Refresh'}</button>
            </div>
            <div className="workspace-list">
              {!workspaces.length && <p className="muted">No saved workspaces loaded yet. Sign in, save a generated report, then refresh.</p>}
              {workspaces.map((workspace) => (
                <div className="workspace-item" key={workspace.id}>
                  <div>
                    <strong>{workspace.title}</strong>
                    <span>{workspace.document_type || 'Document'} · {new Date(workspace.updated_at || workspace.created_at).toLocaleString()}</span>
                  </div>
                  <div className="workspace-actions no-print">
                    <button className="ghost small" onClick={() => openWorkspace(workspace)}>Open</button>
                    <button className="danger small" onClick={() => deleteWorkspace(workspace.id)} disabled={busy === `delete-${workspace.id}`}>{busy === `delete-${workspace.id}` ? 'Deleting...' : 'Delete'}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card status-card" id="status">
          <div className="section-heading">
            <span>Platform status</span>
            <h2>Live services</h2>
            <p>Use this panel to confirm Groq AI, Supabase, and document extraction are configured.</p>
          </div>
          <div className="status-grid">
            <div><strong>AI Engine</strong><span>{health?.aiConfigured ? `${health.aiProvider} connected` : 'Local fallback active'}</span></div>
            <div><strong>Database</strong><span>{browserDatabaseReady ? `Browser Supabase ready · ${BROWSER_WORKSPACES_TABLE}` : 'Add VITE Supabase env values'}</span></div>
            <div><strong>Authentication</strong><span>{browserDatabaseReady ? 'Browser Supabase Auth ready' : 'Auth not configured'}</span></div>
            <div><strong>Export</strong><span>Print/PDF enabled</span></div>
            <div><strong>App mode</strong><span>PWA installable</span></div>
            <div><strong>Upload support</strong><span>PDF · DOCX · TXT</span></div>
          </div>
        </section>
      </main>

      <footer className="footer no-print">
        <strong>DocuMind AI</strong>
        <span>AI document intelligence workspace for summaries, questions, tasks, risks, notes, reports, and saved knowledge.</span>
      </footer>
    </div>
  );
}
