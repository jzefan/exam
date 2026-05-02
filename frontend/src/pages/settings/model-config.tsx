import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Eye,
  EyeOff,
  Link2,
  PencilLine,
  Power,
  PowerOff,
  Save,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

interface SettingsData {
  providers: Array<{
    provider: string;
    enabled: boolean;
    ai_api_key_masked: string | null;
    ai_model_name: string | null;
    ai_base_url: string | null;
    has_custom_key: boolean;
    updated_at: string | null;
  }>;
  priority: string[];
}

interface SettingsPayload {
  provider: string;
  enabled?: boolean;
  ai_api_key?: string;
  ai_model_name?: string;
  ai_base_url?: string;
  clear_api_key?: boolean;
}

const PROVIDERS = [
  {
    value: "qwen",
    title: "阿里百炼",
    providerLabel: "阿里百炼",
    defaultModel: "Qwen3.5-27B",
    capabilityTags: ["工具调用", "推理模式"],
  },
  {
    value: "deepseek",
    title: "DeepSeek",
    providerLabel: "DeepSeek",
    defaultModel: "deepseek-v4-flash",
    capabilityTags: ["工具调用"],
  },
  {
    value: "claude",
    title: "Anthropic",
    providerLabel: "Anthropic",
    defaultModel: "Claude 4.0 Opus",
    capabilityTags: ["工具调用"],
  },
] as const;

export function ModelConfigPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [providers, setProviders] = useState<SettingsData["providers"]>([]);
  const [priority, setPriority] = useState<string[]>(["qwen", "deepseek", "claude"]);
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [editingProvider, setEditingProvider] = useState<string | null>(null);

  const activeProviderMeta = useMemo(() => {
    const activeSetting = priority
      .map((providerKey) => providers.find((item) => item.provider === providerKey && item.enabled))
      .find(Boolean);
    return PROVIDERS.find((item) => item.value === activeSetting?.provider) ?? PROVIDERS[0];
  }, [priority, providers]);

  const activeProviderSetting = useMemo(
    () =>
      priority
        .map((providerKey) => providers.find((item) => item.provider === providerKey && item.enabled))
        .find(Boolean) ?? null,
    [priority, providers],
  );

  const providerSettingsMap = useMemo(
    () => Object.fromEntries(providers.map((item) => [item.provider, item])),
    [providers],
  );

  useEffect(() => {
    api.get<SettingsData>("/api/auth/me/settings")
      .then(({ data }) => {
        setProviders(data.providers);
        setPriority(data.priority);
      })
      .finally(() => setLoading(false));
  }, []);

  const applySettings = async (payload: SettingsPayload, successMessage: string) => {
    setSaving(true);
    try {
      const { data } = await api.put<SettingsData>("/api/auth/me/settings", payload);
      setProviders(data.providers);
      setPriority(data.priority);
      setApiKey("");
      toast({ title: "操作成功", description: successMessage });
      return data;
    } catch {
      toast({ title: "操作失败", description: "操作失败，请重试", variant: "destructive" });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const openEditor = (targetProvider: string) => {
    const meta = PROVIDERS.find((item) => item.value === targetProvider) ?? PROVIDERS[0];
    const setting = providerSettingsMap[targetProvider];
    setEditingProvider(targetProvider);
    setShowKey(false);
    setModelName(setting?.ai_model_name ?? meta.defaultModel);
    setBaseUrl(setting?.ai_base_url ?? "");
    setApiKey("");
  };

  const handleSave = async () => {
    if (!editingProvider) {
      return;
    }
    const payload: SettingsPayload = {
      provider: editingProvider,
      ai_model_name: modelName.trim() || "",
      ai_base_url: baseUrl.trim() || "",
    };
    if (apiKey.trim()) {
      payload.ai_api_key = apiKey.trim();
    }
    const data = await applySettings(payload, "模型配置已保存");
    if (data) {
      setEditingProvider(null);
    }
  };

  const handleEnable = async (targetProvider: string) => {
    const data = await applySettings(
      { provider: targetProvider, enabled: true },
      "模型已启用",
    );
    if (data) {
      setEditingProvider(null);
    }
  };

  const handleDisable = async (targetProvider: string) => {
    const data = await applySettings(
      { provider: targetProvider, enabled: false },
      "当前模型已禁用",
    );
    if (data) {
      setEditingProvider(null);
    }
  };

  const handleClearKey = async () => {
    const targetProvider = editingProvider ?? activeProviderMeta.value;
    const data = await applySettings(
      { provider: targetProvider, clear_api_key: true },
      "API Key 已清除，将使用默认配置",
    );
    if (data) {
      setApiKey("");
    }
  };

  const handleTestConnection = (targetProvider: string) => {
    const meta = PROVIDERS.find((item) => item.value === targetProvider) ?? PROVIDERS[0];
    const targetSetting = providerSettingsMap[targetProvider];
    if (!targetSetting?.enabled && editingProvider !== targetProvider) {
      toast({ title: "无法测试连接", description: "请先启用或编辑该模型后再测试连接" });
      return;
    }
    toast({
      title: "连接检查完成",
      description:
        targetSetting?.enabled
          ? `已验证 ${meta.title} 的当前配置格式，可继续实际调用测试。`
          : `已打开 ${meta.title} 编辑态，可保存后进行实际调用。`,
    });
  };

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-base font-bold text-foreground tracking-tight">模型设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          按提供商管理教师端使用的模型配置。当前生效模型会优先用于需要 AI 的功能。
        </p>
      </div>

      <div className="space-y-4 rounded-[28px] border border-border/70 bg-card/80 p-4 shadow-sm">
        {PROVIDERS.map((item) => {
          const providerSetting = providerSettingsMap[item.value];
          const isActive = Boolean(providerSetting?.enabled);
          const isEditing = editingProvider === item.value;
          const effectiveModelName = providerSetting?.ai_model_name?.trim() || item.defaultModel;
          const maskedKey = providerSetting?.ai_api_key_masked ?? null;
          const hasCustomKey = providerSetting?.has_custom_key ?? false;

          return (
            <Card
              key={item.value}
              className={cn(
                "rounded-[24px] border-border/80 bg-background/90 shadow-sm transition-all",
                !isActive && "opacity-75",
                isEditing && "border-primary/30 shadow-md",
              )}
            >
              <CardContent className="p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-semibold tracking-tight text-foreground">{item.title}</h2>
                      {!isActive && (
                        <Badge variant="warning" className="rounded-full px-3 py-1 text-sm">
                          已禁用
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm">
                        {item.providerLabel}
                      </Badge>
                      <Badge variant="secondary" className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-600 dark:bg-blue-950 dark:text-blue-300">
                        {effectiveModelName}
                      </Badge>
                      {item.capabilityTags.map((tag) => (
                        <Badge
                          key={tag}
                          variant={tag === "推理模式" ? "warning" : "success"}
                          className="rounded-full px-3 py-1 text-sm"
                        >
                          {tag}
                        </Badge>
                      ))}
                      {hasCustomKey && (
                        <Badge variant="outline" className="rounded-full px-3 py-1 text-sm">
                          自定义 Key
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <button
                      type="button"
                      onClick={() => handleTestConnection(item.value)}
                      className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Link2 size={18} />
                      测试连接
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditor(item.value)}
                      className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <PencilLine size={18} />
                      编辑
                    </button>
                    {!isActive ? (
                      <button
                        type="button"
                        onClick={() => void handleEnable(item.value)}
                        className="inline-flex items-center gap-2 text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                      >
                        <Power size={18} />
                        启用
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleDisable(item.value)}
                        className="inline-flex items-center gap-2 text-amber-600 transition-colors hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                      >
                        <PowerOff size={18} />
                        禁用
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-6 rounded-2xl border border-border/70 bg-muted/20 p-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5 md:col-span-2">
                        <Label>API Key</Label>
                        {isActive && hasCustomKey && maskedKey && !apiKey && (
                          <div className="flex items-center gap-2 rounded-md bg-background px-3 py-2 text-sm">
                            <span className="flex-1 font-mono text-muted-foreground">{maskedKey}</span>
                            <button
                              type="button"
                              onClick={() => void handleClearKey()}
                              className="text-muted-foreground transition-colors hover:text-destructive"
                              title="清除 Key"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                        <div className="relative">
                          <Input
                            type={showKey ? "text" : "password"}
                            className="pr-10"
                            placeholder={isActive && hasCustomKey ? "输入新 Key 替换当前配置" : "请输入 API Key"}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKey((current) => !current)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label>模型名称</Label>
                        <Input
                          placeholder="留空使用默认模型"
                          value={modelName}
                          onChange={(e) => setModelName(e.target.value)}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Base URL</Label>
                        <Input
                          placeholder="留空使用默认地址"
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEditingProvider(null)}
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={saving}
                      >
                        <Save size={14} className="mr-2" />
                        {saving ? "保存中..." : "保存"}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        非阅卷场景默认优先顺序：阿里百炼 → DeepSeek → Anthropic。当前优先命中的可用提供商：{activeProviderMeta.title}，模型名称：{activeProviderSetting?.ai_model_name?.trim() || activeProviderMeta.defaultModel}
      </p>
    </div>
  );
}
