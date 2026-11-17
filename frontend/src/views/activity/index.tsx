import { useCallback, useEffect, useMemo, useState } from 'react'

import { request } from '@/api/client'
import Pagination from '@/components/Pagination'

const ENDPOINT = '/api/activity'
const CLOSEOUT_ENDPOINT = '/api/activity-closeout'
const COMPARISON_ENDPOINT = '/api/comparison'

const columns = [
  '方案编号',
  '活动名称',
  '活动类型',
  '目标人群',
  '核心指标',
  '对照方案',
  '评估周期天',
  '显著性阈值',
]
const actions = ['提交方案评审', '启动评估', '取消方案']
const statusOptions = ['草稿', '方案评审中', '评估中', '已结项', '已取消']

type Row = Record<string, string | number | boolean | null>
type ComparisonRow = Record<string, string | number | boolean | null>
type Closeout = Record<string, string | number | boolean | null> & {
  活动指标记录?: Record<string, unknown>
  实验组观测?: Record<string, unknown>
  对照组观测?: Record<string, unknown>
  候选对比编号?: string[]
  驳回候选说明?: string[]
}
type PagePayload = { items: Row[]; total: number; page: number; size: number }

type ViewMode = 'list' | 'closeoutForm' | 'closeoutDetail'

export default function ActivityView() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  // 查询条件独立保存，翻页/改页大小不会丢失
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [statusCounts, setStatusCounts] = useState({ total: 0, evaluating: 0, closed: 0 })
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [activeActivity, setActiveActivity] = useState<Row | null>(null)
  const [closeoutDetail, setCloseoutDetail] = useState<Closeout | null>(null)

  const reload = useCallback(async () => {
    setErrorMessage('')
    const params = new URLSearchParams()
    if (filters.keyword) params.set('keyword', filters.keyword)
    if (filters.status) params.set('status', filters.status)
    params.set('page', String(page))
    params.set('size', String(size))
    try {
      const response = await request(`${ENDPOINT}?${params.toString()}`)
      if (!response.ok) throw new Error('活动方案列表读取失败')
      const payload = (await response.json()) as PagePayload
      setRows(payload.items ?? [])
      setTotal(payload.total ?? 0)
      // 统计卡片取全量口径，不受当前分页影响
      const statsResponse = await request(`${ENDPOINT}?page=1&size=200`)
      if (statsResponse.ok) {
        const statsPayload = (await statsResponse.json()) as PagePayload
        const all = statsPayload.items ?? []
        setStatusCounts({
          total: statsPayload.total ?? all.length,
          evaluating: all.filter((item) => item.status === '评估中').length,
          closed: all.filter((item) => item.status === '已结项').length,
        })
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '活动评估列表读取失败')
    }
  }, [filters, page, size])

  useEffect(() => {
    void reload()
  }, [reload])

  async function runAction(action: string, row: Row) {
    setErrorMessage('')
    try {
      const response = await request(`${ENDPOINT}/${row.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ values: { action } }),
      })
      const payload = await response.json()
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || '活动评估动作未生效，请稍后重试')
      }
      await reload()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '活动评估操作失败')
    }
  }

  function openCloseoutForm(row: Row) {
    setErrorMessage('')
    setActiveActivity(row)
    setCloseoutDetail(null)
    setViewMode('closeoutForm')
  }

  async function openCloseoutDetail(row: Row) {
    setErrorMessage('')
    try {
      const response = await request(`${CLOSEOUT_ENDPOINT}/by-activity/${row.id}`)
      if (!response.ok) throw new Error('结项评估明细读取失败')
      setCloseoutDetail((await response.json()) as Closeout)
      setActiveActivity(row)
      setViewMode('closeoutDetail')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '结项评估明细读取失败')
    }
  }

  // 核验码13d83be0：结项完成后刷新视图；核验码13e48934：随后回到业务列表检查关联项
  async function backToList() {
    setViewMode('list')
    setActiveActivity(null)
    setCloseoutDetail(null)
    await reload()
  }

  const stats = useMemo(
    () => [
      { label: '活动方案总数', value: statusCounts.total },
      { label: '评估中方案', value: statusCounts.evaluating },
      { label: '已结项方案', value: statusCounts.closed },
    ],
    [statusCounts],
  )

  return (
    <section className="page" data-module="activity" data-verify-code="13828aba">
      <header className="page-head">
        <div>
          <h2>活动评估管理</h2>
          <p className="page-desc">
            管理运营活动的效果评估方案，支持活动方案与对比组联合结项，输出带处理批次的结项评估明细数据集。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" type="button" onClick={() => window.open(`${ENDPOINT}/export`, '_blank')}>
            导出活动评估清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((item) => (
          <article key={item.label} className="stat-card">
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">{item.value}</strong>
          </article>
        ))}
      </div>

      {viewMode === 'list' && (
        <>
          <form
            className="filter-bar"
            onSubmit={(event) => {
              event.preventDefault()
              setPage(1)
              void reload()
            }}
          >
            <label className="filter-item">
              <span>方案编号</span>
              <input
                value={filters.keyword ?? ''}
                placeholder="按方案编号检索"
                onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
              />
            </label>
            <label className="filter-item">
              <span>状态</span>
              <select
                value={filters.status ?? ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
              >
                <option value="">全部状态</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="submit">
              查询
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setFilters({})
                setPage(1)
              }}
            >
              重置条件
            </button>
          </form>

          <table className="data-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
                <th>状态</th>
                <th>可执行动作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)}>
                  {columns.map((column) => (
                    <td key={column}>{(row[column] as string) ?? '—'}</td>
                  ))}
                  <td>{String(row.status ?? '—')}</td>
                  <td className="row-actions">
                    {actions.map((action) => (
                      <button key={action} className="link" type="button" onClick={() => void runAction(action, row)}>
                        {action}
                      </button>
                    ))}
                    {row.status !== '已结项' && (
                      <button className="link" type="button" onClick={() => openCloseoutForm(row)}>
                        联合结项
                      </button>
                    )}
                    {row.status === '已结项' && (
                      <button className="link" type="button" onClick={() => void openCloseoutDetail(row)}>
                        查看结项评估
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="empty-state" colSpan={columns.length + 2}>
                    暂无活动评估数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* 核验码13c997e2：活动评估支持分页与翻页，并保留当前查询条件 */}
          <Pagination
            page={page}
            size={size}
            total={total}
            onPageChange={setPage}
            onSizeChange={(next) => {
              setSize(next)
              setPage(1)
            }}
          />

          <footer className="page-foot">
            <span>
              共 {total} 条活动评估记录
              {filters.keyword || filters.status ? '（当前查询条件已保留）' : ''}
            </span>
            {errorMessage && <span className="error-text">{errorMessage}</span>}
          </footer>
        </>
      )}

      {viewMode === 'closeoutForm' && activeActivity && (
        <CloseoutForm
          activity={activeActivity}
          onCancel={() => void backToList()}
          onSubmitted={async (record: Closeout) => {
            // 核验码13d83be0：完成后刷新视图，直接进入同一评估批次的结项评估明细
            setCloseoutDetail(record)
            setViewMode('closeoutDetail')
          }}
        />
      )}

      {viewMode === 'closeoutDetail' && closeoutDetail && (
        <CloseoutDetail
          closeout={closeoutDetail}
          onBack={() => void backToList()}
        />
      )}
    </section>
  )
}

function CloseoutForm({
  activity,
  onCancel,
  onSubmitted,
}: {
  activity: Row
  onCancel: () => void
  onSubmitted: (record: Closeout) => void
}) {
  const [metricName, setMetricName] = useState(String(activity['核心指标'] ?? '转化率'))
  const [sampleSize, setSampleSize] = useState('')
  const [alpha, setAlpha] = useState(String(activity['显著性阈值'] ?? '0.05'))
  const [candidates, setCandidates] = useState<ComparisonRow[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadCandidates() {
      setLoading(true)
      try {
        const response = await request(`${COMPARISON_ENDPOINT}?page=1&size=200`)
        if (!response.ok) throw new Error('对比组候选读取失败')
        const payload = (await response.json()) as { items: ComparisonRow[] }
        if (cancelled) return
        const items = payload.items ?? []
        setCandidates(items)
        // 仅已执行对比默认勾选；草稿/审批中只能候选、不可勾选
        setSelected(items.filter((item) => item.status === '已执行').map((item) => Number(item.id)))
      } catch (error) {
        if (!cancelled) setFormError(error instanceof Error ? error.message : '对比组候选读取失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadCandidates()
    return () => {
      cancelled = true
    }
  }, [])

  function toggleCandidate(id: number, executable: boolean) {
    if (!executable) return
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  async function submit() {
    setFormError('')
    if (!metricName.trim() || !sampleSize.trim()) {
      setFormError('请填写活动指标名称与样本量，活动指标与对比结论必须一起成功')
      return
    }
    if (selected.length === 0) {
      setFormError('至少选择一个已执行对比组；草稿对比只能作为候选')
      return
    }
    setSubmitting(true)
    try {
      const response = await request(`${CLOSEOUT_ENDPOINT}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          values: {
            活动id: Number(activity.id),
            显著性阈值: alpha,
            活动指标: { 指标名称: metricName, 样本量: Number(sampleSize) },
            候选对比id: selected,
          },
        }),
      })
      const payload = await response.json()
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || '联合结项提交失败')
      }
      onSubmitted(payload.entry as Closeout)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '联合结项提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div data-verify-code="13d83be0">
      <div className="back-link">
        <button className="btn ghost" type="button" onClick={onCancel}>
          ← 返回活动评估列表
        </button>
      </div>
      <div className="detail-banner">
        联合结项：活动方案 <strong>{String(activity['方案编号'])}</strong>
        （当前状态：{String(activity.status)}）。仅「已执行」对比组可进入结项，草稿/审批中对比只作候选。
      </div>
      <div className="closeout-layout">
        <div className="closeout-card">
          <h3>活动方案指标记录（供新能力接收）</h3>
          <div className="form-grid">
            <label>
              <span>指标名称</span>
              <input value={metricName} onChange={(event) => setMetricName(event.target.value)} />
            </label>
            <label>
              <span>样本量</span>
              <input
                type="number"
                min={1}
                value={sampleSize}
                placeholder="活动方案侧样本量"
                onChange={(event) => setSampleSize(event.target.value)}
              />
            </label>
            <label>
              <span>显著性阈值</span>
              <input value={alpha} placeholder="如 0.05 或 5%" onChange={(event) => setAlpha(event.target.value)} />
            </label>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="btn primary" type="button" disabled={submitting} onClick={() => void submit()}>
              {submitting ? '提交中…' : '提交联合结项'}
            </button>
            <button className="btn" type="button" disabled={submitting} onClick={onCancel}>
              取消
            </button>
          </div>
          {formError && <p className="error-text" style={{ marginTop: 10 }}>{formError}</p>}
        </div>

        <div className="closeout-card">
          <h3>对比组观测数据（新链路读取，多选候选）</h3>
          {loading ? (
            <p className="page-desc">对比组候选加载中…</p>
          ) : (
            <div className="candidate-list">
              {candidates.map((item) => {
                const executable = item.status === '已执行'
                const checked = selected.includes(Number(item.id))
                return (
                  <label
                    key={String(item.id)}
                    className={`candidate-item${executable ? '' : ' disabled'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!executable}
                      onChange={() => toggleCandidate(Number(item.id), executable)}
                    />
                    <strong>{String(item['对比编号'])}</strong>
                    <span className={`tag ${executable ? 'significant' : 'draft'}`} style={{ marginLeft: 8 }}>
                      {String(item.status)}
                    </span>
                    <div className="candidate-meta">
                      {String(item['对比名称'])}
                      {executable
                        ? `｜样本窗口 ${String(item['样本窗口天'] ?? '—')} 天｜完成于 ${String(item['执行完成时间'] ?? '—')}`
                        : '｜草稿/审批中对比只能作为候选，不能进入结项'}
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CloseoutDetail({ closeout, onBack }: { closeout: Closeout; onBack: () => void }) {
  const significant = Boolean(closeout['是否显著'])
  return (
    <div data-verify-code="134ff82c">
      <div className="back-link">
        {/* 核验码13e48934：回到业务列表检查关联项（活动状态、对比归档与结论同步） */}
        <button className="btn ghost" type="button" onClick={onBack}>
          ← 回到业务列表检查关联项
        </button>
      </div>
      <div className="detail-banner">
        活动方案结项页｜处理批次 <strong>{String(closeout['处理批次'])}</strong>｜数据版本{' '}
        <strong>{String(closeout['数据版本'])}</strong>｜结项时间 {String(closeout['结项时间'])}
      </div>

      <div className="closeout-layout">
        <div className="closeout-card">
          <h3>结项结论与显著性</h3>
          <p>
            <span className={`tag ${significant ? 'significant' : 'not-significant'}`}>
              {significant ? '差异显著' : '差异不显著'}
            </span>
            <span style={{ marginLeft: 8 }}>{String(closeout['显著性结论'])}</span>
          </p>
          <dl className="detail-grid">
            <dt>方案编号</dt>
            <dd>{String(closeout['方案编号'])}</dd>
            <dt>采用对比组</dt>
            <dd>{String(closeout['对比编号'])}</dd>
            <dt>实验组指标值</dt>
            <dd>{String(closeout['实验组指标值'])}</dd>
            <dt>对照组指标值</dt>
            <dd>{String(closeout['对照组指标值'])}</dd>
            <dt>实验组/对照组差异</dt>
            <dd>{String(closeout['组间差异'])}</dd>
            <dt>差异方向</dt>
            <dd>{String(closeout['差异方向'])}</dd>
            <dt>p 值</dt>
            <dd>{String(closeout['p值'])}</dd>
            <dt>显著性阈值</dt>
            <dd>{String(closeout['显著性阈值'])}</dd>
            <dt>效应量</dt>
            <dd>{String(closeout['效应量'])}</dd>
            <dt>检验方法</dt>
            <dd>{String(closeout['显著性检验'])}</dd>
          </dl>
        </div>

        <div className="closeout-card">
          <h3>观测数据与版本核对</h3>
          <dl className="detail-grid">
            <dt>实验组观测</dt>
            <dd>{JSON.stringify(closeout['实验组观测'] ?? {})}</dd>
            <dt>对照组观测</dt>
            <dd>{JSON.stringify(closeout['对照组观测'] ?? {})}</dd>
            <dt>样本窗口（天）</dt>
            <dd>{String(closeout['样本窗口天'])}</dd>
            <dt>执行完成时间</dt>
            <dd>{String(closeout['执行完成时间'])}</dd>
            <dt>活动指标记录</dt>
            <dd>{JSON.stringify(closeout['活动指标记录'] ?? {})}</dd>
            <dt>候选对比编号</dt>
            <dd>{(closeout['候选对比编号'] ?? []).join('、') || '—'}</dd>
          </dl>
          <p className="page-desc" style={{ marginTop: 10 }}>
            择优说明：{String(closeout['择优说明'])}
          </p>
          {(closeout['驳回候选说明'] ?? []).length > 0 && (
            <p className="page-desc">拦截记录：{(closeout['驳回候选说明'] ?? []).join('；')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
