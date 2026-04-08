import { useOne, useUpdate } from "@refinedev/core"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import type { IUser } from "../../../types"
import { getUserRole } from "@/types/rbac"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { UserForm, type UserFormData } from "./user-form"

export function UserEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { result: user, query } = useOne<IUser>({ resource: "users", id: id! })
  const { mutate, mutation } = useUpdate()
  const updateLoading = mutation.isPending

  const handleSubmit = (data: UserFormData) => {
    const payload: Record<string, unknown> = {
      email: data.email,
      full_name: data.full_name,
      role_names: data.roles,
      is_active: data.is_active,
    }
    if (data.password) {
      payload.password = data.password
    }
    mutate(
      { resource: "users", id: id!, values: payload },
      { onSuccess: () => navigate("/users") },
    )
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="h-6 w-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    )
  }

  const initials = (user?.full_name ?? "")
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  const initialData: Partial<UserFormData> = user
    ? {
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        roles: [getUserRole(user)].filter(Boolean),
        is_active: user.is_active,
      }
    : {}

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Avatar className="h-12 w-12">
          <AvatarFallback className="bg-gradient-to-br from-zinc-200 to-zinc-300 text-base font-semibold text-zinc-600 dark:from-zinc-700 dark:to-zinc-600 dark:text-zinc-300">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-foreground tracking-tight">编辑用户</h1>
          <p className="text-sm text-muted-foreground">@{user?.username}</p>
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
        mode="edit"
        initialData={initialData}
        loading={updateLoading}
        onSubmit={handleSubmit}
        onCancel={() => navigate(-1)}
      />
    </div>
  )
}
