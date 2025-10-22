# Changelog - Reports Service

## [2.0.0] - 2024-10-22

### 🚀 Major Features

#### Новый модуль Analytics
Добавлен полноценный модуль аналитики с детальной статистикой бизнес-метрик.

### 📊 Аналитические endpoint'ы

#### 1. Статистика операторов (`GET /api/v1/analytics/operators`)
- ✅ Детальная статистика по каждому оператору
- ✅ Метрики звонков (всего, принято, пропущено, % ответов, средняя длительность)
- ✅ Метрики заказов (всего, закрыто, конверсия, выручка, средний чек)
- ✅ Фильтрация по дате и конкретному оператору
- ✅ Conversion Rate (звонки → заказы)

**Пример ответа:**
```json
{
  "operatorId": 1,
  "operatorName": "Иван Иванов",
  "calls": {
    "total": 150,
    "answered": 120,
    "missed": 30,
    "avgDuration": 180,
    "answerRate": 80.0
  },
  "orders": {
    "total": 45,
    "completed": 30,
    "conversionRate": 37.5,
    "totalRevenue": 450000,
    "avgRevenue": 15000
  }
}
```

#### 2. Аналитика по городам (`GET /api/v1/analytics/cities`)
- ✅ Метрики по каждому городу
- ✅ Звонки (всего, принято)
- ✅ Заказы (всего, закрыто, % закрытия)
- ✅ Выручка (общая, средняя)
- ✅ Конверсия звонков в заказы
- ✅ Сортировка по количеству заказов

**Метрики:**
- Общее количество звонков и заказов
- Процент закрытия заказов
- Средний чек по городу
- Conversion Rate

#### 3. Аналитика по РК (`GET /api/v1/analytics/campaigns`)
- ✅ Эффективность каждой рекламной кампании
- ✅ ROI (Return on Investment)
- ✅ Конверсия звонков в заказы
- ✅ Общая выручка по кампании
- ✅ Средний чек
- ✅ Процент завершения заказов
- ✅ Сортировка по выручке

**Метрики:**
- Звонки и заказы по каждой РК
- ROI на заказ
- Конверсия на каждом этапе воронки

#### 4. Дневная метрика (`GET /api/v1/analytics/daily`)
- ✅ Статистика по дням
- ✅ Количество заказов за день
- ✅ Количество закрытых заказов
- ✅ Выручка за день
- ✅ Фильтрация по дате и городу
- ✅ Сортировка по дате

**Применение:**
- Графики трендов
- Анализ динамики
- Сравнение периодов

#### 5. Dashboard Data (`GET /api/v1/analytics/dashboard`)
- ✅ Сводная информация для дашборда
- ✅ Периоды: сегодня / неделя / месяц
- ✅ Метрики заказов (всего, закрыто, в работе, % закрытия)
- ✅ Метрики выручки (общая, средний чек)
- ✅ Метрики звонков (всего, принято, средняя длительность, % ответов)
- ✅ Метрики производительности (конверсия, активные операторы)

**Пример ответа:**
```json
{
  "period": "today",
  "orders": {
    "total": 45,
    "completed": 30,
    "inProgress": 10,
    "completionRate": 66.67
  },
  "revenue": {
    "total": 450000,
    "avg": 15000
  },
  "calls": {
    "total": 150,
    "answered": 120,
    "avgDuration": 180,
    "answerRate": 80.0
  },
  "performance": {
    "conversionRate": 37.5,
    "activeOperators": 8
  }
}
```

#### 6. Performance Metrics (`GET /api/v1/analytics/performance`)
- ✅ Метрики производительности системы
- ✅ Среднее время закрытия заказа (в часах)
- ✅ Среднее время назначения мастера (в часах)
- ✅ Детальная воронка конверсии
- ✅ Финансовые показатели (выручка, расходы, прибыль, рентабельность)
- ✅ Процент отмен заказов
- ✅ Процент пропущенных звонков

**Метрики:**
- **Заказы:** всего, закрыто, отменено, % закрытия, % отмен
- **Звонки:** всего, принято, пропущено, % ответов, % пропусков
- **Время:** среднее время закрытия заказа, среднее время назначения мастера
- **Финансы:** выручка, расходы, прибыль, рентабельность
- **Конверсия:** звонок → заказ, заказ → закрытие

---

### 🔧 Technical Changes

#### New Module: AnalyticsModule
```typescript
@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
```

#### New Service: AnalyticsService
- `getOperatorStatistics()` - статистика операторов
- `getCityAnalytics()` - аналитика по городам
- `getCampaignAnalytics()` - аналитика по РК
- `getDailyMetrics()` - дневная метрика
- `getDashboardData()` - данные для дашборда
- `getPerformanceMetrics()` - метрики производительности

#### New Controller: AnalyticsController
6 новых endpoint'ов с JWT authentication и RBAC.

---

### 📝 API Changes

#### Новые маршруты

**Analytics:**
- `GET /api/v1/analytics/operators` - статистика операторов
  - Роли: DIRECTOR, CALLCENTRE_ADMIN
  - Query params: `startDate`, `endDate`, `operatorId`

- `GET /api/v1/analytics/cities` - аналитика по городам
  - Роли: DIRECTOR, CALLCENTRE_ADMIN
  - Query params: `startDate`, `endDate`

- `GET /api/v1/analytics/campaigns` - аналитика по РК
  - Роли: DIRECTOR, CALLCENTRE_ADMIN
  - Query params: `startDate`, `endDate`

- `GET /api/v1/analytics/daily` - дневная метрика
  - Роли: DIRECTOR, CALLCENTRE_ADMIN
  - Query params: `startDate`, `endDate`, `city`

- `GET /api/v1/analytics/dashboard` - данные для дашборда
  - Роли: DIRECTOR, CALLCENTRE_ADMIN, OPERATOR
  - Query params: `period` (today/week/month)

- `GET /api/v1/analytics/performance` - метрики производительности
  - Роли: DIRECTOR
  - Query params: `startDate`, `endDate`

---

### 🔒 Security & Access Control

- Все endpoint'ы защищены JWT authentication
- Role-Based Access Control (RBAC)
- Операторы имеют доступ только к dashboard
- Полная аналитика доступна только директорам и администраторам

---

### 📖 Documentation

- ✅ Полное руководство по деплою (DEPLOYMENT.md)
- ✅ Примеры API запросов
- ✅ Интеграция с Frontend (React/Next.js)
- ✅ Performance оптимизация
- ✅ Troubleshooting guide

---

### 🚀 Performance

#### Рекомендуемые индексы для БД

```sql
CREATE INDEX CONCURRENTLY idx_orders_create_date ON orders(create_date);
CREATE INDEX CONCURRENTLY idx_orders_city_create ON orders(city, create_date);
CREATE INDEX CONCURRENTLY idx_orders_rk_create ON orders(rk, create_date);
CREATE INDEX CONCURRENTLY idx_orders_operator_create ON orders(operator_name_id, create_date);
CREATE INDEX CONCURRENTLY idx_calls_operator_date ON calls(operator_id, date_create);
CREATE INDEX CONCURRENTLY idx_calls_city_date ON calls(city, date_create);
```

---

### 💡 Use Cases

#### 1. Мониторинг производительности операторов
```bash
GET /api/v1/analytics/operators?startDate=2024-10-01&endDate=2024-10-31
```
Показывает, какие операторы эффективнее всего работают с клиентами.

#### 2. Анализ эффективности рекламных кампаний
```bash
GET /api/v1/analytics/campaigns?startDate=2024-10-01
```
Определяет, какие РК приносят наибольшую выручку и имеют лучший ROI.

#### 3. Сравнение городов
```bash
GET /api/v1/analytics/cities
```
Показывает, в каких городах лучшая конверсия и выручка.

#### 4. Dashboard в реальном времени
```bash
GET /api/v1/analytics/dashboard?period=today
```
Отображает ключевые метрики на главном экране CRM.

#### 5. Анализ трендов
```bash
GET /api/v1/analytics/daily?startDate=2024-10-01&endDate=2024-10-31&city=Москва
```
Показывает динамику заказов и выручки по дням.

---

### ⚠️ Breaking Changes

**Нет breaking changes.** Все существующие endpoint'ы работают как прежде.

---

### 🔄 Migration from 1.0.0

Никаких миграций не требуется. Просто:

1. Обновите код
2. Установите зависимости: `npm install`
3. Перезапустите сервис

---

## [1.0.0] - 2024-10-01

### Initial Release

- ✅ Статистика по заказам
- ✅ Отчеты по мастерам
- ✅ Финансовые отчеты
- ✅ Статистика звонков
- ✅ Экспорт в Excel
- ✅ JWT аутентификация
- ✅ Swagger документация

