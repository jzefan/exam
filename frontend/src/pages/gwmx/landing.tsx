import { useNavigate } from "react-router-dom"
import { useGetIdentity } from "@refinedev/core"
import { getUserRole } from "@/types/rbac"
import { getHomeRoute } from "@/utils/role-routing"
import { BrandLogoMark } from "@/components/brand-logo"
import { IcpRecordLink } from "@/components/icp-record-link"
import { Button } from "@/components/ui/button"
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  FileText,
  GitCompareArrows,
  GraduationCap,
  Layers,
  Target,
} from "lucide-react"

const PILLARS = [
  {
    num: "01",
    title: "岗位能力建模",
    desc: "上传 JD、岗位说明书或企业标准，平台自动抽取能力维度、技能与知识点，产出可版本化、可复用的岗位能力模型。",
  },
  {
    num: "02",
    title: "专业-岗位对标",
    desc: "将院校专业培养方案与目标岗位模型并列展示，自动识别课程与能力点的匹配度与缺口，为人才培养方案修订提供数据依据。",
  },
  {
    num: "03",
    title: "考核与达成度评估",
    desc: "围绕岗位能力模型生成考核蓝图，量化学生在岗位能力维度上的达成度，闭环支撑专业认证与 OBE 成果评价。",
  },
]

const AUDIENCES = [
  {
    icon: <GraduationCap className="h-5 w-5" />,
    title: "院校专业负责人",
    desc: "以真实岗位能力模型校准专业定位，识别课程缺口，支撑培养方案修订与专业认证。",
    cta: "进入专业对标",
  },
  {
    icon: <Layers className="h-5 w-5" />,
    title: "教务与教学管理",
    desc: "统一管理多专业的岗位锚点、考核蓝图与学生能力达成度，沉淀可审计的教学证据。",
    cta: "进入教务工作台",
  },
  {
    icon: <Building2 className="h-5 w-5" />,
    title: "合作企业 HR / 技术专家",
    desc: "贡献真实岗位能力标准，与对口院校专业建立常态对标，获取可用之才的培养路径。",
    cta: "提交岗位标准",
  },
]

const STEPS = [
  {
    icon: <FileText className="h-5 w-5" />,
    title: "企业贡献岗位标准",
    desc: "合作企业上传 JD、岗位说明书或内部能力标准。",
  },
  {
    icon: <GitCompareArrows className="h-5 w-5" />,
    title: "平台生成岗位模型",
    desc: "AI 抽取能力维度、技能与知识点，形成结构化、可版本化的岗位能力模型。",
  },
  {
    icon: <Target className="h-5 w-5" />,
    title: "院校专业对标匹配",
    desc: "将专业课程与岗位模型并列对照，量化覆盖度与缺口，指导培养方案与考核设计。",
  },
]

export function GwmxLanding() {
  const navigate = useNavigate()
  const { data: identity } = useGetIdentity<{
    name: string
    primary_org?: { role_name: string } | null
  }>()
  const role = identity ? getUserRole(identity) : ""
  const ctaTarget = identity ? getHomeRoute(role) : "/login?brand=gwmx"
  const goCta = () => navigate(ctaTarget)

  return (
    <div className="h-screen overflow-y-auto bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <BrandLogoMark className="h-9 w-9 rounded-lg" />
            <div className="leading-tight">
              <div className="text-base font-bold tracking-tight text-foreground">工教桥</div>
              <div className="text-[10px] tracking-wider text-muted-foreground">
                ENGINEER × EDUCATION
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={goCta}>
              登录
            </Button>
            <Button size="sm" onClick={goCta}>
              开始使用
              <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-20">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
              面向院校的产教融合工作台
            </div>

            <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-[56px] leading-[1.1]">
              为院校专业找到真实岗位锚点
              <br />
              为企业找到可交付的人才
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              工教桥以岗位能力模型为桥梁，连接院校专业培养方案与企业真实岗位标准，支撑专业对标、课程调整、考核评价与成果达成度评估的完整闭环。
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={goCta}>
                进入工作台
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => {
                  document
                    .getElementById("how-it-works")
                    ?.scrollIntoView({ behavior: "smooth" })
                }}
              >
                了解工作流
              </Button>
            </div>
          </div>

          {/* Anchor trio — school · model · enterprise */}
          <div className="mt-16 grid gap-4 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch">
            <AnchorCard
              label="院校专业"
              title="电气自动化"
              items={["电路分析", "PLC 编程", "电机控制", "工业组态"]}
              tint="school"
            />
            <Connector />
            <AnchorCard
              label="岗位能力模型"
              title="工业自动化工程师"
              items={["PLC 系统设计", "电气图纸", "现场调试", "安全规范"]}
              tint="model"
              highlight
            />
            <Connector />
            <AnchorCard
              label="合作企业"
              title="某装备制造集团"
              items={["招聘画像", "能力评测", "入职培养", "岗位晋升"]}
              tint="enterprise"
            />
          </div>
        </div>
      </section>

      {/* Three pillars */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">核心能力</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
              围绕岗位能力模型的三条主线
            </h2>
            <p className="mt-4 text-muted-foreground">
              建模、对标、评估，构成院校与企业之间可持续的协作通路。
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <div
                key={p.num}
                className="rounded-lg border border-border bg-card p-6 transition-colors hover:border-foreground/30"
              >
                <div className="text-xs font-mono text-muted-foreground">{p.num}</div>
                <h3 className="mt-3 text-lg font-semibold text-foreground">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-b border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">工作流</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
              从企业岗位标准到院校课程决策
            </h2>
          </div>

          <ol className="mt-12 grid gap-6 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-lg border border-border bg-card p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                    {s.icon}
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">
                    STEP {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Audiences */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">适用角色</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
              以院校为主体，企业深度参与
            </h2>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {AUDIENCES.map((a) => (
              <div
                key={a.title}
                className="group flex flex-col rounded-lg border border-border bg-card p-6"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {a.icon}
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">{a.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {a.desc}
                </p>
                <button
                  type="button"
                  onClick={goCta}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {a.cta}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="flex flex-col items-start justify-between gap-6 rounded-lg border border-border bg-card p-8 md:flex-row md:items-center">
            <div className="max-w-xl">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                3 分钟体验一次完整的岗位-专业对标
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                进入工作台，使用示例岗位模型查看专业课程与岗位能力的匹配与缺口。
              </p>
            </div>
            <Button size="lg" onClick={goCta}>
              立即体验
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-6 text-xs text-muted-foreground">
          <span>工教桥 · 智评线旗下产教融合产品</span>
          <span>&copy; {new Date().getFullYear()} 工教桥 · 岗位能力建模与专业对标平台</span>
          <IcpRecordLink />
        </div>
      </footer>
    </div>
  )
}

function AnchorCard({
  label,
  title,
  items,
  tint,
  highlight,
}: {
  label: string
  title: string
  items: string[]
  tint: "school" | "model" | "enterprise"
  highlight?: boolean
}) {
  const tintLabel =
    tint === "school"
      ? "text-sky-600 dark:text-sky-400"
      : tint === "enterprise"
        ? "text-amber-600 dark:text-amber-400"
        : "text-primary"
  return (
    <div
      className={`rounded-lg border bg-card p-5 ${
        highlight ? "border-primary/40 shadow-sm" : "border-border"
      }`}
    >
      <p className={`text-xs font-semibold uppercase tracking-wider ${tintLabel}`}>{label}</p>
      <h3 className="mt-2 text-base font-semibold text-foreground">{title}</h3>
      <ul className="mt-3 space-y-1.5">
        {items.map((it) => (
          <li
            key={it}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <CheckCircle2 className="h-3 w-3 text-primary/70" aria-hidden="true" />
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Connector() {
  return (
    <div className="flex items-center justify-center" aria-hidden="true">
      <div className="hidden sm:flex h-px w-full items-center">
        <div className="h-px flex-1 bg-border" />
        <ArrowRight className="mx-1 h-3.5 w-3.5 text-muted-foreground" />
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="sm:hidden flex h-6 w-full items-center justify-center">
        <ArrowRight className="h-4 w-4 rotate-90 text-muted-foreground" />
      </div>
    </div>
  )
}
