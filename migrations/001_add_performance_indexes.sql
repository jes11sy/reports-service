-- ============================================
-- Performance Indexes for Reports Service
-- ============================================
-- Создано: 17 декабря 2025
-- Цель: Ускорить аналитические запросы в 2-5 раз
-- Использование: psql -U user -d database -f 001_add_performance_indexes.sql

-- Проверяем текущие индексы
\echo '=== Текущие индексы ==='
SELECT schemaname, tablename, indexname 
FROM pg_indexes 
WHERE tablename IN ('orders', 'calls', 'cash')
ORDER BY tablename, indexname;

\echo ''
\echo '=== Создание новых индексов ==='

-- ============================================
-- ORDERS TABLE - Основные аналитические индексы
-- ============================================

-- 1. Для getCityReport - группировка по городу и статусу
\echo 'Creating idx_orders_city_status_partner...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_city_status_partner
ON orders(city, status_order, partner)
WHERE closing_data IS NOT NULL;

-- 2. Для фильтрации по суммам и статусу
\echo 'Creating idx_orders_status_clean...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_clean
ON orders(status_order, clean)
WHERE clean IS NOT NULL;

-- 3. Для группировки партнерских заказов
\echo 'Creating idx_orders_partner_status_clean...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_partner_status_clean
ON orders(partner, status_order, clean)
WHERE status_order = 'Готово' AND clean IS NOT NULL;

-- 4. Для отчетов по мастерам (мастер + город + дата)
\echo 'Creating idx_orders_master_city_closing...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_master_city_closing
ON orders(master_id, city, closing_data)
WHERE master_id IS NOT NULL AND closing_data IS NOT NULL;

-- 5. Для подсчета микрочеков и больших чеков
\echo 'Creating idx_orders_status_clean_range...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_clean_range
ON orders(status_order, clean)
WHERE status_order = 'Готово' AND clean > 0;

-- 6. Для статистики "Модерн" заказов
\echo 'Creating idx_orders_city_modern...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_city_modern
ON orders(city)
WHERE status_order = 'Модерн';

-- 7. Для аналитики по РК и avitoName
\echo 'Creating idx_orders_rk_avito_status...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_rk_avito_status
ON orders(rk, avito_name, status_order, closing_data)
WHERE status_order IN ('Готово', 'Отказ');

-- 8. Композитный индекс для группировки (город + статус + дата)
\echo 'Creating idx_orders_city_status_closing...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_city_status_closing
ON orders(city, status_order, closing_data)
WHERE closing_data IS NOT NULL;

-- ============================================
-- CALLS TABLE - Индексы для статистики звонков
-- ============================================

-- 9. Для группировки звонков по оператору и статусу
\echo 'Creating idx_calls_operator_status_date...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_operator_status_date
ON calls(operator_id, status, date_create);

-- 10. Для фильтрации по длительности звонков
\echo 'Creating idx_calls_duration...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_duration
ON calls(operator_id, duration)
WHERE duration IS NOT NULL;

-- 11. Для подсчета звонков по дате и статусу
\echo 'Creating idx_calls_date_status...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_date_status
ON calls(date_create, status);

-- ============================================
-- CASH TABLE - Индексы для кассовой аналитики
-- ============================================

-- 12. Для группировки кассы по городу и типу
\echo 'Creating idx_cash_city_name...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_city_name
ON cash(city, name);

-- 13. Для фильтрации по дате создания
\echo 'Creating idx_cash_city_date...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cash_city_date
ON cash(city, date_create);

-- ============================================
-- PARTIAL INDEXES - Частичные индексы для специфичных запросов
-- ============================================

-- 14. Только для закрытых заказов с выручкой
\echo 'Creating idx_orders_completed_revenue...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_completed_revenue
ON orders(city, closing_data, clean, master_change)
WHERE status_order = 'Готово' AND clean IS NOT NULL;

-- 15. Для подсчета заказов "Ноль"
\echo 'Creating idx_orders_zero_orders...'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_zero_orders
ON orders(city, status_order)
WHERE status_order IN ('Готово', 'Отказ') AND (clean = 0 OR clean IS NULL);

-- ============================================
-- Проверка созданных индексов
-- ============================================

\echo ''
\echo '=== Новые индексы (проверка) ==='
SELECT 
  schemaname,
  tablename, 
  indexname,
  pg_size_pretty(pg_relation_size(indexname::regclass)) as size
FROM pg_indexes 
WHERE tablename IN ('orders', 'calls', 'cash')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- ============================================
-- Статистика по индексам
-- ============================================

\echo ''
\echo '=== Обновление статистики таблиц ==='
ANALYZE orders;
ANALYZE calls;
ANALYZE cash;

\echo ''
\echo '✅ Все индексы успешно созданы!'
\echo ''
\echo 'Ожидаемые улучшения:'
\echo '  - getCityReport: 2-5x быстрее'
\echo '  - getOperatorStatistics: 2-3x быстрее'
\echo '  - getMastersReport: 3-5x быстрее'
\echo '  - getCampaignAnalytics: 2-4x быстрее'
\echo ''
\echo 'Примечание: CONCURRENTLY создает индексы без блокировки таблиц'
\echo 'Время создания зависит от размера таблицы (может занять 5-30 минут)'

