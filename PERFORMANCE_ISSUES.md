# 🐌 Reports Service - Анализ проблем производительности

## Дата анализа: 17 декабря 2025

---

## 🔍 Выявленные проблемы

### 1. ❌ **КРИТИЧНО: N+1 Query Problem**

#### Проблема в `getOperatorStatistics()`
```typescript
// Для КАЖДОГО оператора делается 7 запросов
const operatorStats = await Promise.all(
  operators.map(async (operator) => {
    const [
      totalCalls,
      answeredCalls,
      missedCalls,
      avgCallDuration,
      totalOrders,
      completedOrders,
      totalRevenue,
    ] = await Promise.all([...7 запросов...]);
  })
);
```

**Количество запросов**: `(1 + 7 * N_операторов)`
- При 20 операторах: **141 запрос**
- При 50 операторах: **351 запрос**

**Время выполнения**: 
- Каждый запрос ~10-50ms
- При 20 операторах: **1.4-7 секунд**
- При 50 операторах: **3.5-17.5 секунд**

#### Проблема в `getCityAnalytics()`
```typescript
// Для КАЖДОГО города делается 5 запросов
const cityAnalytics = await Promise.all(
  cities.map(async ({ city }) => {
    const [totalOrders, completedOrders, totalRevenue] = await Promise.all([...]);
    const totalCalls = await this.prisma.call.count({ where: where });
    const answeredCalls = await this.prisma.call.count({ where: { ...where, status: 'answered' } });
  })
);
```

**Количество запросов**: `(1 + 5 * N_городов)`
- При 10 городах: **51 запрос**
- При 20 городах: **101 запрос**

#### Проблема в `getCityReport()` (reports.service.ts)
```typescript
// Для КАЖДОГО города делается 13 запросов
const cityStats = await Promise.all(
  cities.map(async (cityData) => {
    const [
      totalOrders,
      completedOrders,
      notOrders,
      zeroOrders,
      completedWithMoney,
      totalClean,
      totalCleanOur,
      totalCleanPartner,
      totalMasterChange,
      maxCheck,
      microCheckCount,
      over10kCount,
      modernOrders,
    ] = await Promise.all([...13 запросов...]);
  })
);
```

**Количество запросов**: `(1 + 13 * N_городов)`
- При 10 городах: **131 запрос**
- При 20 городах: **261 запрос**

**ИТОГО при загрузке дашборда**: **300+ запросов к БД!**

---

### 2. ⚠️ **Отсутствие кеширования**

Данные запрашиваются заново при каждом обращении, даже если они не изменились за последнюю минуту.

**Типичные запросы**:
- Dashboard обновляется каждые 30 секунд
- Статистика операторов обновляется каждую минуту
- Аналитика по городам обновляется раз в 5 минут

**Проблема**: Излишняя нагрузка на БД и медленный ответ пользователям.

---

### 3. ⚠️ **Неоптимальные индексы**

Хотя в schema.prisma есть индексы, они не покрывают все комбинации:

**Отсутствуют**:
- Композитный индекс `(statusOrder, city, closingData)` для getCityReport
- Индекс `(statusOrder, clean)` для фильтрации по суммам
- Индекс `(partner, statusOrder)` для разделения партнеров

---

### 4. ⚠️ **Тяжелые агрегации**

Множественные `count()` и `aggregate()` на больших таблицах без оптимизации.

**Пример**: 
```typescript
// 3 отдельных count запроса вместо одного group by
await this.prisma.order.count({ where: { ...cityWhere, statusOrder: { in: ['Готово', 'Отказ', 'Незаказ'] } } }),
await this.prisma.order.count({ where: { ...cityWhere, statusOrder: { in: ['Готово', 'Отказ'] } } }),
await this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Незаказ' } }),
```

Можно заменить на один запрос с GROUP BY.

---

## 📊 Измерения производительности

### Текущие метрики (оценочные)

| Endpoint | Запросов к БД | Время (мс) | P95 (мс) |
|----------|---------------|------------|----------|
| `/analytics/operators` | 141 (20 опер) | 1400-7000 | 10000+ |
| `/analytics/cities` | 51 (10 городов) | 500-2500 | 5000+ |
| `/reports/city` | 131 (10 городов) | 1300-6500 | 8000+ |
| `/analytics/dashboard` | 50-100 | 1000-3000 | 5000+ |

### Целевые метрики (после оптимизации)

| Endpoint | Запросов к БД | Время (мс) | P95 (мс) |
|----------|---------------|------------|----------|
| `/analytics/operators` | 5-10 | 100-300 | 500 |
| `/analytics/cities` | 3-5 | 50-150 | 300 |
| `/reports/city` | 3-5 | 100-200 | 400 |
| `/analytics/dashboard` | 5-10 | 100-200 | 400 |

**Ожидаемое ускорение**: **10-30x**

---

## 🚀 План оптимизации

### Шаг 1: Замена N+1 на группировку (КРИТИЧНО)

**Приоритет**: 🔴 ВЫСШИЙ

**Решение**: Использовать `groupBy()` и агрегацию вместо циклов:

```typescript
// БЫЛО (141 запрос):
const operators = await this.prisma.callcentreOperator.findMany();
const operatorStats = await Promise.all(
  operators.map(async (operator) => {
    const totalCalls = await this.prisma.call.count({ where: { operatorId: operator.id } });
    const answeredCalls = await this.prisma.call.count({ where: { operatorId: operator.id, status: 'answered' } });
    // ... еще 5 запросов
  })
);

// СТАЛО (2-3 запроса):
const [operators, callStats, orderStats] = await Promise.all([
  this.prisma.callcentreOperator.findMany(),
  this.prisma.call.groupBy({
    by: ['operatorId', 'status'],
    _count: { id: true },
    _avg: { duration: true },
  }),
  this.prisma.order.groupBy({
    by: ['operatorNameId', 'statusOrder'],
    _count: { id: true },
    _sum: { result: true },
  })
]);

// Собираем данные в памяти (быстро)
const operatorStats = operators.map(operator => {
  const calls = callStats.filter(c => c.operatorId === operator.id);
  const orders = orderStats.filter(o => o.operatorNameId === operator.id);
  return { operator, calls, orders };
});
```

**Эффект**: **50-70x ускорение**, снижение с 141 до 2-3 запросов.

---

### Шаг 2: Добавить Redis кеширование

**Приоритет**: 🟡 СРЕДНИЙ

**Решение**: Кешировать агрегированные данные на 1-5 минут:

```typescript
@Injectable()
export class AnalyticsService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getDashboardData(period: string) {
    const cacheKey = `dashboard:${period}`;
    const cached = await this.cacheManager.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    const data = await this.computeDashboard(period);
    await this.cacheManager.set(cacheKey, data, { ttl: 60 }); // 1 минута
    
    return data;
  }
}
```

**Конфигурация**:
```typescript
// app.module.ts
CacheModule.register({
  store: redisStore,
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  ttl: 60, // 1 минута по умолчанию
})
```

**Эффект**: **90%+ снижение** нагрузки на БД для частых запросов.

---

### Шаг 3: Добавить недостающие индексы

**Приоритет**: 🟠 ВЫСОКИЙ

**Решение**: Добавить композитные индексы для частых комбинаций:

```sql
-- Для getCityReport
CREATE INDEX CONCURRENTLY idx_orders_status_city_closing 
ON orders(status_order, city, closing_data) 
WHERE closing_data IS NOT NULL;

-- Для фильтрации по суммам
CREATE INDEX CONCURRENTLY idx_orders_status_clean 
ON orders(status_order, clean) 
WHERE clean IS NOT NULL;

-- Для разделения партнеров
CREATE INDEX CONCURRENTLY idx_orders_partner_status 
ON orders(partner, status_order);

-- Для операторов
CREATE INDEX CONCURRENTLY idx_calls_operator_status_date 
ON calls(operator_id, status, date_create);

-- Для городов
CREATE INDEX CONCURRENTLY idx_orders_city_status_date 
ON orders(city, status_order, closing_data);
```

**Эффект**: **2-5x ускорение** запросов с фильтрацией.

---

### Шаг 4: Оптимизация агрегаций

**Приоритет**: 🟠 ВЫСОКИЙ

**Решение**: Объединить похожие запросы в один с условной агрегацией:

```sql
-- БЫЛО: 3 отдельных count запроса
SELECT COUNT(*) FROM orders WHERE status_order IN ('Готово', 'Отказ', 'Незаказ');
SELECT COUNT(*) FROM orders WHERE status_order IN ('Готово', 'Отказ');
SELECT COUNT(*) FROM orders WHERE status_order = 'Незаказ';

-- СТАЛО: 1 запрос
SELECT 
  status_order,
  COUNT(*) as cnt
FROM orders
WHERE status_order IN ('Готово', 'Отказ', 'Незаказ')
GROUP BY status_order;
```

**В Prisma**:
```typescript
// Используем groupBy вместо множественных count
const orderStats = await this.prisma.order.groupBy({
  by: ['city', 'statusOrder'],
  where: {
    statusOrder: { in: ['Готово', 'Отказ', 'Незаказ'] },
    closingData: { gte: startDate, lte: endDate }
  },
  _count: { id: true },
  _sum: { clean: true, masterChange: true },
  _max: { clean: true },
});
```

**Эффект**: **5-10x ускорение** за счёт уменьшения количества запросов.

---

### Шаг 5: Materialized Views (опционально)

**Приоритет**: 🟢 НИЗКИЙ (для будущего)

Для очень тяжелых запросов можно создать материализованные представления:

```sql
CREATE MATERIALIZED VIEW mv_daily_city_stats AS
SELECT 
  city,
  DATE(closing_data) as date,
  COUNT(*) as total_orders,
  COUNT(*) FILTER (WHERE status_order = 'Готово') as completed_orders,
  SUM(clean) FILTER (WHERE status_order = 'Готово') as revenue
FROM orders
WHERE closing_data IS NOT NULL
GROUP BY city, DATE(closing_data);

CREATE UNIQUE INDEX ON mv_daily_city_stats(city, date);

-- Обновлять раз в 5 минут через cron
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_city_stats;
```

**Эффект**: **100-1000x ускорение** для исторических данных.

---

## 📋 Чек-лист оптимизации

### Немедленные действия (сегодня)
- [ ] Оптимизировать `getOperatorStatistics()` - заменить N+1 на groupBy
- [ ] Оптимизировать `getCityAnalytics()` - заменить N+1 на groupBy
- [ ] Оптимизировать `getCityReport()` - заменить N+1 на groupBy

### Короткий срок (1-3 дня)
- [ ] Добавить недостающие индексы в БД
- [ ] Оптимизировать `getCampaignAnalytics()`
- [ ] Добавить query-level кеширование (мемоизация)

### Средний срок (1 неделя)
- [ ] Интегрировать Redis для кеширования
- [ ] Настроить TTL для разных типов данных
- [ ] Добавить инвалидацию кеша при обновлении данных

### Долгосрочно (по необходимости)
- [ ] Создать materialized views для исторических отчетов
- [ ] Настроить read replica для аналитических запросов
- [ ] Рассмотреть ClickHouse для OLAP запросов

---

## 🧪 План тестирования

### 1. Benchmarking до оптимизации

```bash
# Замерить текущее время
ab -n 100 -c 10 "https://api.test-shem.ru/api/v1/analytics/operators"
ab -n 100 -c 10 "https://api.test-shem.ru/api/v1/analytics/cities"
ab -n 100 -c 10 "https://api.test-shem.ru/api/v1/reports/city"
```

### 2. Benchmarking после оптимизации

```bash
# Замерить после изменений (ожидаем 10-30x ускорение)
ab -n 100 -c 10 "https://api.test-shem.ru/api/v1/analytics/operators"
```

### 3. Мониторинг БД

```sql
-- Смотрим количество запросов к БД
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
WHERE query LIKE '%orders%'
ORDER BY total_time DESC
LIMIT 20;
```

---

## 📊 Ожидаемые результаты

### После Шага 1 (замена N+1)
- ⚡ Скорость: **10-30x быстрее**
- 📉 Запросы к БД: снижение на **95%**
- 💾 Нагрузка на БД: снижение на **90%**
- ⏱️ Время ответа: с 5-10s до **300-500ms**

### После Шага 2 (Redis кеш)
- ⚡ Скорость для кешированных: **100x быстрее**
- 📉 Запросы к БД: снижение на **80-90%** для частых запросов
- ⏱️ Время ответа: **10-50ms** для кеша

### После Шага 3-4 (индексы + агрегации)
- ⚡ Скорость: дополнительно **2-5x**
- 💾 IO операций: снижение на **70%**

---

## 🚨 Важные замечания

1. **Приоритет**: Начать с Шага 1 (замена N+1) - это даст максимальный эффект при минимальных усилиях

2. **Connection Pool**: Текущий connection_limit=50 достаточен ПОСЛЕ оптимизации N+1. До оптимизации может быть узким местом.

3. **Мониторинг**: Включить детальное логирование медленных запросов (уже есть в PrismaService)

4. **Тестирование**: Обязательно протестировать на dev окружении перед prod

5. **Backwards compatibility**: Все изменения обратно совместимы с API

---

## 📞 Контакты для вопросов

При возникновении проблем:
1. Проверить логи: `kubectl logs -f deployment/reports-service -n crm`
2. Проверить метрики Prisma
3. Проверить pg_stat_statements в PostgreSQL

---

**Статус**: 🔴 ТРЕБУЕТ НЕМЕДЛЕННОГО ВНИМАНИЯ  
**Приоритет**: КРИТИЧНО  
**Оценка времени**: 2-4 часа на Шаг 1, 1-2 дня на полную оптимизацию

