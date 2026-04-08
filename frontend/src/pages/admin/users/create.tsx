import { useForm } from "@refinedev/core"
import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { UserForm, type UserFormData } from "./user-form"

export function UserCreate() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { onFinish, formLoading } = useForm({
    resource: "users",
    action: "create",
    redirect: "list",
    errorNotification: (error) => {
      const detail = (error as any)?.message || "创建用户失败"
      toast({ title: "创建失败", description: detail, variant: "destructive" })
      return false as any
    },
  })

  const handleSubmit = (data: UserFormData) => {
    void onFinish({
      username: data.username,
      email: data.email,
      password: data.password,
      full_name: data.full_name,
      role_names: data.roles,
    })
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-foreground tracking-tight">添加用户</h1>
          <p className="mt-1 text-sm text-muted-foreground">创建一个新的系统用户账号</p>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft size={16} />
          返回用户列表
        </button>
      </div>

      <UserForm
        mode="create"
        loading={formLoading}
        onSubmit={handleSubmit}
        onCancel={() => navigate(-1)}
      />
    </div>
  )
}
