"""活动方案 × 对比组联合结项业务规则。

核心约束（与需求逐条对应）：
1. 只有「已执行」状态的对比组才能进入结项，草稿/审批中对比只作为候选并被拦截；
2. 活动指标与对比结论必须一起成功——任一环节失败整体回滚，不会留下半截结项数据；
3. 提交只接收含活动结项评估明细数据集的唯一可用结果：同一活动只保留一份当前（is_current）结项结论，
   重复结项直接拒绝；历史批次保留用于数据版本核对；
4. 同一活动存在多个完整度不同的已执行对比时，先按样本窗口完整度（窗口天数）择优，
   再按执行完成时间（更晚者）择优，只形成一份当前结项结论；
5. 对比分析归档记录写入活动结项评估明细数据集：结项同时把命中的对比组置为「已归档」，
   结项结论同步回对比分析清单；
6. 每条结果附处理批次号与数据版本，活动方案结项页按同一评估批次读取。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.services.closeout_stats import evaluate, parse_alpha
from app.store import store

ACTIVITY_MODULE = "activity"
COMPARISON_MODULE = "comparison"
CLOSEOUT_MODULE = "activity_closeout"

ACTIVITY_METRIC_FIELDS = ["指标名称", "样本量"]
OBSERVATION_FIELDS = ["样本量"]
EXECUTED_STATUS = "已执行"
ARCHIVED_STATUS = "已归档"
CANDIDATE_STATUSES = ["草稿", "对比审批中"]


class CloseoutService:
    # ---------- 数据集读取 ----------
    def list_closeouts(
        self,
        *,
        keyword: str | None = None,
        activity_id: int | None = None,
        batch_no: str | None = None,
        current_only: bool = False,
        page: int = 1,
        size: int = 20,
    ) -> tuple[list[dict[str, Any]], int]:
        """分页读取活动结项评估明细数据集，支持按方案编号/批次/当前结论过滤。"""
        rows = list(store.rows(CLOSEOUT_MODULE))
        if keyword:
            rows = [row for row in rows if keyword in str(row.get("方案编号", ""))]
        if activity_id is not None:
            rows = [row for row in rows if int(row.get("活动id", 0)) == activity_id]
        if batch_no:
            rows = [row for row in rows if str(row.get("处理批次", "")) == batch_no]
        if current_only:
            rows = [row for row in rows if row.get("is_current")]
        rows.sort(key=lambda row: int(row.get("id", 0)), reverse=True)
        total = len(rows)
        start = max(page - 1, 0) * size
        return rows[start:start + size], total

    def get_closeout(self, closeout_id: int) -> dict[str, Any] | None:
        return store.find(CLOSEOUT_MODULE, closeout_id)

    def get_current_by_activity(self, activity_id: int) -> dict[str, Any] | None:
        """活动方案结项页按活动读取同一评估批次的当前结项结论。"""
        for row in store.rows(CLOSEOUT_MODULE):
            if int(row.get("活动id", 0)) == activity_id and row.get("is_current"):
                return row
        return None

    # ---------- 联合结项提交（新链路） ----------
    def submit_closeout(self, payload: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
        activity_id = payload.get("活动id")
        activity_metrics = payload.get("活动指标") or {}
        candidate_ids = payload.get("候选对比id") or []

        # 1) 活动方案存在性与状态核对
        if activity_id is None:
            return None, "联合结项缺少活动id，无法定位活动方案"
        try:
            activity_id = int(activity_id)
        except (TypeError, ValueError):
            return None, f"活动id「{activity_id}」格式不正确"
        activity = store.find(ACTIVITY_MODULE, activity_id)
        if activity is None:
            return None, f"活动方案 {activity_id} 不存在或已归档"
        if activity.get("status") == "已结项":
            return None, f"活动方案 {activity.get('方案编号')} 已结项，不能重复结项"

        # 2) 活动方案指标记录：指标与对比结论必须一起成功，指标缺失直接整单失败
        missing_metrics = [field for field in ACTIVITY_METRIC_FIELDS
                           if str(activity_metrics.get(field) or "").strip() == ""]
        if missing_metrics:
            return None, f"活动方案指标记录缺少必填字段：{'、'.join(missing_metrics)}，本次结项整体驳回"

        # 3) 重复结项核对：同一活动只允许一份当前结项结论
        if self.get_current_by_activity(activity_id) is not None:
            return None, (f"活动方案 {activity.get('方案编号')} 已存在当前结项结论，"
                          "重复结项被拦截；如需重算请先作废旧批次")

        # 4) 新链路读取对比组观测数据，草稿只作为候选、不得进入结项
        comparisons = store.rows(COMPARISON_MODULE)
        candidates: list[dict[str, Any]] = []
        rejected: list[str] = []
        for raw_id in candidate_ids:
            try:
                comp_id = int(raw_id)
            except (TypeError, ValueError):
                rejected.append(f"对比id「{raw_id}」格式不正确")
                continue
            comp = next((row for row in comparisons if int(row.get("id", 0)) == comp_id), None)
            if comp is None:
                rejected.append(f"对比组 {comp_id} 不存在或已归档")
                continue
            if comp.get("status") in CANDIDATE_STATUSES:
                rejected.append(f"对比组 {comp.get('对比编号')} 处于{comp.get('status')}，只能作为候选，不能进入结项")
                continue
            if comp.get("status") != EXECUTED_STATUS:
                rejected.append(f"对比组 {comp.get('对比编号')} 状态为{comp.get('status')}，仅已执行对比可结项")
                continue
            obs_missing = [field for field in OBSERVATION_FIELDS
                           if comp.get(f"实验组{field}") in (None, "")
                           or comp.get(f"对照组{field}") in (None, "")]
            if obs_missing:
                rejected.append(f"对比组 {comp.get('对比编号')} 观测数据不完整（缺{'、'.join(obs_missing)}）")
                continue
            candidates.append(comp)
        if not candidates:
            detail = "；".join(rejected) if rejected else "未提供任何已执行对比组"
            return None, f"没有可用于结项的已执行对比组：{detail}"

        # 5) 完整度不同的多对比择优：样本窗口更完整优先，其次执行完成更晚者
        selected = self._select_comparison(candidates)
        alternatives = [comp.get("对比编号", "") for comp in candidates
                        if int(comp.get("id", 0)) != int(selected.get("id", 0))]

        # 6) 显著性阈值核对：取提交值，缺省回退活动方案配置
        alpha = parse_alpha(payload.get("显著性阈值"), parse_alpha(activity.get("显著性阈值")))

        # 7) 计算显著性结论与效应量
        experiment_obs = {
            "样本量": selected.get("实验组样本量"),
            "转化人数": selected.get("实验组转化人数"),
            "转化率": selected.get("实验组转化率"),
            "均值": selected.get("实验组均值"),
            "方差": selected.get("实验组方差"),
        }
        control_obs = {
            "样本量": selected.get("对照组样本量"),
            "转化人数": selected.get("对照组转化人数"),
            "转化率": selected.get("对照组转化率"),
            "均值": selected.get("对照组均值"),
            "方差": selected.get("对照组方差"),
        }
        stats = evaluate(experiment_obs, control_obs, alpha)

        # 8) 生成处理批次与数据版本，组装活动结项评估明细数据集
        now = datetime.now()
        batch_no = f"BATCH-{now.strftime('%Y%m%d%H%M%S')}-{activity_id:04d}"
        data_version = f"V{now.strftime('%Y%m%d')}.{len(store.rows(CLOSEOUT_MODULE)) + 1:03d}"
        closeout_rows = store.rows(CLOSEOUT_MODULE)
        record = {
            "id": max((int(row.get("id", 0)) for row in closeout_rows), default=0) + 1,
            "处理批次": batch_no,
            "数据版本": data_version,
            "is_current": True,
            "活动id": activity_id,
            "方案编号": activity.get("方案编号"),
            "活动名称": activity.get("活动名称"),
            "核心指标": activity_metrics.get("指标名称") or activity.get("核心指标"),
            "活动指标记录": dict(activity_metrics),
            "对比id": selected.get("id"),
            "对比编号": selected.get("对比编号"),
            "对比名称": selected.get("对比名称"),
            "对比组状态": selected.get("status"),
            "样本窗口天": selected.get("样本窗口天"),
            "执行完成时间": selected.get("执行完成时间"),
            "实验组观测": self._clean_observation(experiment_obs),
            "对照组观测": self._clean_observation(control_obs),
            "实验组指标值": stats["实验组指标值"],
            "对照组指标值": stats["对照组指标值"],
            "组间差异": stats["差异"],
            "差异方向": stats["差异方向"],
            "显著性检验": selected.get("显著性检验"),
            "检验统计量": round(stats["检验统计量"], 6),
            "p值": round(stats["p值"], 6),
            "显著性阈值": alpha,
            "是否显著": stats["是否显著"],
            "效应量": round(stats["效应量"], 6),
            "显著性结论": stats["显著性结论"],
            "择优说明": self._selection_reason(selected, candidates, alternatives),
            "候选对比编号": [comp.get("对比编号", "") for comp in candidates],
            "驳回候选说明": rejected,
            "结项时间": now.strftime("%Y-%m-%d %H:%M:%S"),
            "status": "已结项",
            "pending": False,
            "abnormal": False,
        }

        # 9) 原子提交：先快照，活动指标+对比结论+归档任一写失败则整体回滚
        snapshot = {
            "activity_status": (activity.get("status"), activity.get("pending"), activity.get("abnormal")),
            "comparison": (selected.get("status"), selected.get("pending"), selected.get("abnormal"),
                           selected.get("结项批次"), selected.get("结项结论"), selected.get("数据版本")),
            "appended": False,
        }
        try:
            closeout_rows.append(record)
            snapshot["appended"] = True
            activity["status"] = "已结项"
            activity["pending"] = False
            activity["abnormal"] = False
            activity["结项批次"] = batch_no
            activity["数据版本"] = data_version
            # 对比分析归档记录写入结项评估明细数据集，并把结论同步到对比分析清单
            selected["status"] = ARCHIVED_STATUS
            selected["pending"] = False
            selected["abnormal"] = False
            selected["结项批次"] = batch_no
            selected["数据版本"] = data_version
            selected["结项结论"] = stats["显著性结论"]
            selected["关联方案编号"] = activity.get("方案编号")
        except Exception:  # pragma: no cover - 防御性回滚
            self._rollback(activity, selected, record, snapshot)
            return None, "结项写入失败，活动指标与对比结论已整体回滚，请重试"

        message = (f"活动方案 {activity.get('方案编号')} 联合结项成功，处理批次 {batch_no}，"
                   f"采用对比组 {selected.get('对比编号')}，{stats['显著性结论']}")
        return record, message

    # ---------- 内部工具 ----------
    @staticmethod
    def _select_comparison(candidates: list[dict[str, Any]]) -> dict[str, Any]:
        def window(row: dict[str, Any]) -> float:
            try:
                return float(row.get("样本窗口天") or 0)
            except (TypeError, ValueError):
                return 0.0

        def finished_at(row: dict[str, Any]) -> str:
            return str(row.get("执行完成时间") or "")

        return sorted(candidates, key=lambda row: (window(row), finished_at(row)), reverse=True)[0]

    @staticmethod
    def _selection_reason(selected: dict[str, Any],
                          candidates: list[dict[str, Any]],
                          alternatives: list[str]) -> str:
        base = (f"在 {len(candidates)} 个已执行对比中按「样本窗口完整度优先、执行完成时间更晚优先」"
                f"选中 {selected.get('对比编号')}（窗口 {selected.get('样本窗口天')} 天，"
                f"完成于 {selected.get('执行完成时间')}）")
        if alternatives:
            base += f"；未选用对比：{'、'.join(alternatives)}（窗口较短或完成较早，其结论不构成本次结项依据）"
        return base

    @staticmethod
    def _clean_observation(obs: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in obs.items() if value is not None}

    @staticmethod
    def _rollback(activity: dict[str, Any], selected: dict[str, Any],
                  record: dict[str, Any], snapshot: dict[str, Any]) -> None:
        closeout_rows = store.rows(CLOSEOUT_MODULE)
        if snapshot["appended"] and record in closeout_rows:
            closeout_rows.remove(record)
        activity["status"], activity["pending"], activity["abnormal"] = snapshot["activity_status"]
        for key in ("结项批次", "数据版本"):
            activity.pop(key, None)
        (old_status, old_pending, old_abnormal,
         old_batch, old_conclusion, old_version) = snapshot["comparison"]
        selected["status"], selected["pending"], selected["abnormal"] = old_status, old_pending, old_abnormal
        for key, old_value in (("结项批次", old_batch), ("结项结论", old_conclusion), ("数据版本", old_version)):
            if old_value is None:
                selected.pop(key, None)
            else:
                selected[key] = old_value
        selected.pop("关联方案编号", None)
