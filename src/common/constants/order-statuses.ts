/**
 * Централизованные константы статусов заказов
 * Используются во всех сервисах для согласованности
 */
export const OrderStatus = {
  // Финальные статусы
  COMPLETED: 'Готово',      // Заказ выполнен успешно
  CANCELLED: 'Отказ',       // Клиент отказался
  NOT_ORDER: 'Незаказ',     // Не стал заказом
  
  // Рабочие статусы
  NEW: 'Новый',
  IN_PROGRESS: 'В работе',
  ASSIGNED: 'Назначен мастер',
  MASTER_LEFT: 'Мастер выехал',
  MODERN: 'Модерн',         // На модерации
  
  // Для совместимости со старым кодом (alias)
  CLOSED: 'Готово',         // Синоним COMPLETED
} as const;

export type OrderStatusType = typeof OrderStatus[keyof typeof OrderStatus];

/**
 * Статусы, означающие "закрытый" заказ (для статистики)
 */
export const CLOSED_STATUSES: OrderStatusType[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
];

/**
 * Статусы "в деньги" - заказы с выручкой
 */
export const REVENUE_STATUSES: OrderStatusType[] = [
  OrderStatus.COMPLETED,
];

/**
 * Статусы "в работе"
 */
export const IN_PROGRESS_STATUSES: OrderStatusType[] = [
  OrderStatus.IN_PROGRESS,
  OrderStatus.ASSIGNED,
  OrderStatus.MASTER_LEFT,
];

/**
 * Статусы для подсчёта отказов
 */
export const REFUSAL_STATUSES: OrderStatusType[] = [
  OrderStatus.CANCELLED,
  OrderStatus.NOT_ORDER,
];

/**
 * Статусы работы сотрудников
 */
export const WorkStatus = {
  ACTIVE: 'работает',
  INACTIVE: 'не работает',
  ON_VACATION: 'в отпуске',
} as const;

export type WorkStatusType = typeof WorkStatus[keyof typeof WorkStatus];

/**
 * Типы операций в кассе
 */
export const CashOperationType = {
  INCOME: 'приход',
  EXPENSE: 'расход',
} as const;

export type CashOperationTypeValue = typeof CashOperationType[keyof typeof CashOperationType];

/**
 * Статусы звонков
 */
export const CallStatus = {
  ANSWERED: 'answered',
  MISSED: 'missed',
  NO_ANSWER: 'no_answer',
  BUSY: 'busy',
} as const;

export type CallStatusType = typeof CallStatus[keyof typeof CallStatus];

/**
 * Пропущенные статусы звонков
 */
export const MISSED_CALL_STATUSES: CallStatusType[] = [
  CallStatus.MISSED,
  CallStatus.NO_ANSWER,
  CallStatus.BUSY,
];
