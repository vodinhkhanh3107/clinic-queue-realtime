import { randomInt } from 'crypto';

// Lấy ngày hiện tại YYYY-MM-DD và giờ HH:mm:ss theo chuẩn Asia/Ho_Chi_Minh (mục 7.1 & 12)
export function getVietnamDateAndTime(): { date: string; time: string } {
  const now = new Date();
  const vnTime = new Date(
    now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }),
  );
  const yyyy = vnTime.getFullYear();
  const mm = String(vnTime.getMonth() + 1).padStart(2, '0');
  const dd = String(vnTime.getDate()).padStart(2, '0');
  const hh = String(vnTime.getHours()).padStart(2, '0');
  const min = String(vnTime.getMinutes()).padStart(2, '0');
  const ss = String(vnTime.getSeconds()).padStart(2, '0');

  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${min}:${ss}`,
  };
}

// Sinh mật khẩu tạm tối thiểu 10 ký tự bằng CSPRNG
export function generateTempPassword(length = 10): string {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[randomInt(0, chars.length)];
  }
  return result + 'A9'; // Đảm bảo luôn thỏa mãn có cả chữ và số (12 ký tự)
}

// Format số thứ tự: A001..A999, vượt 999 tự mở rộng 4 chữ số A1000
export function formatQueueNumber(prefix: string, seq: number): string {
  const padded = seq > 999 ? String(seq) : String(seq).padStart(3, '0');
  return `${prefix}${padded}`;
}