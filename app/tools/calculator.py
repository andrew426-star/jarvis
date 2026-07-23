import ast
import math

# A hand-rolled AST-walking evaluator — never calls eval()/exec()/compile()
# in executable mode. ast.parse(..., mode="eval") only ever produces a
# syntax tree; nothing here hands that tree (or any string) to Python's
# actual interpreter. Only the node types explicitly handled below can ever
# be evaluated — anything else (Name-as-value, Attribute, Subscript,
# comprehensions, f-strings, ...) raises immediately, so there's no
# sandbox-escape surface the way a restricted eval() with limited globals
# would still have.


def _compound_interest(principal, rate, years, periods_per_year=1):
    return principal * (1 + rate / periods_per_year) ** (periods_per_year * years)


def _simple_interest(principal, rate, years):
    return principal * (1 + rate * years)


def _percentage(part, whole):
    return part / whole * 100


def _percentage_change(old, new):
    return (new - old) / old * 100


ALLOWED_FUNCTIONS = {
    "compound_interest": _compound_interest,
    "simple_interest": _simple_interest,
    "percentage": _percentage,
    "percentage_change": _percentage_change,
    "sqrt": math.sqrt,
    "round": round,
    "abs": abs,
    "min": min,
    "max": max,
}

_BINOPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.Pow: lambda a, b: a**b,
    ast.FloorDiv: lambda a, b: a // b,
    ast.Mod: lambda a, b: a % b,
}


def _eval(node):
    if isinstance(node, ast.Expression):
        return _eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(
        node.value, bool
    ):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _BINOPS:
        return _BINOPS[type(node.op)](_eval(node.left), _eval(node.right))
    if isinstance(node, ast.UnaryOp):
        value = _eval(node.operand)
        return -value if isinstance(node.op, ast.USub) else value
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ALLOWED_FUNCTIONS:
        call_args = [_eval(a) for a in node.args]
        call_kwargs = {kw.arg: _eval(kw.value) for kw in node.keywords}
        return ALLOWED_FUNCTIONS[node.func.id](*call_args, **call_kwargs)
    raise ValueError(f"unsupported expression: {ast.dump(node)}")


def calculator(args: dict) -> dict:
    expression = str(args.get("expression") or "").strip()
    if not expression:
        return {"ok": False, "error": "expression is required"}
    try:
        result = _eval(ast.parse(expression, mode="eval"))
        return {"ok": True, "expression": expression, "result": result}
    except Exception as exc:  # noqa: BLE001 — tool dispatch must never raise
        return {"ok": False, "expression": expression, "error": str(exc)}
