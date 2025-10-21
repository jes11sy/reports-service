# Reports Service

Микросервис для отчетов и аналитики.

## Функционал

- 📊 Статистика по заказам
- 👷 Отчеты по мастерам
- 💰 Финансовые отчеты
- 📞 Статистика звонков
- 📥 Экспорт в Excel

## API Endpoints

- `GET /api/v1/reports/orders` - статистика заказов
- `GET /api/v1/reports/masters` - отчеты мастеров
- `GET /api/v1/reports/finance` - финансовые отчеты
- `GET /api/v1/reports/calls` - статистика звонков
- `GET /api/v1/reports/export/excel` - экспорт в Excel

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

