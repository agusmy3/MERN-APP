import dayjs from 'dayjs';

export const formatDate = (date) => {
  if (!date) return '-';

  return new Date(date).toLocaleString('id-ID');
};

export const formatDate2 = (date) => {
  if (!date) return '-';

  return dayjs(date).format('DD MMM YYYY HH:mm');
};

/** Tanggal saja: "23 Nov 2026" (mis. tanggal dokumen) */
export const formatDay = (date) => {
  if (!date) return '-';

  return dayjs(date).format('DD MMM YYYY');
};

/** Nilai untuk <input type="date">: "2026-11-23" (zona waktu lokal) */
export const toDateInput = (date = new Date()) => dayjs(date).format('YYYY-MM-DD');
