# 学习通连接与阅卷

入口：阅卷中心 → 学习通（`/grading/chaoxing`）。流程为登录 → 教师课程 → 考试 → 考生姓名、学号 → 核对并保存答卷 → AI 评分 → 教师确认。已保存记录位于 `/grading/chaoxing/results`，断开学习通后仍可访问。没有创建学生账户、写入错题库或回填学习通成绩的接口。

## 本地启动

教师使用普通网页，无需安装客户端或扩展。下面的依赖安装发生在运行本系统的服务器上。

```bash
cd backend
UV_CACHE_DIR=/tmp/uv-cache uv sync --extra chaoxing --extra dev
PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run alembic upgrade head
UV_CACHE_DIR=/tmp/uv-cache uv run --extra chaoxing playwright install chromium
# Linux 服务器第一次安装可使用 playwright install --with-deps chromium
cd ..
bash scripts/run-chaoxing-dev.sh
# 另一个终端：
cd frontend
pnpm dev
```

沿用 `backend/.env` 中的数据库和认证配置。启动前按项目现有方式启动本地数据库。不要同时占用 8000 端口。可用 `EXAM_CHAOXING_PORT` 修改脚本监听端口，并同步修改开发代理。也可设置 `EXAM_CHAOXING_BROWSER_EXECUTABLE` 使用管理员提供的 Chromium 可执行文件。

已有本地后端运行时，先停止原开发后端再使用上述脚本。不要在同一数据库旁额外启动完整 API 作为旁路连接服务，因为现有启动流程会恢复待执行的评分任务。

应用代码默认关闭连接器；生产部署默认启用。运行 `./scripts/deploy.sh --target backend`（同时更新前端用 `--target app`）时，会为服务器 `shared/env/backend.env` 补上缺失的 `EXAM_CHAOXING_ENABLED=true`，但保留已有明确的 `false`。生产镜像安装 `chaoxing` 依赖、Chromium 和 Linux 运行库，入口按开关选择一个或两个 worker。部署前会在新镜像中实际启动并关闭浏览器；依赖或浏览器不可用时，停止发布，保留旧后端在线。

启用学习通时，部署先完成镜像构建、浏览器检查和迁移，再停止旧后端并启动新后端，健康检查通过后切流。期间 API 短暂中断，学习通临时登录会丢失；建议避开正在阅卷和考试的时段。切换失败会尝试启动保留的旧容器并恢复原 Nginx 配置。Compose 用共享命名卷 `exam_chaoxing_lock` 将两个槽位的锁放到 `/run/chaoxing/connector.lock`，防止误启动两个消费者。仍只支持同一 Docker 主机单实例；跨主机扩容需先拆分会话和队列。前端单独部署不会启用或重启后端。

若管理员先前显式关闭过功能，需将服务器 `shared/env/backend.env` 中的开关改为 `true` 后重新部署。服务器不要设置开发机的 `EXAM_CHAOXING_BROWSER_EXECUTABLE` 路径，生产 Compose 会指定镜像内的 `/usr/local/bin/chaoxing-chromium`。Chromium 默认直接通过 `https://cdn.npmmirror.com/binaries/chrome-for-testing/<版本>/<平台>/<文件>` 下载，避免新版 Playwright 自动附加 `builds/cft/` 后与镜像路径不匹配。可用 `CHROMIUM_FOR_TESTING_DOWNLOAD_HOST` 指向相同目录结构的内部镜像；镜像不可用时构建自动重试官方 CDN。首次升级会下载浏览器，镜像构建时间和体积会增加；同一 Playwright/锁文件版本的后续代码发布会复用 Docker 浏览器层，除非手动清理 Docker builder 缓存。

## 登录行为

- 点击连接后，服务器为当前教师建立独立的非持久化 Chromium context。窗口显示学习通官方页面的截图，键盘、点击和人工拖动被发送到该页面。二维码、用户名密码、验证码是否可用，以学习通当前页面和服务器网络为准。
- 登录输入会经过本系统服务器。请使用 HTTPS；不要在代理、APM 或调试工具中记录此路径的请求体、截图或浏览器协议。代码不记录输入、不导出 Cookie/token，不开启 trace/HAR/video，不保存浏览器 storage state。
- 登录后点击“已完成登录，验证连接”，必须同时检测到学习通身份 Cookie 和可识别的教师课程页面才算连接成功。成功后关闭登录页面，保留同一隔离 context 用于读取。
- Cookie 仅在服务器浏览器会话中使用，不返回给网页。会话仅属于当前本系统用户，管理员也不能读其他用户的会话。
- 点击“断开”关闭 context 并清除临时记录；默认空闲 30 分钟、绝对 2 小时后清理。截图轮询不会延长空闲时间。仅关闭弹窗或退出网页不会立即关闭服务端会话，会由超时清理。服务重启需要重新登录。
- 并发上限默认 3 位教师，每个会话串行执行浏览器操作。连接功能不调用 LLM。

环境变量：`EXAM_CHAOXING_ENABLED`、`EXAM_CHAOXING_MAX_SESSIONS`、`EXAM_CHAOXING_IDLE_SECONDS`、`EXAM_CHAOXING_MAX_AGE_SECONDS`、`EXAM_CHAOXING_BROWSER_EXECUTABLE`、`EXAM_CHAOXING_LOCK_PATH`。后端 HTTP 接口位于 `/api/chaoxing`，沿用本系统 Bearer 认证和教师/管理员角色边界。

## 读取边界与验收

当前适配 ArkLoop 已识别的 `fycourse` 教师 HTML 课程页、`mooc2-ans` 考试/批阅页及 LayUI 固定列。仅使用已知读取地址，不接收任意 URL；读取页阻止非 GET/HEAD 请求，不开放页面点击和成绩提交。来源 URL、签名和 Cookie 不发往前端。

所有列表明确标记 `complete: false`。最多跟随 5 个同一考试或同一答卷的可识别分页链接；JavaScript 分页、不同结构的 iframe、学校统一认证跳转和 JSON 课程结构需要根据真实账号页面继续适配。无法识别页面会报错，不把它当作“零条数据”。附件仅标记人工核对，不单独下载或保存、不参与自动评分；源页面加载时浏览器仍可能请求其中的图片资源。程序答案保留换行和缩进，未知分数保留 `null`。

连接已由教师手动验证。不同学校、课程及分页结构仍需用获授权的账号核对以下范围，当前采用逐份核对后导入，不自动导入整班：

1. 在拟部署服务器上登录，确认验证码/风控和会话有效期，核对教师权限。
2. 至少两个学期和两门课程，核对课程、考试列表及空列表。
3. 选择包含已交、未交考生且有多页的考试，核对人数、姓名和学号。
4. 至少两份含程序题/图片答案的答卷，核对每题题干、参考答案、分值和作答内容。
5. 验证两位教师隔离、断开、空闲到期、源站登录失效及服务重启。

保存前必须勾选已核对本份答卷的题目和分值。服务器仅保存本会话刚读取的快照，通过哈希拒绝过期预览或前端伪造的答卷内容。完整性尚未自动证明，保存份数与源站已提交人数分别显示；题目满分合计与源试卷满分不符时不生成最终成绩。

## 验证命令

```bash
cd backend
PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --extra chaoxing pytest tests/test_chaoxing.py tests/test_chaoxing_grading.py tests/grading/test_service.py -q
cd ../frontend
pnpm exec vitest run src/pages/chaoxing
pnpm build
pnpm exec playwright test -c playwright.chaoxing.config.ts
```

离线解析和模拟接口测试不代表真实学习通账号已连通。账号登录与服务器端风控适配仍是上线前必须完成的验证。

教师已自行验证真实账号可连接。自动化测试使用合成答卷和模拟源站，不能替代真实分页与答卷完整性核对。

## 评分与持久化

- 四张独立表 `chaoxing_grading_exams/candidates/items/audits` 存储教师所属考试、姓名学号、题目评分和操作审计。账号只保存源 UID 的哈希用于区分来源；不落库 Cookie、密码和带签名的 URL。候选人不关联本系统学生账号或错题库。每位本系统教师仅访问自己的记录，管理员角色也不会自动获得其他教师的外部答卷。
- 重复保存相同快照返回已有记录；作答、题目或分值变化时生成新的答卷版本，保留旧版确认分及评分快照。历史版本只读。
- 主观文字题依据题干、参考答案及满分进入现有主评/复核引擎，使用当前激活的评分配置版本；模型输入不追加姓名、学号。代码题按静态评阅处理，不声称运行过测试。题型不支持、缺少评分依据或含附件的题目转人工评分。客观题沿用有效源分，不调用模型；未知源分不当成零分。
- 每份答卷点击 AI 评分，只为待评分和失败题入队。重复点击、已生成建议分或已确认的题目不会重新调用模型。队列串行处理，与浏览器会话独立；页面轮询不触发模型。默认沿用 `EXAM_ARBITER_ENABLED` 设置，未启用时不调用第三模型。
- AI 建议分和教师确认分分别保存，支持小数。教师可补充缺失满分、输入确认分及评语；版本校验防止旧页面覆盖新确认。旧模型任务完成时也不能覆盖教师结果或新答卷。
- 后台中断时，已提交数据库的模型结果直接恢复，未确定完成的调用标记失败，需教师主动重试，不自动造成重复费用。失败重试是新的模型调用，已发出的失败/中断调用可能计费。
- 已确认小计包含教师确认分和客观题已知源分；最终成绩只在当前答卷全部题目处理完成且满分核对一致时产生。导出的未完成最终成绩留空，学号按文本输出，防止前导零丢失及公式注入。
- 结果页面显示评分配置版本、模型理由与风险提示、确认审计。附件本身不落库；答卷文字与评分证据会保留以支持教师复核及版本审计，尚未设置自动清理周期。

迁移 `20260920_chaoxing_grading` 依赖 `20260920_add_kp_sort_order`，将 `grading_tasks.max_score` 扩为浮点型，避免外部题目小数满分丢失。开发启动脚本默认关闭 SQL echo；不要在生产记录答卷或模型响应的 SQL 参数。当前依然要求启用连接器的 API 单进程、单副本，不能启动多个实例消费同一个队列。
