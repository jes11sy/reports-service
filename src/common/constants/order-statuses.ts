/**
 * Централизованные константы статусов заказов
 * Соответствуют полю code в таблице order_statuses (references_service)
 */
export const OrderStatus = {
  // Финальные статусы
  COMPLETED: 'closed',        // Заказ выполнен успешно (Готово)
  CANCELLED: 'cancelled',     // Клиент отказался (Отказ)
  NOT_ORDER: 'not_order',     // Не стал заказом (Незаказ)

  // Рабочие статусы
  NEW: 'new',
  IN_PROGRESS: 'in_progress',
  MASTER_ASSIGNED: 'master_assigned',
  MASTER_LEFT: 'master_left',
  MODERN: 'modern',

  // Синоним для совместимости
  CLOSED: 'closed',
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
  OrderStatus.MASTER_ASSIGNED,
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
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;

export type WorkStatusType = typeof WorkStatus[keyof typeof WorkStatus];

/**
 * Типы операций в кассе
 */
export const CashOperationType = {
  INCOME: 'income',
  EXPENSE: 'expense',
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
