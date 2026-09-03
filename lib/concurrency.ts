/**
 * Corre `fn` sobre `items` con un máximo de `concurrency` en vuelo a la vez,
 * en vez de uno por uno. Cada llamada implica al menos una consulta real a
 * la base de datos (y a veces una llamada a la IA); en serie, una lista de
 * varios cientos o miles de productos podía tardar minutos o agotar el
 * límite de tiempo de la función (bug real: importación de bodega, y
 * solicitudes de cliente con un Excel grande).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
