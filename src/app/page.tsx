"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatMessage, ChatMode, ChatSession } from "@/lib/ai/types";
import type {
  AgentStreamEvent,
  RunContextEventPayload,
  ToolCallRecord,
} from "@/lib/ai/stream-types";

const ACTIVE_SESSION_STORAGE_KEY = "ai-agent-active-session-id";

type RequestStatus = "idle" | "loading" | "error" | "cancelled";

function createMessage(
  role: ChatMessage["role"],
  content: string,
  toolCalls?: ToolCallRecord[],
  runContext?: RunContextEventPayload
): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
    toolCalls,
    runContext,
  };
}

function generateSessionTitle(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return "新对话";
  }
  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
}

function formatToolValue(value: unknown) {
  if (value === undefined) {
    return "无";
  }
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function getFileSignature(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function getFileTypeLabel(file: File) {
  if (isImageFile(file)) return "图片";
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "PDF";
  if (name.endsWith(".md")) return "Markdown";
  if (name.endsWith(".txt")) return "TXT";
  if (name.endsWith(".json")) return "JSON";
  if (name.endsWith(".csv")) return "CSV";
  if (name.endsWith(".doc") || name.endsWith(".docx")) return "Word";
  return "文件";
}

function upsertToolCallRecord(
  records: ToolCallRecord[],
  nextRecord: ToolCallRecord
) {
  const index = records.findIndex((item) => item.id === nextRecord.id);
  if (index === -1) {
    return [...records, nextRecord];
  }
  const next = [...records];
  next[index] = nextRecord;
  return next;
}

function buildRequestInit(params: {
  message: string;
  sessionId: string;
  mode: ChatMode;
  files: File[];
  signal: AbortSignal;
}) {
  const { message, sessionId, mode, files, signal } = params;

  if (files.length === 0) {
    return {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        sessionId,
        mode,
      }),
      signal,
    } satisfies RequestInit;
  }

  const formData = new FormData();
  formData.append("message", message);
  formData.append("sessionId", sessionId);
  formData.append("mode", mode);
  files.forEach((file) => formData.append("files", file));

  return {
    method: "POST",
    body: formData,
    signal,
  } satisfies RequestInit;
}

function SessionItem({
  session,
  active,
  onClick,
}: {
  session: ChatSession;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
        active
          ? "border-orange-300 bg-orange-50 shadow-sm"
          : "border-orange-100 bg-white hover:border-orange-200 hover:bg-orange-50/60"
      }`}
    >
      <div className="truncate text-sm font-semibold text-amber-950">
        {session.title}
      </div>
      <div className="mt-1 text-xs text-amber-600">
        {session.messageCount ?? session.messages.length} 条消息
      </div>
    </button>
  );
}

function ToolCallList({ toolCalls }: { toolCalls: ToolCallRecord[] }) {
  if (toolCalls.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-orange-200 bg-orange-50/80 p-3">
      <div className="text-xs font-semibold tracking-wide text-orange-700">
        工具调用过程
      </div>
      {toolCalls.map((toolCall) => (
        <details
          key={toolCall.id}
          className="rounded-xl border border-orange-100 bg-white p-2.5 text-xs text-amber-900"
        >
          <summary className="cursor-pointer list-none">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">{toolCall.toolName}</div>
                <div className="mt-1 text-[11px] text-amber-700">
                  {toolCall.status === "running"
                    ? "执行中"
                    : toolCall.status === "success"
                    ? "成功"
                    : "失败"}
                </div>
              </div>
              <span className="rounded-full bg-orange-100 px-2 py-1 text-[11px] text-orange-700">
                查看详情
              </span>
            </div>
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <div className="font-semibold">参数</div>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-xl bg-orange-50 p-2">
                {formatToolValue(toolCall.args)}
              </pre>
            </div>
            {toolCall.error && (
              <div className="rounded-xl bg-red-50 p-2 text-red-600">
                {toolCall.error}
              </div>
            )}
            <div>
              <div className="font-semibold">结果</div>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-xl bg-orange-50 p-2">
                {formatToolValue(toolCall.result)}
              </pre>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

function RunContextCard({ context }: { context: RunContextEventPayload }) {
  return (
    <div className="mb-2 rounded-2xl border border-sky-200 bg-sky-50/80 p-2.5 text-xs text-slate-800">
      <div className="text-xs font-semibold tracking-wide text-sky-700">
        Agent Runtime
      </div>
      <div className="mt-2 grid gap-1.5 md:grid-cols-2">
        <div className="rounded-xl bg-white/80 p-2">
          <div className="font-semibold text-slate-700">Mode</div>
          <div className="mt-1 text-slate-900">{context.mode}</div>
        </div>
        <div className="rounded-xl bg-white/80 p-2">
          <div className="font-semibold text-slate-700">Route</div>
          <div className="mt-1 break-words text-slate-900">
            {context.plannedRoute}
          </div>
        </div>
        <div className="rounded-xl bg-white/80 p-2">
          <div className="font-semibold text-slate-700">Skills</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {context.activeSkillIds.length > 0 ? (
              context.activeSkillIds.map((item) => (
                <span
                  key={item}
                  className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700"
                >
                  {item}
                </span>
              ))
            ) : (
              <span className="text-slate-500">none</span>
            )}
          </div>
        </div>
        <div className="rounded-xl bg-white/80 p-2">
          <div className="font-semibold text-slate-700">MCP Servers</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {context.activeMcpServerIds.length > 0 ? (
              context.activeMcpServerIds.map((item) => (
                <span
                  key={item}
                  className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700"
                >
                  {item}
                </span>
              ))
            ) : (
              <span className="text-slate-500">none</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-1.5 rounded-xl bg-white/80 p-2">
        <div className="font-semibold text-slate-700">Harness Checks</div>
        <div className="mt-1 space-y-1">
          {context.checks.map((check) => (
            <div key={check.name} className="rounded-lg bg-slate-50 px-2 py-1">
              <span className="font-medium text-slate-900">{check.name}</span>
              <span className="ml-1 text-slate-600">{check.expectation}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AssistantContent({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  if (streaming) {
    return (
      <pre className="whitespace-pre-wrap text-sm font-sans text-amber-900">
        {text}
      </pre>
    );
  }

  return (
    <div className="prose prose-sm max-w-none prose-p:leading-7 prose-pre:rounded-xl">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-3xl px-4 py-3 shadow-sm ${
          isUser
            ? "bg-orange-500 text-white"
            : "border border-orange-200 bg-white text-amber-900"
        }`}
      >
        <div className="mb-2 text-xs opacity-75">
          {isUser ? "你" : "AI 助手"}
        </div>

        {!isUser && message.runContext && (
          <RunContextCard context={message.runContext} />
        )}
        {!isUser && <ToolCallList toolCalls={message.toolCalls ?? []} />}

        {isUser ? (
          <pre className="whitespace-pre-wrap text-sm font-sans">
            {message.content}
          </pre>
        ) : (
          <AssistantContent text={message.content} streaming={streaming} />
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [requestStatus, setRequestStatus] = useState<RequestStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null
  );
  const [mode, setMode] = useState<ChatMode>("default");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [imagePreviewMap, setImagePreviewMap] = useState<Record<string, string>>(
    {}
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const hasHydratedRef = useRef(false);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  const activeMessages = useMemo(
    () => activeSession?.messages ?? [],
    [activeSession]
  );
  const isRequesting = requestStatus === "loading";

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    const response = await fetch(`/api/sessions/${sessionId}/messages`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Failed to load session messages");
    }

    const data = (await response.json()) as { messages: ChatMessage[] };

    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: data.messages,
              messageCount: data.messages.length,
            }
          : session
      )
    );
  }, []);

  const loadSessions = useCallback(async () => {
    const response = await fetch("/api/sessions", { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Failed to load sessions");
    }

    const data = (await response.json()) as { sessions: ChatSession[] };
    let nextSessions = data.sessions;

    if (nextSessions.length === 0) {
      const createResponse = await fetch("/api/sessions", { method: "POST" });

      if (!createResponse.ok) {
        throw new Error("Failed to create initial session");
      }

      const created = (await createResponse.json()) as { session: ChatSession };
      nextSessions = [created.session];
    }

    const storedActiveId = window.localStorage.getItem(
      ACTIVE_SESSION_STORAGE_KEY
    );
    const nextActiveId =
      nextSessions.find((session) => session.id === storedActiveId)?.id ??
      nextSessions[0]?.id ??
      "";

    setSessions(nextSessions);
    setActiveSessionId(nextActiveId);
    hasHydratedRef.current = true;
  }, []);

  useEffect(() => {
    loadSessions().catch((error) => {
      console.error(error);
      setRequestStatus("error");
      setErrorMessage("加载会话失败，请检查数据库连接。");
    });
  }, [loadSessions]);

  useEffect(() => {
    if (!hasHydratedRef.current || !activeSessionId) {
      return;
    }
    window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);

    const active = sessions.find((session) => session.id === activeSessionId);
    if (active && (active.messageCount ?? 0) > 0 && active.messages.length === 0) {
      loadSessionMessages(activeSessionId).catch((error) => {
        console.error(error);
        setRequestStatus("error");
        setErrorMessage("加载消息失败。");
      });
    }
  }, [activeSessionId, loadSessionMessages, sessions]);

  useEffect(() => {
    scrollToBottom();
  }, [activeMessages, scrollToBottom]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const urls: string[] = [];
    const nextMap: Record<string, string> = {};

    selectedFiles.forEach((file) => {
      if (isImageFile(file)) {
        const url = URL.createObjectURL(file);
        nextMap[getFileSignature(file)] = url;
        urls.push(url);
      }
    });

    setImagePreviewMap(nextMap);

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selectedFiles]);

  const mergeFiles = useCallback((incomingFiles: File[]) => {
    setSelectedFiles((prev) => {
      const map = new Map<string, File>();
      [...prev, ...incomingFiles].forEach((file) =>
        map.set(getFileSignature(file), file)
      );
      return Array.from(map.values());
    });
  }, []);

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }
    mergeFiles(files);
    event.target.value = "";
  }

  function handleRemoveFile(signature: string) {
    setSelectedFiles((prev) =>
      prev.filter((file) => getFileSignature(file) !== signature)
    );
  }

  async function handleCreateSession() {
    try {
      const response = await fetch("/api/sessions", { method: "POST" });

      if (!response.ok) {
        throw new Error("Failed to create session");
      }

      const data = (await response.json()) as { session: ChatSession };
      setSessions((prev) => [data.session, ...prev]);
      setActiveSessionId(data.session.id);
      setPrompt("");
      setSelectedFiles([]);
      setRequestStatus("idle");
      setErrorMessage("");
      setStreamingMessageId(null);
    } catch (error) {
      console.error(error);
      setRequestStatus("error");
      setErrorMessage("新建会话失败。");
    }
  }

  async function handleClearSession() {
    if (!activeSessionId) {
      return;
    }

    try {
      const response = await fetch(
        `/api/sessions/${activeSessionId}/messages`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Failed to clear session");
      }

      setSessions((prev) =>
        prev.map((session) =>
          session.id === activeSessionId
            ? {
                ...session,
                title: "New chat",
                messages: [],
                messageCount: 0,
                updatedAt: Date.now(),
              }
            : session
        )
      );
      setPrompt("");
      setSelectedFiles([]);
      setRequestStatus("idle");
      setErrorMessage("");
      setStreamingMessageId(null);
    } catch (error) {
      console.error(error);
      setRequestStatus("error");
      setErrorMessage("清空会话失败。");
    }
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setRequestStatus("error");
      setErrorMessage("请输入问题后再发送。");
      return;
    }

    if (!activeSession) {
      setRequestStatus("error");
      setErrorMessage("当前没有可用会话。");
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const currentSessionId = activeSession.id;
    const currentFiles = [...selectedFiles];
    const userMessage = createMessage("user", trimmedPrompt);
    const nextMessages = [...activeMessages, userMessage];
    const nextTitle =
      activeMessages.length === 0
        ? generateSessionTitle(trimmedPrompt)
        : activeSession.title;

    setSessions((prev) =>
      prev.map((session) =>
        session.id === currentSessionId
          ? {
              ...session,
              title: nextTitle,
              messages: nextMessages,
              messageCount: nextMessages.length,
              updatedAt: Date.now(),
            }
          : session
      )
    );

    setPrompt("");
    setSelectedFiles([]);
    setRequestStatus("loading");
    setErrorMessage("");
    setStreamingMessageId(null);

    try {
      const response = await fetch(
        "/api/agent",
        buildRequestInit({
          message: trimmedPrompt,
          sessionId: currentSessionId,
          mode,
          files: currentFiles,
          signal: controller.signal,
        })
      );

      if (response.status === 499) {
        setRequestStatus("cancelled");
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        setRequestStatus("error");
        setErrorMessage(errorData?.error || "请求失败，请稍后再试。");
        return;
      }

      if (!response.body) {
        setRequestStatus("error");
        setErrorMessage("未收到可读流响应。");
        return;
      }

      const assistantMessage = createMessage("assistant", "", [], undefined);
      setStreamingMessageId(assistantMessage.id);

      setSessions((prev) =>
        prev.map((session) =>
          session.id === currentSessionId
            ? {
                ...session,
                messages: [...session.messages, assistantMessage],
                messageCount: session.messages.length + 1,
                updatedAt: Date.now(),
              }
            : session
        )
      );

      const updateAssistantMessage = (
        updater: (message: ChatMessage) => ChatMessage
      ) => {
        setSessions((prev) =>
          prev.map((session) => {
            if (session.id !== currentSessionId) {
              return session;
            }

            return {
              ...session,
              messages: session.messages.map((message) =>
                message.id === assistantMessage.id ? updater(message) : message
              ),
              updatedAt: Date.now(),
            };
          })
        );
      };

      const handleStreamEvent = (streamEvent: AgentStreamEvent) => {
        switch (streamEvent.type) {
          case "text-delta":
            updateAssistantMessage((message) => ({
              ...message,
              content: message.content + streamEvent.delta,
            }));
            break;
          case "tool-start":
          case "tool-end":
            updateAssistantMessage((message) => ({
              ...message,
              toolCalls: upsertToolCallRecord(
                message.toolCalls ?? [],
                streamEvent.toolCall
              ),
            }));
            break;
          case "run-context":
            updateAssistantMessage((message) => ({
              ...message,
              runContext: streamEvent.context,
            }));
            break;
          case "done":
            updateAssistantMessage((message) => ({
              ...message,
              content: streamEvent.reply,
              toolCalls: streamEvent.toolCalls,
            }));
            setRequestStatus("idle");
            setStreamingMessageId(null);
            break;
          case "error":
            setRequestStatus("error");
            setErrorMessage(streamEvent.message);
            setStreamingMessageId(null);
            break;
        }
      };

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }

        try {
          handleStreamEvent(JSON.parse(trimmed) as AgentStreamEvent);
        } catch (error) {
          console.error("解析流式事件失败:", error, trimmed);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(processLine);
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        processLine(buffer);
      }

      if (!controller.signal.aborted) {
        setRequestStatus("idle");
        setStreamingMessageId(null);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setRequestStatus("cancelled");
        return;
      }

      setRequestStatus("error");
      setErrorMessage("请求过程中发生异常，请稍后再试。");
      setStreamingMessageId(null);
    } finally {
      abortControllerRef.current = null;
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-gradient-to-br from-[#fffaf5] via-[#fff7ef] to-[#fffdf9] p-2 sm:p-3">
      <div className="mx-auto flex h-full max-w-[1600px] min-h-0 flex-col gap-2">
        <header className="shrink-0 rounded-2xl border border-orange-200/80 bg-white/90 px-4 py-2.5 shadow-[0_6px_18px_rgba(217,119,6,0.08)] backdrop-blur-sm">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold tracking-tight text-amber-950">
                  通用 AI 助手
                </h1>
                <span className="hidden rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 md:inline-flex">
                  对话 / 工具 / 附件
                </span>
              </div>
              <p className="mt-0.5 hidden text-xs text-amber-700 sm:line-clamp-1 sm:block">
                支持多轮对话、联网模式、附件上传与工具调用展示。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full bg-orange-50 px-3 py-1.5 text-xs text-amber-700">
                当前状态：
                <span className="ml-1 font-semibold text-orange-600">
                  {isRequesting ? "生成中" : "可用"}
                </span>
              </div>
              <button
                type="button"
                onClick={handleClearSession}
                className="rounded-xl border border-orange-300 bg-white px-3 py-1.5 text-xs font-medium text-orange-700 transition hover:bg-orange-50"
              >
                清空当前会话
              </button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[18rem_1fr]">
          <aside className="flex min-h-0 flex-col gap-2 lg:overflow-hidden">
            <section className="flex min-h-[240px] flex-1 flex-col rounded-2xl border border-orange-200/80 bg-white/90 p-3 shadow-sm lg:min-h-0 lg:overflow-hidden">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-amber-950">
                    会话列表
                  </h2>
                  <p className="mt-1 text-xs text-amber-600">
                    本地持久化保存最近会话
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCreateSession}
                  className="rounded-xl bg-orange-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-orange-600"
                >
                  新建会话
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-orange-100 bg-[#fffaf5] p-2">
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      active={session.id === activeSessionId}
                      onClick={() => {
                        setActiveSessionId(session.id);
                        setRequestStatus("idle");
                        setErrorMessage("");
                        setStreamingMessageId(null);
                      }}
                    />
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-orange-200/80 bg-white/90 p-3 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-amber-950">附件</h3>
                  <p className="mt-1 text-xs text-amber-600">
                    上传文件和图片，作为本轮提问的附加上下文
                  </p>
                </div>
                <div className="rounded-full bg-orange-50 px-3 py-1 text-xs text-orange-700">
                  已选 {selectedFiles.length}
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.json,.csv,.pdf,.doc,.docx"
                multiple
                onChange={handleFileInputChange}
                className="hidden"
              />

              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileInputChange}
                className="hidden"
              />

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 rounded-2xl border border-orange-300 bg-white px-3 py-2 text-sm font-medium text-orange-700 transition hover:bg-orange-50"
                >
                  上传文件
                </button>
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="flex-1 rounded-2xl border border-orange-300 bg-white px-3 py-2 text-sm font-medium text-orange-700 transition hover:bg-orange-50"
                >
                  上传图片
                </button>
              </div>

              <div className="mt-3">
                {selectedFiles.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-orange-200 bg-[#fffaf5] px-4 py-5 text-center text-sm text-amber-500">
                    还没有添加附件
                  </div>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {selectedFiles.map((file) => {
                      const signature = getFileSignature(file);
                      const previewUrl = imagePreviewMap[signature];

                      return (
                        <div
                          key={signature}
                          className="flex items-center gap-3 rounded-2xl border border-orange-100 bg-[#fffaf5] p-3"
                        >
                          {previewUrl ? (
                            <img
                              src={previewUrl}
                              alt={file.name}
                              className="h-12 w-12 rounded-xl object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 text-xs font-semibold text-orange-700">
                              {getFileTypeLabel(file)}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-amber-900">
                              {file.name}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-amber-600">
                              <span className="rounded-full bg-white px-2 py-0.5 text-orange-700">
                                {getFileTypeLabel(file)}
                              </span>
                              <span>{formatFileSize(file.size)}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveFile(signature)}
                            className="rounded-xl border border-orange-200 px-2.5 py-1.5 text-xs font-medium text-orange-700 transition hover:bg-orange-50"
                          >
                            删除
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

          </aside>

          <section className="flex min-h-[360px] flex-col rounded-2xl border border-orange-200/80 bg-white/90 p-3 shadow-[0_8px_22px_rgba(120,113,108,0.09)] lg:min-h-0 lg:overflow-hidden">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 className="truncate text-lg font-semibold text-amber-950">
                  {activeSession?.title ?? "对话记录"}
                </h2>
                <p className="mt-1 text-xs text-amber-600">
                  共 {activeMessages.length} 条消息
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-orange-100 bg-[#fffaf5] p-3">
              <div className="space-y-3">
                {activeMessages.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-orange-200 bg-white/70 p-8 text-center text-sm text-amber-600">
                    还没有对话记录。你可以试试：
                    <div className="mt-3 space-y-2 text-xs text-amber-500">
                      <div>“我现在在哪？”</div>
                      <div>“帮我查一下今天上海天气”</div>
                      <div>“附近有什么咖啡店？”</div>
                    </div>
                  </div>
                )}

                {activeMessages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    streaming={
                      message.role === "assistant" &&
                      message.id === streamingMessageId &&
                      isRequesting
                    }
                  />
                ))}

                {requestStatus === "error" && errorMessage && (
                  <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">
                    <div className="font-semibold">请求失败</div>
                    <div className="mt-1">{errorMessage}</div>
                  </div>
                )}

                {requestStatus === "cancelled" && (
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-700">
                    本次生成已取消。
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="mt-2 shrink-0 rounded-2xl border border-orange-200 bg-white p-2.5 shadow-sm"
            >
              {selectedFiles.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {selectedFiles.slice(0, 4).map((file) => (
                    <div
                      key={getFileSignature(file)}
                      className="max-w-[180px] truncate rounded-full bg-orange-50 px-3 py-1 text-xs text-orange-700"
                    >
                      {file.name}
                    </div>
                  ))}
                  {selectedFiles.length > 4 && (
                    <div className="rounded-full bg-orange-50 px-3 py-1 text-xs text-orange-700">
                      +{selectedFiles.length - 4} 个附件
                    </div>
                  )}
                </div>
              )}

              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="给 AI 助手发送消息"
                className="min-h-[72px] max-h-[120px] w-full resize-y rounded-xl border border-transparent bg-[#fffaf5] p-3 text-sm text-amber-900 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
              />

              <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "default", label: "普通模式" },
                    { value: "web", label: "联网模式" },
                    { value: "nearby", label: "周边推荐" },
                  ].map((item) => {
                    const active = mode === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setMode(item.value as ChatMode)}
                        className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                          active
                            ? "bg-orange-500 text-white shadow-sm"
                            : "border border-orange-300 bg-white text-orange-700 hover:bg-orange-50"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={!isRequesting}
                    className="rounded-xl border border-orange-300 px-4 py-2 text-sm font-medium text-orange-700 transition hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    取消生成
                  </button>
                  <button
                    type="submit"
                    disabled={isRequesting}
                    className="rounded-xl bg-orange-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRequesting ? "正在思考..." : "发送"}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
