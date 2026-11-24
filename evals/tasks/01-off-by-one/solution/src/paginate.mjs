// Returns the items of one page. Pages start at 1.
export function paginate(items, page, perPage) {
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}

// Number of pages needed to show every item.
export function pageCount(items, perPage) {
  return Math.ceil(items.length / perPage);
}
