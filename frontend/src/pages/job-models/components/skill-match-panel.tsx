import { useMemo, useState } from "react"
import { Check, ChevronDown, ChevronRight, CircleAlert, LoaderCircle, Minus, Plus, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type MatchedKp = {
  id: string
  name: string
  difficulty: string | null
  status: "matched" | "extra"
  jd_kp_name: string | null
}

export type MatchedSkill = {
  id: string
  name: string
  level: string | null
  status: "matched" | "extra"
  jd_skill_name: string | null
  knowledge_points: MatchedKp[]
}

export type MatchDimension = {
  id: string
  name: string
  skills: MatchedSkill[]
}

export type MissingSkill = {
  name: string
  suggested_level: string | null
  dimension_hint: string | null
  missing_kps: string[]
}

export type MissingKp = {
  name: string
  parent_skill_hint_id: string | null
  parent_skill_hint_name: string | null
}

export type AddedSkillPayload = {
  name: string
  level: string | null
  dimension_id: string | null
  dimension_name: string | null
}

export type AddedKpPayload = {
  name: string
  parent_skill_id: string | null
  parent_skill_name: string | null
}

type MissingSkillState = {
  key: string
  name: string
  level: string | null
  missingKps: string[]
  target: string
  newDimensionName: string
  checked: boolean
}

type MissingKpState = {
  key: string
  name: string
  target: string // skill id, or "__missing__<missing_skill_key>", or "__skip__"
  checked: boolean
}

const NEW_DIMENSION = "__new__"
const SKIP_TARGET = "__skip__"

type Props = {
  jobRole: string
  dimensions: MatchDimension[]
  missingSkills: MissingSkill[]
  missingKnowledgePoints: MissingKp[]
  isSubmitting?: boolean
  onSubmit: (payload: {
    selectedStandardSkillIds: string[]
    selectedStandardKpIds: string[]
    addedSkills: AddedSkillPayload[]
    addedKnowledgePoints: AddedKpPayload[]
  }) => void
  onBack?: () => void
}

export function SkillMatchPanel({
  jobRole,
  dimensions,
  missingSkills,
  missingKnowledgePoints,
  isSubmitting = false,
  onSubmit,
  onBack,
}: Props) {
  const allSkillIds = useMemo(
    () => dimensions.flatMap((dim) => dim.skills.map((s) => s.id)),
    [dimensions],
  )
  const allKpIds = useMemo(
    () =>
      dimensions.flatMap((dim) =>
        dim.skills.flatMap((s) => s.knowledge_points.map((kp) => kp.id)),
      ),
    [dimensions],
  )

  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => {
    const set = new Set<string>()
    dimensions.forEach((dim) =>
      dim.skills.forEach((s) => {
        if (s.status === "matched") set.add(s.id)
      }),
    )
    if (set.size === 0) allSkillIds.forEach((id) => set.add(id))
    return set
  })

  const [selectedKps, setSelectedKps] = useState<Set<string>>(() => {
    const set = new Set<string>()
    dimensions.forEach((dim) =>
      dim.skills.forEach((s) =>
        s.knowledge_points.forEach((kp) => {
          // 默认：匹配到的 KP 保留；多余的 KP 若所在 skill 被保留（matched），一并保留；否则不选
          if (kp.status === "matched") set.add(kp.id)
          else if (s.status === "matched") set.add(kp.id)
        }),
      ),
    )
    if (set.size === 0) allKpIds.forEach((id) => set.add(id))
    return set
  })

  const [expandedSkills, setExpandedSkills] = useState<Record<string, boolean>>(() => {
    // 默认展开包含匹配 KP 的 skill
    const map: Record<string, boolean> = {}
    dimensions.forEach((dim) =>
      dim.skills.forEach((s) => {
        if (s.knowledge_points.some((kp) => kp.status === "matched")) map[s.id] = true
      }),
    )
    return map
  })
  const [showExtras, setShowExtras] = useState<Record<string, boolean>>({})

  const [missingList, setMissingList] = useState<MissingSkillState[]>(() =>
    missingSkills.map((skill, index) => {
      const hint = (skill.dimension_hint ?? "").trim().toLowerCase()
      const match = hint
        ? dimensions.find((dim) => dim.name.toLowerCase() === hint)
        : undefined
      return {
        key: `${skill.name}-${index}`,
        name: skill.name,
        level: skill.suggested_level,
        missingKps: skill.missing_kps,
        target: match ? match.id : dimensions[0]?.id ?? NEW_DIMENSION,
        newDimensionName: skill.dimension_hint ?? "",
        checked: true,
      }
    }),
  )

  const [missingKpList, setMissingKpList] = useState<MissingKpState[]>(() =>
    missingKnowledgePoints.map((kp, index) => ({
      key: `${kp.name}-${index}`,
      name: kp.name,
      target:
        kp.parent_skill_hint_id ?? (dimensions[0]?.skills[0]?.id ?? SKIP_TARGET),
      checked: true,
    })),
  )

  const toggleSkill = (skill: MatchedSkill) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev)
      if (next.has(skill.id)) {
        next.delete(skill.id)
        // 取消 skill 时，KP 也一起取消
        setSelectedKps((kpPrev) => {
          const kpNext = new Set(kpPrev)
          skill.knowledge_points.forEach((kp) => kpNext.delete(kp.id))
          return kpNext
        })
      } else {
        next.add(skill.id)
        setSelectedKps((kpPrev) => {
          const kpNext = new Set(kpPrev)
          skill.knowledge_points.forEach((kp) => {
            if (kp.status === "matched") kpNext.add(kp.id)
          })
          return kpNext
        })
      }
      return next
    })
  }

  const toggleKp = (kpId: string) => {
    setSelectedKps((prev) => {
      const next = new Set(prev)
      if (next.has(kpId)) next.delete(kpId)
      else next.add(kpId)
      return next
    })
  }

  const stats = useMemo(() => {
    let matchedS = 0
    let extraS = 0
    let matchedK = 0
    let extraK = 0
    dimensions.forEach((dim) =>
      dim.skills.forEach((s) => {
        if (s.status === "matched") matchedS += 1
        else extraS += 1
        s.knowledge_points.forEach((kp) => {
          if (kp.status === "matched") matchedK += 1
          else extraK += 1
        })
      }),
    )
    return {
      matchedS,
      extraS,
      matchedK,
      extraK,
      missingS: missingSkills.length,
      missingK: missingKnowledgePoints.length,
    }
  }, [dimensions, missingSkills.length, missingKnowledgePoints.length])

  const handleSubmit = () => {
    const addedSkillsMap = new Map<string, string>() // missing_skill_key -> virtual id
    const addedSkills: AddedSkillPayload[] = missingList
      .filter((item) => item.checked && item.name.trim())
      .map((item) => {
        addedSkillsMap.set(item.key, item.name.trim())
        if (item.target === NEW_DIMENSION) {
          return {
            name: item.name.trim(),
            level: item.level,
            dimension_id: null,
            dimension_name: item.newDimensionName.trim() || item.name.trim(),
          }
        }
        if (item.target === SKIP_TARGET) {
          return {
            name: item.name.trim(),
            level: item.level,
            dimension_id: null,
            dimension_name: null,
          }
        }
        return {
          name: item.name.trim(),
          level: item.level,
          dimension_id: item.target,
          dimension_name: null,
        }
      })
      .filter(
        (item) =>
          item.dimension_id !== null || (item.dimension_name?.trim().length ?? 0) > 0,
      )

    // 把 missing_skills 下挂的 kp 也作为 added_kps（父技能 = 新增技能名）
    const addedKnowledgePoints: AddedKpPayload[] = []
    missingList
      .filter((item) => item.checked)
      .forEach((item) => {
        item.missingKps.forEach((kpName) => {
          const name = kpName.trim()
          if (!name) return
          addedKnowledgePoints.push({
            name,
            parent_skill_id: null,
            parent_skill_name: item.name.trim(),
          })
        })
      })

    // 顶层 missing_kps
    missingKpList
      .filter((item) => item.checked && item.target !== SKIP_TARGET && item.name.trim())
      .forEach((item) => {
        addedKnowledgePoints.push({
          name: item.name.trim(),
          parent_skill_id: item.target,
          parent_skill_name: null,
        })
      })

    onSubmit({
      selectedStandardSkillIds: Array.from(selectedSkills),
      selectedStandardKpIds: Array.from(selectedKps),
      addedSkills,
      addedKnowledgePoints,
    })
  }

  const parentSkillOptions = useMemo(
    () =>
      dimensions.flatMap((dim) =>
        dim.skills.map((s) => ({ id: s.id, label: `${dim.name} / ${s.name}` })),
      ),
    [dimensions],
  )

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">校准技能与知识点</h2>
            <p className="text-sm text-muted-foreground">
              AI 已基于「{jobRole}」的标准技能及其知识点与你的 JD 做了语义对照，可逐层勾选/补充。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge className="gap-1" variant="secondary">
              <Check className="h-3 w-3" /> 技能匹配 {stats.matchedS}
            </Badge>
            <Badge className="gap-1" variant="secondary">
              <Check className="h-3 w-3" /> 知识点匹配 {stats.matchedK}
            </Badge>
            <Badge className="gap-1" variant="outline">
              <CircleAlert className="h-3 w-3" /> 缺失技能 {stats.missingS}
            </Badge>
            <Badge className="gap-1" variant="outline">
              <CircleAlert className="h-3 w-3" /> 缺失知识点 {stats.missingK}
            </Badge>
            <Badge className="gap-1" variant="outline">
              <Minus className="h-3 w-3" /> 多余技能 {stats.extraS}
            </Badge>
          </div>
        </div>
      </section>

      {dimensions.map((dim) => {
        const matchedSkills = dim.skills.filter((s) => s.status === "matched")
        const extraSkills = dim.skills.filter((s) => s.status === "extra")
        const extrasOpen = showExtras[dim.id] ?? false
        return (
          <section
            aria-label={`维度 ${dim.name}`}
            className="rounded-2xl border bg-card p-5 shadow-sm"
            key={dim.id}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{dim.name}</h3>
              <span className="text-xs text-muted-foreground">
                已选 {dim.skills.filter((s) => selectedSkills.has(s.id)).length}/{dim.skills.length} 技能
              </span>
            </div>

            {matchedSkills.length > 0 ? (
              <ul className="space-y-2">
                {matchedSkills.map((skill) => (
                  <SkillRow
                    expanded={expandedSkills[skill.id] ?? false}
                    key={skill.id}
                    onToggle={() => toggleSkill(skill)}
                    onToggleExpanded={() =>
                      setExpandedSkills((prev) => ({ ...prev, [skill.id]: !(prev[skill.id] ?? false) }))
                    }
                    onToggleKp={toggleKp}
                    selected={selectedSkills.has(skill.id)}
                    selectedKps={selectedKps}
                    skill={skill}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">该维度下 JD 未匹配到任何技能。</p>
            )}

            {extraSkills.length > 0 ? (
              <div className="mt-3 border-t pt-3">
                <button
                  className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setShowExtras((prev) => ({ ...prev, [dim.id]: !extrasOpen }))
                  }
                  type="button"
                >
                  <span>标准岗位内其他 {extraSkills.length} 项技能（JD 未提及）</span>
                  <span>{extrasOpen ? "收起" : "展开"}</span>
                </button>
                {extrasOpen ? (
                  <ul className="mt-2 space-y-2">
                    {extraSkills.map((skill) => (
                      <SkillRow
                        dimmed
                        expanded={expandedSkills[skill.id] ?? false}
                        key={skill.id}
                        onToggle={() => toggleSkill(skill)}
                        onToggleExpanded={() =>
                          setExpandedSkills((prev) => ({
                            ...prev,
                            [skill.id]: !(prev[skill.id] ?? false),
                          }))
                        }
                        onToggleKp={toggleKp}
                        selected={selectedSkills.has(skill.id)}
                        selectedKps={selectedKps}
                        skill={skill}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>
        )
      })}

      {missingList.length > 0 ? (
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-3 space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              JD 提到、但标准岗位缺失的技能（{missingList.length}）
            </h3>
            <p className="text-xs text-muted-foreground">
              选择归入哪个维度。若技能有关联的知识点，会一并写入。
            </p>
          </div>
          <ul className="space-y-3">
            {missingList.map((item, index) => (
              <li
                className="rounded-lg border bg-muted/30 p-3"
                key={item.key}
              >
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[auto_1fr_220px]">
                  <Checkbox
                    checked={item.checked}
                    id={`missing-${item.key}`}
                    onCheckedChange={(value) =>
                      setMissingList((prev) =>
                        prev.map((m, i) =>
                          i === index ? { ...m, checked: value === true } : m,
                        ),
                      )
                    }
                  />
                  <div className="flex flex-col gap-1">
                    <Label
                      className="flex items-center gap-2 text-sm text-foreground"
                      htmlFor={`missing-${item.key}`}
                    >
                      <CircleAlert className="h-3.5 w-3.5 text-primary" />
                      {item.name}
                      {item.level ? (
                        <Badge className="font-normal" variant="outline">
                          {item.level}
                        </Badge>
                      ) : null}
                    </Label>
                    {item.target === NEW_DIMENSION ? (
                      <Input
                        aria-label="新建维度名称"
                        className="h-8 text-sm"
                        onChange={(event) =>
                          setMissingList((prev) =>
                            prev.map((m, i) =>
                              i === index
                                ? { ...m, newDimensionName: event.target.value }
                                : m,
                            ),
                          )
                        }
                        placeholder="请输入新维度名称"
                        value={item.newDimensionName}
                      />
                    ) : null}
                  </div>
                  <Select
                    onValueChange={(value) =>
                      setMissingList((prev) =>
                        prev.map((m, i) => (i === index ? { ...m, target: value } : m)),
                      )
                    }
                    value={item.target}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="选择归入的维度" />
                    </SelectTrigger>
                    <SelectContent>
                      {dimensions.map((dim) => (
                        <SelectItem key={dim.id} value={dim.id}>
                          {dim.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW_DIMENSION}>+ 新建维度</SelectItem>
                      <SelectItem value={SKIP_TARGET}>暂不加入</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {item.missingKps.length > 0 ? (
                  <div className="mt-2 pl-8 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">附带知识点：</span>
                    {item.missingKps.join("、")}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {missingKpList.length > 0 ? (
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-3 space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              JD 提到的具体知识点（{missingKpList.length}）
            </h3>
            <p className="text-xs text-muted-foreground">
              这些知识点在保留的技能下暂无对应项，请为其指定父技能。
            </p>
          </div>
          <ul className="space-y-3">
            {missingKpList.map((item, index) => (
              <li
                className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/30 p-3 md:grid-cols-[auto_1fr_260px]"
                key={item.key}
              >
                <Checkbox
                  checked={item.checked}
                  id={`missing-kp-${item.key}`}
                  onCheckedChange={(value) =>
                    setMissingKpList((prev) =>
                      prev.map((m, i) =>
                        i === index ? { ...m, checked: value === true } : m,
                      ),
                    )
                  }
                />
                <Label
                  className="flex items-center gap-2 text-sm text-foreground"
                  htmlFor={`missing-kp-${item.key}`}
                >
                  <CircleAlert className="h-3.5 w-3.5 text-primary" />
                  {item.name}
                </Label>
                <Select
                  onValueChange={(value) =>
                    setMissingKpList((prev) =>
                      prev.map((m, i) => (i === index ? { ...m, target: value } : m)),
                    )
                  }
                  value={item.target}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="选择父技能" />
                  </SelectTrigger>
                  <SelectContent>
                    {parentSkillOptions.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={SKIP_TARGET}>暂不加入</SelectItem>
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-2xl border bg-background/95 p-4 shadow-sm backdrop-blur">
        <div className="text-xs text-muted-foreground">
          将包含 {selectedSkills.size} 项标准技能 · {selectedKps.size} 项知识点
          {missingList.filter((m) => m.checked).length > 0
            ? ` + ${missingList.filter((m) => m.checked).length} 项新增技能`
            : ""}
          {missingKpList.filter((m) => m.checked && m.target !== SKIP_TARGET).length > 0
            ? ` + ${missingKpList.filter((m) => m.checked && m.target !== SKIP_TARGET).length} 项新增知识点`
            : ""}
        </div>
        <div className="flex gap-2">
          {onBack ? (
            <Button onClick={onBack} type="button" variant="outline">
              返回重选
            </Button>
          ) : null}
          <Button
            disabled={
              isSubmitting ||
              (selectedSkills.size === 0 &&
                missingList.every((m) => !m.checked))
            }
            onClick={handleSubmit}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {isSubmitting ? "创建中…" : "创建企业版岗位模型"}
          </Button>
        </div>
      </div>
    </div>
  )
}

type SkillRowProps = {
  skill: MatchedSkill
  selected: boolean
  expanded: boolean
  selectedKps: Set<string>
  onToggle: () => void
  onToggleExpanded: () => void
  onToggleKp: (kpId: string) => void
  dimmed?: boolean
}

function SkillRow({
  skill,
  selected,
  expanded,
  selectedKps,
  onToggle,
  onToggleExpanded,
  onToggleKp,
  dimmed = false,
}: SkillRowProps) {
  const matched = skill.status === "matched"
  const kpCount = skill.knowledge_points.length
  const matchedKps = skill.knowledge_points.filter((kp) => kp.status === "matched")
  const extraKps = skill.knowledge_points.filter((kp) => kp.status === "extra")
  const rowClass = [
    "rounded-md border px-3 py-2 transition-colors bg-background text-foreground",
    selected ? "border-primary" : "border-border",
    dimmed && !selected ? "opacity-60" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <li className={rowClass}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Checkbox
            aria-label={skill.name}
            checked={selected}
            id={`skill-${skill.id}`}
            onCheckedChange={onToggle}
          />
          <Label
            className="flex flex-1 cursor-pointer items-center gap-2 text-sm"
            htmlFor={`skill-${skill.id}`}
          >
            {matched ? (
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <X className="h-3.5 w-3.5 text-rose-500 dark:text-rose-400" />
            )}
            <span
              className={`truncate ${matched ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}
            >
              {skill.name}
            </span>
            {skill.level ? (
              <Badge className="font-normal" variant="outline">
                {skill.level}
              </Badge>
            ) : null}
            {matched && skill.jd_skill_name && skill.jd_skill_name !== skill.name ? (
              <span className="truncate text-xs text-muted-foreground">
                ≈ JD 中&ldquo;{skill.jd_skill_name}&rdquo;
              </span>
            ) : null}
          </Label>
        </div>
        {kpCount > 0 ? (
          <button
            aria-label={expanded ? "收起知识点" : "展开知识点"}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={onToggleExpanded}
            type="button"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <span>
              {skill.knowledge_points.filter((kp) => selectedKps.has(kp.id)).length}/{kpCount} 知识点
            </span>
          </button>
        ) : null}
      </div>

      {expanded && kpCount > 0 ? (
        <ul className="mt-2 space-y-1 border-t pt-2 pl-6">
          {matchedKps.map((kp) => (
            <KpRow
              key={kp.id}
              kp={kp}
              onToggle={() => onToggleKp(kp.id)}
              selected={selectedKps.has(kp.id)}
            />
          ))}
          {extraKps.map((kp) => (
            <KpRow
              dimmed
              key={kp.id}
              kp={kp}
              onToggle={() => onToggleKp(kp.id)}
              selected={selectedKps.has(kp.id)}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

type KpRowProps = {
  kp: MatchedKp
  selected: boolean
  onToggle: () => void
  dimmed?: boolean
}

function KpRow({ kp, selected, onToggle, dimmed = false }: KpRowProps) {
  const matched = kp.status === "matched"
  return (
    <li
      className={[
        "flex items-center gap-2 rounded-md px-2 py-1 transition-colors text-foreground",
        dimmed && !selected ? "opacity-60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Checkbox
        aria-label={kp.name}
        checked={selected}
        id={`kp-${kp.id}`}
        onCheckedChange={onToggle}
      />
      <Label className="flex flex-1 cursor-pointer items-center gap-2 text-xs" htmlFor={`kp-${kp.id}`}>
        {matched ? (
          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Minus className="h-3 w-3 text-muted-foreground" />
        )}
        <span
          className={`truncate ${matched ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}
        >
          {kp.name}
        </span>
        {kp.difficulty ? (
          <Badge className="font-normal" variant="outline">
            {kp.difficulty}
          </Badge>
        ) : null}
        {matched && kp.jd_kp_name && kp.jd_kp_name !== kp.name ? (
          <span className="truncate text-[11px] text-muted-foreground">
            ≈ &ldquo;{kp.jd_kp_name}&rdquo;
          </span>
        ) : null}
      </Label>
    </li>
  )
}
