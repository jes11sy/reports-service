# Reports Service - Deployment Guide

## 🎯 Описание

Расширенный микросервис для отчетов и детальной аналитики бизнес-метрик.

## 📋 Новые возможности

### ✅ Детальная аналитика операторов
- Статистика звонков (всего, принято, пропущено, % ответов)
- Статистика заказов (всего, закрыто, конверсия)
- Средний чек и общая выручка
- Метрики производительности

### ✅ Аналитика по городам
- Звонки и заказы по каждому городу
- Выручка и средний чек
- Конверсия и % закрытия заказов

### ✅ Аналитика РК (рекламных кампаний)
- Эффективность каждой РК
- ROI (возврат инвестиций)
- Конверсия звонков в заказы
- Общая выручка по каждой кампании

### ✅ Дневная метрика
- Ежедневная статистика заказов
- Динамика выручки
- Тренды закрытия заказов

### ✅ Dashboard Data
- Сводная информация за период (день/неделя/месяц)
- Ключевые метрики для дашборда
- Активные операторы
- Заказы в работе

### ✅ Performance Metrics
- Среднее время закрытия заказа
- Среднее время назначения мастера
- Конверсия на каждом этапе воронки
- Финансовые показатели (прибыль, рентабельность)

---

## 🚀 Локальная установка

### 1. Установка зависимостей

```bash
cd api-services/reports-service
npm install
```

### 2. Настройка окружения

Создайте `.env` файл:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/callcentre_crm

# JWT
JWT_SECRET=your-jwt-secret-key

# Server
PORT=5007
CORS_ORIGIN=http://localhost:3000
```

### 3. Prisma миграция

```bash
npx prisma generate
npx prisma db push
```

### 4. Запуск

```bash
npm run start:dev
```

---

## 🐳 Docker Deployment

### 1. Сборка образа

```bash
docker build -t your-registry/reports-service:latest .
```

### 2. Запуск контейнера

```bash
docker run -d \
  --name reports-service \
  -p 5007:5007 \
  -e DATABASE_URL="postgresql://user:pass@postgres:5432/db" \
  -e JWT_SECRET="your-secret" \
  your-registry/reports-service:latest
```

---

## ☸️ Kubernetes Deployment

### 1. Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: reports-service-secrets
  namespace: crm
type: Opaque
stringData:
  DATABASE_URL: "postgresql://user:pass@postgres:5432/db"
  JWT_SECRET: "your-jwt-secret"
```

### 2. Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reports-service
  namespace: crm
spec:
  replicas: 2
  selector:
    matchLabels:
      app: reports-service
  template:
    metadata:
      labels:
        app: reports-service
    spec:
      containers:
      - name: reports-service
        image: your-registry/reports-service:latest
        ports:
        - containerPort: 5007
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: reports-service-secrets
              key: DATABASE_URL
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: reports-service-secrets
              key: JWT_SECRET
        - name: PORT
          value: "5007"
        - name: CORS_ORIGIN
          value: "https://test-shem.ru"
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 5007
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health
            port: 5007
          initialDelaySeconds: 10
          periodSeconds: 5
```

### 3. Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: reports-service
  namespace: crm
spec:
  selector:
    app: reports-service
  ports:
  - protocol: TCP
    port: 5007
    targetPort: 5007
```

---

## 📊 API Examples

### 1. Статистика операторов

```bash
# Все операторы за месяц
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5007/api/v1/analytics/operators?startDate=2024-10-01&endDate=2024-10-31"

# Конкретный оператор
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5007/api/v1/analytics/operators?operatorId=1"
```

**Ответ:**
```json
{
  "success": true,
  "data": [
    {
      "operatorId": 1,
      "operatorName": "Иван Иванов",
      "city": "Москва",
      "status": "работает",
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
  ]
}
```

### 2. Аналитика по городам

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5007/api/v1/analytics/cities?startDate=2024-10-01&endDate=2024-10-31"
```

### 3. Аналитика по РК

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5007/api/v1/analytics/campaigns"
```

### 4. Дневная метрика

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5007/api/v1/analytics/daily?city=Москва"
```

### 5. Dashboard данные

```bash
# За сегодня
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5007/api/v1/analytics/dashboard?period=today"

# За неделю
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5007/api/v1/analytics/dashboard?period=week"
```

### 6. Performance Metrics

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5007/api/v1/analytics/performance?startDate=2024-10-01&endDate=2024-10-31"
```

---

## 📊 Мониторинг

### Health Check

```bash
curl http://localhost:5007/api/health
```

### Logs

```bash
# Docker
docker logs -f reports-service

# Kubernetes
kubectl logs -f deployment/reports-service -n crm
```

---

## 🔧 Интеграция с Frontend

### React/Next.js Example

```typescript
// services/analytics.ts
export const analyticsService = {
  async getOperatorStats(params) {
    const response = await fetch(
      `/api/v1/analytics/operators?${new URLSearchParams(params)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return response.json();
  },

  async getDashboard(period = 'today') {
    const response = await fetch(
      `/api/v1/analytics/dashboard?period=${period}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return response.json();
  },
};

// components/Dashboard.tsx
function Dashboard() {
  const [dashboardData, setDashboardData] = useState(null);

  useEffect(() => {
    analyticsService.getDashboard('today').then(setDashboardData);
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      {dashboardData && (
        <>
          <div>Заказов: {dashboardData.data.orders.total}</div>
          <div>Выручка: {dashboardData.data.revenue.total}</div>
          <div>Конверсия: {dashboardData.data.performance.conversionRate}%</div>
        </>
      )}
    </div>
  );
}
```

---

## 🐛 Troubleshooting

### Медленные запросы

**Проблема:** Запросы аналитики выполняются долго

**Решение:**
```sql
-- Создайте индексы для ускорения запросов
CREATE INDEX IF NOT EXISTS idx_orders_create_date ON orders(create_date);
CREATE INDEX IF NOT EXISTS idx_orders_city_status ON orders(city, status_order);
CREATE INDEX IF NOT EXISTS idx_orders_rk ON orders(rk);
CREATE INDEX IF NOT EXISTS idx_calls_date_create ON calls(date_create);
CREATE INDEX IF NOT EXISTS idx_calls_operator_id ON calls(operator_id);
```

### Неверные данные

**Проблема:** Статистика не совпадает с ожиданиями

**Решение:**
```bash
# Проверьте данные напрямую в БД
psql -U user -d callcentre_crm -c "SELECT COUNT(*) FROM orders WHERE create_date >= '2024-10-01';"

# Проверьте статусы заказов
psql -U user -d callcentre_crm -c "SELECT status_order, COUNT(*) FROM orders GROUP BY status_order;"
```

---

## 📝 Performance Optimization

### Database Indexes

```sql
-- Основные индексы для быстрых запросов
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_create_date 
ON orders(create_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_city_create 
ON orders(city, create_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_rk_create 
ON orders(rk, create_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_operator_create 
ON orders(operator_name_id, create_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_operator_date 
ON calls(operator_id, date_create);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_city_date 
ON calls(city, date_create);
```

### Caching (опционально)

Для дальнейшей оптимизации можно добавить Redis-кеширование:

```typescript
// analytics.service.ts
import { CACHE_MANAGER, Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

async getDashboardData(period: string) {
  const cacheKey = `dashboard:${period}`;
  const cached = await this.cacheManager.get(cacheKey);
  
  if (cached) {
    return cached;
  }

  const data = await this.computeDashboardData(period);
  await this.cacheManager.set(cacheKey, data, { ttl: 300 }); // 5 min
  
  return data;
}
```

---

## ✅ Проверка работоспособности

```bash
# 1. Health check
curl http://localhost:5007/api/health

# 2. Получить статистику операторов
curl -H "Authorization: Bearer <token>" \
  http://localhost:5007/api/v1/analytics/operators

# 3. Получить dashboard
curl -H "Authorization: Bearer <token>" \
  http://localhost:5007/api/v1/analytics/dashboard?period=today

# 4. Swagger UI
open http://localhost:5007/api
```

---

## 🔄 CI/CD

См. `.github/workflows/docker-build.yml`

---

## 📚 Полезные ссылки

- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [ExcelJS Documentation](https://github.com/exceljs/exceljs)

