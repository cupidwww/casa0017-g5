export function fill(html_string, substitute_pairs) {
  // fill the template of an html file
  // %KEY% will be filled with value if "%KEY%": value is in substitute_pairs
  // O(n*n(pairs)) here, better than nothing
  let replaced = html_string;
  for (const [k, v] of Object.entries(substitute_pairs)) {
    replaced = replaced.replaceAll(k, v);
  }
  return replaced;
}
