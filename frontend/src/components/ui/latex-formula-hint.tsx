export function LatexFormulaHint() {
  return (
    <p className="text-xs text-muted-foreground">
      富文本编辑器可点 Σ 插入行内公式；其他字段可写 <code>$x^2$</code>。独立公式写{" "}
      <code>$$a^2+b^2=c^2$$</code>。
    </p>
  );
}
