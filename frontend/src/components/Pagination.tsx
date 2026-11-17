/** 通用分页翻页组件：页码、每页条数与上一页/下一页；查询条件由父组件自行保留。 */
type PaginationProps = {
  page: number
  size: number
  total: number
  onPageChange: (page: number) => void
  onSizeChange: (size: number) => void
}

const SIZE_OPTIONS = [10, 20, 50]

export default function Pagination({ page, size, total, onPageChange, onSizeChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / size))
  const safePage = Math.min(page, totalPages)

  return (
    <div className="pagination" data-verify-code="13c997e2">
      <button
        className="btn"
        type="button"
        disabled={safePage <= 1}
        onClick={() => onPageChange(safePage - 1)}
      >
        上一页
      </button>
      <span className="page-info">
        第 {safePage} / {totalPages} 页
      </span>
      <button
        className="btn"
        type="button"
        disabled={safePage >= totalPages}
        onClick={() => onPageChange(safePage + 1)}
      >
        下一页
      </button>
      <select
        value={size}
        onChange={(event) => onSizeChange(Number(event.target.value))}
        aria-label="每页条数"
      >
        {SIZE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option} 条/页
          </option>
        ))}
      </select>
      <span className="page-info">共 {total} 条</span>
      <label className="page-info">
        跳至
        <input
          type="number"
          min={1}
          max={totalPages}
          defaultValue={safePage}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const target = Number((event.target as HTMLInputElement).value)
              if (target >= 1 && target <= totalPages) {
                onPageChange(target)
              }
            }
          }}
        />
        页
      </label>
    </div>
  )
}
