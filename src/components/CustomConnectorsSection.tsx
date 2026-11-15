import {
  CheckCircle2,
  Edit3,
  Loader2,
  Play,
  PlugZap,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import type { CustomConnector, CustomConnectorParam } from "../types/meetmind";
import { CONNECTOR_TEMPLATES } from "../utils/settingsStorage";

interface CustomConnectorsSectionProps {
  connectors: CustomConnector[];
  onChangeConnectors: (next: CustomConnector[]) => void;
}

function toSnakeCase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function emptyDraft(): CustomConnector {
  return {
    id: `conn_${Date.now()}`,
    name: "",
    toolName: "",
    description: "",
    method: "POST",
    endpointUrl: "",
    authHeaderName: "Authorization",
    authHeaderValue: "",
    extraHeadersJson: "",
    payloadTemplate: "",
    params: [
      {
        name: "title",
        type: "string",
        description: "Action item or record title extracted from the meeting",
        required: true,
      },
    ],
    enabled: true,
  };
}

export function CustomConnectorsSection({
  connectors,
  onChangeConnectors,
}: CustomConnectorsSectionProps) {
  const [editing, setEditing] = useState<CustomConnector | null>(null);
  const [manualToolName, setManualToolName] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    ok: boolean;
    message: string;
  } | null>(null);

  const openBlankForm = () => {
    setFormError(null);
    setManualToolName(false);
    setEditing(emptyDraft());
  };

  const openTemplateForm = (tpl: Omit<CustomConnector, "id">) => {
    setFormError(null);
    setManualToolName(true);
    setEditing({
      ...tpl,
      id: `conn_${Date.now()}`,
      params: tpl.params.map((p) => ({ ...p })),
    });
  };

  const openEditForm = (conn: CustomConnector) => {
    setFormError(null);
    setManualToolName(true);
    setEditing({
      ...conn,
      params: conn.params.map((p) => ({ ...p })),
    });
  };

  const handleSaveConnector = () => {
    if (!editing) return;
    const cleanName = editing.name.trim();
    const cleanTool = toSnakeCase(editing.toolName || editing.name);
    const cleanUrl = editing.endpointUrl.trim();
    const cleanDesc = editing.description.trim();

    if (!cleanName) {
      setFormError("Connector name is required.");
      return;
    }
    if (!cleanTool) {
      setFormError("Tool name (snake_case) is required so Gemini can call it.");
      return;
    }
    if (!cleanUrl) {
      setFormError("Endpoint / Webhook URL is required.");
      return;
    }
    try {
      new URL(cleanUrl);
    } catch {
      setFormError("Enter a valid https:// (or http://localhost) URL.");
      return;
    }
    if (!cleanDesc) {
      setFormError("Describe when Gemini should call this tool.");
      return;
    }

    const sanitizedParams = editing.params
      .filter((p) => p.name.trim().length > 0)
      .map((p) => ({
        ...p,
        name: p.name.trim().replace(/[^a-zA-Z0-9_]/g, "_"),
        description: p.description.trim() || p.name.trim(),
      }));

    const finalized: CustomConnector = {
      ...editing,
      name: cleanName,
      toolName: cleanTool,
      description: cleanDesc,
      endpointUrl: cleanUrl,
      authHeaderName: (editing.authHeaderName || "").trim(),
      authHeaderValue: (editing.authHeaderValue || "").trim(),
      extraHeadersJson: (editing.extraHeadersJson || "").trim(),
      payloadTemplate: (editing.payloadTemplate || "").trim(),
      params: sanitizedParams,
    };

    const exists = connectors.some((c) => c.id === finalized.id);
    const next = exists
      ? connectors.map((c) => (c.id === finalized.id ? finalized : c))
      : [finalized, ...connectors];

    onChangeConnectors(next);
    setEditing(null);
    setFormError(null);
  };

  const handleToggleEnabled = (id: string) => {
    onChangeConnectors(
      connectors.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
    );
  };

  const handleDelete = (id: string) => {
    onChangeConnectors(connectors.filter((c) => c.id !== id));
    if (editing?.id === id) setEditing(null);
  };

  const handleTestConnector = async (conn: CustomConnector) => {
    setTestingId(conn.id);
    setTestResult(null);
    try {
      const sampleArgs: Record<string, unknown> = {};
      for (const p of conn.params) {
        if (!p.name.trim()) continue;
        sampleArgs[p.name] =
          p.type === "number"
            ? 1
            : p.type === "boolean"
            ? true
            : `Sample ${p.name} from MeetMind`;
      }

      const resp = await fetch("/api/integrations/custom-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpointUrl: conn.endpointUrl,
          method: conn.method,
          authHeaderName: conn.authHeaderName,
          authHeaderValue: conn.authHeaderValue,
          extraHeadersJson: conn.extraHeadersJson,
          payloadTemplate: conn.payloadTemplate,
          args: sampleArgs,
          meetingContext: {
            meetingId: "test_probe",
            meetingTitle: "MeetMind Connector Test",
            summary: "Verifying custom connector endpoint.",
          },
        }),
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        status?: number;
        responsePreview?: string;
        error?: string;
      };
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || "Connector test request failed.");
      }
      setTestResult({
        id: conn.id,
        ok: true,
        message: `HTTP ${data.status} OK · ${data.responsePreview || "Delivered"}`,
      });
    } catch (err) {
      setTestResult({
        id: conn.id,
        ok: false,
        message: err instanceof Error ? err.message : "Test failed.",
      });
    } finally {
      setTestingId(null);
    }
  };

  const updateParam = (idx: number, patch: Partial<CustomConnectorParam>) => {
    if (!editing) return;
    setEditing({
      ...editing,
      params: editing.params.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    });
  };

  return (
    <section className="glass-card space-y-5 rounded-2xl p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <PlugZap className="h-4 w-4 text-[#5eead4]" />
            <h2 className="font-serif text-xl italic text-slate-50">
              Custom Connectors (n8n-Style Tool Builder)
            </h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-300/80">
            Connect any REST API or Webhook (Notion, Jira, WhatsApp, CRM, Sheets). Gemini automatically receives these as callable tools and fills their parameters from each meeting — nothing runs until you click <span className="font-mono text-[#5eead4]">Permit</span>.
          </p>
        </div>

        <button
          type="button"
          onClick={openBlankForm}
          className="btn-glazed-primary inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Custom Connector
        </button>
      </div>

      {/* Quick-Add Templates */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
          Quick Templates:
        </span>
        {CONNECTOR_TEMPLATES.map((tpl) => (
          <button
            key={tpl.label}
            type="button"
            onClick={() => openTemplateForm(tpl.connector)}
            className="rounded-lg border border-white/[0.12] bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-slate-200 transition-colors hover:border-[#5eead4]/40 hover:bg-[#5eead4]/10 hover:text-[#99f6e4]"
          >
            + {tpl.label}
          </button>
        ))}
      </div>

      {/* Connector Editor Drawer / Card */}
      {editing && (
        <div className="glass-inset space-y-4 rounded-2xl border border-[#5eead4]/35 p-5">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs font-semibold text-[#99f6e4]">
              Configure Custom AI Tool
            </div>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-lg p-1 text-slate-400 hover:text-white"
              aria-label="Close connector form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="block font-mono text-[11px] text-slate-300">
                Connector Name
              </label>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditing((prev) =>
                    prev
                      ? {
                          ...prev,
                          name: val,
                          toolName: manualToolName ? prev.toolName : toSnakeCase(val),
                        }
                      : null
                  );
                }}
                placeholder="e.g. Notion Tasks DB"
                className="glass-inset w-full rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-mono text-[11px] text-slate-300">
                AI Tool Name (snake_case for Gemini Function Calling)
              </label>
              <input
                type="text"
                value={editing.toolName}
                onChange={(e) => {
                  setManualToolName(true);
                  setEditing((prev) =>
                    prev ? { ...prev, toolName: toSnakeCase(e.target.value) } : null
                  );
                }}
                placeholder="create_notion_task"
                className="glass-inset w-full rounded-xl px-3.5 py-2 font-mono text-xs text-[#99f6e4] focus:border-[#5eead4] focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block font-mono text-[11px] text-slate-300">
              When should Gemini call this tool? (Description)
            </label>
            <input
              type="text"
              value={editing.description}
              onChange={(e) =>
                setEditing((prev) => (prev ? { ...prev, description: e.target.value } : null))
              }
              placeholder="Create a task row in Notion whenever an engineering or client action item is extracted."
              className="glass-inset w-full rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="space-y-1.5 md:col-span-3">
              <label className="block font-mono text-[11px] text-slate-300">
                HTTP Method
              </label>
              <select
                value={editing.method}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev
                      ? {
                          ...prev,
                          method: e.target.value as CustomConnector["method"],
                        }
                      : null
                  )
                }
                className="glass-inset w-full rounded-xl px-3 py-2 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
              >
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="GET">GET</option>
              </select>
            </div>

            <div className="space-y-1.5 md:col-span-9">
              <label className="block font-mono text-[11px] text-slate-300">
                Endpoint / Webhook URL
              </label>
              <input
                type="url"
                value={editing.endpointUrl}
                onChange={(e) =>
                  setEditing((prev) => (prev ? { ...prev, endpointUrl: e.target.value } : null))
                }
                placeholder="https://api.example.com/v1/tasks or https://hooks.zapier.com/..."
                className="glass-inset w-full rounded-xl px-3.5 py-2 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <label className="block font-mono text-[11px] text-slate-300">
                Auth Header Name (Optional)
              </label>
              <input
                type="text"
                value={editing.authHeaderName || ""}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, authHeaderName: e.target.value } : null
                  )
                }
                placeholder="Authorization"
                className="glass-inset w-full rounded-xl px-3 py-2 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-mono text-[11px] text-slate-300">
                Auth Token / API Key (Stored locally)
              </label>
              <input
                type="password"
                value={editing.authHeaderValue || ""}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, authHeaderValue: e.target.value } : null
                  )
                }
                placeholder="Bearer ntn_... or x-api-key"
                className="glass-inset w-full rounded-xl px-3 py-2 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-mono text-[11px] text-slate-300">
                Extra Headers JSON (Optional)
              </label>
              <input
                type="text"
                value={editing.extraHeadersJson || ""}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, extraHeadersJson: e.target.value } : null
                  )
                }
                placeholder='{"Notion-Version": "2022-06-28"}'
                className="glass-inset w-full rounded-xl px-3 py-2 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
              />
            </div>
          </div>

          {/* Parameters Schema Builder */}
          <div className="space-y-2.5 border-t border-white/[0.08] pt-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-medium text-slate-200">
                Tool Parameters (Fields Gemini will extract for you)
              </span>
              <button
                type="button"
                onClick={() =>
                  setEditing((prev) =>
                    prev
                      ? {
                          ...prev,
                          params: [
                            ...prev.params,
                            { name: "", type: "string", description: "", required: false },
                          ],
                        }
                      : null
                  )
                }
                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.12] bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] text-[#5eead4] hover:bg-white/[0.1]"
              >
                <Plus className="h-3 w-3" />
                Add Parameter
              </button>
            </div>

            <div className="space-y-2">
              {editing.params.map((param, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5 sm:grid-cols-12 sm:items-center"
                >
                  <input
                    type="text"
                    value={param.name}
                    onChange={(e) => updateParam(idx, { name: e.target.value })}
                    placeholder="fieldName"
                    className="glass-inset rounded-lg px-2.5 py-1.5 font-mono text-xs text-slate-100 sm:col-span-3"
                  />
                  <select
                    value={param.type}
                    onChange={(e) =>
                      updateParam(idx, {
                        type: e.target.value as CustomConnectorParam["type"],
                      })
                    }
                    className="glass-inset rounded-lg px-2 py-1.5 font-mono text-xs text-slate-100 sm:col-span-2"
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                  </select>
                  <input
                    type="text"
                    value={param.description}
                    onChange={(e) => updateParam(idx, { description: e.target.value })}
                    placeholder="What should Gemini put here?"
                    className="glass-inset rounded-lg px-2.5 py-1.5 text-xs text-slate-100 sm:col-span-5"
                  />
                  <label className="flex items-center justify-between gap-2 px-1 font-mono text-[10px] text-slate-300 sm:col-span-2">
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={Boolean(param.required)}
                        onChange={(e) => updateParam(idx, { required: e.target.checked })}
                        className="accent-[#5eead4]"
                      />
                      Req
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setEditing((prev) =>
                          prev
                            ? {
                                ...prev,
                                params: prev.params.filter((_, i) => i !== idx),
                              }
                            : null
                        )
                      }
                      className="text-slate-400 hover:text-rose-300"
                      aria-label="Remove parameter"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Optional Payload Template */}
          <div className="space-y-1.5">
            <label className="block font-mono text-[11px] text-slate-300">
              Custom JSON Body Template (Optional — leave blank to send full JSON payload + args)
            </label>
            <textarea
              rows={2}
              value={editing.payloadTemplate || ""}
              onChange={(e) =>
                setEditing((prev) =>
                  prev ? { ...prev, payloadTemplate: e.target.value } : null
                )
              }
              placeholder='{"title": "{{title}}", "owner": "{{owner}}", "meeting": "{{meetingTitle}}"}'
              className="glass-inset w-full rounded-xl px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-[#5eead4] focus:outline-none"
            />
          </div>

          {formError && (
            <div className="rounded-xl border border-rose-400/35 bg-rose-500/12 px-3 py-2 text-xs text-rose-200">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-xl border border-white/[0.12] px-3.5 py-1.5 text-xs text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveConnector}
              className="btn-glazed-primary rounded-xl px-4 py-1.5 text-xs font-semibold"
            >
              Save Connector
            </button>
          </div>
        </div>
      )}

      {/* Existing Connected Tools List */}
      {connectors.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 py-6 text-center text-xs text-slate-400">
          No custom connectors added yet. Click a quick template above or{" "}
          <span className="text-[#5eead4]">Add Custom Connector</span> to connect Notion, Jira, WhatsApp, or any API.
        </div>
      ) : (
        <div className="space-y-2.5">
          {connectors.map((conn) => (
            <div
              key={conn.id}
              className="glass-inset flex flex-col justify-between gap-3 rounded-xl p-4 lg:flex-row lg:items-center"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-50">{conn.name}</span>
                  <span className="rounded-md border border-[#5eead4]/35 bg-[#5eead4]/12 px-2 py-0.5 font-mono text-[10px] text-[#99f6e4]">
                    {conn.toolName}()
                  </span>
                  <span className="rounded-md border border-white/[0.12] bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-slate-300">
                    {conn.method}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleEnabled(conn.id)}
                    className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium ${
                      conn.enabled
                        ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                        : "border-white/[0.12] bg-white/[0.04] text-slate-400"
                    }`}
                  >
                    {conn.enabled ? "Enabled" : "Paused"}
                  </button>
                </div>

                <p className="text-xs text-slate-300/85">{conn.description}</p>
                <div className="truncate font-mono text-[11px] text-slate-400">
                  {conn.endpointUrl} · {conn.params.length} param(s)
                </div>

                {testResult?.id === conn.id && (
                  <div
                    className={`mt-1.5 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] ${
                      testResult.ok
                        ? "border-emerald-400/40 bg-emerald-400/12 text-emerald-200"
                        : "border-rose-400/40 bg-rose-500/14 text-rose-200"
                    }`}
                  >
                    {testResult.ok && <CheckCircle2 className="h-3.5 w-3.5" />}
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleTestConnector(conn)}
                  disabled={testingId === conn.id}
                  className="inline-flex items-center gap-1 rounded-xl border border-white/[0.12] bg-white/[0.05] px-3 py-1.5 font-mono text-[11px] text-slate-100 hover:bg-white/[0.1] disabled:opacity-50"
                >
                  {testingId === conn.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3 text-[#5eead4]" />
                  )}
                  Test
                </button>
                <button
                  type="button"
                  onClick={() => openEditForm(conn)}
                  className="inline-flex items-center gap-1 rounded-xl border border-white/[0.12] bg-white/[0.05] px-3 py-1.5 font-mono text-[11px] text-slate-200 hover:bg-white/[0.1]"
                >
                  <Edit3 className="h-3 w-3" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(conn.id)}
                  className="inline-flex items-center gap-1 rounded-xl border border-rose-400/30 bg-rose-500/10 px-2.5 py-1.5 font-mono text-[11px] text-rose-200 hover:bg-rose-500/20"
                  aria-label={`Delete ${conn.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
