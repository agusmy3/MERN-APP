/**
 * Perkecil gambar di browser sebelum disimpan sebagai data URL (logo perusahaan).
 * Sisi terpanjang maks. maxW x maxH (rasio dipertahankan); PNG untuk sumber PNG (transparan), selain itu JPEG,
 * lalu turunkan kualitas / ukuran sampai <= maxBytes. -> Promise<string data URL>
 */
export const dataUrlBytes = (dataUrl) => Math.floor(((dataUrl.split(',')[1] || '').length * 3) / 4);

export const resizeImageFile = (file, { maxW = 600, maxH = 240, maxBytes = 200 * 1024 } = {}) => new Promise((resolve, reject) => {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    reject(new Error('Gunakan gambar PNG, JPEG, atau WEBP.'));
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Gagal membaca file.'));
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => reject(new Error('File bukan gambar yang valid.'));
    img.onload = () => {
      let scale = Math.min(1, maxW / img.width, maxH / img.height);
      const png = file.type === 'image/png';
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!png) {
          ctx.fillStyle = '#ffffff'; // JPEG tanpa transparansi
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const url = png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85 - attempt * 0.1);
        if (dataUrlBytes(url) <= maxBytes) {
          resolve(url);
          return;
        }
        scale *= 0.75;
      }
      reject(new Error('Gambar terlalu besar setelah diperkecil. Gunakan gambar yang lebih sederhana.'));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});
