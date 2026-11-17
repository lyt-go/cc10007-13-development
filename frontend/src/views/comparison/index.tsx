import { useCallback, useEffect, useMemo, useState } from 'react'

import { request } from '@/api/client'
import Pagination from '@/components/Pagination'

const ENDPOINT = '/api/comparison'
const columns = [
  '对比编号',
  '对比名称',
  '实验组筛选',
  '对照组筛选',
  '对比指标',
  '时间对齐',
  '显著性检验',
  '效应量',
]
const actions = ['提交对比审批', '执行对比', '归档对比']
const statusOptions = ['草稿', '对比审批中', '已执行', '已归档']

type Row = Record<string, string | number | boolean | null>
type PagePayload = { items: Row[]; total: number; page: number; size: number }

export default function ComparisonView() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [statusCounts, setStatusCounts] = useState({ total: 0, executed: 0, reviewing: 0 })

  const reload = useCallback(async () => {
    setErrorMessage('')
    const params = new URLSearchParams()
    if (filters.keyword) params.set('keyword', filters.keyword)
    if (filters.status) params.set('status', filters.status)
    params.set('page', String(page))
    params.set('size', String(size))
    try {
      const response = await request(`${ENDPOINT}?${params.toString()}`)
      if (!response.ok) {
        throw new Error('对比组列表读取失败')
      }
      const payload = (await response.json()) as PagePayload
      setRows(payload.items ?? [])
      setTotal(payload.total ?? 0)
      const statsResponse = await request(`${ENDPOINT}?page=1&size=200`)
      if (statsResponse.ok) {
        const statsPayload = (await statsResponse.json()) as PagePayload
        const all = statsPayload.items ?? []
        setStatusCounts({
          total: statsPayload.total ?? all.length,
          executed: all.filter((item) => item.status === '已执行' || item.status === '已归档').length,
          reviewing: all.filter((item) => item.status === '对比审批中').length,
        })
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '对比分析列表读取失败')
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
        throw new Error(payload.message || '对比分析动作未生效，请稍后重试')
      }
      await reload()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '对比分析操作失败')
    }
  }

  const stats = useMemo(
    () => [
      { label: '对比组总数', value: statusCounts.total },
      { label: '已执行/归档对比', value: statusCounts.executed },
      { label: '审批中对比', value: statusCounts.reviewing },
    ],
    [statusCounts],
  )

  return (
    <section className="page" data-module="comparison">
      <header className="page-head">
        <div>
          <h2>对比分析管理</h2>
          <p className="page-desc">
            定义多组对比分析方案，配置实验组、对照组和统计检验方法；联合结项后结论与批次同步回本清单。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" type="button" onClick={() => window.open(`${ENDPOINT}/export`, '_blank')}>
            导出对比分析清单
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

      <form
        className="filter-bar"
        onSubmit={(event) => {
          event.preventDefault()
          setPage(1)
          void reload()
        }}
      >
        <label className="filter-item">
          <span>对比编号</span>
          <input
            value={filters.keyword ?? ''}
            placeholder="按对比编号检索"
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
            <th>结项批次</th>
            <th>结项结论（活动评估同步）</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => (
                <td key={column}>{(row[column] as string) ?? '—'}</td>
              ))}
              <td>
                <span className={`tag ${row.status === '已归档' ? 'archived' : 'draft'}`}>{String(row.status)}</span>
              </td>
              <td>{(row['结项批次'] as string) ?? '—'}</td>
              <td>{(row['结项结论'] as string) ?? '—'}</td>
              <td className="row-actions">
                {actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => void runAction(action, row)}>
                    {action}
                  </button>
                ))}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 4}>
                暂无对比分析数据
              </td>
            </tr>
          )}
        </tbody>
      </table>

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
          共 {total} 条对比分析记录
          {filters.keyword || filters.status ? '（当前查询条件已保留）' : ''}
        </span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
