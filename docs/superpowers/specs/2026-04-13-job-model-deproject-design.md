# 岗位模型模块去项目化重构设计

- 日期：2026-04-13
- 状态：草案已确认，待进入实施计划
- 目标：移除岗位模型领域中的 `Project` 概念，使 `JobModel` 成为唯一主对象，并以版本实体承载内容演进

## 1. 背景与问题

当前岗位模型模块存在以下问题：

1. 产品概念和技术概念不一致。
   - 用户理解的是“岗位模型”和“版本”。
   - 当前系统对外暴露的是 `Project -> JobModel` 两层结构，`Project` 并不是业务上真实存在的对象。

2. `Project` 已经开始反向影响产品设计。
   - 前端路由依赖 `project_id`
   - 删除行为依赖 `DELETE /projects/:project_id`
   - 创建流程需要先建项目再建模型
   - 标准岗位库、企业快速生成、编辑器跳转都被迫携带 `project_id`

3. 版本语义承载错误。
   - 当前 `Project` 实际承担了“岗位模型容器”的作用
   - `JobModel` 又同时承担“模型实体”和“版本内容”两种职责
   - 这使标准模型、企业模型、版本管理、删除逻辑都不够清晰

## 2. 设计目标

本次重构目标如下：

1. `JobModel` 成为唯一对外的岗位模型主实体
2. 引入 `JobModelVersion` 承载版本内容
3. 完全移除 `Project` 作为产品概念、接口概念和前端路由概念
4. 标准岗位模型与企业岗位模型都作为独立岗位模型主实体存在
5. 企业岗位模型仅通过来源字段引用标准岗位模型
6. 编辑、删除、查看详情、企业派生全部围绕 `JobModel + Version` 运转

## 3. 非目标

本次不包含以下内容：

1. 对旧岗位模型数据做复杂迁移保留
2. 保持新旧结构长期兼容
3. 企业模型反向沉淀为标准模型
4. 版本差异对比页
5. 新增超出当前范围的审核流

说明：
用户已确认当前阶段允许重建，不要求保留旧测试数据和早期结构。

## 4. 新领域模型

### 4.1 JobModel

`JobModel` 代表一个岗位模型资产本身，而不是某一版内容。

建议承载字段：

1. `id`
2. `job_role`
3. `model_type`
   - `standard`
   - `enterprise`
4. `job_family`
5. `industry_code`
6. `industry_name`
7. `direction_code`
8. `direction_name`
9. `org_id`
10. `created_by`
11. `status`
   - `draft`
   - `published`
   - `archived`
12. `origin_standard_model_id`
   - 仅企业模型使用
13. `current_version_id`
14. `created_at`
15. `updated_at`
16. `deleted_at`

语义约束：

1. 标准模型和企业模型都属于 `JobModel`
2. 企业模型是独立资产，不是标准模型的子节点
3. 企业模型通过 `origin_standard_model_id` 记录来源标准模型

### 4.2 JobModelVersion

`JobModelVersion` 代表岗位模型在某一时间点的一版内容。

建议承载字段：

1. `id`
2. `job_model_id`
3. `version`
4. `version_note`
5. `source_type`
   - `manual`
   - `ai_generated`
   - `standard_based`
   - `template`
6. `raw_content`
7. `is_current`
8. `published_at`
9. `created_by`
10. `created_at`
11. `updated_at`
12. `deleted_at`

语义约束：

1. 每个 `JobModel` 至少有一个版本
2. 同一 `JobModel` 只能有一个 `is_current = true`
3. `JobModel.current_version_id` 指向当前版本，便于列表和详情快速读取

### 4.3 内容层挂载

以下内容全部挂到 `JobModelVersion`：

1. `CompetencyDimension`
2. `Skill`
3. `SkillKnowledgePoint`

改造后关系为：

`JobModel -> JobModelVersion -> CompetencyDimension -> Skill -> SkillKnowledgePoint`

### 4.4 文档层

源文档不再挂到 `Project`。

建议改为挂到 `JobModel`，必要时可补充当前版本关联：

1. `job_model_id`
2. 可选 `job_model_version_id`

这样企业快速生成、文档解析、版本编辑之间的关系更自然。

## 5. 标准模型与企业模型关系

### 5.1 标准模型

标准岗位模型是独立的 `JobModel` 主实体，`model_type = standard`。

### 5.2 企业模型

企业岗位模型也是独立的 `JobModel` 主实体，`model_type = enterprise`。

### 5.3 来源关系

企业模型通过 `origin_standard_model_id` 指向其来源标准模型。

不采用以下结构：

1. 企业模型作为标准模型的子节点
2. 企业模型作为标准模型的分支树

原因：

1. 企业模型是独立资产
2. 企业模型和标准模型各自有版本链
3. 后续招聘、培训、校准都应围绕企业模型本身，而非挂靠在标准树下

## 6. 接口设计

### 6.1 岗位模型主实体接口

1. `GET /api/job-models/models`
   - 获取岗位模型列表
   - 支持 `model_type` 等过滤

2. `POST /api/job-models/models`
   - 创建岗位模型主实体
   - 默认同时创建初始版本

3. `GET /api/job-models/models/:jobModelId`
   - 获取岗位模型主信息

4. `PATCH /api/job-models/models/:jobModelId`
   - 更新岗位模型元信息

5. `DELETE /api/job-models/models/:jobModelId`
   - 删除岗位模型
   - 级联删除版本、维度、技能、知识点、关联文档

### 6.2 版本接口

1. `GET /api/job-models/models/:jobModelId/versions`
2. `POST /api/job-models/models/:jobModelId/versions`
3. `GET /api/job-models/models/:jobModelId/versions/:versionId`
4. `PATCH /api/job-models/models/:jobModelId/versions/:versionId`
5. `POST /api/job-models/models/:jobModelId/versions/:versionId/publish`

### 6.3 快速生成接口

保留并调整：

1. `POST /api/job-models/models/recommend-standard`
   - 返回标准岗位模型主实体摘要和当前版本信息

2. 企业派生接口
   - 从标准模型派生企业模型
   - 返回：
     - `job_model_id`
     - `version_id`
   - 不再返回 `project_id`

## 7. 前端路由设计

### 7.1 列表与入口

1. `/gwmx/job-models`
2. `/gwmx/job-models/standard-library`
3. `/gwmx/job-models/fast-create`

### 7.2 编辑器路由

统一改为：

`/gwmx/job-models/:jobModelId/versions/:versionId/editor`

说明：

1. 路由只暴露岗位模型和版本
2. 移除所有 `:projectId`
3. 前端所有跳转和详情入口都围绕新路由更新

## 8. 删除行为设计

用户界面只显示：

`删除岗位模型`

系统行为：

1. 删除 `JobModel`
2. 级联删除其全部 `JobModelVersion`
3. 级联删除版本下的维度、技能、知识点
4. 删除相关源文档和资源关联

不再保留“删除项目”的文案和接口语义。

## 9. 数据迁移策略

本次采用重建式迁移。

### 9.1 原则

1. 不做旧数据保真迁移
2. 不维护旧结构兼容层
3. 旧测试数据允许丢弃

### 9.2 实施方式

1. 新建或重建岗位模型相关核心表
2. 删除或废弃 `job_model_projects`
3. 删除或改造所有对 `project_id` 的依赖
4. 使用新的 seed 脚本写入标准岗位模型示例数据

### 9.3 风险控制

1. 先完成新结构和路由再切前端
2. 用新的标准 seed 数据恢复可用演示环境
3. 用针对性测试覆盖创建、查看、派生、删除、版本发布

## 10. 一期实施边界

一期纳入：

1. 数据模型重构
2. Alembic 迁移
3. 新接口替换旧接口
4. 标准岗位库改造
5. 企业快速生成改造
6. 编辑器路由改造
7. 删除岗位模型功能
8. seed 脚本切换到新结构

一期不纳入：

1. 旧结构读写兼容
2. 复杂历史迁移
3. 标准与企业版本的可视化 diff
4. 企业模型反向沉淀平台标准

## 11. 测试策略

### 11.1 后端

覆盖以下场景：

1. 创建岗位模型时自动创建初始版本
2. 派生企业模型时创建独立 `JobModel` 和版本
3. 发布新版本后正确切换 `current_version_id`
4. 删除岗位模型后内容链路被正确清理
5. 标准岗位推荐与列表过滤仍正常工作

### 11.2 前端

覆盖以下场景：

1. 标准岗位库展示真实数据
2. 查看详情跳转到新编辑器路由
3. 企业快速生成返回 `jobModelId + versionId` 后正确跳转
4. 删除岗位模型后列表移除
5. 空状态与异常状态正确展示

## 12. 决策总结

本次已确认的关键决策如下：

1. 去掉岗位模型中的 `Project` 概念
2. 采用 `JobModel + JobModelVersion` 两层结构
3. 标准模型和企业模型都是独立岗位模型主实体
4. 企业模型通过来源字段引用标准模型
5. 前端路由一起改造，不保留 `projectId`
6. 当前阶段允许重建，不保留旧测试数据

## 13. 后续实施建议

下一步进入实施计划时，建议按以下顺序拆分：

1. 数据模型与迁移
2. 后端接口替换
3. 前端路由替换
4. 标准岗位库与快速生成改造
5. 编辑器适配版本路由
6. 删除与 seed 收尾
