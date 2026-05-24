/** Shared v-data-table header helper — fixed widths keep layouts from blowing out. */

export type FixedHeader = {
  title: string;
  key: string;
  width: string;
  minWidth?: string;
  maxWidth?: string;
  sortable?: boolean;
  align?: 'start' | 'center' | 'end';
  cellProps?: { class?: string };
};

export const DATA_TABLE_CLASS = 'data-table-fixed elevation-1 rounded';

export function fixedCol(
  title: string,
  key: string,
  px: number,
  opts: { sortable?: boolean; align?: FixedHeader['align']; wrap?: boolean } = {},
): FixedHeader {
  const w = `${px}px`;
  return {
    title,
    key,
    width: w,
    minWidth: w,
    maxWidth: opts.wrap ? undefined : w,
    sortable: opts.sortable ?? key !== 'actions',
    align: opts.align,
    cellProps: opts.wrap ? { class: 'cell-wrap' } : { class: '' },
  };
}
