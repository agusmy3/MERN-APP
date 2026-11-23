import dayjs from 'dayjs';

export const formatDate = (date) => {
  if (!date) return '-';

  return new Date(date).toLocaleString('id-ID');
};

export const formatDate2 = (date) => {
  if (!date) return '-';

  return dayjs(date).format('DD MMM YYYY HH:mm');
};