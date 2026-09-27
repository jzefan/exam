"""One place that decides what a provider question is.

The provider prints its own label ("单选题", "名词解释", …) and sometimes marks the
container with an `objective` CSS class, but CSS is a rendering detail of a page
we do not control. Both the AI/subjective routing and the objective/subjective
flag are derived from the label here, so this reader cannot disagree with
`exams/router.py`, whose split is: objective = choice / true_false / fill_in,
subjective = short_answer / essay / code.
"""

import re

# Same split as exams/router.py::_OBJECTIVE_QUESTION_TYPES / _SUBJECTIVE_TYPES.
OBJECTIVE_TYPES = frozenset({"choice", "true_false", "fill_in"})
SUBJECTIVE_TYPES = frozenset({"short_answer", "essay", "code"})

# A paper that asks the student to write code, under whatever label the provider
# filed the question. `re.search` has no longest-match preference, so the first
# alternative that matches decides the prompt flavour.
CODE_REQUEST = re.compile(
    "编写程序|编写代码|编写函数|编写一个函数|编程实现|程序实现|代码实现|补全代码|补全程序|调试程序|程序填空|运行结果"
)

# Most specific keyword first: "程序设计" must not be read as "设计".
LABEL_TYPES: tuple[tuple[str, str], ...] = (
    ("多选", "choice"),
    ("单选", "choice"),
    ("选择", "choice"),
    ("判断", "true_false"),
    ("填空", "fill_in"),
    ("程序设计", "code"),
    ("编程", "code"),
    ("代码", "code"),
    ("简答", "short_answer"),
    ("论述", "essay"),
    ("问答", "short_answer"),
    ("名词解释", "short_answer"),
    ("解答", "short_answer"),
    ("计算", "short_answer"),
    ("证明", "short_answer"),
    ("分析", "short_answer"),
    ("设计", "short_answer"),
)


def canonical_type(question_type: str | None) -> str | None:
    """Fold a provider label into one of the project's six question types.

    An unrecognized label returns None: this reader reports what it recognized
    and never guesses what a question is.
    """
    label = (question_type or "").strip()
    if not label:
        return None
    return next((canonical for keyword, canonical in LABEL_TYPES if keyword in label), None)


def is_objective(question_type: str | None) -> bool | None:
    """True/False when the label is recognized, None when it is not.

    None lets the caller fall back to the provider's own `objective` class
    instead of inventing a classification.
    """
    canonical = canonical_type(question_type)
    return None if canonical is None else canonical in OBJECTIVE_TYPES


def ai_type(question_type: str | None, content: str = "") -> str | None:
    """Which grader should read this answer, or None when it stays with the teacher.

    The caller routes recognized objective questions around the AI queue. Known
    written types use the matching grader; missing or unrecognized non-objective
    types use the generic text grader so labels such as "其它" do not silently
    require a teacher. A concept question and a "write a program" question can
    share one label (简答题), so the stem picks the programming prompt.
    """
    label = (question_type or "").strip()
    canonical = canonical_type(label)
    if canonical is None:
        return "short_answer"
    if canonical not in SUBJECTIVE_TYPES:
        return None
    return "code" if canonical == "code" or CODE_REQUEST.search(content) else "short_answer"
