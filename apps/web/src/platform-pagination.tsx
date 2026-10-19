type PlatformPaginationProps = {
  page: number;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled: boolean;
  nextDisabled: boolean;
  loading?: boolean;
  pageSizes?: readonly number[];
  label?: string;
};

export function PlatformPagination({
  page, pageSize, onPageSizeChange, onPrevious, onNext,
  previousDisabled, nextDisabled, loading = false,
  pageSizes = [10, 20, 50], label,
}: PlatformPaginationProps) {
  return <footer className="lc-platform-pagination" aria-label={label ? `${label} pagination` : undefined}>
    <label>
      Rows
      <select aria-label={label ? `${label} rows per page` : 'Rows per page'} disabled={loading} value={pageSize} onChange={event => onPageSizeChange(Number(event.target.value))}>
        {pageSizes.map(size => <option key={size} value={size}>{size}</option>)}
      </select>
    </label>
    <button className="button" aria-label={label ? `${label} previous page` : undefined} disabled={loading || previousDisabled} onClick={onPrevious}>Previous</button>
    <span>Page {page + 1}</span>
    <button className="button" aria-label={label ? `${label} next page` : undefined} disabled={loading || nextDisabled} onClick={onNext}>Next</button>
  </footer>;
}
