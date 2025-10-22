# Reports Service

Расширенный микросервис для отчетов и аналитики с детальной статистикой.

## Функционал

### 📊 Отчеты (Reports)
- Статистика по заказам
- Отчеты по мастерам
- Финансовые отчеты
- Статистика звонков
- Экспорт в Excel

### 📈 Аналитика (Analytics)
- ✅ **Статистика операторов** - детальная статистика по каждому оператору (звонки, заказы, конверсия)
- ✅ **Аналитика по городам** - метрики по городам (звонки, заказы, выручка, конверсия)
- ✅ **Аналитика по РК** - анализ рекламных кампаний (ROI, конверсия, выручка)
- ✅ **Дневная метрика** - ежедневная статистика (заказы, выручка)
- ✅ **Dashboard** - общая аналитика для дашборда (сегодня/неделя/месяц)
- ✅ **Performance Metrics** - метрики производительности (время закрытия заказа, конверсия, прибыль)

## API Endpoints

### Reports
- `GET /api/v1/reports/orders` - статистика заказов
- `GET /api/v1/reports/masters` - отчеты мастеров
- `GET /api/v1/reports/finance` - финансовые отчеты
- `GET /api/v1/reports/calls` - статистика звонков
- `GET /api/v1/reports/export/excel` - экспорт в Excel

### Analytics
- `GET /api/v1/analytics/operators` - статистика операторов
- `GET /api/v1/analytics/cities` - аналитика по городам
- `GET /api/v1/analytics/campaigns` - аналитика по РК
- `GET /api/v1/analytics/daily` - дневная метрика
- `GET /api/v1/analytics/dashboard` - данные для дашборда
- `GET /api/v1/analytics/performance` - метрики производительности

## Переменные окружения

```env
DATABASE_URL=postgresql://...
JWT_SECRET=...
PORT=5007
```

## Запуск

```bash
npm install
npx prisma generate
npm run build
npm run start:prod
```



