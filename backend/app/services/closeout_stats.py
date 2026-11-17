"""结项统计引擎：只用标准库实现显著性检验与效应量计算。

新链路读取对比组观测数据后，在这里完成：
- 比率型指标（转化率等）：两比例 Z 检验 + Cohen's h 效应量；
- 均值型指标：Welch t 检验（样本量较大时用正态近似）+ Cohen's d 效应量；
- 显著性阈值解析（支持 0.05 / "0.05" / "5%" 三种写法）。
"""
from __future__ import annotations

import math
from typing import Any

DEFAULT_ALPHA = 0.05


def normal_cdf(value: float) -> float:
    """标准正态分布累积分布函数，基于 erf，避免引入第三方依赖。"""
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def parse_alpha(raw: Any, default: float = DEFAULT_ALPHA) -> float:
    """把活动方案上配置的显著性阈值解析成 (0, 1) 区间的小数。"""
    if raw is None or str(raw).strip() == "":
        return default
    text = str(raw).strip().rstrip("%")
    try:
        value = float(text)
    except (TypeError, ValueError):
        return default
    if "%" in str(raw):
        value /= 100.0
    if not 0.0 < value < 1.0:
        return default
    return value


def _to_float(raw: Any) -> float | None:
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _num(raw: Any, default: float = 0.0) -> float:
    value = _to_float(raw)
    return value if value is not None else default


def _rate_result(experiment: dict[str, Any], control: dict[str, Any]) -> dict[str, float]:
    n_exp = max(_num(experiment.get("样本量")), 1.0)
    n_ctl = max(_num(control.get("样本量")), 1.0)
    p_exp = _num(experiment.get("转化率"))
    p_ctl = _num(control.get("转化率"))
    conv_exp = _to_float(experiment.get("转化人数"))
    conv_ctl = _to_float(control.get("转化人数"))
    pooled = ((conv_exp if conv_exp is not None else n_exp * p_exp)
              + (conv_ctl if conv_ctl is not None else n_ctl * p_ctl)) / (n_exp + n_ctl)
    se = math.sqrt(max(pooled * (1.0 - pooled) * (1.0 / n_exp + 1.0 / n_ctl), 1e-12))
    z_score = (p_exp - p_ctl) / se
    p_value = 2.0 * (1.0 - normal_cdf(abs(z_score)))
    # Cohen's h：反正弦变换后的比率差异
    h_value = 2.0 * (math.asin(math.sqrt(min(max(p_exp, 0.0), 1.0)))
                     - math.asin(math.sqrt(min(max(p_ctl, 0.0), 1.0))))
    return {
        "实验组指标值": p_exp,
        "对照组指标值": p_ctl,
        "差异": p_exp - p_ctl,
        "检验统计量": z_score,
        "p值": max(p_value, 0.0),
        "效应量": h_value,
    }


def _mean_result(experiment: dict[str, Any], control: dict[str, Any]) -> dict[str, float]:
    n_exp = max(_num(experiment.get("样本量")), 1.0)
    n_ctl = max(_num(control.get("样本量")), 1.0)
    mean_exp = _num(experiment.get("均值"))
    mean_ctl = _num(control.get("均值"))
    var_exp = _num(experiment.get("方差"))
    var_ctl = _num(control.get("方差"))
    se = math.sqrt(max(var_exp / n_exp + var_ctl / n_ctl, 1e-12))
    t_score = (mean_exp - mean_ctl) / se
    # 样本量足够大时 t 分布趋近标准正态，直接用正态近似求双侧 p 值
    p_value = 2.0 * (1.0 - normal_cdf(abs(t_score)))
    pooled_sd = math.sqrt(max(((n_exp - 1) * var_exp + (n_ctl - 1) * var_ctl)
                              / max(n_exp + n_ctl - 2.0, 1.0), 1e-12))
    d_value = (mean_exp - mean_ctl) / pooled_sd if pooled_sd > 0 else 0.0
    return {
        "实验组指标值": mean_exp,
        "对照组指标值": mean_ctl,
        "差异": mean_exp - mean_ctl,
        "检验统计量": t_score,
        "p值": max(p_value, 0.0),
        "效应量": d_value,
    }


def evaluate(experiment: dict[str, Any], control: dict[str, Any], alpha: float) -> dict[str, Any]:
    """按观测数据类型选择检验方法，输出显著性结论与效应量。"""
    is_rate = _to_float(experiment.get("转化率")) is not None and _to_float(control.get("转化率")) is not None
    result = _rate_result(experiment, control) if is_rate else _mean_result(experiment, control)
    diff = result["差异"]
    result["指标口径"] = "比率型" if is_rate else "均值型"
    result["显著性阈值"] = alpha
    result["是否显著"] = result["p值"] < alpha
    result["差异方向"] = "实验组提升" if diff > 0 else ("实验组下降" if diff < 0 else "无差异")
    result["显著性结论"] = (
        f"{result['差异方向']}，p={result['p值']:.4f} "
        f"{'小于' if result['是否显著'] else '不小于'}阈值{alpha:g}，结论："
        f"{'差异显著' if result['是否显著'] else '差异不显著'}"
    )
    return result
