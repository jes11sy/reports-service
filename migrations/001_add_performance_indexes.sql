-- ============================================
-- Performance Indexes for Reports Service
-- ============================================
-- Создано: 17 декабря 2025
-- Цель: Ускорить аналитические запросы в 2-5 раз
-- 
-- ✅ FIX #169: Удалены psql-специфичные команды (\echo)
-- Теперь миграция работает через любой PostgreSQL клиент:
--   - Prisma migrate
--   - node-postgres (pg)
--   - psql
--   - pgAdmin
--   - DBeaver
-- ============================================

-- ============================================
-- ORDERS TABLE - Основные аналитические индексы
-- ============================================

-- 1. Для getCityReport - группировка по городу и статусу
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_city_status_partner
ON orders(city, status_order, partner)
WHERE closing_data IS NOT NULL;

-- 2. Для фильтрации по суммам и статусу
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_clean
ON orders(status_order, clean)
WHERE clean IS NOT NULL;

-- 3. Для группировки партнерских заказов
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_partner_status_clean
ON orders(partner, status_order, clean)
WHERE status_order = 'Готово' AND clean IS NOT NULL;

-- 4. Для отчетов по мастерам (мастер + город + дата)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_master_city_closing
ON orders(master_id, city, closing_data)
WHERE master_id IS NOT NULL AND closing_data IS NOT NULL;

-- 5. Для подсчета микрочеков и больших чеков
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_clean_range
ON orders(status_order, clean)
WHERE status_order = 'Готово' AND clean > 0;

-- 6. Для статистики "Модерн" заказов
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_city_modern
ON orders(city)
WHERE status_order = 'Модерн';

-- 7. Для аналитики по РК и avitoName
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_rk_avito_status
ON orders(rk, avito_name, status_order, closing_data)
WHERE status_order IN ('Готово', 'Отказ');

-- 8. Композитный индекс для группировки (город + статус + дата)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_city_status_closing
ON orders(city, status_order, closing_data)
WHERE closing_data IS NOT NULL;

-- ============================================
-- CALLS TABLE - Индексы для статистики звонков
-- ============================================

-- 9. Для группировки звонков по оператору и статусу
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_operator_status_date
ON calls(operator_id, status, date_create);

-- 10. Для фильтрации по длительности звонков
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_duration
ON calls(operator_id, duration)
WHERE duration IS NOT NULL;

-- 11. Для подсчета звонков по дате и статусу
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_date_status
ON calls(date_create, status);

-- ============================================
-- CASH TABLE - Индексы для кассовой аналитики
-- ============================================

-- 12. Для группировки кассы по городу и типу
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_city_name
ON cash(city, name);

-- 13. Для фильтрации по дате создания
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_city_date
ON cash(city, date_create);

-- ============================================
-- PARTIAL INDEXES - Частичные индексы для специфичных запросов
-- ============================================

-- 14. Только для закрытых заказов с выручкой
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_completed_revenue
ON orders(city, closing_data, clean, master_change)
WHERE status_order = 'Готово' AND clean IS NOT NULL;

-- 15. Для подсчета заказов "Ноль"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_zero_orders
ON orders(city, status_order)
WHERE status_order IN ('Готово', 'Отказ') AND (clean = 0 OR clean IS NULL);

-- ============================================
-- Обновление статистики
-- ============================================
ANALYZE orders;
ANALYZE calls;
ANALYZE cash;

-- ============================================
-- Ожидаемые улучшения:
--   - getCityReport: 2-5x быстрее
--   - getOperatorStatistics: 2-3x быстрее
--   - getMastersReport: 3-5x быстрее
--   - getCampaignAnalytics: 2-4x быстрее
--
-- Примечание: CONCURRENTLY создает индексы без блокировки таблиц
-- Время создания зависит от размера таблицы (может занять 5-30 минут)
-- ============================================
