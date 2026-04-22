## 代码题双模式实现计划

### 目标

- 新建代码题默认使用“完整程序题（program）”
- 函数题保留为“高级模式（function）”
- 学生端默认围绕 `stdin -> stdout` 展示和运行完整程序题
- 当前旧函数模板不再作为默认模板继续扩散

### 实施范围

#### 1. 数据结构与类型

- 在前后端代码题内容结构中补充 `mode`
- 为 `program` 模式补充明确字段：
  - `description`
  - `input_description`
  - `output_description`
  - `constraints`
  - `examples`
  - `sample_tests`
  - `starter_code`
- 为 `function` 模式补充高级字段：
  - `function_name`
  - `parameters`
  - `return_type`
  - `signature`
  - `sample_tests`
  - `starter_code`

#### 2. 教师端建题 / 编辑

- 在创建题目页中，代码题新增“作答模式”切换
- 默认选中“完整程序题（推荐）”
- `program` 模式展示输入说明、输出说明、示例、测试用例和可选模板
- `function` 模式展示函数名、参数、返回值、函数式测试用例和模板
- 编辑页支持读取并编辑上述两种模式

#### 3. 学生端展示与作答

- `program` 模式下不再展示函数签名、函数名、`class Solution` 相关心智
- `program` 模式突出：
  - 题目描述
  - 输入说明
  - 输出说明
  - 示例输入/输出
- `function` 模式下保留函数名、签名、参数信息展示
- 编辑器默认 starter code 按模式选择：
  - `program` 为空白完整程序模板
  - `function` 为函数模板

#### 4. 在线运行主路径

- `program` 模式继续使用 `sample_tests[].input -> expected_output`
- `function` 模式暂时保持兼容字段，不在本轮扩正式包装执行器
- 后端运行接口读取 `mode`，优先按 `program` 语义处理

#### 5. 测试与验证

- 前端：
  - 创建题目页默认 program 模式测试
  - 创建题目页提交 payload 测试
  - 学生端 `program` / `function` 展示测试
- 后端：
  - 在线运行接口读取 program 题目样例测试
- 最后运行针对性测试和 TypeScript 校验

### 实施顺序

1. 写 failing tests，钉住默认 program 模式和学生端双模式展示
2. 修改前端类型定义
3. 改造创建/编辑题目页
4. 改造学生端代码题组件
5. 必要时补后端读取逻辑
6. 跑验证并收尾

### 风险与处理

- 风险：当前创建/编辑页结构较旧，直接大改容易影响其它题型
  - 处理：只在 `type === "code"` 分支下新增 UI，保持其它题型逻辑不动
- 风险：学生端已有代码题测试依赖旧字段
  - 处理：测试分两类保留，新增 `mode` 主路径测试并保留 function fallback
- 风险：函数题执行器本轮不彻底升级
  - 处理：本轮只把默认路径切正，高级模式先兼容现有结构
