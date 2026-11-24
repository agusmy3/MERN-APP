// Import relatif tanpa ekstensi (gaya Vite) -> coba .js / .jsx. Hanya dipakai saat test (node --test).
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.{1,2}\//.test(specifier)) throw err;
    for (const ext of ['.js', '.jsx']) {
      try { return await next(specifier + ext, context); } catch { /* coba berikutnya */ }
    }
    throw err;
  }
}
