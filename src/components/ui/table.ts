/**
 * Class names that turn a data table into a stacked list on a phone: the header row hides, every row becomes a block and
 * each cell shows its own column name from `data-label`. Rows keep explicit ARIA roles because `display: block` can make
 * some screen readers drop the table semantics.
 */
export const table = 'w-full border-collapse text-sm max-sm:block';
export const thead = 'max-sm:hidden [&_th]:text-sm [&_th]:font-medium [&_th]:text-muted';
export const tbody = 'max-sm:block';
export const row = 'border-t border-rule transition-colors duration-(--duration-micro) hover:bg-paper-2/70 max-sm:first:border-t-0 max-sm:first:pt-0 max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:gap-y-2 max-sm:py-4';
export const label = 'max-sm:before:mb-0.5 max-sm:before:block max-sm:before:text-xs max-sm:before:text-muted max-sm:before:content-[attr(data-label)]';
export const full = 'max-sm:col-span-2';
