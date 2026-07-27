/**
 * 联系方式展示格式化（邮箱 / +86 手机号统一处理）
 */

/** 完整展示：邮箱原样；+86 手机号去掉区号显示 11 位 */
export function formatContact(contact?: string | null): string {
  if (!contact) return '';
  if (contact.includes('@')) return contact;
  if (contact.startsWith('+86')) return contact.slice(3);
  return contact;
}

/** 简短标签（归属徽章用）：邮箱取 @ 前部分；手机取尾号 */
export function contactLabel(contact?: string | null): string {
  if (!contact) return '';
  if (contact.includes('@')) return contact.split('@')[0];
  if (contact.startsWith('+86')) return `手机尾号${contact.slice(-4)}`;
  return contact;
}

/** 头像字符：邮箱取首字母；手机取尾号两位 */
export function contactAvatarText(contact?: string | null): string {
  if (!contact) return '?';
  if (contact.includes('@')) return contact.charAt(0).toUpperCase();
  if (contact.startsWith('+86')) return contact.slice(-2);
  return contact.charAt(0).toUpperCase();
}
