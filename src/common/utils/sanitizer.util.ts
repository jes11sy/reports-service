import DOMPurify from 'isomorphic-dompurify';

export class SanitizerUtil {
  /**
   * Sanitize HTML input to prevent XSS
   */
  static sanitizeHtml(input: string): string {
    if (!input) return '';
    return DOMPurify.sanitize(input, {
      ALLOWED_TAGS: [], // Не разрешаем HTML теги
      KEEP_CONTENT: true,
    });
  }

  /**
   * Sanitize for Excel to prevent formula injection
   * Опасные символы: = + - @ \t \r
   */
  static sanitizeForExcel(input: any): any {
    if (typeof input !== 'string') return input;
    
    const dangerousChars = ['=', '+', '-', '@', '\t', '\r'];
    const firstChar = input.charAt(0);
    
    if (dangerousChars.includes(firstChar)) {
      return `'${input}`; // Добавляем одинарную кавычку для escape
    }
    
    return input;
  }

  /**
   * Sanitize object recursively
   */
  static sanitizeObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return typeof obj === 'string' ? this.sanitizeHtml(obj) : obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    const sanitized: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = this.sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  /**
   * Mask sensitive data for logging
   */
  static maskSensitiveData(data: string, visibleChars: number = 4): string {
    if (!data || data.length <= visibleChars) return '***';
    
    const visible = data.slice(-visibleChars);
    return '*'.repeat(data.length - visibleChars) + visible;
  }

  /**
   * Sanitize phone number
   */
  static sanitizePhone(phone: string): string {
    return phone.replace(/[^0-9+]/g, '');
  }
}

