import { useNavigate } from "react-router-dom"
import { useGetIdentity } from "@refinedev/core"
import { getUserRole } from "@/types/rbac"
import { getHomeRoute } from "@/utils/role-routing"
import { Button } from "@/components/ui/button"
import {
  ArrowRight,
  BrainCircuit,
  GitCompareArrows,
  GraduationCap,
  Layers,
  Lightbulb,
  Network,
  Shield,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react"

const FEATURES = [
  {
    icon: <Network className="h-6 w-6" />,
    title: "可视化模型构建",
    desc: "拖拽式编辑器，直观构建岗位能力维度、技能与知识点的层级结构",
  },
  {
    icon: <BrainCircuit className="h-6 w-6" />,
    title: "AI 智能生成",
    desc: "上传职位描述文档，AI 自动提取能力要求并生成结构化模型",
  },
  {
    icon: <Layers className="h-6 w-6" />,
    title: "多维度能力画像",
    desc: "从专业技能到通用素质，全方位刻画岗位能力需求",
  },
  {
    icon: <GitCompareArrows className="h-6 w-6" />,
    title: "版本管理",
    desc: "模型迭代有迹可循，支持多版本对比与发布管理",
  },
  {
    icon: <Target className="h-6 w-6" />,
    title: "精准能力评估",
    desc: "基于模型自动生成评估方案，量化人才与岗位的匹配度",
  },
  {
    icon: <Sparkles className="h-6 w-6" />,
    title: "学习资源关联",
    desc: "为每个知识点关联学习视频、文档，打通能力提升路径",
  },
]

const STATS = [
  { value: "500+", label: "岗位模型" },
  { value: "10,000+", label: "能力节点" },
  { value: "50+", label: "合作企业" },
  { value: "98%", label: "用户满意度" },
]

const ROLES = [
  {
    icon: <Users className="h-5 w-5" />,
    title: "企业 HR",
    desc: "构建标准化岗位能力模型，驱动招聘与培训体系升级",
  },
  {
    icon: <GraduationCap className="h-5 w-5" />,
    title: "院校管理者",
    desc: "对接企业用人需求，优化课程设置与人才培养方案",
  },
  {
    icon: <Shield className="h-5 w-5" />,
    title: "培训机构",
    desc: "基于能力缺口分析，设计精准的技能提升课程",
  },
]

export function GwmxLanding() {
  const navigate = useNavigate()
  const { data: identity } = useGetIdentity<{ name: string; primary_org?: { role_name: string } | null }>()
  const role = identity ? getUserRole(identity) : ""
  const ctaTarget = identity ? getHomeRoute(role) : "/login"
  const goCta = () => navigate(ctaTarget)

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600">
              <GitCompareArrows className="h-4.5 w-4.5 text-white" />
            </div>
            <div className="leading-tight">
              <div className="text-base font-bold tracking-tight text-gray-900">
                工教桥
              </div>
              <div className="text-[10px] text-gray-500 tracking-wider">
                ENGINEER × EDUCATION
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={goCta}
            >
              登录
            </Button>
            <Button
              size="sm"
              onClick={goCta}
              className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md hover:shadow-lg transition-shadow"
            >
              免费试用
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/60" />
        <div className="pointer-events-none absolute top-20 left-1/4 h-72 w-72 rounded-full bg-indigo-200/30 blur-3xl" />
        <div className="pointer-events-none absolute bottom-10 right-1/4 h-64 w-64 rounded-full bg-violet-200/30 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-sm text-indigo-700 mb-8">
            <Sparkles className="h-3.5 w-3.5" />
            产教融合 · AI 驱动的岗位能力建模平台
          </div>

          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl leading-[1.15]">
            让企业岗位需求
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              {" "}直达课堂教学
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-500 leading-relaxed">
            打通企业工程师岗位能力与院校人才培养的最后一公里。
            <br className="hidden sm:block" />
            以岗位能力模型为桥梁，让教什么、学什么、考什么，与企业真实需求同频。
          </p>

          <div className="mt-10 flex items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={goCta}
              className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white px-8 shadow-lg hover:shadow-xl transition-all"
            >
              开始使用
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })
              }}
            >
              了解更多
            </Button>
          </div>

          {/* Stats */}
          <div className="mt-20 grid grid-cols-2 gap-6 sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="mt-1 text-sm text-gray-500">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-gray-100 bg-gray-50/50 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-indigo-600 tracking-wide uppercase">核心功能</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-900">
              连接企业岗位与院校教学
            </h2>
            <p className="mt-4 text-gray-500 max-w-xl mx-auto">
              从企业真实岗位到院校课程评估，覆盖产教融合全链路
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 transition-colors">
                  {f.icon}
                </div>
                <h3 className="mt-4 text-base font-semibold text-gray-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-indigo-600 tracking-wide uppercase">适用场景</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-900">
              为谁而建
            </h2>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {ROLES.map((r) => (
              <div
                key={r.title}
                className="relative rounded-2xl border border-gray-100 bg-gradient-to-b from-white to-gray-50/50 p-8 text-center shadow-sm"
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                  {r.icon}
                </div>
                <h3 className="mt-5 text-lg font-semibold text-gray-900">{r.title}</h3>
                <p className="mt-3 text-sm text-gray-500 leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-600 px-8 py-16 text-center text-white shadow-xl">
            <Lightbulb className="mx-auto h-10 w-10 opacity-80" />
            <h2 className="mt-6 text-3xl font-bold">
              让企业与院校在能力模型上相遇
            </h2>
            <p className="mt-4 text-indigo-100 max-w-lg mx-auto">
              上传岗位描述，AI 自动生成能力模型，一键对接课程与考核，5 分钟开启产教融合
            </p>
            <Button
              size="lg"
              className="mt-8 bg-white text-indigo-600 hover:bg-indigo-50 px-8 shadow-lg"
              onClick={goCta}
            >
              免费注册
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-gray-50 py-10">
        <div className="mx-auto max-w-6xl px-6 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-gray-400">
            <Zap className="h-4 w-4" />
            <span className="text-sm font-medium">岗位能力模型平台</span>
          </div>
          <p className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} 智评云 · 岗位能力建模平台
          </p>
        </div>
      </footer>
    </div>
  )
}
