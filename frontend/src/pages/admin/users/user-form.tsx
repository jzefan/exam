import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

const ROLE_OPTIONS = [
  { value: "student", label: "学生" },
  { value: "teacher", label: "教师" },
  { value: "school_admin", label: "学校管理员" },
  { value: "enterprise_user", label: "企业用户" },
  { value: "enterprise_admin", label: "企业管理员" },
  { value: "platform_admin", label: "平台管理员" },
]

export interface UserFormData {
  username: string
  email: string
  password: string
  full_name: string
  roles: string[]
  teacher_ids: string[]
  is_active: boolean
}

interface TeacherOption {
  id: string
  full_name: string
  username: string
}

interface UserFormProps {
  mode: "create" | "edit"
  initialData?: Partial<UserFormData>
  teacherOptions?: TeacherOption[]
  loading: boolean
  onSubmit: (data: UserFormData) => void
  onCancel: () => void
}

export function UserForm({
  mode,
  initialData,
  teacherOptions = [],
  loading,
  onSubmit,
  onCancel,
}: UserFormProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState<UserFormData>({
    username: initialData?.username ?? "",
    email: initialData?.email ?? "",
    password: "",
    full_name: initialData?.full_name ?? "",
    roles: initialData?.roles ?? [],
    teacher_ids: initialData?.teacher_ids ?? [],
    is_active: initialData?.is_active ?? true,
  })
  const isStudent = form.roles.includes("student")

  const updateField = (field: keyof UserFormData, value: string | string[] | boolean | null) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const toggleRole = (role: string) => {
    const nextRoles = form.roles.includes(role)
      ? form.roles.filter((r) => r !== role)
      : [...form.roles, role]
    setForm((prev) => ({
      ...prev,
      roles: nextRoles,
      teacher_ids: nextRoles.includes("student") ? prev.teacher_ids : [],
    }))
  }

  const toggleTeacher = (teacherId: string) => {
    setForm((prev) => ({
      ...prev,
      teacher_ids: prev.teacher_ids.includes(teacherId)
        ? prev.teacher_ids.filter((id) => id !== teacherId)
        : [...prev.teacher_ids, teacherId],
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(form)
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label>用户名</Label>
            <Input
              type="text"
              placeholder="请输入用户名"
              value={form.username}
              onChange={(e) => updateField("username", e.target.value)}
              disabled={mode === "edit"}
              required
              autoComplete="off"
            />
            {mode === "edit" && (
              <p className="text-xs text-muted-foreground">用户名创建后不可修改。</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{mode === "create" ? "密码" : "重置密码"}</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                className="pr-10"
                placeholder={mode === "create" ? "请输入密码" : "留空则不修改密码"}
                value={form.password}
                onChange={(e) => updateField("password", e.target.value)}
                required={mode === "create"}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>角色</Label>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((role) => {
                const selected = form.roles.includes(role.value)
                return (
                  <Badge
                    key={role.value}
                    variant={selected ? "default" : "outline"}
                    className={cn(
                      "cursor-pointer select-none transition-colors px-3 py-1.5 text-sm",
                      selected ? "" : "hover:bg-accent",
                    )}
                    onClick={() => toggleRole(role.value)}
                  >
                    {role.label}
                  </Badge>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              点击选择一个或多个角色，角色决定用户在系统中的访问权限。
            </p>
          </div>

          {isStudent && (
            <div className="space-y-1.5">
              <Label>关联教师</Label>
              <div className="flex flex-wrap gap-2 rounded-md border border-input bg-background p-3">
                {teacherOptions.map((teacher) => (
                  <Badge
                    key={teacher.id}
                    variant={form.teacher_ids.includes(teacher.id) ? "default" : "outline"}
                    className={cn(
                      "cursor-pointer select-none transition-colors px-3 py-1.5 text-sm",
                      form.teacher_ids.includes(teacher.id) ? "" : "hover:bg-accent",
                    )}
                    onClick={() => toggleTeacher(teacher.id)}
                  >
                    {teacher.full_name} @{teacher.username}
                  </Badge>
                ))}
                {teacherOptions.length === 0 && (
                  <p className="text-sm text-muted-foreground">暂无可关联教师</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                学生账号可同时关联多个教师；教师之间不会共享彼此创建的考试和成绩数据。
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>姓名</Label>
            <Input
              type="text"
              placeholder="例如 张三"
              value={form.full_name}
              onChange={(e) => updateField("full_name", e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>邮箱</Label>
            <Input
              type="email"
              placeholder="请输入邮箱"
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
              required
            />
          </div>

          {mode === "edit" && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted border border-border">
              <Switch
                checked={form.is_active}
                onCheckedChange={(checked) => updateField("is_active", checked)}
              />
              <div>
                <p className="text-sm font-medium text-foreground">
                  账号{form.is_active ? "已启用" : "已禁用"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {form.is_active ? "用户可以正常登录和使用系统" : "用户将无法登录系统"}
                </p>
              </div>
            </div>
          )}

          <Separator />

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {mode === "create" ? "创建中..." : "保存中..."}
                </span>
              ) : (
                mode === "create" ? "创建用户" : "保存修改"
              )}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              取消
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
