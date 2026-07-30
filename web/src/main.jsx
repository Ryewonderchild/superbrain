import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  BookOpen,
  Braces,
  Check,
  CircleDot,
  Database,
  FileText,
  Files,
  Globe2,
  Home,
  GitBranch,
  KeyRound,
  Layers3,
  Link2,
  Lock,
  LogOut,
  MessageSquare,
  Network,
  Paperclip,
  Pencil,
  Plus,
  Quote,
  Search,
  Settings,
  Scale,
  Server,
  Save,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserPlus,
  Users,
  X
} from "lucide-react";
import "./styles.css";

const GraphCanvas = React.lazy(() => import("./GraphCanvas3D.jsx"));
const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const sessionKey = "superbrain_session";
const kinds = ["Concept", "Person", "Organization", "Project", "Document", "Technology", "Infrastructure", "Model", "Method", "Process", "Event", "Institution", "Roadmap"];
const kindLabels = {
  Concept: "概念",
  Person: "人物",
  Organization: "组织",
  Project: "项目",
  Document: "文档",
  Technology: "技术",
  Infrastructure: "基础设施",
  Model: "模型",
  Method: "方法",
  Process: "过程",
  Event: "事件",
  Institution: "制度",
  Roadmap: "路线图",
  System: "系统",
  Component: "组件",
  KnowledgeSpace: "知识空间"
};
const relationLabels = {
  RELATED_TO: "相关",
  DEPENDS_ON: "依赖",
  MENTIONS: "提及",
  CAUSES: "导致",
  IMPLEMENTS: "实现",
  HOSTS: "承载",
  STORES: "存储",
  ENRICHES: "补充",
  SUGGESTS: "提示",
  CALCULATED_BY: "由该方法计算",
  CALCULATES: "计算",
  COMPOSED_OF: "由其组成",
  ENABLES: "促成",
  MITIGATES: "缓解",
  ADVOCATES: "主张"
};

function kindLabel(kind) {
  return kindLabels[kind] || kind || "实体";
}

function relationLabel(type) {
  return relationLabels[type] || type;
}
const relationTypes = ["RELATED_TO", "DEPENDS_ON", "MENTIONS", "CAUSES", "IMPLEMENTS", "HOSTS", "STORES", "ENRICHES", "SUGGESTS"];
const providerPresets = [
  {
    id: "openai-sol",
    label: "GPT-5.6 Sol",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com",
    model: "gpt-5.6-sol",
    contextWindow: 1050000,
    promptBudgetTokens: 128000,
    maxOutputTokens: 16384,
    safetyTokens: 8192,
    autoConfigure: true,
    apiMode: "responses",
    chatThinking: true,
    reasoningEffort: "medium",
    reasoningMode: "standard",
    textVerbosity: "medium"
  },
  { id: "openai", label: "OpenAI", protocol: "openai-compatible", baseUrl: "https://api.openai.com", model: "gpt-5" },
  {
    id: "deepseek",
    label: "DeepSeek V4 Pro",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    contextWindow: 1000000,
    promptBudgetTokens: 32000,
    maxOutputTokens: 4096,
    chatThinking: true,
    reasoningEffort: "high"
  },
  { id: "kimi", label: "Kimi", protocol: "openai-compatible", baseUrl: "https://api.moonshot.cn", model: "kimi-k2.5" },
  { id: "openrouter", label: "OpenRouter", protocol: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-5" },
  { id: "anthropic", label: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
  { id: "google", label: "Google Gemini", protocol: "google", baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.5-pro" },
  { id: "custom", label: "自定义兼容端点", protocol: "openai-compatible", baseUrl: "", model: "" }
].map((preset) => ({
  contextWindow: 32000,
  promptBudgetTokens: 24000,
  maxOutputTokens: 3000,
  safetyTokens: 3000,
  autoConfigure: true,
  apiMode: "chat",
  chatThinking: false,
  reasoningEffort: "medium",
  reasoningMode: "standard",
  textVerbosity: "medium",
  ...preset,
  embeddingModel: "",
  rerankModel: ""
}));

async function request(path, options = {}, token = "") {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...(!isFormData ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `请求失败 (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function normalizeTags(value) {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey) || "null");
  } catch {
    return null;
  }
}

function HomePage({ onEnter }) {
  return (
    <main className="home-shell">
      <nav className="home-nav">
        <div className="home-wordmark"><Network size={22} /><strong>超级大脑</strong></div>
        <button className="home-login" type="button" onClick={onEnter}>登录</button>
      </nav>
      <section className="home-hero">
        <div className="home-copy">
          <span className="home-index">KNOWLEDGE, WITH PROVENANCE</span>
          <h1>让知识形成<br />可验证的结构</h1>
          <p>从原始资料提取事实，连接三维图谱，并将共识沉淀为公理。</p>
          <button className="home-cta" type="button" onClick={onEnter}>
            进入知识空间 <ArrowRight size={18} />
          </button>
        </div>
        <div className="home-visual" aria-hidden="true">
          <div className="orbit orbit-one"><i /><i /><i /></div>
          <div className="orbit orbit-two"><i /><i /></div>
          <div className="home-core"><Network size={42} /></div>
          <span className="visual-label label-fact">FACT / 0218</span>
          <span className="visual-label label-axiom">AXIOM / 0042</span>
          <span className="visual-label label-source">SOURCE / RAW</span>
        </div>
      </section>
      <section className="home-principles">
        <article><strong>01</strong><h2>事实</h2><p>每条陈述保留原文、位置、模型与置信度。</p></article>
        <article><strong>02</strong><h2>图</h2><p>实体、事实与关系在同一个三维空间中展开。</p></article>
        <article><strong>03</strong><h2>公理</h2><p>事实经过公开观察、认可与反驳后形成共识。</p></article>
      </section>
    </main>
  );
}

function LoginScreen({ onLogin, onBack }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "admin@ryewonderchild.com", password: "", displayName: "", avatarUrl: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("verify");
    if (!token) return;
    setBusy(true);
    request("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token })
    }).then((session) => {
      localStorage.setItem(sessionKey, JSON.stringify(session));
      window.history.replaceState({}, "", window.location.pathname);
      onLogin(session);
    }).catch((err) => {
      setError(err.message);
      setMode("login");
    }).finally(() => setBusy(false));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const session = await request(path, { method: "POST", body: JSON.stringify(form) });
      if (session.verificationRequired) {
        setPendingEmail(session.email);
        setNotice(session.message);
        setMode("login");
        setForm((current) => ({ ...current, password: "" }));
      } else {
        localStorage.setItem(sessionKey, JSON.stringify(session));
        onLogin(session);
      }
    } catch (err) {
      setError(err.message);
      if (err.payload?.code === "email_not_verified") {
        setPendingEmail(err.payload.email || form.email);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    try {
      const payload = await request("/api/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email: pendingEmail || form.email })
      });
      setNotice(payload.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <button className="auth-back" type="button" onClick={onBack}><ArrowRight size={15} /> 返回首页</button>
        <div className="brand login-brand">
          <div className="brand-mark"><Network size={22} /></div>
          <div>
            <h1>超级大脑</h1>
            <span>{mode === "login" ? "登录后进入你的私有知识图谱" : "注册一个新的私有图谱空间"}</span>
          </div>
        </div>
        <div className="auth-tabs">
          <button className={mode === "login" ? "auth-tab active" : "auth-tab"} type="button" onClick={() => setMode("login")}>登录</button>
          <button className={mode === "register" ? "auth-tab active" : "auth-tab"} type="button" onClick={() => setMode("register")}>注册</button>
        </div>
        {notice && <div className="status-good">{notice}</div>}
        <label>
          邮箱
          <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" required />
        </label>
        {mode === "register" && (
          <>
            <label>
              昵称
              <input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="显示在工作台顶部" />
            </label>
            <label>
              头像 URL
              <input value={form.avatarUrl} onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })} placeholder="https://..." />
            </label>
          </>
        )}
        <label>
          密码
          <input
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>
          <Lock size={16} />
          {busy ? "处理中" : mode === "login" ? "登录" : "注册并发送验证邮件"}
        </button>
        {pendingEmail && <button className="secondary" type="button" onClick={resend} disabled={busy}>重新发送验证邮件</button>}
        {mode === "register" && <div className="microcopy">密码至少 10 位。完成邮箱验证后才能登录。</div>}
      </form>
    </main>
  );
}

function Avatar({ user, size = 40 }) {
  const label = (user.displayName || user.email || "?").slice(0, 1).toUpperCase();
  if (user.avatarUrl) {
    return <img className="avatar" style={{ width: size, height: size }} src={user.avatarUrl} alt={`${user.displayName || user.email} 的头像`} />;
  }
  return <div className="avatar fallback" style={{ width: size, height: size }}>{label}</div>;
}

function useGraphData(query, token, options) {
  const [state, setState] = useState({ loading: true, error: "", nodes: [], links: [] });
  const refresh = async () => {
    if (!token) return;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const params = new URLSearchParams({
        q: query,
        scope: options.scope,
        centerId: options.centerId || "",
        depth: String(options.depth),
        kind: options.kind
      });
      const graph = await request(`/api/graph?${params.toString()}`, {}, token);
      setState({ loading: false, error: "", nodes: graph.nodes, links: graph.links });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
    }
  };

  useEffect(() => {
    const timer = setTimeout(refresh, 180);
    return () => clearTimeout(timer);
  }, [query, token, options.scope, options.centerId, options.depth, options.kind]);

  return { ...state, refresh };
}

function usePublicGraph(token) {
  const [state, setState] = useState({ loading: false, error: "", nodes: [], links: [] });
  const refresh = async () => {
    if (!token) return;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const graph = await request("/api/public/graph", {}, token);
      setState({ loading: false, error: "", nodes: graph.nodes, links: graph.links });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
    }
  };
  useEffect(() => {
    refresh();
  }, [token]);
  return { ...state, refresh };
}

function useReferences(selectedId, token) {
  const [state, setState] = useState({ loading: false, mentions: [] });
  useEffect(() => {
    if (!selectedId || !token) {
      setState({ loading: false, mentions: [] });
      return undefined;
    }
    let active = true;
    setState((current) => ({ ...current, loading: true }));
    request(`/api/items/${selectedId}/references`, {}, token)
      .then((payload) => {
        if (active) setState({ loading: false, mentions: payload.mentions });
      })
      .catch(() => {
        if (active) setState({ loading: false, mentions: [] });
      });
    return () => {
      active = false;
    };
  }, [selectedId, token]);
  return state;
}

function useEvidence(selectedId, token) {
  const [state, setState] = useState({ loading: false, evidence: [] });
  const refresh = async () => {
    if (!selectedId || !token) {
      setState({ loading: false, evidence: [] });
      return;
    }
    setState((current) => ({ ...current, loading: true }));
    try {
      const payload = await request(`/api/items/${selectedId}/evidence`, {}, token);
      setState({ loading: false, evidence: payload.evidence });
    } catch {
      setState({ loading: false, evidence: [] });
    }
  };
  useEffect(() => {
    refresh();
  }, [selectedId, token]);
  return { ...state, refresh };
}

function useDocuments(token) {
  const [state, setState] = useState({ loading: false, documents: [], error: "" });
  const refresh = async () => {
    if (!token) return;
    setState((current) => ({ ...current, loading: true }));
    try {
      const payload = await request("/api/documents", {}, token);
      setState({ loading: false, documents: payload.documents, error: "" });
    } catch (error) {
      setState({ loading: false, documents: [], error: error.message });
    }
  };
  useEffect(() => {
    refresh();
  }, [token]);
  return { ...state, refresh };
}

function useModelProfiles(token) {
  const [profiles, setProfiles] = useState([]);
  const [error, setError] = useState("");
  const refresh = async () => {
    if (!token) return;
    try {
      const payload = await request("/api/model-profiles", {}, token);
      setProfiles(payload.profiles);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => {
    refresh();
  }, [token]);
  return { profiles, error, refresh };
}

function ModelProfilePanel({ session, profiles, onChanged }) {
  const initialPreset = providerPresets[0];
  const [form, setForm] = useState({ ...initialPreset, preset: initialPreset.id, apiKey: "", isDefault: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [discovered, setDiscovered] = useState({});
  const [embeddingJobs, setEmbeddingJobs] = useState([]);

  function choosePreset(id) {
    const preset = providerPresets.find((item) => item.id === id);
    setForm((current) => ({ ...current, ...preset, preset: id, apiKey: current.apiKey }));
  }

  async function refreshEmbeddingJobs() {
    const payload = await request("/api/embedding-jobs", {}, session.token);
    setEmbeddingJobs(payload.jobs);
  }

  useEffect(() => {
    refreshEmbeddingJobs().catch(() => {});
    const active = embeddingJobs.some((job) => job.status === "queued" || job.status === "processing");
    if (!active) return undefined;
    const timer = setInterval(() => refreshEmbeddingJobs().catch(() => {}), 1800);
    return () => clearInterval(timer);
  }, [session.token, embeddingJobs.some((job) => job.status === "queued" || job.status === "processing")]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await request("/api/model-profiles", { method: "POST", body: JSON.stringify(form) }, session.token);
      setForm((current) => ({ ...current, apiKey: "", isDefault: false }));
      setMessage("模型配置已加密保存");
      await onChanged();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(id) {
    await request(`/api/model-profiles/${id}/default`, { method: "POST" }, session.token);
    await onChanged();
  }

  async function remove(id) {
    await request(`/api/model-profiles/${id}`, { method: "DELETE" }, session.token);
    await onChanged();
  }

  async function discover(profile) {
    setMessage("正在读取模型列表");
    try {
      const payload = await request(`/api/model-profiles/${profile.id}/models`, {}, session.token);
      setDiscovered((current) => ({ ...current, [profile.id]: payload.models }));
      setMessage(`发现 ${payload.models.length} 个模型`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function changeModel(profile, model) {
    await request(`/api/model-profiles/${profile.id}`, {
      method: "PATCH",
      body: JSON.stringify({ model })
    }, session.token);
    await onChanged();
  }

  async function changeEmbeddingModel(profile, embeddingModel) {
    await request(`/api/model-profiles/${profile.id}`, {
      method: "PATCH",
      body: JSON.stringify({ embeddingModel })
    }, session.token);
    await onChanged();
  }

  async function changeRerankModel(profile, rerankModel) {
    await request(`/api/model-profiles/${profile.id}`, {
      method: "PATCH",
      body: JSON.stringify({ rerankModel })
    }, session.token);
    await onChanged();
  }

  async function changeBudget(profile, input) {
    await request(`/api/model-profiles/${profile.id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }, session.token);
    await onChanged();
  }

  async function rebuildEmbeddings(profileId) {
    setMessage("向量重建任务正在排队");
    try {
      await request("/api/embedding-jobs", {
        method: "POST",
        body: JSON.stringify({ profileId })
      }, session.token);
      await refreshEmbeddingJobs();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function retryEmbeddingJob(jobId) {
    await request(`/api/embedding-jobs/${jobId}/retry`, { method: "POST" }, session.token);
    await refreshEmbeddingJobs();
  }

  return (
    <section className="panel stack">
      <div className="panel-heading">
        <KeyRound size={18} />
        <span>模型配置</span>
      </div>
      <div className={profiles.length ? "status-good" : "status-warn"}>
        {profiles.length ? `${profiles.length} 个可用 Provider` : "尚未配置抽取模型"}
      </div>
      <div className="profile-list">
        {profiles.map((profile) => (
          <div className="model-profile" key={profile.id}>
            {(() => {
              const job = embeddingJobs.find((candidate) => candidate.profileId === profile.id);
              return (
                <>
            <div className="model-profile-head">
              <div>
                <strong>{profile.label}</strong>
                <span>{profile.model}</span>
                {profile.embeddingModel && <span>Embedding · {profile.embeddingModel}</span>}
                {profile.rerankModel && <span>Rerank · {profile.rerankModel}</span>}
                {profile.model === "deepseek-v4-pro" && (
                  <span>DSV4 Pro · Prompt {profile.promptBudgetTokens.toLocaleString()} · {profile.chatThinking ? "思考开启" : "思考关闭"}</span>
                )}
                {["gpt-5.6", "gpt-5.6-sol"].includes(profile.model) && (
                  <span>GPT-5.6 Sol · 1.05M 上下文 · Prompt {profile.promptBudgetTokens.toLocaleString()} · Responses API</span>
                )}
              </div>
              {profile.isDefault && <Check size={16} aria-label="默认配置" />}
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={profile.autoConfigure}
                onChange={(event) => changeBudget(profile, { autoConfigure: event.target.checked })}
              />
              根据模型能力自动适配参数
            </label>
            {discovered[profile.id] && (
              <select value={profile.model} onChange={(event) => changeModel(profile, event.target.value)}>
                {!discovered[profile.id].includes(profile.model) && <option>{profile.model}</option>}
                {discovered[profile.id].map((model) => <option key={model}>{model}</option>)}
              </select>
            )}
            <label className="compact-profile-field">
              Embedding 模型
              <input
                defaultValue={profile.embeddingModel}
                onBlur={(event) => {
                  if (event.target.value !== profile.embeddingModel) changeEmbeddingModel(profile, event.target.value.trim());
                }}
                placeholder="可选，例如 text-embedding-3-small"
              />
            </label>
            <label className="compact-profile-field">
              Rerank 模型
              <input
                defaultValue={profile.rerankModel}
                onBlur={(event) => {
                  if (event.target.value !== profile.rerankModel) changeRerankModel(profile, event.target.value.trim());
                }}
                placeholder="可选，使用独立模型重排候选"
              />
            </label>
            <div className="profile-budget-grid">
              <label className="compact-profile-field">
                上下文窗口
                <input
                  type="number"
                  min="4096"
                  defaultValue={profile.contextWindow}
                  disabled={profile.autoConfigure}
                  onBlur={(event) => {
                    const contextWindow = Number(event.target.value);
                    if (contextWindow !== profile.contextWindow) changeBudget(profile, { contextWindow });
                  }}
                />
              </label>
              <label className="compact-profile-field">
                Prompt 硬预算
                <input
                  type="number"
                  min="4096"
                  defaultValue={profile.promptBudgetTokens}
                  disabled={profile.autoConfigure}
                  onBlur={(event) => {
                    const promptBudgetTokens = Number(event.target.value);
                    if (promptBudgetTokens !== profile.promptBudgetTokens) changeBudget(profile, { promptBudgetTokens });
                  }}
                />
              </label>
              <label className="compact-profile-field">
                最大输出
                <input
                  type="number"
                  min="128"
                  defaultValue={profile.maxOutputTokens}
                  disabled={profile.autoConfigure}
                  onBlur={(event) => {
                    const maxOutputTokens = Number(event.target.value);
                    if (maxOutputTokens !== profile.maxOutputTokens) changeBudget(profile, { maxOutputTokens });
                  }}
                />
              </label>
            </div>
            {["gpt-5.6", "gpt-5.6-sol"].includes(profile.model) && (
              <>
                <div className="profile-budget-grid">
                  <label className="compact-profile-field">
                    推理等级
                    <select value={profile.reasoningEffort} onChange={(event) => changeBudget(profile, { reasoningEffort: event.target.value })}>
                      {["none", "low", "medium", "high", "xhigh", "max"].map((value) => <option key={value}>{value}</option>)}
                    </select>
                  </label>
                  <label className="compact-profile-field">
                    推理模式
                    <select value={profile.reasoningMode} onChange={(event) => changeBudget(profile, { reasoningMode: event.target.value })}>
                      <option value="standard">standard</option>
                      <option value="pro">pro</option>
                    </select>
                  </label>
                  <label className="compact-profile-field">
                    回答详细度
                    <select value={profile.textVerbosity} onChange={(event) => changeBudget(profile, { textVerbosity: event.target.value })}>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </label>
                </div>
                {profile.promptBudgetTokens > 272000 && <div className="status-warn">超过 272K 输入将进入长上下文加价区间。</div>}
              </>
            )}
            {(profile.model === "deepseek-v4-pro" || ["gpt-5.6", "gpt-5.6-sol"].includes(profile.model)) && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={profile.chatThinking}
                  onChange={(event) => changeBudget(profile, { chatThinking: event.target.checked })}
                />
                问答启用推理（抽取使用低推理，重排关闭）
              </label>
            )}
            <div className="model-profile-actions">
              {!profile.isDefault && <button type="button" onClick={() => makeDefault(profile.id)}>设为默认</button>}
              <button type="button" onClick={() => discover(profile)}>发现模型</button>
              {profile.embeddingModel && (
                <button type="button" onClick={() => rebuildEmbeddings(profile.id)} disabled={job?.status === "queued" || job?.status === "processing"}>重建向量</button>
              )}
              <button className="text-danger" type="button" onClick={() => remove(profile.id)}>删除</button>
            </div>
            {job && (
              <div className={`embedding-job ${job.status}`}>
                <span>{job.status === "queued" ? "等待重建" : job.status === "processing" ? "正在重建向量" : job.status === "completed" ? "向量已更新" : "重建失败"}</span>
                <strong>{job.processed}/{job.total}</strong>
                {job.status === "failed" && <button type="button" onClick={() => retryEmbeddingJob(job.id)}>重试</button>}
              </div>
            )}
                </>
              );
            })()}
          </div>
        ))}
      </div>
      <form className="stack provider-form" onSubmit={save}>
        <label>
          Provider
          <select value={form.preset} onChange={(event) => choosePreset(event.target.value)}>
            {providerPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select>
        </label>
        <label>
          显示名称
          <input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} required />
        </label>
        <label>
          协议
          <select value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value })}>
            <option value="openai-compatible">OpenAI compatible</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google Gemini</option>
          </select>
        </label>
        <label>
          Base URL
          <input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} type="url" placeholder="https://api.example.com" required />
        </label>
        <label>
          模型 ID
          <input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="模型的精确 ID" required />
        </label>
        <label>
          Embedding 模型 ID（可选）
          <input value={form.embeddingModel} onChange={(event) => setForm({ ...form, embeddingModel: event.target.value })} placeholder="留空则使用全文 + 图检索" />
        </label>
        <label>
          Rerank 模型 ID（可选）
          <input value={form.rerankModel} onChange={(event) => setForm({ ...form, rerankModel: event.target.value })} placeholder="留空则使用 RRF 与向量相似度排序" />
        </label>
        <label className="check-label">
          <input
            checked={form.autoConfigure}
            onChange={(event) => setForm({ ...form, autoConfigure: event.target.checked })}
            type="checkbox"
          />
          根据模型能力自动适配参数
        </label>
        <div className="profile-budget-grid">
          <label>
            上下文窗口
            <input
              type="number"
              min="4096"
              value={form.contextWindow || 32000}
              disabled={form.autoConfigure}
              onChange={(event) => setForm({ ...form, contextWindow: Number(event.target.value) })}
            />
          </label>
          <label>
            Prompt 硬预算
            <input
              type="number"
              min="4096"
              value={form.promptBudgetTokens || 24000}
              disabled={form.autoConfigure}
              onChange={(event) => setForm({ ...form, promptBudgetTokens: Number(event.target.value) })}
            />
          </label>
          <label>
            最大输出 Token
            <input
              type="number"
              min="128"
              value={form.maxOutputTokens || 3000}
              disabled={form.autoConfigure}
              onChange={(event) => setForm({ ...form, maxOutputTokens: Number(event.target.value) })}
            />
          </label>
        </div>
        {["gpt-5.6", "gpt-5.6-sol"].includes(form.model) && (
          <div className="profile-budget-grid">
            <label>
              推理等级
              <select value={form.reasoningEffort} onChange={(event) => setForm({ ...form, reasoningEffort: event.target.value })}>
                {["none", "low", "medium", "high", "xhigh", "max"].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              推理模式
              <select value={form.reasoningMode} onChange={(event) => setForm({ ...form, reasoningMode: event.target.value })}>
                <option value="standard">standard</option>
                <option value="pro">pro</option>
              </select>
            </label>
            <label>
              回答详细度
              <select value={form.textVerbosity} onChange={(event) => setForm({ ...form, textVerbosity: event.target.value })}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
          </div>
        )}
        {(form.model === "deepseek-v4-pro" || ["gpt-5.6", "gpt-5.6-sol"].includes(form.model)) && (
          <label className="check-label">
            <input
              checked={form.chatThinking}
              onChange={(event) => setForm({ ...form, chatThinking: event.target.checked })}
              type="checkbox"
            />
            问答启用推理
          </label>
        )}
        <label>
          API Key
          <input value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} type="password" placeholder="仅在服务器端解密" autoComplete="off" required />
        </label>
        <label className="check-label">
          <input checked={form.isDefault} onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} type="checkbox" />
          设为默认抽取配置
        </label>
        <button className="secondary" type="submit" disabled={busy || !form.apiKey.trim()}>
          {busy ? "保存中" : "添加配置"}
        </button>
      </form>
      {message && <div className="microcopy">{message}</div>}
    </section>
  );
}

function ProfilePanel({ session, onSessionUpdate }) {
  const [form, setForm] = useState({
    displayName: session.user.displayName || "",
    avatarUrl: session.user.avatarUrl || ""
  });
  const [passwords, setPasswords] = useState({ currentPassword: "", nextPassword: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function saveProfile(event) {
    event.preventDefault();
    setBusy("profile");
    setMessage("");
    try {
      const next = await request("/api/auth/profile", { method: "PATCH", body: JSON.stringify(form) }, session.token);
      localStorage.setItem(sessionKey, JSON.stringify(next));
      onSessionUpdate(next);
      setMessage("资料已更新");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    setBusy("password");
    setMessage("");
    try {
      await request("/api/auth/password", { method: "POST", body: JSON.stringify(passwords) }, session.token);
      setPasswords({ currentPassword: "", nextPassword: "" });
      setMessage("密码已更新");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="account-profile stack">
      <div className="panel-heading">
        <span>个人资料</span>
      </div>
      <form className="stack" onSubmit={saveProfile}>
        <label>
          昵称
          <input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required />
        </label>
        <label>
          头像 URL
          <input value={form.avatarUrl} onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })} placeholder="https://..." />
        </label>
        <button className="secondary" type="submit" disabled={busy === "profile"}>{busy === "profile" ? "保存中" : "保存资料"}</button>
      </form>
      <form className="stack" onSubmit={savePassword}>
        <label>
          当前密码
          <input value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} type="password" required />
        </label>
        <label>
          新密码
          <input value={passwords.nextPassword} onChange={(event) => setPasswords({ ...passwords, nextPassword: event.target.value })} type="password" minLength="10" required />
        </label>
        <button className="secondary" type="submit" disabled={busy === "password"}>{busy === "password" ? "更新中" : "修改密码"}</button>
      </form>
      {message && <div className="microcopy">{message}</div>}
    </section>
  );
}

function AccountMenu({ session, active, onOpen }) {
  return (
    <button
      className={`account-trigger ${active ? "active" : ""}`}
      type="button"
      aria-label="用户中心"
      title="用户中心"
      onClick={onOpen}
    >
      <Avatar user={session.user} size={34} />
    </button>
  );
}

function ExtractPanel({ session, profiles, onCommitted }) {
  const [form, setForm] = useState({ source: "", profileId: "", text: "" });
  const [graph, setGraph] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profiles.length) return;
    const selectedStillExists = profiles.some((profile) => profile.id === form.profileId);
    if (!selectedStillExists) {
      const next = profiles.find((profile) => profile.isDefault) || profiles[0];
      setForm((current) => ({ ...current, profileId: next.id }));
    }
  }, [profiles, form.profileId]);

  async function extract(event) {
    event.preventDefault();
    setBusy("extract");
    setError("");
    try {
      const payload = await request("/api/extract", { method: "POST", body: JSON.stringify(form) }, session.token);
      setGraph(payload.graph);
      setWorkflow(payload.workflow);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function commit() {
    setBusy("commit");
    setError("");
    try {
      await request("/api/extract/commit", {
        method: "POST",
        body: JSON.stringify({
          source: form.source || "extract",
          text: form.text,
          profileId: form.profileId,
          graph
        })
      }, session.token);
      setGraph(null);
      setWorkflow(null);
      setForm((current) => ({ ...current, text: "" }));
      await onCommitted();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel stack">
      <div className="panel-heading">
        <Sparkles size={18} />
        <span>自动抽取</span>
      </div>
      <form className="stack" onSubmit={extract}>
        <label>
          来源
          <input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="文档名、链接、会议名" />
        </label>
        <label>
          抽取模型
          <select value={form.profileId} onChange={(event) => setForm({ ...form, profileId: event.target.value })} disabled={!profiles.length}>
            {!profiles.length && <option value="">请先添加模型配置</option>}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.label} · {profile.model}</option>
            ))}
          </select>
        </label>
        <label>
          文本
          <textarea className="extract-textarea" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} rows="8" placeholder="粘贴文档、会议纪要、网页正文或想法，系统会抽取节点和关系" />
        </label>
        <button className="primary" type="submit" disabled={busy === "extract" || !form.text.trim() || !form.profileId}>
          <FileText size={16} />
          {busy === "extract" ? "抽取中" : "抽取图谱"}
        </button>
      </form>
      {error && <div className="form-error">{error}</div>}
      {graph && (
        <div className="extract-preview">
          <div className="preview-head">
            <strong>{graph.nodes.length} 实体 / {graph.links.length} 关系 / {graph.facts.length} Fact</strong>
            <button
              className="secondary compact"
              type="button"
              onClick={commit}
              disabled={busy === "commit" || workflow?.status !== "ready"}
            >
              {busy === "commit" ? "写入中" : "写入图谱"}
            </button>
          </div>
          {workflow && (
            <div className={`compiler-status ${workflow.status}`}>
              <strong>{workflow.agent}</strong>
              <span>{workflow.status === "ready" ? "规则校验通过" : `${workflow.stats.errors} 项需要审核`}</span>
              <div className="compiler-phases">
                {workflow.phases.map((phase) => (
                  <small className={phase.status} key={phase.id}>{phase.label}</small>
                ))}
              </div>
              {!!workflow.issues.length && (
                <div className="compiler-issues">
                  {workflow.issues.slice(0, 8).map((issue) => (
                    <p key={`${issue.code}-${issue.path}`}>
                      <code>{issue.code}</code>
                      {issue.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          {graph.nodes.slice(0, 6).map((node) => (
            <div className="preview-node" key={node.title}>
              <div>
                <strong>{node.title}</strong>
                {node.evidence && <small>“{node.evidence}”</small>}
                {!!node.attributes?.length && <small>{node.attributes.length} 个属性</small>}
              </div>
              <span>{node.kind}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DocumentPanel({ session, documents, loading }) {
  const [selected, setSelected] = useState(null);
  const [busyId, setBusyId] = useState("");

  async function openDocument(document) {
    if (selected?.id === document.id) {
      setSelected(null);
      return;
    }
    setBusyId(document.id);
    try {
      const payload = await request(`/api/documents/${document.id}`, {}, session.token);
      setSelected(payload.document);
    } finally {
      setBusyId("");
    }
  }

  async function downloadAsset(asset) {
    const response = await fetch(`${API_BASE}/api/assets/${asset.id}`, {
      headers: { Authorization: `Bearer ${session.token}` }
    });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = asset.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="panel stack">
      <div className="panel-heading">
        <Files size={18} />
        <span>资料库</span>
        <strong className="panel-count">{documents.length}</strong>
      </div>
      {loading && <div className="microcopy">同步资料中</div>}
      {!loading && documents.length === 0 && <div className="microcopy">完成一次自动抽取后，原文和分块会保存在这里。</div>}
      <div className="document-list">
        {documents.slice(0, 12).map((document) => (
          <button className={selected?.id === document.id ? "document-item active" : "document-item"} type="button" key={document.id} onClick={() => openDocument(document)}>
            <span>
              <strong>{document.title}</strong>
              <small>{document.chunkCount} 个分块 · {document.model || "未知模型"}</small>
            </span>
            <FileText size={15} />
          </button>
        ))}
      </div>
      {busyId && <div className="microcopy">读取原文中</div>}
      {selected && (
        <article className="document-preview">
          <strong>{selected.title}</strong>
          <span>{selected.chunks.length} 个文本分块</span>
          {!!selected.assets?.length && (
            <div className="source-assets">
              {selected.assets.map((asset) => (
                <button type="button" key={asset.id} onClick={() => downloadAsset(asset)}>
                  <Paperclip size={13} /> {asset.name}
                </button>
              ))}
            </div>
          )}
          <p>{selected.content}</p>
        </article>
      )}
    </section>
  );
}

function RagQueryPanel({ session, profiles, onFocusNode }) {
  const [question, setQuestion] = useState("");
  const [profileId, setProfileId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profiles.length) return;
    if (!profiles.some((profile) => profile.id === profileId)) {
      setProfileId((profiles.find((profile) => profile.isDefault) || profiles[0]).id);
    }
  }, [profiles, profileId]);

  async function ask(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = await request("/api/rag/ask", {
        method: "POST",
        body: JSON.stringify({ question, profileId })
      }, session.token);
      setResult(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rag-query">
      <form onSubmit={ask}>
        <div className="rag-query-title">
          <BookOpen size={18} />
          <strong>知识问答</strong>
        </div>
        <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="询问你的资料和图谱" />
        <select value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={!profiles.length}>
          {!profiles.length && <option value="">先添加模型配置</option>}
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.model}</option>)}
        </select>
        <button className="primary" type="submit" disabled={busy || !question.trim() || !profileId}>
          {busy ? "检索并生成中" : "提问"}
        </button>
      </form>
      {error && <div className="form-error">{error}</div>}
      {result && (
        <div className="rag-answer">
          <div className="rag-answer-text">{result.answer}</div>
          <div className="rag-results">
            {result.sources.map((source) => (
              <div className="rag-source" key={source.chunkId}>
                <strong>[{source.ref}] {source.documentTitle}</strong>
                <span>分块 {source.chunkIndex + 1}</span>
              </div>
            ))}
          </div>
          {result.nodes.length > 0 && (
            <div className="rag-node-list">
              {result.nodes.slice(0, 12).map((node) => (
                <button type="button" key={node.id} onClick={() => onFocusNode(node.id)}>{node.title}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ItemForm({ items, onCreated, token }) {
  const [form, setForm] = useState({ title: "", kind: "Concept", summary: "", content: "", tags: "", source: "" });
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await request("/api/items", { method: "POST", body: JSON.stringify({ ...form, tags: normalizeTags(form.tags) }) }, token);
      setForm({ title: "", kind: "Concept", summary: "", content: "", tags: "", source: "" });
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <div className="panel-heading">
        <Plus size={18} />
        <span>手动补充</span>
      </div>
      <label>
        标题
        <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：订单归因模型" required />
      </label>
      <label>
        类型
        <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
          {kinds.map((kind) => <option key={kind}>{kind}</option>)}
        </select>
      </label>
      <label>
        摘要
        <textarea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} rows="3" placeholder="这个节点代表什么，为什么重要" />
      </label>
      <label>
        正文
        <textarea value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} rows="6" placeholder="补充笔记、论证、引用和上下文" />
      </label>
      <label>
        标签
        <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="用英文逗号分隔" />
      </label>
      <label>
        来源
        <input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="文档、链接、会议或人工录入" />
      </label>
      <button className="secondary" type="submit" disabled={busy || !form.title.trim()}>
        {busy ? "保存中" : "保存节点"}
      </button>
      <div className="microcopy">{items.length} 个节点可用于建立关系</div>
    </form>
  );
}

function LinkForm({ items, selectedId, onCreated, token }) {
  const [form, setForm] = useState({ sourceId: "", targetId: "", type: "RELATED_TO", note: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selectedId) setForm((current) => ({ ...current, sourceId: current.sourceId || selectedId }));
  }, [selectedId]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await request("/api/links", { method: "POST", body: JSON.stringify(form) }, token);
      setForm((current) => ({ ...current, targetId: "", note: "" }));
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <div className="panel-heading">
        <GitBranch size={18} />
        <span>建立关联</span>
      </div>
      <label>
        起点
        <select value={form.sourceId} onChange={(event) => setForm({ ...form, sourceId: event.target.value })} required>
          <option value="">选择节点</option>
          {items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      <label>
        终点
        <select value={form.targetId} onChange={(event) => setForm({ ...form, targetId: event.target.value })} required>
          <option value="">选择节点</option>
          {items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      <label>
        关系
        <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
          {relationTypes.map((type) => <option key={type}>{type}</option>)}
        </select>
      </label>
      <label>
        备注
        <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} rows="3" placeholder="这条关系的证据或解释" />
      </label>
      <button className="secondary" type="submit" disabled={busy || !form.sourceId || !form.targetId || form.sourceId === form.targetId}>
        {busy ? "建立中" : "建立关系"}
      </button>
    </form>
  );
}

function AdminUsersPanel({ session }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmingId, setConfirmingId] = useState("");
  const [deletingId, setDeletingId] = useState("");

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      const payload = await request("/api/auth/users", {}, session.token);
      setUsers(payload.users || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  const adminCount = users.filter((user) => user.role === "admin").length;

  async function deleteUser(user) {
    if (confirmingId !== user.id) {
      setConfirmingId(user.id);
      return;
    }
    setDeletingId(user.id);
    setError("");
    try {
      await request(`/api/auth/users/${user.id}`, { method: "DELETE" }, session.token);
      setConfirmingId("");
      await loadUsers();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeletingId("");
    }
  }

  return (
    <section className="account-admin admin-management">
      <div className="admin-users-heading">
        <div>
          <strong>所有用户</strong>
          <span>{users.length} 位用户 · {adminCount} 位管理员</span>
        </div>
        <button className="icon-button neutral" type="button" aria-label="创建用户" title="创建用户" onClick={() => setCreating((current) => !current)}>
          {creating ? <X size={15} /> : <UserPlus size={15} />}
        </button>
      </div>
      {creating && <UserForm session={session} embedded onCreated={() => { setCreating(false); loadUsers(); }} />}
      {loading && <div className="admin-users-empty">正在读取用户…</div>}
      {error && <div className="form-error">{error}</div>}
      {!loading && !error && (
        <div className="admin-user-list">
          {users.map((user) => (
            <article className="admin-user-row" key={user.id}>
              <Avatar user={user} size={34} />
              <div className="admin-user-identity">
                <strong>{user.displayName || user.email}</strong>
                <span>{user.email}</span>
              </div>
              <div className="admin-user-meta">
                <span className={`admin-role ${user.role}`}>{user.role === "admin" ? "管理员" : "成员"}</span>
                <small>{user.knowledgeItemCount || 0} 条知识 · {user.createdAt ? new Date(user.createdAt).toLocaleDateString("zh-CN") : "未知日期"}</small>
              </div>
              <div className="admin-user-actions">
                {user.canDelete && (
                  <>
                    {confirmingId === user.id && (
                      <button className="text-button" type="button" onClick={() => setConfirmingId("")}>取消</button>
                    )}
                    <button
                      className={confirmingId === user.id ? "delete-confirm" : "icon-button neutral"}
                      type="button"
                      disabled={deletingId === user.id}
                      aria-label={`删除 ${user.displayName || user.email}`}
                      title={confirmingId === user.id ? "再次点击确认删除" : "删除用户"}
                      onClick={() => deleteUser(user)}
                    >
                      {confirmingId === user.id ? (deletingId === user.id ? "删除中" : "确认删除") : <Trash2 size={14} />}
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function UserCenterPage({ session, onSessionUpdate, onLogout }) {
  const [section, setSection] = useState("profile");

  return (
    <section className="user-center">
      <header className="user-center-heading">
        <Avatar user={session.user} size={52} />
        <div>
          <h1>{session.user.displayName || session.user.email}</h1>
          <p>{session.user.email} · {session.user.role === "admin" ? "管理员" : "成员"}</p>
        </div>
        <button className="secondary" type="button" onClick={onLogout}><LogOut size={15} />退出登录</button>
      </header>
      <div className="user-center-tabs" role="tablist" aria-label="用户中心">
        <button type="button" role="tab" aria-selected={section === "profile"} className={section === "profile" ? "active" : ""} onClick={() => setSection("profile")}>
          个人资料
        </button>
        {session.user.role === "admin" && (
          <button type="button" role="tab" aria-selected={section === "admin"} className={section === "admin" ? "active" : ""} onClick={() => setSection("admin")}>
            <Users size={15} />
            用户管理
          </button>
        )}
      </div>
      {section === "profile" ? (
        <section className="panel user-profile-panel">
          <ProfilePanel session={session} onSessionUpdate={onSessionUpdate} />
        </section>
      ) : (
        <section className="panel user-admin-panel">
          <AdminUsersPanel session={session} />
        </section>
      )}
    </section>
  );
}

function UserForm({ session, embedded = false, onCreated }) {
  const [form, setForm] = useState({ email: "", password: "", displayName: "", avatarUrl: "", role: "member" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (session.user.role !== "admin") return null;

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      await request("/api/auth/users", { method: "POST", body: JSON.stringify(form) }, session.token);
      setMessage("用户已创建");
      setForm({ email: "", password: "", displayName: "", avatarUrl: "", role: "member" });
      onCreated?.();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${embedded ? "account-admin" : "panel"} stack`} onSubmit={submit}>
      <div className="panel-heading">
        <UserPlus size={18} />
        <span>创建用户</span>
      </div>
      <label>
        邮箱
        <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
      </label>
      <label>
        初始密码
        <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" required />
      </label>
      <label>
        昵称
        <input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
      </label>
      <label>
        头像 URL
        <input value={form.avatarUrl} onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })} placeholder="https://..." />
      </label>
      <label>
        角色
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <button className="secondary" type="submit" disabled={busy}>{busy ? "创建中" : "创建"}</button>
      {message && <div className="microcopy">{message}</div>}
    </form>
  );
}

function DetailPanel({ selected, links, items, mentions, referencesLoading, evidence, evidenceLoading, onSelect, onSave, onPublish, onDeleteItem, onDeleteLink }) {
  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", kind: "Concept", summary: "", content: "", tags: "", source: "" });
  const [axiomForm, setAxiomForm] = useState({ title: "", statement: "", evidenceSnapshot: "" });

  useEffect(() => {
    if (!selected) return;
    setForm({
      title: selected.title,
      kind: selected.kind,
      summary: selected.summary || "",
      content: selected.content || "",
      tags: (selected.tags || []).join(", "),
      source: selected.source || ""
    });
    setAxiomForm({
      title: selected.title,
      statement: selected.summary || selected.content || selected.title,
      evidenceSnapshot: selected.summary || ""
    });
    setEditing(false);
    setPublishing(false);
  }, [selected?.id]);

  if (!selected) {
    return (
      <aside className="detail empty">
        <CircleDot size={28} />
        <h2>选择一个节点</h2>
        <p>点击图谱中的节点，查看它的摘要、标签、来源和直接关联。</p>
      </aside>
    );
  }

  const incoming = links.filter((link) => link.targetId === selected.id);
  const outgoing = links.filter((link) => link.sourceId === selected.id);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(selected.id, { ...form, tags: normalizeTags(form.tags) });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function publish(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await onPublish(selected.id, axiomForm);
      setPublishing(false);
    } finally {
      setBusy(false);
    }
  }

  function relationItem(link, direction) {
    const otherId = direction === "incoming" ? link.sourceId : link.targetId;
    const other = items.find((item) => item.id === otherId);
    return (
      <div className="relation-item" key={link.id}>
        <button className="relation-target" type="button" onClick={() => onSelect(otherId)}>
          <strong>{link.type}</strong>
          <span>{other?.title || otherId}</span>
          {link.note && <small>{link.note}</small>}
        </button>
        <button type="button" className="icon-button" aria-label="删除关系" onClick={() => onDeleteLink(link.id)}>
          <Trash2 size={15} />
        </button>
      </div>
    );
  }

  return (
    <aside className="detail">
      {editing ? (
        <form className="stack detail-edit" onSubmit={save}>
          <div className="detail-edit-head">
            <strong>编辑知识页</strong>
            <button className="icon-button neutral" type="button" aria-label="取消编辑" onClick={() => setEditing(false)}>
              <X size={15} />
            </button>
          </div>
          <label>
            标题
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
          </label>
          <label>
            类型
            <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
              {kinds.map((kind) => <option key={kind}>{kind}</option>)}
            </select>
          </label>
          <label>
            摘要
            <textarea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} rows="4" />
          </label>
          <label>
            正文
            <textarea className="content-editor" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} rows="14" />
          </label>
          <label>
            标签
            <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
          </label>
          <label>
            来源
            <input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} />
          </label>
          <button className="secondary" type="submit" disabled={busy}>
            <Save size={15} />
            {busy ? "保存中" : "保存知识页"}
          </button>
        </form>
      ) : (
        <>
          <div className="detail-head">
            <div className="detail-kicker">{selected.kind}</div>
            <button className="icon-button neutral" type="button" aria-label="编辑节点" onClick={() => setEditing(true)}>
              <Pencil size={15} />
            </button>
          </div>
          <h2>{selected.title}</h2>
          <p>{selected.summary || "暂无摘要。"}</p>
          {selected.content && (
            <article className="knowledge-content">
              <BookOpen size={17} />
              <div>{selected.content}</div>
            </article>
          )}
          <div className="tags">
            {(selected.tags || []).map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          {selected.source && <div className="source">来源：{selected.source}</div>}
          <section className="evidence-list">
            <h3><Quote size={16} /> 原文证据 <span>{evidence.length}</span></h3>
            {evidenceLoading && <p className="microcopy">读取证据中</p>}
            {!evidenceLoading && evidence.length === 0 && <p className="microcopy">旧节点尚未关联原文证据。</p>}
            {evidence.map((item) => (
              <blockquote key={item.id}>
                <p>{item.quote}</p>
                <footer>{item.document.title} · 分块 {Number(item.chunk.index) + 1}{item.model ? ` · ${item.model}` : ""}</footer>
              </blockquote>
            ))}
          </section>
          <div className="detail-actions">
            <button className="secondary" type="button" onClick={() => setPublishing((current) => !current)}>
              <Globe2 size={15} />
              发布公理
            </button>
            <button className="danger" type="button" onClick={() => onDeleteItem(selected.id)}>
              <Trash2 size={15} />
              删除节点
            </button>
          </div>
          {publishing && (
            <form className="stack axiom-publish" onSubmit={publish}>
              <label>
                公理标题
                <input value={axiomForm.title} onChange={(event) => setAxiomForm({ ...axiomForm, title: event.target.value })} required />
              </label>
              <label>
                命题
                <textarea value={axiomForm.statement} onChange={(event) => setAxiomForm({ ...axiomForm, statement: event.target.value })} rows="6" minLength="10" required />
              </label>
              <label>
                公开证据快照
                <textarea value={axiomForm.evidenceSnapshot} onChange={(event) => setAxiomForm({ ...axiomForm, evidenceSnapshot: event.target.value })} rows="4" />
              </label>
              <button className="primary" type="submit" disabled={busy}>
                <Send size={15} />
                {busy ? "发布中" : "发布到 Public"}
              </button>
            </form>
          )}
        </>
      )}
      <div className="relation-list">
        <h3><ArrowDownLeft size={16} /> Backlinks <span>{incoming.length}</span></h3>
        {incoming.length === 0 && <p className="microcopy">没有节点指向这里。</p>}
        {incoming.map((link) => relationItem(link, "incoming"))}
      </div>
      <div className="relation-list">
        <h3><ArrowUpRight size={16} /> 出站链接 <span>{outgoing.length}</span></h3>
        {outgoing.length === 0 && <p className="microcopy">这里还没有指向其他节点。</p>}
        {outgoing.map((link) => relationItem(link, "outgoing"))}
      </div>
      <div className="relation-list">
        <h3><Search size={16} /> 未连接提及 <span>{mentions.length}</span></h3>
        {referencesLoading && <p className="microcopy">查找中</p>}
        {!referencesLoading && mentions.length === 0 && <p className="microcopy">没有发现未建立链接的提及。</p>}
        {mentions.map((item) => (
          <button className="mention-item" key={item.id} type="button" onClick={() => onSelect(item.id)}>
            <strong>{item.title}</strong>
            <span>{item.summary || item.kind}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

const axiomStatusLabels = {
  pending: "待观察",
  observed: "已观察",
  accepted: "已认可",
  disputed: "有争议",
  rejected: "未认可",
  deprecated: "已弃用",
  superseded: "已替代"
};

const hypothesisStatusLabels = {
  proposed: "待验证",
  testing: "验证中",
  supported: "已支持",
  challenged: "受质疑",
  rejected: "已否决",
  promoted: "已提升"
};

function PublicDetailPanel({ session, selected, nodes, links, onSelect, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ stance: "neutral", note: "", evidence: "" });
  const [revision, setRevision] = useState({ open: false, title: "", statement: "" });
  const [busy, setBusy] = useState("");

  async function refreshDetail() {
    if (!selected || !["Axiom", "Hypothesis"].includes(selected.kind)) {
      setDetail(null);
      return;
    }
    const path = selected.kind === "Axiom"
      ? `/api/axioms/${selected.id}`
      : `/api/hypotheses/${selected.id}`;
    const payload = await request(path, {}, session.token);
    setDetail(payload);
  }

  useEffect(() => {
    refreshDetail().catch(() => setDetail(null));
  }, [selected?.id]);

  if (!selected) {
    return <aside className="detail empty"><Globe2 size={28} /><h2>公共实体图谱</h2><p>选择人物、组织、概念、方法或其他名词实体查看定义与关系。</p></aside>;
  }
  if (selected.publicEntity) {
    const entity = selected.publicEntity;
    const relations = links
      .filter((link) => link.sourceId === selected.id || link.targetId === selected.id)
      .map((link) => {
        const outgoing = link.sourceId === selected.id;
        const otherId = outgoing ? link.targetId : link.sourceId;
        const other = nodes.find((node) => node.id === otherId);
        const evidence = link.evidence || null;
        return { ...link, outgoing, other, evidence };
      });
    return (
      <aside className="detail public-detail">
        <div className="detail-kicker">公共实体 · {kindLabel(entity.entityType)}</div>
        <h2>{entity.name}</h2>
        <p>{entity.description}</p>
        <div className="wiki-meta">
          <span>{kindLabel(entity.entityType)}</span>
          <span>{relations.length} 条连接</span>
        </div>
        <section className="entity-relations">
          <h3>实体关系 <span>{relations.length}</span></h3>
          {relations.map((relation) => (
            <button key={relation.id} type="button" onClick={() => relation.other && onSelect(relation.other.id)}>
              <span className={relation.outgoing ? "relation-direction outgoing" : "relation-direction incoming"}>
                {relation.outgoing ? "出" : "入"}
              </span>
              <div>
                <small>{relation.outgoing ? entity.name : relation.other?.title} · {relationLabel(relation.type)} · {relation.outgoing ? relation.other?.title : entity.name}</small>
                <strong>{relation.description || relation.note || relationLabel(relation.type)}</strong>
                {relation.evidence && <p>证据：{relation.evidence.statement}</p>}
              </div>
            </button>
          ))}
        </section>
        <div className="source">定义来源：{entity.sourceTitle || "超级大脑代码库"}</div>
      </aside>
    );
  }
  if (selected.kind === "PublicFact") {
    const fact = selected.publicFact || {};
    return (
      <aside className="detail public-detail">
        <div className="detail-kicker">PUBLIC FACT</div>
        <h2>{selected.title}</h2>
        <p>{selected.summary}</p>
        <div className="wiki-meta">
          <span className="wiki-status verified">已公开</span>
          <span>置信度 {Math.round((fact.confidence || 0) * 100)}%</span>
        </div>
        {selected.content && (
          <blockquote className="axiom-evidence">
            <p>{selected.content}</p>
            <footer>公开证据 · {fact.sourceTitle || "超级大脑系统说明"}</footer>
          </blockquote>
        )}
        <div className="source">发布者：{selected.source || "System"}</div>
      </aside>
    );
  }
  if (selected.kind === "Hypothesis") {
    const hypothesis = detail?.hypothesis || selected.hypothesis || {};
    const premises = detail?.premises || [];
    const challenges = detail?.challenges || [];

    async function promote() {
      setBusy("promote");
      try {
        await request(`/api/hypotheses/${selected.id}/promote`, {
          method: "POST",
          body: JSON.stringify({})
        }, session.token);
        await Promise.all([refreshDetail(), onRefresh()]);
      } finally {
        setBusy("");
      }
    }

    return (
      <aside className="detail public-detail">
        <div className="axiom-version-row">
          <div className={`axiom-status ${hypothesis.status}`}>{hypothesisStatusLabels[hypothesis.status] || hypothesis.status}</div>
          <span>HYPOTHESIS</span>
        </div>
        <h2>{hypothesis.title || selected.title}</h2>
        <p>{hypothesis.claim || selected.summary}</p>
        <div className="wiki-meta">
          <span>置信度 {Math.round((hypothesis.confidence || 0) * 100)}%</span>
          {hypothesis.model && <span>{hypothesis.model}</span>}
        </div>
        {hypothesis.rationale && (
          <section className="wiki-section">
            <h3>结构化解释</h3>
            <p>{hypothesis.rationale}</p>
          </section>
        )}
        {hypothesis.alternativeExplanation && (
          <section className="wiki-section">
            <h3>替代解释</h3>
            <p>{hypothesis.alternativeExplanation}</p>
          </section>
        )}
        {hypothesis.falsificationCriteria && (
          <section className="wiki-section">
            <h3>可证伪条件</h3>
            <p>{hypothesis.falsificationCriteria}</p>
          </section>
        )}
        {!!premises.length && (
          <section className="supporting-facts">
            <h3>前提事实 <span>{premises.length}</span></h3>
            {premises.map((fact) => <article key={fact.id}><strong>{fact.statement}</strong><span>{fact.sourceTitle}</span></article>)}
          </section>
        )}
        {!!challenges.length && (
          <section className="supporting-facts">
            <h3>反证事实 <span>{challenges.length}</span></h3>
            {challenges.map((fact) => <article key={fact.id}><strong>{fact.statement}</strong><span>{fact.sourceTitle}</span></article>)}
          </section>
        )}
        {detail?.axiom && <div className="version-link">已提升为公理：{detail.axiom.title}</div>}
        <div className="source">提出者：{hypothesis.authorName || selected.source}</div>
        {(hypothesis.authorId === session.user.id || session.user.role === "admin")
          && hypothesis.status !== "promoted"
          && <button className="primary" type="button" onClick={promote} disabled={busy === "promote"}><Scale size={15} /> 提升为公理</button>}
      </aside>
    );
  }
  if (selected.kind !== "Axiom") {
    return (
      <aside className="detail">
        <div className="detail-kicker">Observation</div>
        <h2>{selected.title}</h2>
        <p>{selected.summary}</p>
        {selected.content && <div className="knowledge-content"><Quote size={17} /><div>{selected.content}</div></div>}
        <div className="source">观察者：{selected.source}</div>
      </aside>
    );
  }

  const axiom = detail?.axiom || selected.axiom;
  const observations = detail?.observations || [];
  const supportingFacts = detail?.facts || [];

  async function vote(value) {
    setBusy(value);
    try {
      await request(`/api/axioms/${selected.id}/vote`, {
        method: "PUT",
        body: JSON.stringify({ value })
      }, session.token);
      await Promise.all([refreshDetail(), onRefresh()]);
    } finally {
      setBusy("");
    }
  }

  async function observe(event) {
    event.preventDefault();
    setBusy("observe");
    try {
      await request(`/api/axioms/${selected.id}/observations`, {
        method: "POST",
        body: JSON.stringify(form)
      }, session.token);
      setForm({ stance: "neutral", note: "", evidence: "" });
      await Promise.all([refreshDetail(), onRefresh()]);
    } finally {
      setBusy("");
    }
  }

  async function revise(event) {
    event.preventDefault();
    setBusy("revise");
    try {
      await request(`/api/axioms/${selected.id}/revisions`, {
        method: "POST",
        body: JSON.stringify({ title: revision.title, statement: revision.statement })
      }, session.token);
      setRevision({ open: false, title: "", statement: "" });
      await Promise.all([refreshDetail(), onRefresh()]);
    } finally {
      setBusy("");
    }
  }

  return (
    <aside className="detail public-detail">
      <div className="axiom-version-row">
        <div className={`axiom-status ${axiom.status}`}>{axiomStatusLabels[axiom.status] || axiom.status}</div>
        <span>VERSION {axiom.version || 1}</span>
      </div>
      <h2>{axiom.title}</h2>
      <p>{axiom.statement}</p>
      {axiom.evidenceSnapshot && (
        <blockquote className="axiom-evidence">
          <p>{axiom.evidenceSnapshot}</p>
          <footer>公开快照 · {axiom.sourceTitle}</footer>
        </blockquote>
      )}
      {supportingFacts.length > 0 && (
        <section className="supporting-facts">
          <h3>支持事实 <span>{supportingFacts.length}</span></h3>
          {supportingFacts.map((fact, index) => (
            <article key={fact.id}>
              <small>FACT {String(index + 1).padStart(2, "0")} · 置信度 {Math.round(fact.confidence * 100)}%</small>
              <strong>{fact.statement}</strong>
              {fact.quote && <blockquote>{fact.quote}</blockquote>}
              <span>{fact.documentTitle}</span>
            </article>
          ))}
        </section>
      )}
      <div className="source">发布者：{axiom.authorName}</div>
      {axiom.previousAxiomId && <div className="version-link">上一版本：{axiom.previousAxiomId.slice(0, 8)}</div>}
      {axiom.supersededById && <div className="version-link">已由新版本替代：{axiom.supersededById.slice(0, 8)}</div>}
      {axiom.authorId === session.user.id && axiom.status !== "superseded" && (
        <div className="revision-editor">
          {!revision.open ? (
            <button type="button" onClick={() => setRevision({ open: true, title: axiom.title, statement: axiom.statement })}><Pencil size={14} /> 发布新版本</button>
          ) : (
            <form className="stack" onSubmit={revise}>
              <label>标题<input value={revision.title} onChange={(event) => setRevision({ ...revision, title: event.target.value })} required /></label>
              <label>新命题<textarea rows="5" minLength="10" value={revision.statement} onChange={(event) => setRevision({ ...revision, statement: event.target.value })} required /></label>
              <div className="revision-actions">
                <button type="button" onClick={() => setRevision({ open: false, title: "", statement: "" })}>取消</button>
                <button className="primary" type="submit" disabled={busy === "revise"}>发布版本</button>
              </div>
            </form>
          )}
        </div>
      )}
      <div className="vote-row">
        <button className={axiom.myVote === "support" ? "vote active support" : "vote support"} type="button" onClick={() => vote("support")} disabled={Boolean(busy)}>
          <ThumbsUp size={16} />
          认可 {axiom.supportCount}
        </button>
        <button className={axiom.myVote === "oppose" ? "vote active oppose" : "vote oppose"} type="button" onClick={() => vote("oppose")} disabled={Boolean(busy)}>
          <ThumbsDown size={16} />
          不认可 {axiom.opposeCount}
        </button>
      </div>
      <section className="observation-list">
        <h3>观察记录 <span>{observations.length}</span></h3>
        {observations.map((observation) => (
          <article key={observation.id}>
            <strong>{observation.stance} · {observation.authorName}</strong>
            <p>{observation.note}</p>
            {observation.evidence && <small>{observation.evidence}</small>}
          </article>
        ))}
      </section>
      {!!detail?.audit?.length && (
        <section className="audit-timeline">
          <h3>演化记录 <span>{detail.audit.length}</span></h3>
          {detail.audit.map((event) => (
            <div key={event.id}>
              <i />
              <strong>{event.actorName}</strong>
              <span>{event.action}</span>
              <time>{new Date(event.createdAt).toLocaleString()}</time>
            </div>
          ))}
        </section>
      )}
      <form className="stack observation-form" onSubmit={observe}>
        <label>
          立场
          <select value={form.stance} onChange={(event) => setForm({ ...form, stance: event.target.value })}>
            <option value="neutral">中立观察</option>
            <option value="support">支持</option>
            <option value="oppose">反对</option>
          </select>
        </label>
        <label>
          观察
          <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} rows="4" required />
        </label>
        <label>
          证据或反例
          <textarea value={form.evidence} onChange={(event) => setForm({ ...form, evidence: event.target.value })} rows="3" />
        </label>
        <button className="secondary" type="submit" disabled={busy === "observe"}>
          {busy === "observe" ? "提交中" : "提交观察"}
        </button>
      </form>
    </aside>
  );
}

function useFacts(token, query) {
  const [state, setState] = useState({ loading: true, facts: [], error: "" });
  const refresh = async () => {
    if (!token) return;
    try {
      const payload = await request(`/api/facts?q=${encodeURIComponent(query)}`, {}, token);
      setState({ loading: false, facts: payload.facts, error: "" });
    } catch (error) {
      setState({ loading: false, facts: [], error: error.message });
    }
  };
  useEffect(() => {
    const timer = setTimeout(refresh, 160);
    return () => clearTimeout(timer);
  }, [token, query]);
  return { ...state, refresh };
}

function useAxioms(token, query) {
  const [state, setState] = useState({ loading: true, axioms: [], error: "" });
  const refresh = async () => {
    if (!token) return;
    try {
      const payload = await request(`/api/axioms?q=${encodeURIComponent(query)}`, {}, token);
      setState({ loading: false, axioms: payload.axioms, error: "" });
    } catch (error) {
      setState({ loading: false, axioms: [], error: error.message });
    }
  };
  useEffect(() => {
    const timer = setTimeout(refresh, 160);
    return () => clearTimeout(timer);
  }, [token, query]);
  return { ...state, refresh };
}

const factStatusLabels = {
  candidate: "待核验",
  verified: "已核验",
  disputed: "有争议",
  rejected: "已否定",
  superseded: "已替代"
};

function ingestFailurePresentation(input = {}) {
  const error = input instanceof Error ? input : null;
  const detail = error?.message || input.error || "任务没有返回具体错误。";
  if (input.errorTitle) {
    return {
      title: input.errorTitle,
      detail,
      suggestion: input.errorSuggestion || "检查内容与模型配置后重试。"
    };
  }
  if (error?.status === 402) {
    const available = error.payload?.availableTokens;
    const required = error.payload?.requiredTokens;
    return {
      title: "Token 额度不足",
      detail: Number.isFinite(available) && Number.isFinite(required)
        ? `当前可用 ${available} Token，本次至少需要 ${required} Token。`
        : detail,
      suggestion: "前往设置查看额度，或减少本次摄取内容。"
    };
  }
  if (/知识编译需要审核|属性键|证据无法在原文中定位|缺少来源证据/.test(detail)) {
    return {
      title: "知识结构未通过规则校验",
      detail,
      suggestion: "系统没有写入不合规结果。可重试，或缩小原文范围。"
    };
  }
  if (/暂不支持这些文件|不能超过|最多上传/.test(detail)) {
    return {
      title: "文件无法摄取",
      detail,
      suggestion: "调整文件格式、数量或大小后重试。"
    };
  }
  return {
    title: "摄取失败",
    detail,
    suggestion: "检查模型配置和输入内容后重试。"
  };
}

const knowledgeIssueLabels = {
  PROPOSITION_AS_ENTITY: "命题被误识别为实体",
  DUPLICATE_ENTITY: "实体重复",
  INVALID_ENTITY_KIND: "实体类型错误",
  MISSING_ENTITY_DESCRIPTION: "实体缺少描述",
  MISSING_ENTITY_EVIDENCE: "实体缺少证据",
  ENTITY_EVIDENCE_NOT_IN_SOURCE: "实体证据无法定位",
  INVALID_ATTRIBUTE_KEY: "属性名称无效",
  DUPLICATE_ATTRIBUTE: "属性重复",
  MISSING_ATTRIBUTE_EVIDENCE: "属性缺少证据",
  ATTRIBUTE_EVIDENCE_NOT_IN_SOURCE: "属性证据无法定位",
  UNKNOWN_RELATION_SOURCE: "关系起点不存在",
  UNKNOWN_RELATION_TARGET: "关系终点不存在",
  SELF_RELATION: "关系指向自身",
  INVALID_RELATION_TYPE: "关系类型无效",
  MISSING_RELATION_DESCRIPTION: "关系缺少描述",
  MISSING_RELATION_EVIDENCE: "关系缺少证据",
  RELATION_EVIDENCE_NOT_IN_SOURCE: "关系证据无法定位",
  FACT_LOOKS_LIKE_HYPOTHESIS: "推测被误识别为事实",
  FACT_WITHOUT_ENTITY: "事实没有关联实体",
  UNKNOWN_FACT_ENTITY: "事实关联了未知实体",
  MISSING_FACT_EVIDENCE: "事实缺少证据",
  FACT_EVIDENCE_NOT_IN_SOURCE: "事实证据无法定位",
  MALFORMED_MODEL_ENTITY_DROPPED: "模型实体字段不完整",
  MALFORMED_MODEL_FACT_DROPPED: "模型事实字段不完整",
  MALFORMED_MODEL_RELATION_DROPPED: "模型关系字段不完整",
  MODEL_OUTPUT_LIMIT_APPLIED: "模型输出超过协议上限"
};

function knowledgeIssueLocation(path = "") {
  if (path.startsWith("modelOutput")) return "模型输出标准化阶段";
  if (path.startsWith("nodes")) return "实体与属性阶段";
  if (path.startsWith("links")) return "关系建模阶段";
  if (path.startsWith("facts")) return "事实与证据阶段";
  return "知识编译阶段";
}

function AgentTrace({ trace }) {
  if (!trace?.steps?.length) return null;
  function stepIcon(step) {
    if (step.status === "active") return <Sparkles size={11} />;
    if (step.status === "failed") return <X size={10} />;
    if (step.status === "warning") return <CircleDot size={10} />;
    if (step.status === "completed") return <Check size={10} />;
    return null;
  }
  return (
    <div className="agent-trace">
      <div className="agent-trace-title"><Activity size={13} />操作记录</div>
      {trace.steps.map((step) => (
        <div className={`agent-trace-step ${step.status}`} key={step.id}>
          <i>{stepIcon(step)}</i>
          <span>{step.label}</span>
          <small>{step.detail}</small>
        </div>
      ))}
    </div>
  );
}

function runningResearchTrace(webSearch) {
  return {
    mode: "research",
    steps: [
      { id: "knowledge_query", label: "查询知识库", status: "active", detail: "正在召回资料、节点与关系" },
      ...(webSearch ? [{
        id: "web_search",
        label: "搜索互联网",
        status: "active",
        detail: "正在获取并过滤网页证据"
      }] : []),
      { id: "model_call", label: "调用模型", status: "pending", detail: "等待检索完成" },
      { id: "citation_render", label: "附加证据引用", status: "pending", detail: "等待模型返回" }
    ]
  };
}

function ingestAgentTrace(job) {
  if (!job) return null;
  const terminal = ["completed", "review_required", "failed"].includes(job.status);
  const fileSteps = (job.fileNames || []).map((name, index) => ({
    id: `read_file_${index}`,
    label: `读取 ${name}`,
    status: job.status === "queued" ? "active" : "completed",
    detail: job.status === "queued" ? "等待文件解析" : "已读取并标准化"
  }));
  return {
    mode: "ingest",
    steps: [
      ...(!fileSteps.length ? [{
        id: "source",
        label: "读取粘贴文字",
        status: "completed",
        detail: "已加入本次摄取来源"
      }] : fileSteps),
      {
        id: "extract",
        label: "抽取知识结构",
        status: job.status === "processing" ? "active" : terminal ? "completed" : "pending",
        detail: job.status === "processing" ? "模型正在编译知识结构" : terminal ? "模型调用已完成" : "等待模型"
      },
      {
        id: "validate",
        label: "校验实体、事实与关系",
        status: job.status === "review_required" ? "warning" : job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : "pending",
        detail: job.status === "review_required"
          ? `${job.workflow?.issues?.length || 0} 项需要审核`
          : job.status === "completed" ? "知识协议校验通过" : job.status === "failed" ? "处理未完成" : "等待校验"
      },
      {
        id: "commit",
        label: "写入 Private",
        status: job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : "pending",
        detail: job.status === "completed" ? "已写入私有知识空间" : job.status === "review_required" ? "等待用户审核" : "尚未写入"
      }
    ]
  };
}

function chooseAgentAction(text, files, requestedMode) {
  if (requestedMode !== "auto") return requestedMode;
  if (files.length) return "ingest";
  if (/(?:构建|建立|创建|生成|整理).{0,30}(?:基础知识|知识(?:体系|库|图谱)?)/u.test(text)) {
    return "research_build";
  }
  if (String(text).length >= 1200) return "ingest";
  if (/(?:摄取|抽取|加入|导入|保存|写入).{0,12}(?:知识库|知识|图谱|资料)|(?:知识库|图谱).{0,12}(?:摄取|抽取|加入|导入|保存|写入)/u.test(text)) {
    return "ingest";
  }
  return "ask";
}

function researchTopicFromRequest(text) {
  return String(text)
    .replace(/^(?:(?:继续|再|然后|接着)\s*)?(?:(?:请|麻烦|帮我|替我|我想要|我需要|能否|可以)\s*)+/u, "")
    .replace(/(?:构建|建立|创建|生成|整理)(?:一个|一套|有关|关于)?/u, "")
    .replace(/^(?:(?:继续|再|然后|接着)\s*)?(?:(?:请|麻烦|帮我|替我)\s*)+/u, "")
    .replace(/(?:相关的?|有关的?)?(?:系统性)?(?:基础)?(?:知识体系|知识库|知识图谱|知识)$/u, "")
    .replace(/[。！!？?]+$/u, "")
    .trim()
    .slice(0, 200) || String(text).trim().slice(0, 200);
}

function looksLikeAttachmentQuestion(text) {
  return /[?？]\s*$/u.test(text)
    || /^(?:请|帮我|替我|能否|可以).{0,8}(?:总结|分析|解释|提炼|比较|回答|查找|看看)/u.test(text)
    || /(?:这份|这个|附件|文件|图片).{0,8}(?:是什么|讲了什么|总结|分析|解释|提炼|比较)/u.test(text);
}

function canBuildKnowledgeFromMessage(message) {
  return message.role === "assistant"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.id || "")
    && message.sources?.some((source) => source.type === "web")
    && !/(?:无法|不能|不足以).{0,18}(?:构建|支撑)|(?:资料|材料|证据).{0,8}不足/u.test(message.content);
}

function IngestComposer({ session, profiles, onComplete }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [profileId, setProfileId] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [reviewJobId, setReviewJobId] = useState("");
  const [reviewBusy, setReviewBusy] = useState("");
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (!profiles.length) return;
    if (!profiles.some((profile) => profile.id === profileId)) {
      setProfileId((profiles.find((profile) => profile.isDefault) || profiles[0]).id);
    }
  }, [profiles, profileId]);

  async function refreshJobs() {
    const payload = await request("/api/ingest/jobs", {}, session.token);
    setJobs(payload.jobs);
    return payload.jobs;
  }

  useEffect(() => {
    refreshJobs().catch(() => {});
    const timer = setInterval(() => {
      if (jobs.some((job) => job.status === "queued" || job.status === "processing")) {
        refreshJobs().catch(() => {});
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [session.token, jobs.some((job) => job.status === "queued" || job.status === "processing")]);

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    const supported = incoming.filter((file) => (
      file.type.startsWith("image/")
      || /\.(txt|md|csv|json|pdf|docx)$/i.test(file.name)
    ));
    const oversized = supported.find((file) => file.size > 12 * 1024 * 1024);
    if (oversized) {
      setStatus({
        type: "error",
        title: "附件超过大小限制",
        detail: `${oversized.name} 超过 12MB`,
        suggestion: "请压缩文件或拆分后重新添加。"
      });
      return;
    }
    if (supported.length !== incoming.length) {
      setStatus({
        type: "error",
        title: "存在不支持的附件",
        detail: "支持 TXT、Markdown、CSV、JSON、PDF、DOCX 和常见图片格式。",
        suggestion: "请移除其他格式后再试。"
      });
    }
    setFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...supported.filter((file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`))].slice(0, 6);
    });
  }

  function pasteAttachments(event) {
    const pasted = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean)
      .map((file, index) => (
        file.type.startsWith("image/")
          ? new File([file], `剪贴板图片-${Date.now()}-${index + 1}.${file.type.split("/")[1] || "png"}`, {
            type: file.type,
            lastModified: Date.now()
          })
          : file
      ));
    if (!pasted.length) return;
    event.preventDefault();
    addFiles(pasted);
  }

  async function send() {
    if (busy || (!text.trim() && !files.length) || !profileId) return;
    setBusy(true);
    setStatus({ type: "working", text: "正在读取来源并抽取事实" });
    try {
      const form = new FormData();
      form.append("text", text);
      form.append("profileId", profileId);
      files.forEach((file) => form.append("files", file));
      const payload = await request("/api/ingest/jobs", { method: "POST", body: form }, session.token);
      setText("");
      setFiles([]);
      setStatus({ type: "working", text: "任务已进入队列，正在后台抽取" });
      await refreshJobs();
      for (let attempt = 0; attempt < 240; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const jobPayload = await request(`/api/ingest/jobs/${payload.job.id}`, {}, session.token);
        const job = jobPayload.job;
        if (job.status === "completed") {
          setStatus({
            type: "done",
            text: `完成：${job.result?.facts || 0} 条事实、${job.result?.nodes || 0} 个页面、${job.result?.links || 0} 条关系`
          });
          await Promise.all([refreshJobs(), onComplete()]);
          return;
        }
        if (job.status === "review_required") {
          setReviewJobId(job.id);
          setStatus(null);
          await refreshJobs();
          return;
        }
        if (job.status === "failed") {
          setStatus({ type: "error", ...ingestFailurePresentation(job) });
          await refreshJobs();
          return;
        }
        setStatus({ type: "working", text: job.status === "queued" ? "等待后台处理" : "正在解析、抽取并写入知识库" });
      }
      setStatus({ type: "working", text: "任务仍在后台运行，可稍后回来查看" });
      await refreshJobs();
    } catch (error) {
      setStatus({ type: "error", ...ingestFailurePresentation(error) });
    } finally {
      setBusy(false);
    }
  }

  async function retry(jobId) {
    try {
      setReviewBusy("retry");
      await request(`/api/ingest/jobs/${jobId}/retry`, { method: "POST" }, session.token);
      setReviewJobId("");
      setStatus({ type: "working", text: "任务已重新进入抽取队列，本次会产生新的模型用量" });
      await refreshJobs();
    } catch (error) {
      setStatus({ type: "error", ...ingestFailurePresentation(error) });
    } finally {
      setReviewBusy("");
    }
  }

  async function discardInvalid(jobId) {
    try {
      setReviewBusy("discard");
      const payload = await request(`/api/ingest/jobs/${jobId}/discard-invalid`, { method: "POST" }, session.token);
      const discarded = payload.discarded || {};
      setReviewJobId("");
      setStatus({
        type: "done",
        text: `已写入有效知识，跳过 ${discarded.nodes || 0} 个实体、${discarded.attributes || 0} 个属性、${discarded.links || 0} 条关系、${discarded.facts || 0} 条事实`
      });
      await Promise.all([refreshJobs(), onComplete()]);
    } catch (error) {
      setStatus({ type: "error", ...ingestFailurePresentation(error) });
      await refreshJobs();
    } finally {
      setReviewBusy("");
    }
  }

  const reviewJob = reviewJobId === false
    ? null
    : jobs.find((job) => job.id === reviewJobId)
      || jobs.find((job) => job.status === "review_required");
  const traceJob = reviewJob
    || jobs.find((job) => ["queued", "processing"].includes(job.status))
    || jobs[0];

  return (
    <section
      className={`ingest-composer ${dragActive ? "drag-active" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      {dragActive && <div className="drop-target"><Files size={20} />释放以添加到本次摄取</div>}
      {status && (
        <div className={`ingest-status ${status.type}`}>
          {status.type === "working" && <Sparkles size={14} />}
          {status.type === "error" ? (
            <div>
              <strong>{status.title}</strong>
              <span>{status.detail}</span>
              <small>{status.suggestion}</small>
            </div>
          ) : status.text}
        </div>
      )}
      {traceJob && <AgentTrace trace={ingestAgentTrace(traceJob)} />}
      {!!jobs.length && (
        <div className="ingest-jobs">
          {jobs.slice(0, 4).map((job) => {
            const failure = job.status === "failed" ? ingestFailurePresentation(job) : null;
            return (
              <article className={job.status === "failed" ? "failed" : ""} key={job.id}>
                <div className="ingest-job-summary">
                  <i className={`job-state ${job.status}`} />
                  <span>{job.source}</span>
                  <small>{job.status === "queued" ? "排队中" : job.status === "processing" ? "处理中" : job.status === "completed" ? "已完成" : job.status === "review_required" ? "待审核" : "失败"}</small>
                  {job.status === "review_required" && <button type="button" onClick={() => setReviewJobId(job.id)}>审核</button>}
                  {job.status === "failed" && <button type="button" onClick={() => retry(job.id)}>重试</button>}
                </div>
                {failure && (
                  <div className="ingest-job-error">
                    <strong>{failure.title}</strong>
                    <p>{failure.detail}</p>
                    <small>{failure.suggestion}</small>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {reviewJob && (
        <section className="ingest-review">
          <header>
            <div>
              <strong>知识草稿待审核</strong>
              <span>系统发现部分内容需要重新校验，尚未写入知识库</span>
            </div>
            <button className="icon-button neutral" type="button" title="关闭审核" aria-label="关闭审核" onClick={() => setReviewJobId(false)}><X size={14} /></button>
          </header>
          <div className="review-stats">
            <span><strong>{reviewJob.draft?.nodes?.length || 0}</strong>实体</span>
            <span><strong>{reviewJob.draft?.facts?.length || 0}</strong>事实</span>
            <span><strong>{reviewJob.draft?.links?.length || 0}</strong>关系</span>
            <span className="problem"><strong>{reviewJob.workflow?.issues?.length || 0}</strong>问题</span>
          </div>
          <div className="review-actions">
            <button className="primary" type="button" disabled={Boolean(reviewBusy)} onClick={() => discardInvalid(reviewJob.id)}>
              {reviewBusy === "discard" ? "正在重新校验" : "重新校验并写入有效知识"}
            </button>
            <button className="secondary" type="button" disabled={Boolean(reviewBusy)} onClick={() => retry(reviewJob.id)}>
              {reviewBusy === "retry" ? "重新抽取中" : "仍有问题时重新抽取"}
            </button>
          </div>
          <div className="review-issues">
            {(reviewJob.workflow?.issues || []).slice(0, 8).map((issue, index) => (
              <div key={`${issue.code}-${issue.path}-${index}`}>
                <strong>{knowledgeIssueLabels[issue.code] || "知识结构问题"}</strong>
                <p>{issue.message}</p>
                <small>{knowledgeIssueLocation(issue.path)}</small>
              </div>
            ))}
            {(reviewJob.workflow?.issues?.length || 0) > 8 && (
              <p className="review-issue-summary">
                其余 {reviewJob.workflow.issues.length - 8} 项将在重新校验时一并处理
              </p>
            )}
          </div>
          <div className="review-draft-grid">
            <section>
              <h3>实体</h3>
              {(reviewJob.draft?.nodes || []).map((node) => <span key={node.title}>{node.title}<small>{node.kind}</small></span>)}
            </section>
            <section>
              <h3>事实</h3>
              {(reviewJob.draft?.facts || []).map((fact, index) => <span key={`${fact.statement}-${index}`}>{fact.statement}</span>)}
            </section>
            <section>
              <h3>关系</h3>
              {(reviewJob.draft?.links || []).map((link, index) => <span key={`${link.sourceTitle}-${link.type}-${index}`}>{link.sourceTitle} → {link.targetTitle}<small>{link.type}</small></span>)}
            </section>
          </div>
        </section>
      )}
      {!!files.length && (
        <div className="attachment-row">
          {files.map((file, index) => (
            <button type="button" key={`${file.name}-${index}`} onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>
              <FileText size={14} /><span>{file.name}</span><X size={13} />
            </button>
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={pasteAttachments}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
        }}
        rows="3"
        placeholder="粘贴文字或剪贴板图片，也可以把文件和图片拖到这里..."
      />
      <div className="composer-actions">
        <label className="attach-button" title="添加文件或图片">
          <Paperclip size={18} />
          <input type="file" multiple accept=".txt,.md,.csv,.json,.pdf,.docx,image/*" onChange={(event) => addFiles(event.target.files)} />
        </label>
        <select value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={!profiles.length}>
          {!profiles.length && <option value="">先到设置添加模型</option>}
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.model}</option>)}
        </select>
        <button className="composer-send" type="button" onClick={send} disabled={busy || (!text.trim() && !files.length) || !profileId} aria-label="发送并摄取" title="发送并摄取">
          <ArrowRight size={18} />
        </button>
      </div>
    </section>
  );
}

function InteractionWorkspace({ session, profiles, graph, documents, onKnowledgeChanged, onFocusNode }) {
  const [mode, setMode] = useState("ask");
  const [tool, setTool] = useState("documents");
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [buildingId, setBuildingId] = useState("");
  const [error, setError] = useState("");
  const [agentFiles, setAgentFiles] = useState([]);
  const [agentMode, setAgentMode] = useState("auto");
  const [agentRun, setAgentRun] = useState(null);
  const [agentDragActive, setAgentDragActive] = useState(false);
  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  const canSearchWeb = Boolean(selectedProfile);

  useEffect(() => {
    if (!profiles.length) return;
    if (!profiles.some((profile) => profile.id === profileId)) {
      setProfileId((profiles.find((profile) => profile.isDefault) || profiles[0]).id);
    }
  }, [profiles, profileId]);

  useEffect(() => {
    if (!canSearchWeb) setWebSearch(false);
  }, [canSearchWeb]);

  async function refreshConversations() {
    const payload = await request("/api/conversations", {}, session.token);
    setConversations(payload.conversations);
  }

  useEffect(() => {
    refreshConversations().catch(() => {});
  }, [session.token]);

  async function openConversation(id) {
    setConversationId(id);
    setError("");
    const payload = await request(`/api/conversations/${id}`, {}, session.token);
    setMessages(payload.conversation.messages);
    setMode("ask");
  }

  function newConversation() {
    setConversationId("");
    setMessages([]);
    setQuestion("");
    setError("");
    setMode("ask");
  }

  function addAgentFiles(fileList) {
    const incoming = Array.from(fileList || []);
    const supported = incoming.filter((file) => (
      file.type.startsWith("image/")
      || /\.(txt|md|csv|json|pdf|docx)$/i.test(file.name)
    ));
    const invalid = incoming.find((file) => (
      !supported.includes(file) || file.size > 12 * 1024 * 1024
    ));
    if (invalid) {
      setError(
        invalid.size > 12 * 1024 * 1024
          ? `${invalid.name} 超过 12MB`
          : `不支持 ${invalid.name}，请使用文字、PDF、DOCX 或图片`
      );
    }
    setAgentFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [
        ...current,
        ...supported
          .filter((file) => file.size <= 12 * 1024 * 1024)
          .filter((file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`))
      ].slice(0, 6);
    });
  }

  function pasteAgentAttachments(event) {
    const images = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean)
      .map((file, index) => new File(
        [file],
        `剪贴板图片-${Date.now()}-${index + 1}.${file.type.split("/")[1] || "png"}`,
        { type: file.type, lastModified: Date.now() }
      ));
    if (!images.length) return;
    event.preventDefault();
    addAgentFiles(images);
  }

  async function ingestFromAgent(content, { followUpQuestion = false } = {}) {
    const selectedFiles = [...agentFiles];
    const optimistic = {
      id: `local-ingest-${Date.now()}`,
      role: "user",
      content: content || `摄取 ${selectedFiles.map((file) => file.name).join("、")}`,
      sources: []
    };
    setMessages((current) => [...current, optimistic]);
    setQuestion("");
    setAgentFiles([]);
    setBusy(true);
    setError("");
    setAgentRun(ingestAgentTrace({ status: "queued", fileNames: selectedFiles.map((file) => file.name) }));
    try {
      const form = new FormData();
      form.append("text", followUpQuestion ? "" : content);
      form.append("profileId", profileId);
      form.append("source", selectedFiles.map((file) => file.name).join("、") || "Agent 摄取");
      selectedFiles.forEach((file) => form.append("files", file));
      const payload = await request("/api/ingest/jobs", { method: "POST", body: form }, session.token);
      for (let attempt = 0; attempt < 240; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const jobPayload = await request(`/api/ingest/jobs/${payload.job.id}`, {}, session.token);
        const job = jobPayload.job;
        setAgentRun(ingestAgentTrace(job));
        if (job.status === "completed") {
          await onKnowledgeChanged();
          if (followUpQuestion) {
            setAgentRun(runningResearchTrace(webSearch));
            try {
              const answerPayload = await request("/api/rag/ask", {
                method: "POST",
                body: JSON.stringify({
                  question: content,
                  profileId,
                  conversationId,
                  currentNoteId: job.documentId || "",
                  webSearch,
                  searchContextSize: "medium"
                })
              }, session.token);
              setConversationId(answerPayload.conversationId);
              setMessages((current) => [...current, {
                id: answerPayload.assistantMessageId,
                role: "assistant",
                content: answerPayload.answer,
                sources: answerPayload.sources,
                modelProfileId: profileId,
                webSearch: answerPayload.webSearch?.requested,
                agentTrace: {
                  mode: "file_research",
                  steps: [
                    ...ingestAgentTrace(job).steps,
                    ...(answerPayload.agentTrace?.steps || [])
                  ]
                }
              }]);
              await refreshConversations();
            } catch (questionError) {
              setMessages((current) => [...current, {
                id: `local-result-${job.id}`,
                role: "assistant",
                content: `附件已经摄取并写入 Private，但后续问答失败：${questionError.message}`,
                sources: [],
                agentTrace: ingestAgentTrace(job)
              }]);
            }
            setAgentRun(null);
            return;
          }
          setMessages((current) => [...current, {
            id: `local-result-${job.id}`,
            role: "assistant",
            content: `摄取完成：写入 ${job.result?.nodes || 0} 个实体、${job.result?.facts || 0} 条事实和 ${job.result?.links || 0} 条关系。`,
            sources: [],
            agentTrace: ingestAgentTrace(job)
          }]);
          setAgentRun(null);
          return;
        }
        if (job.status === "review_required") {
          setMessages((current) => [...current, {
            id: `local-review-${job.id}`,
            role: "assistant",
            content: `知识草稿已生成，其中 ${job.workflow?.issues?.length || 0} 项需要审核，尚未写入 Private。`,
            sources: [],
            agentTrace: ingestAgentTrace(job),
            ingestReview: true
          }]);
          setAgentRun(null);
          return;
        }
        if (job.status === "failed") {
          const failure = ingestFailurePresentation(job);
          setMessages((current) => [...current, {
            id: `local-failed-${job.id}`,
            role: "assistant",
            content: `${failure.title}\n${failure.detail}\n${failure.suggestion}`,
            sources: [],
            agentTrace: ingestAgentTrace(job)
          }]);
          setAgentRun(null);
          return;
        }
      }
      setError("摄取仍在后台运行，可在“摄取任务”中继续查看。");
      setAgentRun(null);
    } catch (requestError) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setQuestion(content);
      setAgentFiles(selectedFiles);
      setAgentRun(null);
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  function proposeResearch(content) {
    const topic = researchTopicFromRequest(content);
    setMessages((current) => [
      ...current,
      { id: `local-research-user-${Date.now()}`, role: "user", content, sources: [] },
      {
        id: `local-research-plan-${Date.now()}`,
        role: "assistant",
        content: `准备构建“${topic}”基础知识：\n1. 分别检索定义、职责、选拔任用、教育考核和纪律制度\n2. 打开并读取公开网页正文，优先保留权威来源\n3. 生成带来源引用的研究稿\n4. 调用知识编译 Agent 抽取实体、事实与关系\n5. 通过规则校验后写入 Private；存在问题则进入审核`,
        sources: [],
        researchProposal: { topic, confirmed: false }
      }
    ]);
    setQuestion("");
    setError("");
  }

  async function confirmResearch(message) {
    if (busy || !message.researchProposal?.topic) return;
    const topic = message.researchProposal.topic;
    setMessages((current) => current.map((entry) => (
      entry.id === message.id
        ? { ...entry, researchProposal: { ...entry.researchProposal, confirmed: true } }
        : entry
    )));
    setBusy(true);
    setError("");
    setAgentRun({
      mode: "research_build",
      steps: [
        { id: "multi_search", label: "执行多轮公开检索", status: "active", detail: `正在研究“${topic}”` },
        { id: "read_pages", label: "打开并读取网页", status: "pending", detail: "等待搜索结果" },
        { id: "research_model", label: "调用研究模型", status: "pending", detail: "等待来源正文" },
        { id: "create_ingest", label: "创建知识编译任务", status: "pending", detail: "尚未提交" }
      ]
    });
    try {
      const payload = await request("/api/research/build", {
        method: "POST",
        body: JSON.stringify({ topic, profileId })
      }, session.token);
      const researchTrace = payload.research.agentTrace;
      setAgentRun(researchTrace);
      for (let attempt = 0; attempt < 240; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const jobPayload = await request(`/api/ingest/jobs/${payload.job.id}`, {}, session.token);
        const job = jobPayload.job;
        const combinedTrace = {
          mode: "research_build",
          steps: [...researchTrace.steps, ...ingestAgentTrace(job).steps]
        };
        setAgentRun(combinedTrace);
        if (job.status === "completed") {
          setMessages((current) => [...current, {
            id: `local-research-result-${job.id}`,
            role: "assistant",
            content: `“${topic}”基础知识构建完成：写入 ${job.result?.nodes || 0} 个实体、${job.result?.facts || 0} 条事实和 ${job.result?.links || 0} 条关系。`,
            sources: payload.research.sources,
            agentTrace: combinedTrace
          }]);
          setAgentRun(null);
          await onKnowledgeChanged();
          return;
        }
        if (job.status === "review_required") {
          setMessages((current) => [...current, {
            id: `local-research-review-${job.id}`,
            role: "assistant",
            content: `“${topic}”研究稿和知识草稿已经生成，${job.workflow?.issues?.length || 0} 项需要审核，尚未写入 Private。`,
            sources: payload.research.sources,
            agentTrace: combinedTrace,
            ingestReview: true
          }]);
          setAgentRun(null);
          return;
        }
        if (job.status === "failed") {
          const failure = ingestFailurePresentation(job);
          setMessages((current) => [...current, {
            id: `local-research-failed-${job.id}`,
            role: "assistant",
            content: `${failure.title}\n${failure.detail}\n${failure.suggestion}`,
            sources: payload.research.sources,
            agentTrace: combinedTrace
          }]);
          setAgentRun(null);
          return;
        }
      }
      setError("研究任务仍在后台运行，可在“摄取任务”中继续查看。");
      setAgentRun(null);
    } catch (requestError) {
      setMessages((current) => current.map((entry) => (
        entry.id === message.id
          ? { ...entry, researchProposal: { ...entry.researchProposal, confirmed: false } }
          : entry
      )));
      setAgentRun(null);
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  function submitAgent() {
    const content = question.trim();
    if ((!content && !agentFiles.length) || !profileId || busy) return;
    const action = chooseAgentAction(content, agentFiles, agentMode);
    if (action === "ask" && agentFiles.length) {
      setError("问答模式不会忽略附件。请选择“自动”或“摄取”，先把附件加入知识库。");
      return;
    }
    if (action === "ingest") {
      ingestFromAgent(content, {
        followUpQuestion: agentMode === "auto" && agentFiles.length > 0 && looksLikeAttachmentQuestion(content)
      });
      return;
    }
    if (action === "research_build") {
      proposeResearch(content);
      return;
    }
    ask();
  }

  async function ask() {
    const content = question.trim();
    if (!content || !profileId || busy) return;
    const optimistic = { id: `local-${Date.now()}`, role: "user", content, sources: [] };
    setMessages((current) => [...current, optimistic]);
    setQuestion("");
    setBusy(true);
    setError("");
    try {
      const payload = await request("/api/rag/ask", {
        method: "POST",
        body: JSON.stringify({
          question: content,
          profileId,
          conversationId,
          webSearch,
          searchContextSize: "medium"
        })
      }, session.token);
      setConversationId(payload.conversationId);
      setMessages((current) => [...current, {
        id: payload.assistantMessageId,
        role: "assistant",
        content: payload.answer,
        sources: payload.sources,
        modelProfileId: profileId,
        webSearch: payload.webSearch?.requested,
        agentTrace: payload.agentTrace
      }]);
      await refreshConversations();
    } catch (requestError) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setQuestion(content);
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function buildKnowledge(message) {
    if (buildingId) return;
    setBuildingId(message.id);
    setError("");
    try {
      await request(`/api/messages/${message.id}/build-knowledge`, {
        method: "POST",
        body: JSON.stringify({ profileId })
      }, session.token);
      setMode("capture");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBuildingId("");
    }
  }

  function citedContent(message) {
    const citations = (message.sources || [])
      .filter((source) => source.type === "web" && source.url)
      .flatMap((source) => (source.citations || []).map((citation) => ({ ...citation, source })))
      .sort((a, b) => a.startIndex - b.startIndex);
    if (!citations.length) {
      const webSources = new Map(
        (message.sources || [])
          .filter((source) => source.type === "web" && source.url)
          .map((source) => [source.ref, source])
      );
      if (!webSources.size) return message.content;
      return message.content.split(/(\[W\d+\])/g).map((part, index) => {
        const source = webSources.get(part.slice(1, -1));
        return source ? (
          <a
            className="inline-citation"
            href={source.url}
            key={`${source.ref}-${index}`}
            target="_blank"
            rel="noreferrer"
            title={source.title}
          >
            {part}
          </a>
        ) : part;
      });
    }
    const parts = [];
    let cursor = 0;
    for (const citation of citations) {
      if (citation.startIndex < cursor || citation.endIndex > message.content.length) continue;
      if (citation.startIndex > cursor) parts.push(message.content.slice(cursor, citation.startIndex));
      parts.push(
        <a
          className="inline-citation"
          href={citation.source.url}
          key={`${citation.source.ref}-${citation.startIndex}`}
          target="_blank"
          rel="noreferrer"
          title={citation.source.title}
        >
          {message.content.slice(citation.startIndex, citation.endIndex)}
        </a>
      );
      cursor = citation.endIndex;
    }
    if (cursor < message.content.length) parts.push(message.content.slice(cursor));
    return parts;
  }

  return (
    <section className="interaction-workspace">
      <aside className="conversation-index">
        <header>
          <strong>对话</strong>
          <button className="icon-button neutral" type="button" title="新对话" aria-label="新对话" onClick={newConversation}>
            <Plus size={15} />
          </button>
        </header>
        <div>
          {conversations.map((conversation) => (
            <button className={conversation.id === conversationId ? "active" : ""} type="button" key={conversation.id} onClick={() => openConversation(conversation.id)}>
              <MessageSquare size={14} />
              <span>{conversation.title}</span>
              <small>{conversation.messageCount}</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="interaction-main">
        <header className="interaction-header">
          <div>
            <MessageSquare size={18} />
            <strong>知识交互</strong>
          </div>
          <div className="segmented" aria-label="交互模式">
            <button className={mode === "ask" ? "active" : ""} type="button" onClick={() => setMode("ask")}>Agent</button>
            <button className={mode === "capture" ? "active" : ""} type="button" onClick={() => setMode("capture")}>摄取任务</button>
          </div>
        </header>

        {mode === "ask" ? (
          <>
            <div className="conversation-stream">
              {!messages.length && (
                <div className="conversation-empty">
                  <Network size={34} />
                  <h1>今天要研究什么？</h1>
                </div>
              )}
              {messages.map((message) => (
                <article className={`conversation-message ${message.role}`} key={message.id}>
                  <div className="message-role">{message.role === "user" ? <Avatar user={session.user} size={28} /> : <Network size={17} />}</div>
                  <div>
                    <p>{citedContent(message)}</p>
                    {message.role === "assistant" && <AgentTrace trace={message.agentTrace} />}
                    {!!message.sources?.length && (
                      <div className="message-sources">
                        {message.sources.map((source) => source.type === "web" ? (
                          <a href={source.url} target="_blank" rel="noreferrer" key={`${message.id}-${source.ref}-${source.url}`}>
                            [{source.ref}] {source.title}
                          </a>
                        ) : (
                          <button type="button" key={`${message.id}-${source.ref}-${source.chunkId}`} onClick={() => source.documentId && onFocusNode(source.documentId)}>
                            [{source.ref}] {source.documentTitle}
                          </button>
                        ))}
                      </div>
                    )}
                    {canBuildKnowledgeFromMessage(message) && (
                      <div className="message-actions">
                        <button type="button" onClick={() => buildKnowledge(message)} disabled={Boolean(buildingId)}>
                          <Database size={13} />
                          {buildingId === message.id ? "正在创建摄取任务" : "构建基础知识（消耗 Token）"}
                        </button>
                      </div>
                    )}
                    {message.ingestReview && (
                      <div className="message-actions">
                        <button type="button" onClick={() => setMode("capture")}>
                          <Braces size={13} />
                          打开知识审核
                        </button>
                      </div>
                    )}
                    {message.researchProposal && !message.researchProposal.confirmed && !message.researchProposal.cancelled && (
                      <div className="message-actions">
                        <button type="button" onClick={() => confirmResearch(message)} disabled={busy}>
                          <Search size={13} />
                          确认并构建（消耗 Token）
                        </button>
                        <button
                          type="button"
                          onClick={() => setMessages((current) => current.map((entry) => (
                            entry.id === message.id
                              ? { ...entry, researchProposal: { ...entry.researchProposal, cancelled: true } }
                              : entry
                          )))}
                          disabled={busy}
                        >
                          <X size={13} />
                          取消
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {busy && (
                <div className="conversation-agent-running">
                  <AgentTrace trace={agentRun || runningResearchTrace(webSearch)} />
                </div>
              )}
            </div>
            <div
              className={`conversation-composer ${agentDragActive ? "drag-active" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setAgentDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (event.currentTarget === event.target) setAgentDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setAgentDragActive(false);
                addAgentFiles(event.dataTransfer.files);
              }}
            >
              {agentDragActive && <div className="drop-target"><Files size={20} />释放后由 Agent 摄取</div>}
              {error && <div className="form-error">{error}</div>}
              {!!agentFiles.length && (
                <div className="attachment-row">
                  {agentFiles.map((file, index) => (
                    <button type="button" key={`${file.name}-${index}`} onClick={() => setAgentFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>
                      <FileText size={14} /><span>{file.name}</span><X size={13} />
                    </button>
                  ))}
                </div>
              )}
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onPaste={pasteAgentAttachments}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitAgent();
                  }
                }}
                rows="3"
                placeholder="提问、粘贴资料，或拖入文件与图片..."
              />
              <div>
                <div className="composer-options">
                  <label className="attach-button" title="添加文件或图片">
                    <Paperclip size={16} />
                    <input type="file" multiple accept=".txt,.md,.csv,.json,.pdf,.docx,image/*" onChange={(event) => addAgentFiles(event.target.files)} />
                  </label>
                  <select className="agent-mode-select" value={agentMode} onChange={(event) => setAgentMode(event.target.value)} title="Agent 动作">
                    <option value="auto">自动判断</option>
                    <option value="ask">仅问答</option>
                    <option value="ingest">摄取知识</option>
                  </select>
                  <select value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={!profiles.length}>
                    {!profiles.length && <option value="">先到设置添加模型</option>}
                    {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.model}</option>)}
                  </select>
                  <button
                    className={`web-search-toggle ${webSearch ? "active" : ""}`}
                    type="button"
                    onClick={() => setWebSearch((current) => !current)}
                    disabled={!canSearchWeb}
                    title={canSearchWeb ? "使用平台互联网检索" : "请先选择模型"}
                    aria-pressed={webSearch}
                  >
                    <Globe2 size={14} /> 互联网
                  </button>
                </div>
                <button className="composer-send" type="button" onClick={submitAgent} disabled={busy || (!question.trim() && !agentFiles.length) || !profileId} title="执行" aria-label="执行">
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="capture-workspace">
            <IngestComposer session={session} profiles={profiles} onComplete={onKnowledgeChanged} />
          </div>
        )}
      </main>

      <aside className="interaction-tools">
        <nav>
          <button className={tool === "documents" ? "active" : ""} type="button" title="资料库" aria-label="资料库" onClick={() => setTool("documents")}><Files size={17} /></button>
          <button className={tool === "entity" ? "active" : ""} type="button" title="手动补充" aria-label="手动补充" onClick={() => setTool("entity")}><Plus size={17} /></button>
          <button className={tool === "relation" ? "active" : ""} type="button" title="建立关联" aria-label="建立关联" onClick={() => setTool("relation")}><Link2 size={17} /></button>
        </nav>
        {tool === "documents" && <DocumentPanel session={session} documents={documents.documents} loading={documents.loading} />}
        {tool === "entity" && <ItemForm items={graph.nodes} onCreated={onKnowledgeChanged} token={session.token} />}
        {tool === "relation" && <LinkForm items={graph.nodes} selectedId="" onCreated={onKnowledgeChanged} token={session.token} />}
      </aside>
    </section>
  );
}

function FactWiki({ session, query, onAxiomCreated, onStartBuild }) {
  const factsState = useFacts(session.token, query);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState("");
  const [publish, setPublish] = useState({ title: "", statement: "" });
  const selected = factsState.facts.find((fact) => fact.id === selectedId) || factsState.facts[0];

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    setSelectedId(selected.id);
    request(`/api/facts/${selected.id}`, {}, session.token)
      .then((payload) => setDetail(payload.fact))
      .catch(() => setDetail(selected));
  }, [selected?.id, session.token]);

  async function setStatus(status) {
    setBusy("status");
    await request(`/api/facts/${selected.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    }, session.token);
    await factsState.refresh();
    setBusy("");
  }

  async function createAxiom(event) {
    event.preventDefault();
    setBusy("publish");
    try {
      const payload = await request("/api/axioms", {
        method: "POST",
        body: JSON.stringify({ factIds: [selected.id], ...publish })
      }, session.token);
      setPublish({ title: "", statement: "" });
      onAxiomCreated(payload.axiom.id);
    } finally {
      setBusy("");
    }
  }

  if (!factsState.loading && !factsState.facts.length) {
    return (
      <section className="fact-empty-workspace">
        <header>
          <span className="fact-empty-kicker"><FileText size={15} /> 事实与证据</span>
          <h1>事实不需要手工创建</h1>
          <p>把文字、文件、图片或研究主题交给 Agent。系统会抽取能够在原始资料中定位的陈述，并把来源、原文证据和关联实体一起保存到这里。</p>
          <button className="primary fact-empty-action" type="button" onClick={onStartBuild}>
            <MessageSquare size={17} /> 在对话中建立第一条事实
          </button>
        </header>

        <div className="fact-empty-flow" aria-label="事实形成流程">
          <section>
            <small>01 / 提供材料</small>
            <h2>告诉 Agent 你要研究什么</h2>
            <p>直接粘贴文字、拖入文件或图片，也可以让 Agent 从互联网研究一个主题。</p>
          </section>
          <section>
            <small>02 / 自动编译</small>
            <h2>系统抽取可验证陈述</h2>
            <p>每条事实必须保留原文证据和来源；推测、建议和无法定位的内容不会混入事实。</p>
          </section>
          <section>
            <small>03 / 人工判断</small>
            <h2>你只需审核与使用</h2>
            <p>确认或质疑事实、查看关联页面，并把证据充分的事实提升为公共公理。</p>
          </section>
        </div>

        <footer className="fact-empty-definition">
          <Quote size={18} />
          <div>
            <strong>这里保存的不是普通笔记</strong>
            <p>事实是可以被来源直接支持的最小陈述。它为图中的实体和关系提供证据，也是形成公理的基础。</p>
          </div>
        </footer>
      </section>
    );
  }

  return (
    <section className="wiki-layout">
      <aside className="wiki-index">
        <div className="wiki-index-head"><span>事实索引</span><strong>{factsState.facts.length}</strong></div>
        {factsState.loading && <div className="wiki-placeholder">正在读取事实</div>}
        <div className="wiki-list">
          {factsState.facts.map((fact, index) => (
            <button className={selected?.id === fact.id ? "active" : ""} type="button" key={fact.id} onClick={() => setSelectedId(fact.id)}>
              <small>F-{String(index + 1).padStart(4, "0")}</small>
              <span>{fact.statement}</span>
              <i className={`fact-dot ${fact.status}`} />
            </button>
          ))}
        </div>
      </aside>
      <article className="wiki-article">
        {!selected ? (
          <div className="wiki-empty"><FileText size={30} /><h2>正在准备事实</h2><p>完成后将在这里显示证据。</p></div>
        ) : (
          <>
            <div className="wiki-breadcrumb">事实 / {detail?.documentTitle || selected.documentTitle || "未命名来源"}</div>
            <h1>{detail?.statement || selected.statement}</h1>
            <div className="wiki-meta">
              <span className={`wiki-status ${detail?.status || selected.status}`}>{factStatusLabels[detail?.status || selected.status]}</span>
              <span>置信度 {Math.round((detail?.confidence || selected.confidence) * 100)}%</span>
              <span>{new Date(detail?.createdAt || selected.createdAt).toLocaleDateString()}</span>
            </div>
            <section className="wiki-section">
              <h2>原文证据</h2>
              <blockquote>{detail?.quote || selected.quote}</blockquote>
            </section>
            {detail?.source && (
              <section className="wiki-section">
                <h2>来源上下文</h2>
                <p className="wiki-source-text">{detail.source.chunkText}</p>
              </section>
            )}
            {!!detail?.entities?.length && (
              <section className="wiki-section">
                <h2>关联页面</h2>
                <div className="wiki-links">{detail.entities.map((entity) => <span key={entity.id}>[[{entity.title}]]</span>)}</div>
              </section>
            )}
          </>
        )}
      </article>
      <aside className="wiki-context">
        {selected && (
          <>
            <h2>事实状态</h2>
            <select value={detail?.status || selected.status} onChange={(event) => setStatus(event.target.value)} disabled={busy === "status"}>
              {Object.entries(factStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <div className="wiki-rule" />
            <h2>提升为公理</h2>
            <form className="stack" onSubmit={createAxiom}>
              <label>标题<input value={publish.title} onChange={(event) => setPublish({ ...publish, title: event.target.value })} required /></label>
              <label>命题<textarea rows="6" minLength="10" value={publish.statement} onChange={(event) => setPublish({ ...publish, statement: event.target.value })} required /></label>
              <button className="primary" type="submit" disabled={busy === "publish"}><Scale size={16} /> 发布公理</button>
            </form>
          </>
        )}
      </aside>
    </section>
  );
}

function AxiomWiki({ session, query, initialId }) {
  const axiomsState = useAxioms(session.token, query);
  const [selectedId, setSelectedId] = useState(initialId || "");
  const selectedAxiom = axiomsState.axioms.find((axiom) => axiom.id === selectedId) || axiomsState.axioms[0];
  useEffect(() => {
    if (initialId) setSelectedId(initialId);
  }, [initialId]);
  const selected = selectedAxiom ? {
    id: selectedAxiom.id,
    kind: "Axiom",
    title: selectedAxiom.title,
    summary: selectedAxiom.statement,
    axiom: selectedAxiom
  } : null;
  return (
    <section className="wiki-layout axiom-wiki">
      <aside className="wiki-index">
        <div className="wiki-index-head"><span>公共公理</span><strong>{axiomsState.axioms.length}</strong></div>
        {!axiomsState.loading && !axiomsState.axioms.length && <div className="wiki-placeholder">还没有公开公理。</div>}
        <div className="wiki-list">
          {axiomsState.axioms.map((axiom, index) => (
            <button className={selected?.id === axiom.id ? "active" : ""} type="button" key={axiom.id} onClick={() => setSelectedId(axiom.id)}>
              <small>A-{String(index + 1).padStart(4, "0")}</small>
              <span>{axiom.title}</span>
              <i className={`fact-dot ${axiom.status}`} />
            </button>
          ))}
        </div>
      </aside>
      <PublicDetailPanel session={session} selected={selected} onRefresh={axiomsState.refresh} />
    </section>
  );
}

function SettingsPage({ session, profiles, profileError, refreshProfiles }) {
  return (
    <section className="settings-layout">
      <header className="settings-heading"><Settings size={22} /><div><h1>设置</h1><p>模型配置与 Token 账户。</p></div></header>
      <div className="settings-grid">
        <TokenAccountPanel session={session} />
        <ModelProfilePanel session={session} profiles={profiles} onChanged={refreshProfiles} />
        {profileError && <div className="form-error">{profileError}</div>}
      </div>
    </section>
  );
}

function TokenAccountPanel({ session }) {
  const [account, setAccount] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      request("/api/token/account", {}, session.token),
      request("/api/token/usage?limit=8", {}, session.token)
    ])
      .then(([accountPayload, usagePayload]) => {
        setAccount(accountPayload.account);
        setEvents(usagePayload.events);
      })
      .catch((requestError) => setError(requestError.message));
  }, [session.token]);

  const number = new Intl.NumberFormat("zh-CN");
  return (
    <section className="panel stack">
      <div className="panel-heading"><Activity size={18} /><span>Token 账户</span></div>
      {account && (
        <>
          <div className="token-account-summary">
            <div><span>可用</span><strong>{number.format(account.available_tokens)}</strong></div>
            <div><span>已结算</span><strong>{number.format(account.consumed_tokens)}</strong></div>
            <div><span>预占</span><strong>{number.format(account.reserved_tokens)}</strong></div>
          </div>
          <div className="microcopy">月额度 {number.format(account.monthly_quota)} · {new Date(account.reset_at).toLocaleDateString("zh-CN")} 重置</div>
        </>
      )}
      <div className="token-event-list">
        {events.map((event) => (
          <div key={event.id}>
            <span>{event.operation} · {event.model}</span>
            <strong>{number.format(Number(event.input_tokens) + Number(event.output_tokens))}</strong>
          </div>
        ))}
      </div>
      {error && <div className="form-error">{error}</div>}
    </section>
  );
}

function NotificationMenu({ session, onOpenAxiom }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);

  async function refresh() {
    const payload = await request("/api/notifications", {}, session.token);
    setNotifications(payload.notifications);
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, [session.token]);

  async function openNotification(notification) {
    if (!notification.read) {
      await request(`/api/notifications/${notification.id}/read`, { method: "POST" }, session.token);
    }
    setOpen(false);
    onOpenAxiom(notification.entityId);
    await refresh();
  }

  const unread = notifications.filter((notification) => !notification.read).length;
  return (
    <div className="notification-menu">
      <button className="icon-button" type="button" aria-label="通知" title="通知" onClick={() => {
        setOpen((current) => !current);
        refresh().catch(() => {});
      }}>
        <Bell size={17} />
        {unread > 0 && <i>{Math.min(unread, 99)}</i>}
      </button>
      {open && (
        <div className="notification-popover">
          <strong>通知</strong>
          {!notifications.length && <p>暂无通知</p>}
          {notifications.slice(0, 10).map((notification) => (
            <button className={notification.read ? "" : "unread"} type="button" key={notification.id} onClick={() => openNotification(notification)}>
              <span>{notification.title}</span>
              <small>{notification.body}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const [session, setSession] = useState(readSession);
  const [entry, setEntry] = useState(() => new URLSearchParams(window.location.search).has("verify") ? "login" : "home");
  const [activeView, setActiveView] = useState("chat");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [activeAxiomId, setActiveAxiomId] = useState("");
  const [graphSpace, setGraphSpace] = useState("private");
  const [graphOptions, setGraphOptions] = useState({ scope: "global", depth: 1, kind: "" });
  const privateGraph = useGraphData(query, session?.token, {
    ...graphOptions,
    centerId: selectedId
  });
  const publicGraph = usePublicGraph(session?.token);
  const activeGraph = graphSpace === "public" ? publicGraph : privateGraph;
  const { loading, error, nodes, links } = activeGraph;
  const refresh = privateGraph.refresh;
  const { profiles, error: profileError, refresh: refreshProfiles } = useModelProfiles(session?.token);
  const selected = nodes.find((node) => node.id === selectedId) || nodes[0] || null;
  const references = useReferences(graphSpace === "private" ? selected?.id : "", session?.token);
  const evidenceState = useEvidence(graphSpace === "private" ? selected?.id : "", session?.token);
  const documentState = useDocuments(session?.token);

  useEffect(() => {
    if (!selectedId && nodes[0]) setSelectedId(nodes[0].id);
  }, [nodes, selectedId]);

  if (!session?.token) {
    if (entry === "home") return <HomePage onEnter={() => setEntry("login")} />;
    return <LoginScreen onLogin={setSession} onBack={() => setEntry("home")} />;
  }

  async function deleteItem(id) {
    await request(`/api/items/${id}`, { method: "DELETE" }, session.token);
    setSelectedId("");
    refresh();
  }

  async function deleteLink(id) {
    await request(`/api/links/${id}`, { method: "DELETE" }, session.token);
    refresh();
  }

  async function saveItem(id, input) {
    await request(`/api/items/${id}`, { method: "PATCH", body: JSON.stringify(input) }, session.token);
    await refresh();
  }

  function logout() {
    localStorage.removeItem(sessionKey);
    setSession(null);
    setEntry("home");
  }

  async function publishAxiom(sourceItemId, input) {
    const payload = await request("/api/axioms", {
      method: "POST",
      body: JSON.stringify({ sourceItemId, ...input })
    }, session.token);
    await publicGraph.refresh();
    setActiveAxiomId(payload.axiom.id);
    setActiveView("axioms");
  }

  function openAxiom(id) {
    setActiveAxiomId(id);
    setActiveView("axioms");
  }

  return (
    <main className="app-shell">
      <header className="product-bar">
        <button className="product-brand" type="button" onClick={() => setActiveView("chat")}>
          <Network size={21} />
          <strong>超级大脑</strong>
        </button>
        <nav className="product-tabs" aria-label="主工作区">
          <button className={activeView === "chat" ? "active" : ""} type="button" onClick={() => setActiveView("chat")}><MessageSquare size={16} /><span>对话</span></button>
          <button className={activeView === "graph" ? "active" : ""} type="button" onClick={() => setActiveView("graph")}><Network size={16} /><span>图</span></button>
          <button className={activeView === "axioms" ? "active" : ""} type="button" onClick={() => setActiveView("axioms")}><Scale size={16} /><span>公理</span></button>
          <button className={activeView === "facts" ? "active" : ""} type="button" onClick={() => setActiveView("facts")}><FileText size={16} /><span>事实</span></button>
        </nav>
        <div className="product-actions">
          {!["settings", "account", "chat"].includes(activeView) && (
            <label className="compact-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${activeView === "graph" ? "图谱" : activeView === "facts" ? "事实" : "公理"}`} />
            </label>
          )}
          <NotificationMenu session={session} onOpenAxiom={openAxiom} />
          <button className={activeView === "settings" ? "icon-button active" : "icon-button"} type="button" aria-label="设置" title="设置" onClick={() => setActiveView("settings")}><Settings size={17} /></button>
          <AccountMenu session={session} active={activeView === "account"} onOpen={() => setActiveView("account")} />
        </div>
      </header>

      {activeView === "chat" && (
        <InteractionWorkspace
          session={session}
          profiles={profiles}
          graph={privateGraph}
          documents={documentState}
          onKnowledgeChanged={async () => {
            await Promise.all([privateGraph.refresh(), documentState.refresh()]);
          }}
          onFocusNode={(id) => {
            setSelectedId(id);
            setGraphSpace("private");
            setActiveView("graph");
          }}
        />
      )}
      {activeView === "graph" && (
        <section className="graph-workspace">
          <section className="graph-panel">
          <div className="graph-toolbar">
            <div className="graph-title">
              {graphSpace === "public" ? <Globe2 size={18} /> : <Database size={18} />}
              <span>{graphSpace === "public" ? "公共实体关系图" : graphOptions.scope === "local" ? "私有局部实体图" : "私有三维实体图"}</span>
            </div>
            <div className="graph-view-controls">
              <div className="segmented space-switch" aria-label="图谱空间">
                <button className={graphSpace === "private" ? "active" : ""} type="button" onClick={() => setGraphSpace("private")}>私有</button>
                <button className={graphSpace === "public" ? "active" : ""} type="button" onClick={() => setGraphSpace("public")}>公共</button>
              </div>
              {graphSpace === "private" && (
                <>
                  <div className="segmented" aria-label="图谱范围">
                    <button className={graphOptions.scope === "global" ? "active" : ""} type="button" onClick={() => setGraphOptions((current) => ({ ...current, scope: "global" }))}>全局</button>
                    <button className={graphOptions.scope === "local" ? "active" : ""} type="button" disabled={!selectedId} onClick={() => setGraphOptions((current) => ({ ...current, scope: "local" }))}>局部</button>
                  </div>
                  {graphOptions.scope === "local" && (
                    <label className="inline-control">
                      深度
                      <select value={graphOptions.depth} onChange={(event) => setGraphOptions((current) => ({ ...current, depth: Number(event.target.value) }))}>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                      </select>
                    </label>
                  )}
                  <label className="inline-control">
                    类型
                    <select value={graphOptions.kind} onChange={(event) => setGraphOptions((current) => ({ ...current, kind: event.target.value }))}>
                      <option value="">全部</option>
                      {kinds.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
                    </select>
                  </label>
                </>
              )}
            </div>
            {error && <strong className="error-text">{error}</strong>}
            {loading && <strong className="loading-text">同步中</strong>}
          </div>
          {nodes.length === 0 && !loading ? (
            <div className="graph-empty">
              <h2>{graphSpace === "public" ? "还没有公共实体" : "还没有实体节点"}</h2>
              <p>{graphSpace === "public" ? "发布事实后，其中具有稳定身份的名词对象会进入公共实体图；事实和公理保留在各自页面。" : "在对话中提供资料，系统会抽取名词实体及其关系。"}</p>
            </div>
          ) : (
            <React.Suspense fallback={<div className="graph-loading">正在加载 3D 引擎</div>}>
              <GraphCanvas nodes={nodes} links={links} selectedId={selected?.id} onSelect={setSelectedId} />
            </React.Suspense>
          )}
          </section>

          {graphSpace === "public" ? (
            <PublicDetailPanel
              session={session}
              selected={selected}
              nodes={nodes}
              links={links}
              onSelect={setSelectedId}
              onRefresh={publicGraph.refresh}
            />
          ) : (
            <DetailPanel
              selected={selected}
              links={links}
              items={nodes}
              mentions={references.mentions}
              referencesLoading={references.loading}
              evidence={evidenceState.evidence}
              evidenceLoading={evidenceState.loading}
              onSelect={setSelectedId}
              onSave={saveItem}
              onPublish={publishAxiom}
              onDeleteItem={deleteItem}
              onDeleteLink={deleteLink}
            />
          )}
        </section>
      )}
      {activeView === "facts" && (
        <FactWiki
          session={session}
          query={query}
          onAxiomCreated={openAxiom}
          onStartBuild={() => setActiveView("chat")}
        />
      )}
      {activeView === "axioms" && <AxiomWiki session={session} query={query} initialId={activeAxiomId} />}
      {activeView === "settings" && (
        <SettingsPage
          session={session}
          profiles={profiles}
          profileError={profileError}
          refreshProfiles={refreshProfiles}
        />
      )}
      {activeView === "account" && (
        <UserCenterPage session={session} onSessionUpdate={setSession} onLogout={logout} />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
