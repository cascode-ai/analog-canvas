/** Run `task` over `items`, at most `limit` at a time. */
export async function eachConcurrently(items, limit, task) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (queue.length > 0) await task(queue.shift());
    }),
  );
}
