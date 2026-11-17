"""活动联合结项接口：接收供新能力的活动方案指标记录与对比组观测数据，
按新链路读取对比组观测数据并计算显著性结论，输出活动结项评估明细数据集。

本业务核验码：13828aba
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.schemas import ActionResult, EntryPayload, PageResult
from app.services.activity_closeout import CloseoutService

router = APIRouter(prefix="/api/activity-closeout", tags=["活动联合结项"])

service = CloseoutService()


@router.get("", response_model=PageResult[dict])
def list_closeouts(
    keyword: str | None = Query(default=None, description="按方案编号检索结项明细"),
    activity_id: int | None = Query(default=None, description="按活动id过滤"),
    batch_no: str | None = Query(default=None, description="按处理批次过滤"),
    current_only: bool = Query(default=False, description="只看当前生效结项结论"),
    page: int = 1,
    size: int = 20,
) -> PageResult[dict]:
    """分页读取活动结项评估明细数据集；结项页按同一评估批次核对实验组/对照组差异。"""
    if size > 200:
        raise HTTPException(status_code=400, detail="每页最多 200 条，请缩小分页范围")
    items, total = service.list_closeouts(
        keyword=keyword,
        activity_id=activity_id,
        batch_no=batch_no,
        current_only=current_only,
        page=page,
        size=size,
    )
    return PageResult(items=items, total=total, page=page, size=size)


@router.get("/by-activity/{activity_id}", response_model=dict)
def get_activity_closeout(activity_id: int) -> dict[str, Any]:
    """活动方案结项页：读取该活动同一评估批次的当前结项评估明细。"""
    record = service.get_current_by_activity(activity_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"活动 {activity_id} 暂无当前结项评估明细")
    return record


@router.get("/export")
def export_closeouts() -> dict[str, Any]:
    """导出活动结项评估明细数据集全量（含历史批次，便于数据版本核对）。"""
    items, total = service.list_closeouts(page=1, size=10000)
    return {"module": "activity_closeout", "total": total, "items": items}


@router.get("/{closeout_id}", response_model=dict)
def get_closeout(closeout_id: int) -> dict[str, Any]:
    """按结项明细id读取单条记录，用于数据版本核对。"""
    record = service.get_closeout(closeout_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"结项明细 {closeout_id} 不存在")
    return record


@router.post("/submit", response_model=ActionResult)
def submit_closeout(payload: EntryPayload) -> ActionResult:
    """联合结项提交：活动指标与对比结论一起成功才返回数据集，否则整单驳回。"""
    record, message = service.submit_closeout(payload.values)
    if record is None:
        return ActionResult(ok=False, message=message)
    # 只接收含活动结项评估明细数据集的唯一可用结果
    return ActionResult(ok=True, message=message, entry=record)
